#!/usr/bin/env bash
# Verifies a deployed environment answers correctly through CloudFront.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools
BASE="${1:-$(stack_output "$(stack edge)" SiteUrl)}"
[[ -n "$BASE" && "$BASE" != "None" ]] || die "Could not determine the site URL. Pass it as an argument."

log "Smoke testing ${BASE}"
failures=0

check() {
  local label="$1" url="$2" expect="$3"
  local body
  if body=$(curl -fsS --max-time 20 "$url" 2>/dev/null) && grep -q "$expect" <<<"$body"; then
    info "ok   ${label}"
  else
    printf '    \033[1;31mfail\033[0m %s (%s)\n' "$label" "$url"
    failures=$((failures + 1))
  fi
}

check 'front end loads'   "${BASE}/"                            'Cloud Time Machine'
check 'api metadata'      "${BASE}/api/meta"                    '"companies"'
check 'architecture 2005' "${BASE}/api/architectures/shopcart/2005" '"eraName"'
check 'architecture 2025' "${BASE}/api/architectures/shopcart/2025" 'Well-Architected'
check 'timeline'          "${BASE}/api/architectures/shopcart/timeline" '"snapshots"'
check 'comparison'        "${BASE}/api/architectures/shopcart/2008/compare" '"narrative"'

log "Checking a POST simulation"
if curl -fsS --max-time 30 -X POST "${BASE}/api/simulate/traffic" \
    -H 'content-type: application/json' \
    -d '{"companyId":"shopcart","year":2005,"rps":50000}' | grep -q '"verdict"'; then
  info 'ok   traffic simulation'
else
  printf '    \033[1;31mfail\033[0m traffic simulation\n'
  failures=$((failures + 1))
fi

log "Checking that the load balancer refuses direct traffic"
ALB="$(stack_output "$(stack app)" LoadBalancerDnsName)"
if [[ -n "$ALB" && "$ALB" != "None" ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://${ALB}/healthz" || echo '000')
  if [[ "$code" == "403" || "$code" == "000" ]]; then
    info "ok   direct access blocked (HTTP ${code})"
  else
    printf '    \033[1;31mfail\033[0m the load balancer answered a direct request with %s\n' "$code"
    failures=$((failures + 1))
  fi
fi

if [[ $failures -eq 0 ]]; then
  log 'All checks passed.'
else
  die "${failures} check(s) failed."
fi
