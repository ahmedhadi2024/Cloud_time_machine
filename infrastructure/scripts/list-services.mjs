#!/usr/bin/env node
/**
 * Prints every AWS service this project deploys, counted from the
 * CloudFormation templates themselves rather than from a hand-kept list, so it
 * cannot drift out of date. Written in Node rather than bash so it runs on
 * Windows without Git Bash.
 *
 *   npm run services
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const templateDir = join(here, '..', 'cloudformation');

/** CloudFormation namespaces do not always match the product name. */
const SERVICE_NAMES = {
  AutoScaling: 'EC2 Auto Scaling',
  Budgets: 'AWS Budgets',
  CloudFront: 'Amazon CloudFront',
  CloudWatch: 'Amazon CloudWatch',
  DynamoDB: 'Amazon DynamoDB',
  ElasticLoadBalancingV2: 'Elastic Load Balancing (ALB)',
  IAM: 'AWS IAM',
  KMS: 'AWS KMS',
  // CloudWatch Logs is a separate namespace but the same product.
  Logs: 'Amazon CloudWatch',
  RDS: 'Amazon RDS',
  S3: 'Amazon S3',
  SNS: 'Amazon SNS',
  SQS: 'Amazon SQS',
  SSM: 'AWS Systems Manager',
  SecretsManager: 'AWS Secrets Manager',
  StepFunctions: 'AWS Step Functions',
  WAFv2: 'AWS WAF',
};

/**
 * The EC2 namespace covers four products AWS documents and prices separately,
 * so counting it as one service undersells what is actually deployed.
 */
const EC2_SUBSERVICES = {
  LaunchTemplate: 'Amazon EC2',
  SecurityGroup: 'Security Groups',
  VPCEndpoint: 'VPC Endpoints',
  FlowLog: 'VPC Flow Logs',
};

function serviceFor(namespace, resource) {
  if (namespace === 'EC2') return EC2_SUBSERVICES[resource] ?? 'Amazon VPC';
  return SERVICE_NAMES[namespace] ?? namespace;
}

/**
 * Services that are real and in use but declare no resource of their own: they
 * come free with another resource, or are a storage class rather than a type.
 */
const IMPLICIT = [
  ['Amazon EBS', 'Encrypted gp3 root volumes, via the EC2 launch template'],
  ['Amazon S3 Glacier', 'Lifecycle transitions to Glacier IR and Deep Archive'],
  ['AWS Shield Standard', 'Automatic and free with CloudFront and the ALB'],
];

/**
 * academy.yaml is a reduced variant for AWS Academy Learner Lab, not part of
 * the production deployment, so counting it here would overstate what the five
 * numbered stacks actually create. It is reported separately at the end.
 */
const VARIANTS = new Set(['academy.yaml']);

const allTemplates = readdirSync(templateDir).filter((f) => f.endsWith('.yaml')).sort();
const templates = allTemplates.filter((f) => !VARIANTS.has(f));
const byService = new Map();

for (const file of templates) {
  const body = readFileSync(join(templateDir, file), 'utf8');
  for (const match of body.matchAll(/Type:\s+AWS::([A-Za-z0-9]+)::([A-Za-z0-9]+)/g)) {
    const [, namespace, resource] = match;
    const service = serviceFor(namespace, resource);
    if (!byService.has(service)) byService.set(service, { count: 0, types: new Set(), files: new Set() });
    const entry = byService.get(service);
    entry.count += 1;
    entry.types.add(resource);
    entry.files.add(file.replace('.yaml', ''));
  }
}

const rows = [...byService.entries()]
  .map(([service, entry]) => ({
    service,
    resources: entry.count,
    types: [...entry.types].sort().join(', '),
    stacks: [...entry.files].sort().join(', '),
  }))
  .sort((a, b) => a.service.localeCompare(b.service));

const totalResources = rows.reduce((acc, r) => acc + r.resources, 0);

console.log('\nAWS services deployed by Cloud Time Machine');
console.log('Counted from infrastructure/cloudformation/*.yaml\n');

const width = Math.max(...rows.map((r) => r.service.length), 'Service'.length);
console.log(`${'Service'.padEnd(width)}  ${'Res'.padStart(3)}  Stacks`);
console.log(`${'-'.repeat(width)}  ${'-'.repeat(3)}  ${'-'.repeat(30)}`);
for (const row of rows) {
  console.log(`${row.service.padEnd(width)}  ${String(row.resources).padStart(3)}  ${row.stacks}`);
}

console.log('\nAlso in use, with no resource of their own:');
for (const [name, why] of IMPLICIT) {
  console.log(`  ${name.padEnd(width - 2)}  ${why}`);
}

console.log(
  `\n${rows.length} services with declared resources + ${IMPLICIT.length} implicit = ` +
    `${rows.length + IMPLICIT.length} services, ${totalResources} resources across ${templates.length} stacks.`,
);

for (const variant of allTemplates.filter((f) => VARIANTS.has(f))) {
  const body = readFileSync(join(templateDir, variant), 'utf8');
  const services = new Set();
  let count = 0;
  for (const match of body.matchAll(/Type:\s+AWS::([A-Za-z0-9]+)::([A-Za-z0-9]+)/g)) {
    services.add(serviceFor(match[1], match[2]));
    count += 1;
  }
  console.log(
    `\nVariant ${variant}: ${services.size} services, ${count} resources ` +
      '(reduced for AWS Academy Learner Lab; not counted above).',
  );
}
console.log();
