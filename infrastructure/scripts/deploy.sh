#!/usr/bin/env bash
# Deploys the whole stack, in dependency order, and prints the site URL.
#
#   ENVIRONMENT=prod ALERT_EMAIL=you@example.com ./deploy.sh
#
# Re-running is safe: CloudFormation applies only the differences, and a stack
# with no changes is not an error.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ALERT_EMAIL="${ALERT_EMAIL:-}"
MONTHLY_BUDGET_USD="${MONTHLY_BUDGET_USD:-50}"
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t3.micro}"
DB_MULTI_AZ="${DB_MULTI_AZ:-false}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
MIN_SIZE="${MIN_SIZE:-2}"
MAX_SIZE="${MAX_SIZE:-6}"
SINGLE_NAT="${SINGLE_NAT:-true}"
DOMAIN_NAME="${DOMAIN_NAME:-}"
CERTIFICATE_ARN="${CERTIFICATE_ARN:-}"

require_tools
log "Deploying ${PROJECT_NAME} (${ENVIRONMENT}) to ${AWS_REGION} as account $(account_id)"
info "Version ${APP_VERSION}"
[[ -n "$ALERT_EMAIL" ]] || warn "ALERT_EMAIL is unset, so nothing will be subscribed to the alert topic."

SECRET="$(origin_secret)"
PREFIX_LIST="$(cloudfront_prefix_list)"
[[ -n "$PREFIX_LIST" ]] \
  && info "Restricting the load balancer to CloudFront prefix list ${PREFIX_LIST}" \
  || warn "CloudFront prefix list not found; the load balancer will rely on the origin secret alone."

# 1. Network. Everything else imports its subnets and security groups.
deploy_stack "$(stack network)" "${TEMPLATES}/00-network.yaml" \
  "ProjectName=${PROJECT_NAME}" \
  "Environment=${ENVIRONMENT}" \
  "SingleNatGateway=${SINGLE_NAT}" \
  "CloudFrontPrefixListId=${PREFIX_LIST}"

# 2. Data. The RDS instance is the slow part, typically 8-12 minutes.
deploy_stack "$(stack data)" "${TEMPLATES}/10-data.yaml" \
  "ProjectName=${PROJECT_NAME}" \
  "Environment=${ENVIRONMENT}" \
  "DbInstanceClass=${DB_INSTANCE_CLASS}" \
  "DbMultiAz=${DB_MULTI_AZ}" \
  "AlertEmail=${ALERT_EMAIL}"

ASSETS_BUCKET="$(stack_output "$(stack data)" AssetsBucketName)"
WEB_BUCKET="$(stack_output "$(stack data)" WebBucketName)"

# 3. Build and publish the artefacts the instances download at boot. This must
#    happen before the Auto Scaling Group launches anything.
"${REPO_ROOT}/infrastructure/scripts/build.sh"

log "Uploading API bundle to s3://${ASSETS_BUCKET}/releases/${APP_VERSION}/"
aws s3 cp "${BUILD_DIR}/api.tar.gz" \
  "s3://${ASSETS_BUCKET}/releases/${APP_VERSION}/api.tar.gz" \
  --region "$AWS_REGION"

# 4. Application. Changing AppVersion replaces the launch template, and the
#    rolling update policy replaces instances one at a time.
deploy_stack "$(stack app)" "${TEMPLATES}/20-app.yaml" \
  "ProjectName=${PROJECT_NAME}" \
  "Environment=${ENVIRONMENT}" \
  "InstanceType=${INSTANCE_TYPE}" \
  "MinSize=${MIN_SIZE}" \
  "MaxSize=${MAX_SIZE}" \
  "DesiredCapacity=${MIN_SIZE}" \
  "OriginSecret=${SECRET}" \
  "AppVersion=${APP_VERSION}"

# 5. Front end. Hashed assets can be cached forever; index.html must not be,
#    or a deployment is invisible until the cache expires.
log "Uploading front end to s3://${WEB_BUCKET}/"
aws s3 sync "${BUILD_DIR}/web/" "s3://${WEB_BUCKET}/" \
  --region "$AWS_REGION" --delete \
  --cache-control 'public,max-age=31536000,immutable' \
  --exclude 'index.html'
aws s3 cp "${BUILD_DIR}/web/index.html" "s3://${WEB_BUCKET}/index.html" \
  --region "$AWS_REGION" \
  --cache-control 'no-cache,must-revalidate' \
  --content-type 'text/html'

# 6. Edge.
deploy_stack "$(stack edge)" "${TEMPLATES}/30-edge.yaml" \
  "ProjectName=${PROJECT_NAME}" \
  "Environment=${ENVIRONMENT}" \
  "OriginSecret=${SECRET}" \
  "DomainName=${DOMAIN_NAME}" \
  "CertificateArn=${CERTIFICATE_ARN}"

# 7. Operations. Imports the load balancer and fleet names, so it goes last.
deploy_stack "$(stack ops)" "${TEMPLATES}/40-ops.yaml" \
  "ProjectName=${PROJECT_NAME}" \
  "Environment=${ENVIRONMENT}" \
  "MonthlyBudgetUsd=${MONTHLY_BUDGET_USD}" \
  "BudgetEmail=${ALERT_EMAIL}"

DISTRIBUTION_ID="$(stack_output "$(stack edge)" DistributionId)"
log "Invalidating the CloudFront cache"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" --paths '/*' \
  --query 'Invalidation.Id' --output text

SITE_URL="$(stack_output "$(stack edge)" SiteUrl)"
log "Deployed"
info "Site:      ${SITE_URL}"
info "Dashboard: $(stack_output "$(stack ops)" DashboardUrl)"
info "Version:   ${APP_VERSION}"
info "A new distribution takes a few minutes to finish propagating to the edge."
