#!/usr/bin/env bash
# Tears the environment down in reverse dependency order.
#
# Retained on purpose, because they hold data: the saved-designs table, the
# assets bucket, and the final RDS snapshot. The script names them at the end
# so nothing is deleted silently and nothing is left behind unknowingly.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools

cat <<WARNING

This will delete the ${PROJECT_NAME} ${ENVIRONMENT} environment in ${AWS_REGION}:
  $(stack ops), $(stack edge), $(stack app), $(stack data), $(stack network)

WARNING
read -r -p "Type the environment name (${ENVIRONMENT}) to continue: " confirm
[[ "$confirm" == "$ENVIRONMENT" ]] || die 'Aborted.'

WEB_BUCKET="$(stack_output "$(stack data)" WebBucketName 2>/dev/null || echo '')"

for name in "$(stack ops)" "$(stack edge)"; do
  if stack_exists "$name"; then
    log "Deleting ${name}"
    aws cloudformation delete-stack --stack-name "$name" --region "$AWS_REGION"
    aws cloudformation wait stack-delete-complete --stack-name "$name" --region "$AWS_REGION"
  fi
done

# The web bucket is not retained, and CloudFormation cannot delete a bucket
# that still has objects in it.
if [[ -n "$WEB_BUCKET" && "$WEB_BUCKET" != "None" ]]; then
  log "Emptying s3://${WEB_BUCKET}"
  aws s3 rm "s3://${WEB_BUCKET}" --recursive --region "$AWS_REGION" || true
fi

for name in "$(stack app)" "$(stack data)" "$(stack network)"; do
  if stack_exists "$name"; then
    log "Deleting ${name}"
    aws cloudformation delete-stack --stack-name "$name" --region "$AWS_REGION"
    aws cloudformation wait stack-delete-complete --stack-name "$name" --region "$AWS_REGION" || \
      warn "${name} did not delete cleanly. Check the stack events; a retained resource may need removing by hand."
  fi
done

log 'Deleted. These were kept on purpose and still cost money:'
info "S3 bucket  ${PROJECT_NAME}-${ENVIRONMENT}-assets-$(account_id)"
info "DynamoDB   ${PROJECT_NAME}-${ENVIRONMENT}-designs"
info "RDS        the final snapshot of ${PROJECT_NAME}-${ENVIRONMENT}"
info "SSM        /${PROJECT_NAME}/${ENVIRONMENT}/origin-secret"
info 'Remove them by hand once you are sure you do not want the data.'
