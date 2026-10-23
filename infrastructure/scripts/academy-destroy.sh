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

# CloudFormation cannot delete a bucket that still has objects in it.
if aws s3api head-bucket --bucket "$BUCKET" --region "$AWS_REGION" >/dev/null 2>&1; then
  log "Emptying s3://${BUCKET}"
  aws s3 rm "s3://${BUCKET}" --recursive --region "$AWS_REGION" >/dev/null || true
fi

log "Deleting stack ${STACK}"
aws cloudformation delete-stack --stack-name "$STACK" --region "$AWS_REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$AWS_REGION" \
  || info "The stack did not delete cleanly; check its events in the console."

log "Deleted"
info "Nothing from this deployment is left running."
