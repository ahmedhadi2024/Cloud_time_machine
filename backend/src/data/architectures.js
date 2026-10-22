import { getCompany, scaleFor } from './companies.js';

/**
 * Era templates.
 *
 * Each era is the architecture a competent team would plausibly be running in
 * that period, parameterised by the company's workload for the chosen year.
 * `evolution` lists what changed since the previous era, which is what the
 * animated timeline narrates.
 */

/** Pick an instance type and count that can serve `peakRps` with headroom. */
function sizeFleet(peakRps, { headroom = 1.4, maxUnits = 40 } = {}) {
  const ladder = [
    { instanceType: 't3.medium', perUnit: 550 },
    { instanceType: 'm5.large', perUnit: 1200 },
    { instanceType: 'm5.xlarge', perUnit: 2400 },
    { instanceType: 'm5.2xlarge', perUnit: 4800 },
  ];
  const target = Math.max(1, peakRps * headroom);
  for (const rung of ladder) {
    const units = Math.ceil(target / rung.perUnit);
    if (units <= maxUnits) return { instanceType: rung.instanceType, units: Math.max(2, units) };
  }
  const top = ladder[ladder.length - 1];
  return { instanceType: top.instanceType, units: Math.ceil(target / top.perUnit) };
}

function sizeDb(peakRps, cacheOffload = 0) {
  const effective = peakRps * (1 - cacheOffload);
  const ladder = [
    { instanceClass: 'db.t3.medium', cap: 900 },
    { instanceClass: 'db.m5.large', cap: 3000 },
    { instanceClass: 'db.m5.xlarge', cap: 6000 },
    { instanceClass: 'db.m5.2xlarge', cap: 12000 },
  ];
  for (const rung of ladder) {
    if (effective <= rung.cap) return { instanceClass: rung.instanceClass, readReplicas: 0 };
  }
  const top = ladder[ladder.length - 1];
  const replicas = Math.min(15, Math.ceil((effective - top.cap) / (top.cap * 0.7)));
  return { instanceClass: top.instanceClass, readReplicas: replicas };
}

const ERAS = [
  {
    year: 2005,
    name: 'One rack, one prayer',
    narrative:
      'Everything runs on hardware you own. Capacity is whatever you bought last quarter, and recovery means driving to the data centre.',
    build: (scale) => ({
      nodes: [
        { id: 'lb', type: 'hardwareLoadBalancer', props: {} },
        { id: 'app', type: 'singleServer', props: { units: Math.max(1, Math.ceil(scale.peakRps / 250)) } },
        { id: 'db', type: 'selfHostedDb', props: { storageGb: Math.max(100, Math.round(scale.storageGb * 0.6)) } },
        { id: 'files', type: 'ebs', props: { storageGb: Math.max(100, Math.round(scale.storageGb * 0.4)), volumeType: 'gp2', snapshots: false } },
        { id: 'tape', type: 'tapeBackup', props: {} },
        { id: 'watch', type: 'manualMonitoring', props: {} },
      ],
      edges: [
        ['lb', 'app'],
        ['app', 'db'],
        ['app', 'files'],
        ['db', 'tape'],
        ['app', 'watch'],
      ],
      evolution: ['Starting point: a single tier with no redundancy anywhere.'],
    }),
  },
  {
    year: 2008,
    name: 'Scale up, then scale up again',
    narrative:
      'The answer to load is a bigger box. The database is split onto its own server and a nightly replica appears, but a failover is still a human decision.',
    build: (scale) => {
      const fleet = sizeFleet(scale.peakRps, { headroom: 1.2 });
      return {
        nodes: [
          { id: 'lb', type: 'hardwareLoadBalancer', props: {} },
          { id: 'app', type: 'ec2', props: { ...fleet, instanceType: 'legacy.datacenter', azCount: 0 } },
          { id: 'db', type: 'selfHostedDb', props: { storageGb: Math.round(scale.storageGb * 0.6) } },
          { id: 'files', type: 'ebs', props: { storageGb: Math.round(scale.storageGb * 0.4), volumeType: 'gp2' } },
          { id: 'tape', type: 'tapeBackup', props: {} },
          { id: 'watch', type: 'manualMonitoring', props: {} },
        ],
        edges: [
          ['lb', 'app'],
          ['app', 'db'],
          ['app', 'files'],
          ['db', 'tape'],
          ['app', 'watch'],
        ],
        evolution: [
          'Application and database separated onto different hosts.',
          'More servers behind the appliance, but still one site and one database.',
        ],
      };
    },
  },
  {
    year: 2011,
    name: 'Lift and shift to EC2',
    narrative:
      'The rack becomes instances. A managed load balancer and a managed database remove the worst of the toil, though capacity is still provisioned by hand.',
    build: (scale) => {
      const fleet = sizeFleet(scale.peakRps);
      const db = sizeDb(scale.peakRps);
      return {
        nodes: [
          { id: 'vpc', type: 'vpc', props: { azCount: 2, natGateways: 1 } },
          { id: 'sg', type: 'securityGroup', props: { openToWorld: true } },
          { id: 'iam', type: 'iam', props: { instanceRoles: false } },
          { id: 'lb', type: 'elbClassic', props: { azCount: 2 } },
          { id: 'app', type: 'ec2', props: { ...fleet, azCount: 2 } },
          { id: 'db', type: 'rds', props: { ...db, multiAz: false, storageGb: Math.round(scale.storageGb * 0.5), encrypted: false, backupRetentionDays: 7 } },
          { id: 'assets', type: 's3', props: { storageGb: Math.round(scale.storageGb * 0.5), publicAccessBlocked: true } },
          { id: 'watch', type: 'cloudwatch', props: { customMetrics: 10, logGbPerMonth: 5, alarms: 4 } },
        ],
        edges: [
          ['vpc', 'lb'],
          ['sg', 'app'],
          ['iam', 'app'],
          ['lb', 'app'],
          ['app', 'db'],
          ['app', 'assets'],
          ['app', 'watch'],
        ],
        evolution: [
          'Physical servers replaced by EC2 inside a VPC.',
          'Database handed to RDS: backups and patching stop being a person.',
          'Static files moved to S3 instead of local disks.',
          'IAM accounts replace a shared root password, though the security groups are still wide open.',
        ],
      };
    },
  },
  {
    year: 2014,
    name: 'Elastic and multi-AZ',
    narrative:
      'Capacity follows demand for the first time. Auto Scaling replaces fixed fleets, RDS goes Multi-AZ, and a CDN takes the static load off the origin.',
    build: (scale) => {
      const fleet = sizeFleet(scale.peakRps);
      const db = sizeDb(scale.peakRps, 0.6);
      return {
        nodes: [
          { id: 'vpc', type: 'vpc', props: { azCount: 3, natGateways: 2 } },
          { id: 'sg', type: 'securityGroup', props: { openToWorld: false } },
          { id: 'iam', type: 'iam', props: { instanceRoles: true } },
          { id: 'cdn', type: 'cloudfront', props: { cacheHitRatio: 0.7 } },
          { id: 'lb', type: 'alb', props: { azCount: 3 } },
          { id: 'app', type: 'autoScalingGroup', props: { instanceType: fleet.instanceType, min: 2, desired: Math.max(2, Math.ceil(fleet.units * 0.6)), max: Math.max(6, fleet.units * 2), azCount: 3 } },
          { id: 'cache', type: 'elasticache', props: { nodes: 2, hitRatio: 0.6 } },
          { id: 'db', type: 'rds', props: { ...db, multiAz: true, storageGb: Math.round(scale.storageGb * 0.35), encrypted: true, backupRetentionDays: 7 } },
          { id: 'assets', type: 's3', props: { storageGb: Math.round(scale.storageGb * 0.65), publicAccessBlocked: true, lifecycleToIaDays: 90 } },
          { id: 'watch', type: 'cloudwatch', props: { customMetrics: 25, logGbPerMonth: 15, alarms: 12 } },
        ],
        edges: [
          ['vpc', 'lb'],
          ['sg', 'app'],
          ['iam', 'app'],
          ['cdn', 'lb'],
          ['cdn', 'assets'],
          ['lb', 'app'],
          ['app', 'cache'],
          ['app', 'db'],
          ['app', 'assets'],
          ['app', 'watch'],
        ],
        evolution: [
          'Auto Scaling Group replaces a fixed EC2 fleet.',
          'RDS switched to Multi-AZ: failover drops from an hour to minutes.',
          'CloudFront added, so cache hits never reach the origin.',
          'ElastiCache put in front of the database for hot reads.',
        ],
      };
    },
  },
  {
    year: 2017,
    name: 'Decoupled and event-driven',
    narrative:
      'Spikes stop being an outage. Queues absorb writes, DynamoDB takes the high-volume event log, and WAF filters the traffic nobody wants.',
    build: (scale) => {
      const fleet = sizeFleet(scale.peakRps);
      const db = sizeDb(scale.peakRps, 0.75);
      return {
        nodes: [
          { id: 'vpc', type: 'vpc', props: { azCount: 3, natGateways: 3 } },
          { id: 'sg', type: 'securityGroup', props: { openToWorld: false } },
          { id: 'iam', type: 'iam', props: { instanceRoles: true, mfaOnRoot: true } },
          { id: 'kms', type: 'kms', props: { keys: 2 } },
          { id: 'waf', type: 'waf', props: { rules: 6 } },
          { id: 'cdn', type: 'cloudfront', props: { cacheHitRatio: 0.82 } },
          { id: 'lb', type: 'alb', props: { azCount: 3 } },
          { id: 'app', type: 'autoScalingGroup', props: { instanceType: fleet.instanceType, min: 3, desired: Math.max(3, Math.ceil(fleet.units * 0.6)), max: Math.max(9, fleet.units * 3), azCount: 3 } },
          { id: 'cache', type: 'elasticache', props: { nodes: 3, hitRatio: 0.75 } },
          { id: 'db', type: 'rds', props: { ...db, multiAz: true, storageGb: Math.round(scale.storageGb * 0.25), encrypted: true, backupRetentionDays: 14 } },
          { id: 'events', type: 'dynamodb', props: { onDemand: true, storageGb: Math.round(scale.storageGb * 0.1), writeShare: 0.4 } },
          { id: 'queue', type: 'sqs', props: { dlq: true, messageShare: 0.25 } },
          { id: 'worker', type: 'autoScalingGroup', props: { instanceType: 't3.medium', min: 2, desired: 3, max: 20, azCount: 3 } },
          { id: 'topic', type: 'sns', props: { messageShare: 0.05 } },
          { id: 'assets', type: 's3', props: { storageGb: Math.round(scale.storageGb * 0.65), publicAccessBlocked: true, lifecycleToIaDays: 60, lifecycleToGlacierDays: 365 } },
          { id: 'watch', type: 'cloudwatch', props: { customMetrics: 60, logGbPerMonth: 60, alarms: 30 } },
        ],
        edges: [
          ['vpc', 'lb'],
          ['sg', 'app'],
          ['iam', 'app'],
          ['kms', 'db'],
          ['kms', 'assets'],
          ['waf', 'cdn'],
          ['cdn', 'lb'],
          ['cdn', 'assets'],
          ['lb', 'app'],
          ['app', 'cache'],
          ['app', 'db'],
          ['app', 'events'],
          ['app', 'queue'],
          ['queue', 'worker'],
          ['worker', 'db'],
          ['worker', 'topic'],
          ['app', 'assets'],
          ['app', 'watch'],
          ['worker', 'watch'],
        ],
        evolution: [
          'SQS inserted between the web tier and slow work, so spikes queue instead of failing.',
          'DynamoDB takes the append-only event log off the relational database.',
          'WAF added in front of CloudFront for rate limiting and bad bots.',
          'KMS customer-managed keys for database and bucket encryption.',
        ],
      };
    },
  },
  {
    year: 2020,
    name: 'Serverless at the edges',
    narrative:
      'The parts with bursty, spiky load stop running on instances at all. Workflows become explicit state machines that retry themselves.',
    build: (scale) => {
      const fleet = sizeFleet(scale.peakRps);
      const db = sizeDb(scale.peakRps, 0.82);
      return {
        nodes: [
          { id: 'vpc', type: 'vpc', props: { azCount: 3, natGateways: 3 } },
          { id: 'sg', type: 'securityGroup', props: { openToWorld: false } },
          { id: 'iam', type: 'iam', props: { instanceRoles: true, mfaOnRoot: true } },
          { id: 'kms', type: 'kms', props: { keys: 3 } },
          { id: 'secrets', type: 'secretsManager', props: { secrets: 3 } },
          { id: 'waf', type: 'waf', props: { rules: 10 } },
          { id: 'cdn', type: 'cloudfront', props: { cacheHitRatio: 0.88 } },
          { id: 'lb', type: 'alb', props: { azCount: 3 } },
          { id: 'app', type: 'autoScalingGroup', props: { instanceType: fleet.instanceType, min: 3, desired: Math.max(3, Math.ceil(fleet.units * 0.5)), max: Math.max(12, fleet.units * 3), azCount: 3 } },
          { id: 'cache', type: 'elasticache', props: { nodes: 3, hitRatio: 0.82 } },
          { id: 'db', type: 'rds', props: { ...db, multiAz: true, storageGb: Math.round(scale.storageGb * 0.2), encrypted: true, backupRetentionDays: 21 } },
          { id: 'events', type: 'dynamodb', props: { onDemand: true, storageGb: Math.round(scale.storageGb * 0.12), writeShare: 0.45 } },
          { id: 'queue', type: 'sqs', props: { dlq: true, messageShare: 0.3 } },
          { id: 'fn', type: 'lambda', props: { memoryMb: 1024, avgDurationMs: 90 } },
          { id: 'flow', type: 'stepFunctions', props: { transitionsPerRequest: 5, requestShare: 0.03 } },
          { id: 'topic', type: 'sns', props: { messageShare: 0.05 } },
          { id: 'assets', type: 's3', props: { storageGb: Math.round(scale.storageGb * 0.6), publicAccessBlocked: true, lifecycleToIaDays: 30, lifecycleToGlacierDays: 180 } },
          { id: 'archive', type: 'glacier', props: { storageGb: Math.round(scale.storageGb * 0.4), monthlyRetrievalGb: 20 } },
          { id: 'watch', type: 'cloudwatch', props: { customMetrics: 120, logGbPerMonth: 150, alarms: 60 } },
          { id: 'budget', type: 'budgets', props: { budgets: 3 } },
        ],
        edges: [
          ['vpc', 'lb'],
          ['sg', 'app'],
          ['iam', 'app'],
          ['iam', 'fn'],
          ['kms', 'db'],
          ['kms', 'assets'],
          ['kms', 'events'],
          ['secrets', 'app'],
          ['waf', 'cdn'],
          ['cdn', 'lb'],
          ['cdn', 'assets'],
          ['lb', 'app'],
          ['app', 'cache'],
          ['app', 'db'],
          ['app', 'events'],
          ['app', 'queue'],
          ['queue', 'fn'],
          ['fn', 'db'],
          ['fn', 'flow'],
          ['flow', 'topic'],
          ['app', 'assets'],
          ['assets', 'archive'],
          ['app', 'watch'],
          ['fn', 'watch'],
          ['watch', 'topic'],
          ['budget', 'topic'],
        ],
        evolution: [
          'Queue consumers moved from EC2 workers to Lambda: no idle capacity.',
          'Step Functions make multi-step jobs observable and automatically retried.',
          'Lifecycle rules tier cold objects to Glacier Deep Archive.',
          'AWS Budgets wired to SNS so spend pages a human.',
        ],
      };
    },
  },
  {
    year: 2025,
    name: 'Well-Architected reference',
    narrative:
      'The target architecture from the proposal: global edge, elastic compute across three AZs, managed data stores, event decoupling, and cost and security controls that are part of the design rather than bolted on.',
    build: (scale) => {
      const fleet = sizeFleet(scale.peakRps);
      const db = sizeDb(scale.peakRps, 0.88);
      return {
        nodes: [
          { id: 'dns', type: 'route53', props: { healthChecks: 3 } },
          { id: 'vpc', type: 'vpc', props: { azCount: 3, natGateways: 3, flowLogs: true } },
          { id: 'sg', type: 'securityGroup', props: { openToWorld: false } },
          { id: 'iam', type: 'iam', props: { instanceRoles: true, mfaOnRoot: true } },
          { id: 'kms', type: 'kms', props: { keys: 4 } },
          { id: 'secrets', type: 'secretsManager', props: { secrets: 4 } },
          { id: 'waf', type: 'waf', props: { rules: 12, rateLimitPerFiveMin: 2000 } },
          { id: 'cdn', type: 'cloudfront', props: { cacheHitRatio: 0.9 } },
          { id: 'lb', type: 'alb', props: { azCount: 3 } },
          { id: 'app', type: 'autoScalingGroup', props: { instanceType: fleet.instanceType, min: 3, desired: Math.max(3, Math.ceil(fleet.units * 0.5)), max: Math.max(15, fleet.units * 4), azCount: 3 } },
          { id: 'cache', type: 'elasticache', props: { nodes: 3, hitRatio: 0.88 } },
          { id: 'db', type: 'rds', props: { ...db, multiAz: true, storageGb: Math.round(scale.storageGb * 0.18), encrypted: true, backupRetentionDays: 30 } },
          { id: 'events', type: 'dynamodb', props: { onDemand: true, storageGb: Math.round(scale.storageGb * 0.12), writeShare: 0.45 } },
          { id: 'queue', type: 'sqs', props: { dlq: true, messageShare: 0.3 } },
          { id: 'fn', type: 'lambda', props: { memoryMb: 1024, avgDurationMs: 80 } },
          { id: 'flow', type: 'stepFunctions', props: { transitionsPerRequest: 6, requestShare: 0.04 } },
          { id: 'topic', type: 'sns', props: { messageShare: 0.05 } },
          { id: 'assets', type: 's3', props: { storageGb: Math.round(scale.storageGb * 0.55), publicAccessBlocked: true, versioning: true, lifecycleToIaDays: 30, lifecycleToGlacierDays: 120 } },
          { id: 'archive', type: 'glacier', props: { storageGb: Math.round(scale.storageGb * 0.45), monthlyRetrievalGb: 25 } },
          { id: 'watch', type: 'cloudwatch', props: { customMetrics: 150, logGbPerMonth: 200, alarms: 90 } },
          { id: 'budget', type: 'budgets', props: { budgets: 4 } },
        ],
        edges: [
          ['dns', 'cdn'],
          ['vpc', 'lb'],
          ['sg', 'app'],
          ['iam', 'app'],
          ['iam', 'fn'],
          ['kms', 'db'],
          ['kms', 'assets'],
          ['kms', 'events'],
          ['kms', 'queue'],
          ['secrets', 'app'],
          ['waf', 'cdn'],
          ['cdn', 'lb'],
          ['cdn', 'assets'],
          ['lb', 'app'],
          ['app', 'cache'],
          ['app', 'db'],
          ['app', 'events'],
          ['app', 'queue'],
          ['queue', 'fn'],
          ['fn', 'db'],
          ['fn', 'events'],
          ['fn', 'flow'],
          ['flow', 'topic'],
          ['app', 'assets'],
          ['assets', 'archive'],
          ['app', 'watch'],
          ['fn', 'watch'],
          ['watch', 'topic'],
          ['budget', 'topic'],
        ],
        evolution: [
          'Route 53 health checks in front of the edge for DNS-level failover.',
          'Three AZs for every stateful tier, with 30 days of backups.',
          'KMS keys cover database, buckets, tables and queues.',
          'Budgets, alarms and flow logs are part of the stack, not an afterthought.',
        ],
      };
    },
  },
];

export const ERA_YEARS = ERAS.map((e) => e.year);

export function eraForYear(year) {
  let chosen = ERAS[0];
  for (const era of ERAS) {
    if (year >= era.year) chosen = era;
  }
  return chosen;
}

function normaliseEdges(edges) {
  return edges.map(([from, to], i) => ({ id: `e${i}-${from}-${to}`, from, to }));
}

/**
 * The architecture for a company in a year: nodes, edges and the narrative the
 * timeline shows while animating into this state.
 */
export function architectureFor(companyId, year) {
  const company = getCompany(companyId);
  const scale = scaleFor(companyId, year);
  const era = eraForYear(year);
  const { nodes, edges, evolution } = era.build(scale, company);
  return {
    companyId,
    companyName: company.name,
    year,
    era: era.year,
    eraName: era.name,
    narrative: era.narrative,
    companyNote: company.story?.[era.year] ?? company.blurb,
    evolution,
    scale,
    nodes,
    edges: normaliseEdges(edges),
  };
}

/** Every era snapshot for a company, used by the timeline scrubber. */
export function timelineFor(companyId) {
  return ERA_YEARS.map((year) => architectureFor(companyId, year));
}

export const MODERN_YEAR = 2025;
