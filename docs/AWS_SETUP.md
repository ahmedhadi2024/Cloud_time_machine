# Deploying to AWS

A walkthrough of what `npm run deploy` does, what you have to do yourself, and
what to do when a step fails.

## Before you start

| Requirement | How to check |
| --- | --- |
| AWS CLI v2 | `aws --version` |
| Node.js 20+ | `node -v` |
| Working credentials | `aws sts get-caller-identity` |

The IAM principal needs to create VPCs, EC2, RDS, DynamoDB, S3, CloudFront,
WAFv2, IAM roles, SNS, SQS, Step Functions, CloudWatch, SSM parameters and
Budgets. In practice this is an administrator in an account you are willing to
experiment in. Do not deploy this into a shared production account.

`cfn-lint` is optional but worth having: `pip install cfn-lint`, then
`npm run lint:infra`.

## Deploy

```bash
export AWS_PROFILE=your-profile       # or configure a default profile
export ALERT_EMAIL=you@example.com
export MONTHLY_BUDGET_USD=50
npm run deploy
```

Expect about 20 minutes on a first deployment. Roughly: network 3 min, data
10 min (RDS dominates), app 5 min, edge 5 min (CloudFront), ops 1 min.

### What the script does, in order

1. **Checks prerequisites** and refuses to continue without working credentials.
2. **Reads or generates the origin secret** and stores it as an encrypted SSM
   parameter at `/<project>/<env>/origin-secret`. CloudFront sends it as the
   `x-origin-secret` header; the load balancer's listener returns 403 to any
   request without it. A re-deployment reuses the same value, so the two stacks
   never disagree.
3. **Looks up the CloudFront origin-facing prefix list** so the load balancer's
   security group can reject everything that is not a CloudFront edge. If the
   lookup fails the deployment continues with the origin secret as the only
   gate, and warns.
4. **Deploys `00-network`** — VPC, three public and three private subnets, NAT,
   S3 and DynamoDB gateway endpoints, flow logs for rejected traffic, and the
   four security groups that only allow traffic one direction down the tiers.
5. **Deploys `10-data`** — KMS key with rotation, Multi-AZ-capable RDS with its
   password generated into Secrets Manager, the two DynamoDB tables, the assets
   and web buckets with lifecycle rules, and the SQS/SNS pair.
6. **Builds and uploads the artefacts.** `build.sh` produces `api.tar.gz`
   (source plus production `node_modules`) and the static front end. The tarball
   goes to `s3://<assets-bucket>/releases/<version>/`, which is what instances
   download at boot — so this must happen before the Auto Scaling Group exists.
7. **Deploys `20-app`** — instance role, launch template with IMDSv2 required,
   the ALB with its 403-by-default listener, and the Auto Scaling Group with CPU
   and request-count target tracking.
8. **Uploads the front end**, with hashed assets cached for a year and
   `index.html` marked `no-cache`. Caching `index.html` is the classic way to
   make a deployment invisible for 24 hours.
9. **Deploys `30-edge`** — WAF web ACL (rate limit plus three AWS managed rule
   groups) and the CloudFront distribution with two origins: the web bucket by
   default, the load balancer for `/api/*`.
10. **Deploys `40-ops`** — seven alarms, a six-widget dashboard, the Step
    Functions workflow, and the monthly budget.
11. **Invalidates the CloudFront cache** and prints the site URL.

### Verify

```bash
npm run smoke
```

Checks the front end loads, six API routes answer, a POST simulation runs, and
that the load balancer refuses a request sent straight to its DNS name.

## The four things only you can do

### 1. AWS credentials

Nothing in the repository contains a credential, and nothing should. On EC2 the
application gets its permissions from the instance profile; locally the CLI uses
your profile.

### 2. Confirm the SNS subscription

AWS emails a confirmation link to `ALERT_EMAIL` when the data stack is created.
Alarms fire regardless, but no mail arrives until you click it.

### 3. Switch on Cost Explorer for Budgets

`AWS::Budgets::Budget` needs Cost Explorer enabled once per account, and it can
take up to 24 hours to become usable on a brand-new account. If `40-ops` fails
with a Budgets error, that is why. Everything else is already deployed and
working; re-run `npm run deploy` the next day and it will pick up where it left
off.

### 4. A custom domain, if you want one

Optional. Without it you get `https://d111111abcdef8.cloudfront.net`, on a
valid certificate.

With one:

```bash
# The certificate MUST be in us-east-1, whatever region the rest is in.
aws acm request-certificate --domain-name app.example.com \
  --validation-method DNS --region us-east-1
# Add the validation CNAME, wait for ISSUED, then:
export DOMAIN_NAME=app.example.com
export CERTIFICATE_ARN=arn:aws:acm:us-east-1:...:certificate/...
npm run deploy
```

Then point a Route 53 A/AAAA alias at the distribution's domain name.

## Updating a running deployment

Just re-run `npm run deploy`. Each run stamps a new `APP_VERSION`, which changes
the launch template, and the Auto Scaling rolling update policy replaces
instances one at a time while keeping `MinSize` in service. The target group's
30-second deregistration delay lets in-flight requests finish, so a deployment
does not return 502s.

To redeploy only the front end:

```bash
npm run build
aws s3 sync .build/web/ s3://<web-bucket>/ --delete \
  --cache-control 'public,max-age=31536000,immutable' --exclude index.html
aws s3 cp .build/web/index.html s3://<web-bucket>/index.html \
  --cache-control 'no-cache,must-revalidate'
aws cloudfront create-invalidation --distribution-id <id> --paths '/*'
```

## Troubleshooting

**Instances keep cycling, and the target group has no healthy hosts.**
The API failed to start. Connect with Session Manager — no SSH key or port 22
is needed, the instance role has `AmazonSSMManagedInstanceCore`:

```bash
aws ssm start-session --target i-0123456789abcdef0
sudo systemctl status ctm-api
sudo journalctl -u ctm-api -n 100 --no-pager
sudo cat /var/log/cloud-init-output.log   # user data failures land here
```

The usual cause is the release tarball not being where user data expects it.
Check `aws s3 ls s3://<assets-bucket>/releases/`.

**403 from the site itself.** CloudFront is reaching the load balancer but the
secret header is not matching. Both `20-app` and `30-edge` must have deployed
with the same `OriginSecret`; the SSM parameter is the source of truth, so
re-running the deploy script fixes a mismatch.

**`Export ... cannot be found`.** The stacks were deployed out of order, or an
earlier one is mid-update. Deploy them in numeric order; `deploy.sh` already
does.

**RDS takes ages / `DBInstanceAlreadyExists`.** A previous destroy left a
snapshot and the identifier is taken. Either delete the old instance or change
`ENVIRONMENT`.

**`destroy.sh` leaves the network stack behind.** Something outside
CloudFormation is holding an ENI — usually a NAT gateway or a VPC endpoint still
deleting. Wait a few minutes and re-run.

**The site shows an old version.** `index.html` got cached. Invalidate `/*` and
confirm the upload set `no-cache` on it.

## Deliberate security choices

- The load balancer accepts traffic only from CloudFront ranges, and the
  listener's default action is a 403, so the origin cannot be used directly.
- Nothing is in a public subnet except the load balancer. Instances reach the
  internet through NAT and reach S3 and DynamoDB through gateway endpoints,
  which also avoids NAT data charges.
- IMDSv2 is required and the hop limit is 1, so a server-side request forgery in
  the application cannot read instance credentials.
- No SSH. Session Manager instead, which is audited and needs no open port.
- The database password is generated by Secrets Manager and never appears in a
  template, a parameter, or the repository.
- Every store is encrypted with the same customer-managed KMS key, so key use is
  auditable and rotation is in one place.
- The instance role grants exactly the actions used, scoped to the specific
  table, queue, topic and bucket prefixes — `s3:PutObject` on `designs/*`, not
  on the bucket.
- `systemd` runs the service with `ProtectSystem=strict` and
  `NoNewPrivileges=true`: it cannot write to its own code.
