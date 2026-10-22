# What it costs to run

us-east-1 list prices, no discounts. These are estimates for planning; the only
authority on your bill is Cost Explorer.

## Default configuration

What `npm run deploy` creates with no overrides: three AZs, one NAT gateway, two
`t3.small` instances, single-AZ `db.t3.micro`.

| Item | Monthly |
| --- | --- |
| NAT gateway (1 × $0.045/hr + data) | $34 |
| Application Load Balancer (hours + minimal LCU) | $17 |
| EC2 2 × t3.small | $30 |
| EBS 2 × 20 GB gp3 | $3 |
| RDS db.t3.micro + 20 GB gp3 | $15 |
| WAF web ACL + 3 managed rule groups | $8 |
| CloudWatch metrics, logs, 7 alarms | $6 |
| KMS customer-managed key | $1 |
| Secrets Manager (1 secret) | $0.40 |
| S3, DynamoDB, SQS, SNS, Step Functions, CloudFront at low traffic | ~$2 |
| **Total** | **≈ $116/month** |

On a 12-month free-tier account, `t3.micro` instances and `db.t3.micro` are
covered, which brings it to about **$66/month** — the NAT gateway, load balancer
and WAF are the floor.

## Cutting it down

| Change | Saving | What you give up |
| --- | --- | --- |
| `INSTANCE_TYPE=t3.micro MIN_SIZE=1 MAX_SIZE=3` | ~$22 | Headroom, and one instance is a single point of failure |
| Remove the WAF (drop `30-edge`'s web ACL) | ~$8 | Rate limiting and the managed rule sets |
| Replace NAT with VPC endpoints only | ~$34 | Instances can no longer reach the public internet at all |
| Delete the stack when not demonstrating | all of it | It is not running |

The NAT gateway is the single biggest line item in a small deployment and buys
nothing a demo needs: the only outbound call instances make is to S3 and
DynamoDB, which already go through the free gateway endpoints. Removing the NAT
route is the cheapest meaningful change, at the cost of `dnf update` no longer
working at boot — which matters, since user data installs Node.js from the
internet. Doing it properly means baking an AMI.

**Costs nothing to add:** IAM, security groups, VPC endpoints for S3 and
DynamoDB, S3 lifecycle rules, Budgets (up to two), and all three Shield Standard
protections.

## Scaling up

| Change | Added monthly |
| --- | --- |
| `DB_MULTI_AZ=true` | +$15 (a second instance and its storage) |
| `SINGLE_NAT=false` (one NAT per AZ) | +$66 |
| `INSTANCE_TYPE=m5.large`, 3 desired | +$180 |
| `PriceClass_All` on CloudFront | pay per GB at each region's rate |
| Shield Advanced | +$3,000 |

Shield Advanced is in the simulator because it is the right answer at a certain
scale, and in no sense the right answer for this deployment.

## Where the money goes at real scale

The simulator's own cost engine shows the pattern the architecture produces, and
it is consistent: past a few thousand requests per second, **data transfer and
compute dominate, and almost everything else is noise**. That is why the two
highest-value optimisations are nearly always the same two:

1. **A CDN.** Edge egress is cheaper per GB than origin egress, and a cache hit
   consumes no compute at all. At an 85% hit ratio you are paying for 15% of the
   traffic you serve.
2. **A commitment.** Baseline capacity runs every hour of every month. A 1-year
   Compute Savings Plan on the baseline is about 28% off, with burst left
   on-demand.

After those: cache before adding read replicas (a cache absorbs repeated reads
more cheaply per query than another database instance), lifecycle rules on
anything older than a month, and VPC endpoints so AWS-bound traffic skips the
NAT's per-GB charge.

## Guardrails this project deploys

- A monthly budget alerting at 80% actual and 100% forecast, to
  `ALERT_EMAIL`. The forecast alert is the one that matters: it fires while there
  is still time to act.
- Auto Scaling with a `MaxSize` ceiling, so a traffic spike or an attack cannot
  scale the fleet without limit.
- WAF rate limiting, which caps the request volume an attacker can bill you for.
- A CloudWatch alarm on the dead-letter queue, because a retry loop is both an
  outage and a cost.
- S3 lifecycle rules, including expiry of noncurrent versions — with versioning
  on and no expiry rule, deleted objects are stored and billed forever.

A budget does not reduce a bill by itself. It is the control that stops a
runaway cost from running for a full month before anyone notices.
