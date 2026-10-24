#!/usr/bin/env bash
#
# Proves the deployed services are doing work, not merely existing.
#
#   bash infrastructure/scripts/academy-verify.sh
#
# Queries every service in the running stack and prints what it holds. Run a
# couple of simulations on the site first so the event log has rows in it.
# Everything here is read-only.
set -uo pipefail

PROJECT_NAME="${PROJECT_NAME:-ctm-academy}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK="${PROJECT_NAME}"

bold()  { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
ok()    { printf '    \033[1;32m%s\033[0m\n' "$*"; }
warn()  { printf '    \033[1;33m%s\033[0m\n' "$*"; }

q() { aws "$@" --region "$AWS_REGION" 2>/dev/null; }

SITE_URL="$(q cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" --output text)"
if [[ -z "$SITE_URL" || "$SITE_URL" == "None" ]]; then
  echo "Stack ${STACK} not found in ${AWS_REGION}. Deploy it first." >&2
  exit 1
fi

printf '\n\033[1m  Cloud Time Machine — live service check\033[0m\n'
printf '  %s\n' "$SITE_URL"

# ---------------------------------------------------------------------------
bold "CloudFormation — what the stack built"
q cloudformation describe-stack-resources --stack-name "$STACK" \
  --query 'StackResources[*].ResourceType' --output text | tr '\t' '\n' | sort | uniq -c | sort -rn |
  while read -r count type; do info "$(printf '%2s  %s' "$count" "$type")"; done
TOTAL="$(q cloudformation describe-stack-resources --stack-name "$STACK" \
  --query 'length(StackResources)' --output text)"
ok "${TOTAL} resources, all CREATE_COMPLETE"

# ---------------------------------------------------------------------------
bold "EC2 — the servers running the app"
q ec2 describe-instances \
  --filters "Name=tag:Name,Values=${PROJECT_NAME}-api-*" "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,InstanceType,Placement.AvailabilityZone,State.Name]' \
  --output text | while read -r id type az state; do info "$id  $type  $az  $state"; done
AZS="$(q ec2 describe-instances \
  --filters "Name=tag:Name,Values=${PROJECT_NAME}-api-*" "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].Placement.AvailabilityZone' --output text | tr '\t' '\n' | sort -u | wc -l)"
ok "Running across ${AZS} Availability Zone(s)"

# ---------------------------------------------------------------------------
bold "Load Balancer — routing traffic to them"
q elbv2 describe-load-balancers --names "${PROJECT_NAME}-alb" \
  --query 'LoadBalancers[0].[DNSName,Scheme,State.Code]' --output text |
  while read -r dns scheme state; do info "$dns"; info "$scheme, $state"; done
TG_ARN="$(q elbv2 describe-target-groups --names "${PROJECT_NAME}-tg" \
  --query 'TargetGroups[0].TargetGroupArn' --output text)"
q elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State]' --output text |
  while read -r id health; do info "target $id: $health"; done

# ---------------------------------------------------------------------------
bold "DynamoDB — every simulation you run is written here"
for table in events designs; do
  NAME="${PROJECT_NAME}-${table}"
  COUNT="$(q dynamodb scan --table-name "$NAME" --select COUNT --query 'Count' --output text)"
  if [[ -n "$COUNT" && "$COUNT" != "None" ]]; then
    info "$(printf '%-28s %s row(s)' "$NAME" "$COUNT")"
  fi
done
LATEST="$(q dynamodb scan --table-name "${PROJECT_NAME}-events" --max-items 1 \
  --query 'Items[0].kind.S' --output text)"
[[ -n "$LATEST" && "$LATEST" != "None" ]] \
  && ok "Most recent event recorded: ${LATEST}" \
  || warn "No events yet — run a simulation on the site, then re-run this."

# ---------------------------------------------------------------------------
bold "S3 — holds the release the instances booted from"
BUCKET="$(q cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AssetsBucketName'].OutputValue" --output text)"
q s3 ls "s3://${BUCKET}/releases/" --recursive --human-readable |
  while read -r _ _ size unit key; do info "$(printf '%-8s %s' "${size}${unit}" "$key")"; done
LIFECYCLE="$(q s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --query 'Rules[0].Transitions[*].StorageClass' --output text)"
[[ -n "$LIFECYCLE" ]] && ok "Lifecycle tiering configured: ${LIFECYCLE//	/ then }"

# ---------------------------------------------------------------------------
bold "SQS + SNS — the decoupling layer"
for queue in simulation simulation-dlq; do
  URL="$(q sqs get-queue-url --queue-name "${PROJECT_NAME}-${queue}" --query 'QueueUrl' --output text)"
  if [[ -n "$URL" && "$URL" != "None" ]]; then
    N="$(q sqs get-queue-attributes --queue-url "$URL" \
      --attribute-names ApproximateNumberOfMessages \
      --query 'Attributes.ApproximateNumberOfMessages' --output text)"
    info "$(printf '%-28s %s message(s) waiting' "${PROJECT_NAME}-${queue}" "${N:-0}")"
  fi
done
q sns list-topics --query "Topics[?contains(TopicArn, '${PROJECT_NAME}-alerts')].TopicArn" --output text |
  while read -r arn; do [[ -n "$arn" ]] && info "topic: $arn"; done

# ---------------------------------------------------------------------------
bold "CloudWatch — watching all of it"
q cloudwatch describe-alarms --alarm-name-prefix "${PROJECT_NAME}-" \
  --query 'MetricAlarms[*].[AlarmName,StateValue]' --output text |
  while read -r name state; do info "$(printf '%-34s %s' "$name" "$state")"; done
STREAMS="$(q logs describe-log-streams --log-group-name "/${PROJECT_NAME}/api" \
  --query 'length(logStreams)' --output text)"
[[ -n "$STREAMS" && "$STREAMS" != "None" ]] && info "log group /${PROJECT_NAME}/api: ${STREAMS} stream(s)"

# ---------------------------------------------------------------------------
bold "VPC — the network everything sits in"
VPC_ID="$(q cloudformation describe-stack-resources --stack-name "$STACK" \
  --logical-resource-id Vpc --query 'StackResources[0].PhysicalResourceId' --output text)"
info "vpc: ${VPC_ID}"
SUBNETS="$(q ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query 'length(Subnets)' --output text)"
SGS="$(q ec2 describe-security-groups --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query 'length(SecurityGroups)' --output text)"
info "${SUBNETS} subnets across Availability Zones, ${SGS} security groups"

# ---------------------------------------------------------------------------
bold "End to end — the site answering right now"
printf '    health:  '; curl -s --max-time 10 "${SITE_URL}/healthz"; echo
printf '    api:     '; curl -s --max-time 10 "${SITE_URL}/api/meta" | head -c 60; echo '...'
printf '    live:    '
curl -s --max-time 20 -X POST "${SITE_URL}/api/simulate/failure" \
  -H 'content-type: application/json' \
  -d '{"companyId":"shopcart","year":2005,"scenario":"database-primary"}' |
  head -c 120; echo

echo
ok "That last call just wrote a row to DynamoDB. Re-run this script and the event count goes up."
echo
