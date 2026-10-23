#!/usr/bin/env bash
#
# Deploys Cloud Time Machine into an AWS Academy Learner Lab.
#
#   bash infrastructure/scripts/academy-deploy.sh
#
# Run it from AWS CloudShell inside the lab (easiest: no credentials to copy),
# or from Git Bash after pasting the lab's CLI credentials into ~/.aws/credentials.
#
# Safe to re-run: CloudFormation applies only the differences.
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-ctm-academy}"
AWS_REGION="${AWS_REGION:-us-east-1}"   # Learner Lab allows us-east-1 and us-west-2
APP_VERSION="${APP_VERSION:-$(date -u +%Y%m%d-%H%M%S)}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
DESIRED_CAPACITY="${DESIRED_CAPACITY:-2}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="${REPO_ROOT}/infrastructure/cloudformation/academy.yaml"
BUILD_DIR="${REPO_ROOT}/.build-academy"
STACK="${PROJECT_NAME}"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

for tool in aws node npm tar; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required but not installed."
done

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "No usable AWS credentials. Start the lab, then copy its CLI credentials (AWS Details -> AWS CLI -> Show)."

BUCKET="${PROJECT_NAME}-assets-${ACCOUNT_ID}"

log "Deploying ${PROJECT_NAME} to ${AWS_REGION} in account ${ACCOUNT_ID}"
info "Version ${APP_VERSION}"

# Learner Lab denies creating IAM roles, so the launch template reuses the
# profile the lab provides. Check it exists before spending ten minutes
# discovering it does not.
if ! aws iam get-instance-profile --instance-profile-name LabInstanceProfile >/dev/null 2>&1; then
  info "WARNING: LabInstanceProfile not found. If this is not a Learner Lab account,"
  info "         pass INSTANCE_PROFILE_NAME=<your profile> or use the full deployment."
fi

# ---------------------------------------------------------------------- build
log "Building the application bundle"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/api"

cd "$REPO_ROOT/frontend"
npm ci >/dev/null 2>&1 || npm install >/dev/null
npm run build >/dev/null
info "Front end built"

cd "$REPO_ROOT/backend"
npm ci --omit=dev >/dev/null 2>&1 || npm install --omit=dev >/dev/null
cp -r src package.json node_modules "$BUILD_DIR/api/"

# There is no CDN in this deployment, so the API serves the front end itself
# from ./public. src/app.js picks that directory up when it exists.
cp -r "$REPO_ROOT/frontend/dist" "$BUILD_DIR/api/public"

tar -czf "$BUILD_DIR/api.tar.gz" -C "$BUILD_DIR/api" .
info "Bundle: $(du -h "$BUILD_DIR/api.tar.gz" | cut -f1)"

# --------------------------------------------------------------------- upload
# The bucket has to exist before the stack, because instances download the
# tarball during boot. CloudFormation adopts it on the first deploy.
log "Publishing the release to s3://${BUCKET}"
if ! aws s3api head-bucket --bucket "$BUCKET" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws s3 mb "s3://${BUCKET}" --region "$AWS_REGION" >/dev/null
  info "Created bucket ${BUCKET}"
fi
aws s3 cp "$BUILD_DIR/api.tar.gz" \
  "s3://${BUCKET}/releases/${APP_VERSION}/api.tar.gz" --region "$AWS_REGION" >/dev/null
info "Uploaded releases/${APP_VERSION}/api.tar.gz"

# --------------------------------------------------------------------- deploy
log "Deploying the stack (takes about 5 minutes)"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "ReleaseBucket=${BUCKET}" \
    "AppVersion=${APP_VERSION}" \
    "InstanceType=${INSTANCE_TYPE}" \
    "DesiredCapacity=${DESIRED_CAPACITY}" \
    "InstanceProfileName=${INSTANCE_PROFILE_NAME:-LabInstanceProfile}"

SITE_URL="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text)"

# ----------------------------------------------------------------- wait + check
log "Waiting for the instances to boot and pass health checks"
info "This takes 2-4 minutes; the load balancer returns 503 until then."
for attempt in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${SITE_URL}/healthz" || echo '000')"
  if [[ "$code" == "200" ]]; then
    info "Healthy after ~$((attempt * 15))s"
    break
  fi
  printf '    attempt %-2s  HTTP %s\n' "$attempt" "$code"
  sleep 15
done

log "Done"
info "Site:      ${SITE_URL}"
info "Stack:     ${STACK}"
info "Version:   ${APP_VERSION}"
echo
info "Checks:"
curl -s --max-time 10 "${SITE_URL}/healthz" && echo
curl -s --max-time 10 "${SITE_URL}/api/meta" | head -c 80 && echo '...'
echo
info "Tear it down with:  bash infrastructure/scripts/academy-destroy.sh"
info "Learner Lab sessions expire, so redeploy on the day of your demo."
