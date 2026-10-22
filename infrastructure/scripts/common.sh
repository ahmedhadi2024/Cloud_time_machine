#!/usr/bin/env bash
# Shared settings and helpers for the deployment scripts.
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-cloud-time-machine}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
# CloudFront-scoped WAF and certificates only exist in us-east-1, so the whole
# stack lives there to keep the edge template in the same region as the rest.
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_VERSION="${APP_VERSION:-$(date -u +%Y%m%d-%H%M%S)}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATES="${REPO_ROOT}/infrastructure/cloudformation"
BUILD_DIR="${REPO_ROOT}/.build"

stack() { echo "${PROJECT_NAME}-${ENVIRONMENT}-$1"; }

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

require_tools() {
  for tool in aws node npm tar; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required but not installed."
  done
  aws sts get-caller-identity >/dev/null 2>&1 \
    || die "No usable AWS credentials. Run 'aws configure' or export AWS_PROFILE."
}

account_id() { aws sts get-caller-identity --query Account --output text; }

stack_exists() {
  aws cloudformation describe-stacks --stack-name "$1" --region "$AWS_REGION" >/dev/null 2>&1
}

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$1" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# Deploy a template, treating "no changes" as success rather than an error.
deploy_stack() {
  local name="$1" template="$2"; shift 2
  log "Deploying stack ${name}"
  local args=(
    cloudformation deploy
    --stack-name "$name"
    --template-file "$template"
    --region "$AWS_REGION"
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM
    --no-fail-on-empty-changeset
    --tags "Project=${PROJECT_NAME}" "Environment=${ENVIRONMENT}" "ManagedBy=cloudformation"
  )
  if [[ $# -gt 0 ]]; then
    args+=(--parameter-overrides "$@")
  fi
  aws "${args[@]}"
}

# The origin secret ties CloudFront to the load balancer. It is generated once
# and kept in SSM Parameter Store so repeat deployments reuse the same value.
origin_secret() {
  local param="/${PROJECT_NAME}/${ENVIRONMENT}/origin-secret"
  local existing
  if existing=$(aws ssm get-parameter --name "$param" --with-decryption \
      --region "$AWS_REGION" --query Parameter.Value --output text 2>/dev/null); then
    echo "$existing"
    return
  fi
  local generated
  generated=$(openssl rand -hex 24 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')
  aws ssm put-parameter --name "$param" --value "$generated" --type SecureString \
    --region "$AWS_REGION" --overwrite >/dev/null
  echo "$generated"
}

# The managed prefix list of CloudFront's origin-facing ranges, so the load
# balancer's security group can exclude everything else. Empty if unavailable,
# in which case the listener's secret-header rule is the only gate.
cloudfront_prefix_list() {
  aws ec2 describe-managed-prefix-lists \
    --region "$AWS_REGION" \
    --filters 'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing' \
    --query 'PrefixLists[0].PrefixListId' --output text 2>/dev/null | grep -E '^pl-' || echo ''
}
