#!/usr/bin/env bash
# Shared helpers for the AWS Academy scripts. Sourced, never run directly.

# Delete a stack, including one already stuck in DELETE_FAILED.
#
# A plain delete-stack is enough almost always. When it is not, something in
# the stack refuses to go — usually a VPC still holding a network interface the
# load balancer has not finished releasing. CloudFormation then parks the stack
# in DELETE_FAILED, where it can neither be updated nor deployed over, which is
# the state this exists to get out of.
#
# The second attempt abandons exactly the resources that refused, which is the
# only way to clear that state. Abandoned resources keep existing and are named
# on the way out, because the next deploy will collide with any of them that
# carry a fixed name.
force_delete_stack() {
  local stack="$1" region="$2"
  local state

  state="$(aws cloudformation describe-stacks --stack-name "$stack" --region "$region" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo 'NONE')"
  [[ "$state" == "NONE" ]] && return 0

  printf '    stack is %s; deleting\n' "$state"
  aws cloudformation delete-stack --stack-name "$stack" --region "$region" >/dev/null 2>&1 || true
  if aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$region" 2>/dev/null; then
    printf '    deleted cleanly\n'
    return 0
  fi

  local stuck
  stuck="$(aws cloudformation describe-stack-events --stack-name "$stack" --region "$region" \
    --query "StackEvents[?ResourceStatus=='DELETE_FAILED'].LogicalResourceId" \
    --output text 2>/dev/null | tr '\t' '\n' | sort -u | tr '\n' ' ')"

  if [[ -z "${stuck// /}" ]]; then
    printf '    could not delete the stack and nothing reported DELETE_FAILED.\n'
    printf '    Check its events in the CloudFormation console.\n'
    return 1
  fi

  printf '    these refused to delete: %s\n' "$stuck"
  printf '    retrying while abandoning them\n'
  # shellcheck disable=SC2086 — the list must expand into separate arguments.
  aws cloudformation delete-stack --stack-name "$stack" --region "$region" \
    --retain-resources $stuck >/dev/null 2>&1 || true
  aws cloudformation wait stack-delete-complete --stack-name "$stack" --region "$region" 2>/dev/null || true

  state="$(aws cloudformation describe-stacks --stack-name "$stack" --region "$region" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo 'NONE')"
  if [[ "$state" == "NONE" ]]; then
    printf '    stack removed. Still present and no longer managed: %s\n' "$stuck"
    printf '    Delete those by hand if a later deploy reports a name conflict.\n'
    return 0
  fi

  printf '    stack is still %s. Delete it from the CloudFormation console.\n' "$state"
  return 1
}
