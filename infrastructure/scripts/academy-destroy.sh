#!/usr/bin/env bash
#
# Removes the AWS Academy deployment and the release bucket it used.
#
#   bash infrastructure/scripts/academy-destroy.sh
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-ctm-academy}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK="${PROJECT_NAME}"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "No usable AWS credentials. Start the lab and copy its CLI credentials first."

BUCKET="${PROJECT_NAME}-assets-${ACCOUNT_ID}"

log "Deleting stack ${STACK}"
aws cloudformation delete-stack --stack-name "$STACK" --region "$AWS_REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$AWS_REGION" \
  || info "The stack did not delete cleanly; check its events in the console."

# The release bucket is created by academy-deploy.sh rather than by the stack,
# so CloudFormation does not remove it. Instances no longer need it once the
# stack is gone, so it goes last.
if aws s3api head-bucket --bucket "$BUCKET" --region "$AWS_REGION" >/dev/null 2>&1; then
  log "Removing s3://${BUCKET}"
  aws s3 rm "s3://${BUCKET}" --recursive --region "$AWS_REGION" >/dev/null || true
  aws s3 rb "s3://${BUCKET}" --region "$AWS_REGION" >/dev/null || \
    info "Could not delete the bucket; remove it by hand if you want it gone."
fi

log "Deleted"
info "Nothing from this deployment is left running."
