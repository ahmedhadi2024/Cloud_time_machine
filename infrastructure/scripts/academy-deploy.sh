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

source "$(dirname "${BASH_SOURCE[0]}")/academy-common.sh"

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

# ------------------------------------------------------ resolve what exists
# Both of these are referenced by the template but created by the lab, not by
# us. CloudFormation checks they exist while building the changeset, and when
# one is missing or unreadable it fails with an opaque
# AWS::EarlyValidation::ResourceExistenceCheck rather than naming it. Resolving
# them here turns that into a clear message before anything is deployed.

log "Checking what this account provides"

# The instance profile. Learner Labs have shipped it under more than one name.
PROFILE="${INSTANCE_PROFILE_NAME:-}"
if [[ -z "$PROFILE" ]]; then
  for candidate in LabInstanceProfile LabRole EMR_EC2_DefaultRole; do
    if aws iam get-instance-profile --instance-profile-name "$candidate" >/dev/null 2>&1; then
      PROFILE="$candidate"
      break
    fi
  done
fi
if [[ -z "$PROFILE" ]]; then
  # iam:GetInstanceProfile can itself be denied, so fall back to listing.
  PROFILE="$(aws iam list-instance-profiles \
    --query "InstanceProfiles[?contains(InstanceProfileName, 'Lab')].InstanceProfileName | [0]" \
    --output text 2>/dev/null || echo 'None')"
  [[ "$PROFILE" == "None" ]] && PROFILE=""
fi
[[ -n "$PROFILE" ]] || die "$(cat <<'MSG'
Could not find an instance profile to use.

This account has no LabInstanceProfile, and none could be listed. Run:
    aws iam list-instance-profiles --query "InstanceProfiles[*].InstanceProfileName"
then re-run with the name it shows:
    INSTANCE_PROFILE_NAME=<name> npm run deploy:academy
MSG
)"
info "Instance profile: ${PROFILE}"

# The AMI. Reading it here rather than through an SSM parameter type in the
# template means a denied SSM read fails here, with a reason attached.
AMI_ID="${AMI_ID:-}"
if [[ -z "$AMI_ID" ]]; then
  AMI_ID="$(aws ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64 \
    --query Parameter.Value --output text --region "$AWS_REGION" 2>/dev/null || echo '')"
fi
if [[ -z "$AMI_ID" || "$AMI_ID" == "None" ]]; then
  info "SSM parameter unavailable; searching for the newest Amazon Linux 2023 image"
  AMI_ID="$(aws ec2 describe-images \
    --owners amazon \
    --filters 'Name=name,Values=al2023-ami-2023.*-x86_64' 'Name=state,Values=available' \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text --region "$AWS_REGION" 2>/dev/null || echo '')"
fi
[[ -n "$AMI_ID" && "$AMI_ID" != "None" ]] || die "Could not resolve an Amazon Linux 2023 AMI. Pass one with AMI_ID=ami-xxxxxxxx."
info "AMI: ${AMI_ID}"

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
# The bucket has to exist and hold the tarball before the stack is created,
# because instances download it while booting. That is why this script owns it
# rather than the template: CloudFormation cannot create a bucket that already
# exists, and cannot populate one it has not created yet.
log "Publishing the release to s3://${BUCKET}"
if ! aws s3api head-bucket --bucket "$BUCKET" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws s3 mb "s3://${BUCKET}" --region "$AWS_REGION" >/dev/null
  info "Created bucket ${BUCKET}"

  aws s3api put-public-access-block --bucket "$BUCKET" --region "$AWS_REGION" \
    --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' >/dev/null

  aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$AWS_REGION" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null

  # The same tiering the production stack applies, kept so the Glacier
  # lifecycle is still part of what this deployment demonstrates.
  aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$AWS_REGION" \
    --lifecycle-configuration '{"Rules":[{"ID":"tier-cold-objects","Status":"Enabled","Filter":{"Prefix":""},"Transitions":[{"Days":30,"StorageClass":"STANDARD_IA"},{"Days":120,"StorageClass":"GLACIER_IR"}]}]}' >/dev/null

  info "Applied public access block, encryption and lifecycle rules"
fi
aws s3 cp "$BUILD_DIR/api.tar.gz" \
  "s3://${BUCKET}/releases/${APP_VERSION}/api.tar.gz" --region "$AWS_REGION" >/dev/null
info "Uploaded releases/${APP_VERSION}/api.tar.gz"

# --------------------------------------------------------------------- deploy
# Three states block a deploy and none of them can be updated out of: a
# changeset that failed validation leaves REVIEW_IN_PROGRESS, a failed first
# create leaves ROLLBACK_COMPLETE, and a destroy that could not remove
# everything leaves DELETE_FAILED. Each has to be deleted before deploying.
STACK_STATE="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$AWS_REGION" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo 'NONE')"
case "$STACK_STATE" in
  REVIEW_IN_PROGRESS|ROLLBACK_COMPLETE|DELETE_FAILED|CREATE_FAILED)
    log "Clearing the stack left by a previous attempt"
    force_delete_stack "$STACK" "$AWS_REGION" \
      || die "Could not clear stack ${STACK}. Delete it in the CloudFormation console, then re-run."
    ;;
esac

log "Deploying the stack (takes about 5 minutes)"
# Tagging every resource means Resource Groups and Tag Editor can list the
# whole deployment on one screen, across services, which no per-service console
# page does.
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset \
  --tags "Project=${PROJECT_NAME}" "ManagedBy=cloudformation" \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "ReleaseBucket=${BUCKET}" \
    "AppVersion=${APP_VERSION}" \
    "InstanceType=${INSTANCE_TYPE}" \
    "InstanceProfileName=${PROFILE}" \
    "LatestAmiId=${AMI_ID}"

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
