import {
  HOURS_PER_MONTH,
  EC2_HOURLY,
  RDS_HOURLY,
  ELASTICACHE_HOURLY,
  STORAGE_GB_MONTH,
  TRANSFER_GB,
  REQUEST_PRICES,
} from './pricing.js';

/**
 * The service catalog is the single source of truth for every simulator.
 * A node in an architecture graph is `{ id, type, props }` where `type` is a key
 * below; the engines only ever read the fields declared here, so a user-built
 * graph and a stock era graph behave identically.
 *
 * Field meanings
 *   role              placement in the request path, used for topology checks
 *   capacityRps       sustainable requests/sec per unit at p99 < 500ms
 *   security          booleans the security scorer sums with weights
 *   availability      azSpread = how many AZs this node can survive losing
 *   cost(props,usage) monthly estimate plus a human-readable breakdown
 */

const money = (n) => Math.round(n * 100) / 100;

function line(label, amount) {
  return { label, amount: money(amount) };
}

function sum(lines) {
  return money(lines.reduce((acc, l) => acc + l.amount, 0));
}

function build(lines) {
  return { monthly: sum(lines), lines };
}

export const CATALOG = {
  /* ---------------------------------------------------------------- edge */
  route53: {
    label: 'Route 53',
    category: 'Networking',
    role: 'dns',
    icon: 'dns',
    description: 'Managed DNS with health checks and latency-based routing.',
    capacityRps: Infinity,
    security: { identityControl: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 1.0 },
    defaults: { healthChecks: 2 },
    cost: (props, usage) =>
      build([
        line('Hosted zone', REQUEST_PRICES.route53HostedZoneMonth),
        line('Health checks', (props.healthChecks ?? 2) * 0.5),
        line('Queries', (usage.monthlyRequests / 1e6) * 0.4),
      ]),
  },

  cloudfront: {
    label: 'CloudFront',
    category: 'Networking',
    role: 'edge',
    icon: 'cdn',
    description: 'Global CDN that caches at the edge and absorbs L3/L4 floods.',
    capacityRps: Infinity,
    security: { ddosProtection: true, tlsInTransit: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999 },
    defaults: { cacheHitRatio: 0.85 },
    absorbsDdosRatio: 0.9,
    offloadRatio: (props) => props.cacheHitRatio ?? 0.85,
    cost: (props, usage) => {
      const hit = props.cacheHitRatio ?? 0.85;
      return build([
        line('Edge data transfer out', usage.monthlyEgressGb * hit * TRANSFER_GB.cloudFrontEgress),
        line('Requests', (usage.monthlyRequests / 10000) * REQUEST_PRICES.cloudFrontPer10kRequests),
      ]);
    },
  },

  waf: {
    label: 'AWS WAF',
    category: 'Security',
    role: 'security',
    icon: 'shield',
    description: 'Layer-7 firewall: rate limiting, bot control, OWASP rule sets.',
    capacityRps: Infinity,
    security: { waf: true, ddosProtection: true },
    availability: { azSpread: 3, annualUptime: 0.9999 },
    defaults: { rules: 6, rateLimitPerFiveMin: 2000 },
    absorbsDdosRatio: 0.8,
    cost: (props, usage) =>
      build([
        line('Web ACL', REQUEST_PRICES.wafWebAclMonth),
        line('Rules', (props.rules ?? 6) * REQUEST_PRICES.wafRuleMonth),
        line('Inspected requests', (usage.monthlyRequests / 1e6) * REQUEST_PRICES.wafPerMillionRequests),
      ]),
  },

  shieldAdvanced: {
    label: 'Shield Advanced',
    category: 'Security',
    role: 'security',
    icon: 'shield',
    description: 'Paid DDoS response team, cost protection and L7 mitigation.',
    capacityRps: Infinity,
    security: { ddosProtection: true, ddosResponseTeam: true },
    availability: { azSpread: 3, annualUptime: 0.9999 },
    absorbsDdosRatio: 0.98,
    cost: () => build([line('Subscription', REQUEST_PRICES.shieldAdvancedMonth)]),
  },

  /* ------------------------------------------------------------ balancing */
  alb: {
    label: 'Application Load Balancer',
    category: 'Compute',
    role: 'loadBalancer',
    icon: 'balancer',
    description: 'Layer-7 load balancer with health checks across AZs.',
    capacityRps: 50000,
    security: { tlsInTransit: true, networkIsolation: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999 },
    defaults: { azCount: 3 },
    cost: (props, usage) => {
      const lcu = Math.max(usage.peakRps / 1000, usage.monthlyEgressGb / 1000);
      return build([
        line('Hours', REQUEST_PRICES.albHour * HOURS_PER_MONTH),
        line('LCU hours', lcu * REQUEST_PRICES.albLcuHour * HOURS_PER_MONTH),
      ]);
    },
  },

  elbClassic: {
    label: 'Classic Load Balancer',
    category: 'Compute',
    role: 'loadBalancer',
    icon: 'balancer',
    description: 'First-generation ELB: no path routing, no HTTP/2, no WAF hook.',
    capacityRps: 10000,
    security: { tlsInTransit: true },
    availability: { azSpread: 2, managedFailover: true, annualUptime: 0.9995 },
    deprecated: true,
    defaults: { azCount: 2 },
    cost: (props, usage) =>
      build([
        line('Hours', 0.025 * HOURS_PER_MONTH),
        line('Data processed', usage.monthlyEgressGb * 0.008),
      ]),
  },

  hardwareLoadBalancer: {
    label: 'Hardware Load Balancer',
    category: 'Legacy',
    role: 'loadBalancer',
    icon: 'balancer',
    description: 'A physical appliance in one rack: a single point of failure.',
    capacityRps: 8000,
    security: {},
    availability: { azSpread: 0, annualUptime: 0.99 },
    legacy: true,
    cost: () => build([line('Appliance amortised + support', 850)]),
  },

  /* -------------------------------------------------------------- compute */
  singleServer: {
    label: 'Single Physical Server',
    category: 'Legacy',
    role: 'compute',
    icon: 'server',
    description: 'One box in a rack running web, app and database together.',
    capacityRps: 250,
    security: {},
    availability: { azSpread: 0, annualUptime: 0.97 },
    legacy: true,
    defaults: { units: 1 },
    cost: (props) =>
      build([line('Colocation + hardware', 420 * (props.units ?? 1))]),
  },

  ec2: {
    label: 'EC2 Instances',
    category: 'Compute',
    role: 'compute',
    icon: 'server',
    description: 'Virtual machines you size, patch and scale yourself.',
    capacityRps: 800,
    security: { networkIsolation: true },
    availability: { azSpread: 1, annualUptime: 0.995 },
    defaults: { instanceType: 'm5.large', units: 2, azCount: 1 },
    capacityFor: (props) => {
      const perUnit = {
        't3.micro': 150,
        't3.small': 300,
        't3.medium': 550,
        't3.large': 900,
        'm5.large': 1200,
        'm5.xlarge': 2400,
        'm5.2xlarge': 4800,
        'c5.large': 1500,
        'c5.xlarge': 3000,
        'legacy.datacenter': 250,
      }[props.instanceType ?? 'm5.large'] ?? 800;
      return perUnit * (props.units ?? 1);
    },
    cost: (props) => {
      const type = props.instanceType ?? 'm5.large';
      const units = props.units ?? 2;
      const hourly = EC2_HOURLY[type] ?? EC2_HOURLY['m5.large'];
      return build([
        line(`${units} x ${type}`, hourly * units * HOURS_PER_MONTH),
        line('Root EBS gp3', (props.ebsGbPerUnit ?? 30) * units * STORAGE_GB_MONTH.ebsGp3),
      ]);
    },
  },

  autoScalingGroup: {
    label: 'Auto Scaling Group',
    category: 'Compute',
    role: 'compute',
    icon: 'scale',
    description: 'EC2 fleet that grows and shrinks on CloudWatch alarms.',
    capacityRps: 800,
    security: { networkIsolation: true, selfHealing: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9995 },
    elastic: true,
    defaults: { instanceType: 'm5.large', min: 2, max: 20, desired: 3, azCount: 3 },
    capacityFor: (props) => {
      const perUnit = {
        't3.micro': 150,
        't3.small': 300,
        't3.medium': 550,
        't3.large': 900,
        'm5.large': 1200,
        'm5.xlarge': 2400,
        'm5.2xlarge': 4800,
        'c5.large': 1500,
        'c5.xlarge': 3000,
      }[props.instanceType ?? 'm5.large'] ?? 800;
      return perUnit * (props.max ?? props.desired ?? 3);
    },
    steadyCapacity: (props) => {
      const perUnit = {
        'm5.large': 1200,
        'm5.xlarge': 2400,
        't3.medium': 550,
      }[props.instanceType ?? 'm5.large'] ?? 800;
      return perUnit * (props.desired ?? 3);
    },
    cost: (props, usage) => {
      const type = props.instanceType ?? 'm5.large';
      const hourly = EC2_HOURLY[type] ?? EC2_HOURLY['m5.large'];
      // Average fleet size tracks load, floored at `min` and capped at `max`.
      const needed = Math.ceil(usage.averageRps / 1000) || 1;
      const avgUnits = Math.min(Math.max(needed, props.min ?? 2), props.max ?? 20);
      return build([
        line(`~${avgUnits} x ${type} (averaged)`, hourly * avgUnits * HOURS_PER_MONTH),
        line('Root EBS gp3', (props.ebsGbPerUnit ?? 30) * avgUnits * STORAGE_GB_MONTH.ebsGp3),
      ]);
    },
  },

  lambda: {
    label: 'Lambda',
    category: 'Compute',
    role: 'compute',
    icon: 'function',
    description: 'Per-request compute with no instances to manage.',
    capacityRps: 10000,
    security: { networkIsolation: true, selfHealing: true, managedPatching: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9995 },
    elastic: true,
    defaults: { memoryMb: 512, avgDurationMs: 120 },
    cost: (props, usage) => {
      const gbSeconds =
        ((props.memoryMb ?? 512) / 1024) *
        ((props.avgDurationMs ?? 120) / 1000) *
        usage.monthlyRequests;
      return build([
        line('Requests', (usage.monthlyRequests / 1e6) * 0.2),
        line('GB-seconds', gbSeconds * 0.0000166667),
      ]);
    },
  },

  ecsFargate: {
    label: 'ECS on Fargate',
    category: 'Compute',
    role: 'compute',
    icon: 'container',
    description: 'Containers without managing servers; scales per task.',
    capacityRps: 1000,
    security: { networkIsolation: true, managedPatching: true, selfHealing: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9995 },
    elastic: true,
    defaults: { vcpu: 1, memoryGb: 2, tasks: 4 },
    capacityFor: (props) => 1000 * (props.tasks ?? 4),
    cost: (props, usage) => {
      const tasks = Math.max(props.tasks ?? 4, Math.ceil(usage.averageRps / 1000));
      return build([
        line('vCPU hours', tasks * (props.vcpu ?? 1) * 0.04048 * HOURS_PER_MONTH),
        line('Memory GB-hours', tasks * (props.memoryGb ?? 2) * 0.004445 * HOURS_PER_MONTH),
      ]);
    },
  },

  /* ------------------------------------------------------------- database */
  selfHostedDb: {
    label: 'Self-hosted Database',
    category: 'Legacy',
    role: 'database',
    icon: 'database',
    description: 'MySQL on a server you back up by cron, restore by hand.',
    capacityRps: 400,
    security: {},
    availability: { azSpread: 0, annualUptime: 0.97, rtoMinutes: 240, rpoMinutes: 1440 },
    legacy: true,
    defaults: { storageGb: 200 },
    cost: (props) =>
      build([
        line('Server + colocation', 380),
        line('Disks', (props.storageGb ?? 200) * 0.12),
      ]),
  },

  rds: {
    label: 'Amazon RDS',
    category: 'Database',
    role: 'database',
    icon: 'database',
    description: 'Managed relational database with backups and optional Multi-AZ.',
    capacityRps: 3000,
    security: { encryptionAtRest: true, networkIsolation: true, managedPatching: true, automatedBackups: true },
    availability: { azSpread: 1, annualUptime: 0.995, rtoMinutes: 60, rpoMinutes: 5 },
    defaults: {
      instanceClass: 'db.m5.large',
      multiAz: false,
      storageGb: 200,
      readReplicas: 0,
      encrypted: true,
      backupRetentionDays: 7,
    },
    capacityFor: (props) => {
      const perInstance = {
        'db.t3.micro': 200,
        'db.t3.small': 400,
        'db.t3.medium': 900,
        'db.m5.large': 3000,
        'db.m5.xlarge': 6000,
        'db.m5.2xlarge': 12000,
      }[props.instanceClass ?? 'db.m5.large'] ?? 3000;
      // Replicas only absorb reads, assumed 70% of a web workload.
      return perInstance * (1 + 0.7 * (props.readReplicas ?? 0));
    },
    securityFor: (props) => ({
      encryptionAtRest: props.encrypted !== false,
      networkIsolation: true,
      managedPatching: true,
      automatedBackups: (props.backupRetentionDays ?? 7) > 0,
    }),
    availabilityFor: (props) =>
      props.multiAz
        ? { azSpread: 2, managedFailover: true, annualUptime: 0.9995, rtoMinutes: 2, rpoMinutes: 0 }
        : { azSpread: 1, managedFailover: false, annualUptime: 0.995, rtoMinutes: 60, rpoMinutes: 5 },
    cost: (props) => {
      const cls = props.instanceClass ?? 'db.m5.large';
      const hourly = RDS_HOURLY[cls] ?? RDS_HOURLY['db.m5.large'];
      const instances = 1 + (props.multiAz ? 1 : 0) + (props.readReplicas ?? 0);
      const storage = props.storageGb ?? 200;
      return build([
        line(`${instances} x ${cls}`, hourly * instances * HOURS_PER_MONTH),
        line('Storage gp3', storage * instances * STORAGE_GB_MONTH.rdsGp3),
        line('Backups beyond free tier', Math.max(0, storage * 0.5) * 0.095),
      ]);
    },
  },

  aurora: {
    label: 'Aurora',
    category: 'Database',
    role: 'database',
    icon: 'database',
    description: 'MySQL/Postgres-compatible storage layer replicated across 3 AZs.',
    capacityRps: 8000,
    security: { encryptionAtRest: true, networkIsolation: true, managedPatching: true, automatedBackups: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999, rtoMinutes: 1, rpoMinutes: 0 },
    defaults: { instanceClass: 'db.m5.large', replicas: 1, storageGb: 200 },
    capacityFor: (props) => 8000 * (1 + 0.8 * (props.replicas ?? 1)),
    cost: (props) => {
      const hourly = (RDS_HOURLY[props.instanceClass ?? 'db.m5.large'] ?? 0.171) * 1.2;
      const instances = 1 + (props.replicas ?? 1);
      return build([
        line(`${instances} x ${props.instanceClass ?? 'db.m5.large'}`, hourly * instances * HOURS_PER_MONTH),
        line('Cluster storage', (props.storageGb ?? 200) * 0.1),
        line('I/O requests', 18),
      ]);
    },
  },

  dynamodb: {
    label: 'DynamoDB',
    category: 'Database',
    role: 'database',
    icon: 'table',
    description: 'Key-value store with single-digit ms reads at any scale.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true, identityControl: true, managedPatching: true, automatedBackups: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999, rtoMinutes: 0, rpoMinutes: 0 },
    elastic: true,
    defaults: { onDemand: true, storageGb: 50, writeShare: 0.3 },
    cost: (props, usage) => {
      const writes = usage.monthlyRequests * (props.writeShare ?? 0.3);
      const reads = usage.monthlyRequests - writes;
      return build([
        line('Write request units', (writes / 1e6) * REQUEST_PRICES.dynamoWriteRequestUnitMillion),
        line('Read request units', (reads / 1e6) * REQUEST_PRICES.dynamoReadRequestUnitMillion),
        line('Storage', (props.storageGb ?? 50) * REQUEST_PRICES.dynamoStorageGbMonth),
      ]);
    },
  },

  elasticache: {
    label: 'ElastiCache',
    category: 'Database',
    role: 'cache',
    icon: 'cache',
    description: 'In-memory cache that shields the database from read storms.',
    capacityRps: 50000,
    security: { encryptionAtRest: true, networkIsolation: true },
    availability: { azSpread: 2, managedFailover: true, annualUptime: 0.9995 },
    defaults: { nodeType: 'cache.m5.large', nodes: 2, hitRatio: 0.8 },
    offloadRatio: (props) => props.hitRatio ?? 0.8,
    cost: (props) => {
      const hourly = ELASTICACHE_HOURLY[props.nodeType ?? 'cache.m5.large'] ?? 0.156;
      return build([line(`${props.nodes ?? 2} x ${props.nodeType ?? 'cache.m5.large'}`, hourly * (props.nodes ?? 2) * HOURS_PER_MONTH)]);
    },
  },

  /* -------------------------------------------------------------- storage */
  s3: {
    label: 'Amazon S3',
    category: 'Storage',
    role: 'storage',
    icon: 'bucket',
    description: 'Object storage with 11 nines of durability and lifecycle tiering.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true, identityControl: true, versioning: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999 },
    elastic: true,
    defaults: { storageGb: 500, lifecycleToIaDays: 0, lifecycleToGlacierDays: 0, publicAccessBlocked: true },
    securityFor: (props) => ({
      encryptionAtRest: true,
      identityControl: props.publicAccessBlocked !== false,
      publicBucket: props.publicAccessBlocked === false,
      versioning: props.versioning !== false,
    }),
    cost: (props, usage) => {
      const gb = props.storageGb ?? 500;
      const iaShare = props.lifecycleToIaDays ? 0.4 : 0;
      const glacierShare = props.lifecycleToGlacierDays ? 0.35 : 0;
      const stdShare = Math.max(0, 1 - iaShare - glacierShare);
      return build([
        line('Standard', gb * stdShare * STORAGE_GB_MONTH.s3Standard),
        line('Infrequent Access', gb * iaShare * STORAGE_GB_MONTH.s3InfrequentAccess),
        line('Glacier Instant Retrieval', gb * glacierShare * STORAGE_GB_MONTH.s3GlacierInstant),
        line('Requests', (usage.monthlyRequests / 1e6) * 0.4),
      ]);
    },
  },

  ebs: {
    label: 'EBS Volumes',
    category: 'Storage',
    role: 'storage',
    icon: 'disk',
    description: 'Block storage attached to one instance in one AZ.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true },
    availability: { azSpread: 0, annualUptime: 0.999 },
    defaults: { storageGb: 500, volumeType: 'gp3', snapshots: true },
    cost: (props) => {
      const perGb = props.volumeType === 'gp2' ? STORAGE_GB_MONTH.ebsGp2 : STORAGE_GB_MONTH.ebsGp3;
      const gb = props.storageGb ?? 500;
      return build([
        line(`${props.volumeType ?? 'gp3'} volumes`, gb * perGb),
        line('Snapshots', props.snapshots === false ? 0 : gb * 0.3 * 0.05),
      ]);
    },
  },

  glacier: {
    label: 'S3 Glacier Deep Archive',
    category: 'Storage',
    role: 'archive',
    icon: 'archive',
    description: 'Cold archive at ~1/23 of Standard, 12-hour retrieval.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true, identityControl: true, objectLock: true },
    availability: { azSpread: 3, annualUptime: 0.9999 },
    defaults: { storageGb: 5000, monthlyRetrievalGb: 10 },
    cost: (props) =>
      build([
        line('Deep Archive storage', (props.storageGb ?? 5000) * STORAGE_GB_MONTH.s3GlacierDeep),
        line('Retrievals', (props.monthlyRetrievalGb ?? 10) * REQUEST_PRICES.glacierRetrievalGb),
      ]),
  },

  tapeBackup: {
    label: 'Tape Backup',
    category: 'Legacy',
    role: 'archive',
    icon: 'archive',
    description: 'Nightly tapes driven to an offsite vault once a week.',
    capacityRps: Infinity,
    security: { offsiteCopy: true },
    availability: { azSpread: 0, annualUptime: 0.99, rtoMinutes: 1440, rpoMinutes: 1440 },
    legacy: true,
    cost: () => build([line('Media + courier + vault', 260)]),
  },

  /* ------------------------------------------------------ event plumbing */
  sqs: {
    label: 'Amazon SQS',
    category: 'Integration',
    role: 'queue',
    icon: 'queue',
    description: 'Durable queue that decouples spikes from downstream work.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true, identityControl: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999 },
    elastic: true,
    bufferingQueue: true,
    defaults: { dlq: true, messageShare: 0.2 },
    cost: (props, usage) =>
      build([
        line('Requests', ((usage.monthlyRequests * (props.messageShare ?? 0.2)) / 1e6) * REQUEST_PRICES.sqsPerMillion),
      ]),
  },

  sns: {
    label: 'Amazon SNS',
    category: 'Integration',
    role: 'notification',
    icon: 'bell',
    description: 'Fan-out pub/sub for alerts, emails and downstream services.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true, identityControl: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999 },
    elastic: true,
    defaults: { messageShare: 0.05 },
    cost: (props, usage) =>
      build([
        line('Publishes', ((usage.monthlyRequests * (props.messageShare ?? 0.05)) / 1e6) * REQUEST_PRICES.snsPerMillion),
      ]),
  },

  stepFunctions: {
    label: 'Step Functions',
    category: 'Integration',
    role: 'orchestration',
    icon: 'workflow',
    description: 'State machine that retries and tracks multi-step workflows.',
    capacityRps: Infinity,
    security: { identityControl: true, auditTrail: true },
    availability: { azSpread: 3, managedFailover: true, annualUptime: 0.9999 },
    elastic: true,
    defaults: { transitionsPerRequest: 4, requestShare: 0.02 },
    cost: (props, usage) => {
      const transitions =
        usage.monthlyRequests * (props.requestShare ?? 0.02) * (props.transitionsPerRequest ?? 4);
      return build([line('State transitions', (transitions / 1000) * REQUEST_PRICES.stepFunctionsPer1kTransitions)]);
    },
  },

  /* --------------------------------------------------- network & identity */
  vpc: {
    label: 'VPC',
    category: 'Networking',
    role: 'network',
    icon: 'network',
    description: 'Private network with public and private subnets per AZ.',
    capacityRps: Infinity,
    security: { networkIsolation: true, privateSubnets: true, flowLogs: true },
    availability: { azSpread: 3, annualUptime: 1.0 },
    defaults: { azCount: 3, natGateways: 1, flowLogs: true },
    cost: (props, usage) =>
      build([
        line('NAT gateway hours', (props.natGateways ?? 1) * REQUEST_PRICES.natGatewayHour * HOURS_PER_MONTH),
        line('NAT data processing', usage.monthlyEgressGb * 0.1 * REQUEST_PRICES.natGatewayGb),
        line('Flow logs', props.flowLogs === false ? 0 : 6),
      ]),
  },

  securityGroup: {
    label: 'Security Groups',
    category: 'Security',
    role: 'firewall',
    icon: 'lock',
    description: 'Stateful instance-level firewall; least privilege by default.',
    capacityRps: Infinity,
    security: { firewall: true, networkIsolation: true },
    availability: { azSpread: 3, annualUptime: 1.0 },
    defaults: { openToWorld: false },
    securityFor: (props) => ({
      firewall: true,
      networkIsolation: true,
      overlyPermissive: props.openToWorld === true,
    }),
    cost: () => build([line('No charge', 0)]),
  },

  iam: {
    label: 'IAM',
    category: 'Security',
    role: 'identity',
    icon: 'key',
    description: 'Roles and policies instead of long-lived access keys.',
    capacityRps: Infinity,
    security: { identityControl: true, leastPrivilege: true, auditTrail: true },
    availability: { azSpread: 3, annualUptime: 1.0 },
    defaults: { instanceRoles: true, mfaOnRoot: true },
    cost: () => build([line('No charge', 0)]),
  },

  kms: {
    label: 'AWS KMS',
    category: 'Security',
    role: 'encryption',
    icon: 'key',
    description: 'Customer-managed keys with rotation and audited use.',
    capacityRps: Infinity,
    security: { encryptionAtRest: true, keyManagement: true, auditTrail: true },
    availability: { azSpread: 3, annualUptime: 0.99999 },
    defaults: { keys: 1 },
    cost: (props, usage) =>
      build([
        line('Customer managed keys', (props.keys ?? 1) * REQUEST_PRICES.kmsKeyMonth),
        line('API requests', (usage.monthlyRequests / 10000) * REQUEST_PRICES.kmsPer10kRequests * 0.1),
      ]),
  },

  secretsManager: {
    label: 'Secrets Manager',
    category: 'Security',
    role: 'identity',
    icon: 'key',
    description: 'Rotated database credentials instead of a config file.',
    capacityRps: Infinity,
    security: { secretRotation: true, identityControl: true, auditTrail: true },
    availability: { azSpread: 3, annualUptime: 0.9999 },
    defaults: { secrets: 2 },
    cost: (props) => build([line('Secrets', (props.secrets ?? 2) * REQUEST_PRICES.secretsManagerSecretMonth)]),
  },

  /* --------------------------------------------------------- observability */
  cloudwatch: {
    label: 'CloudWatch',
    category: 'Management',
    role: 'observability',
    icon: 'chart',
    description: 'Metrics, logs, alarms and dashboards for every component.',
    capacityRps: Infinity,
    security: { auditTrail: true, monitoring: true },
    availability: { azSpread: 3, annualUptime: 0.9999 },
    defaults: { customMetrics: 40, logGbPerMonth: 30, alarms: 20 },
    cost: (props) =>
      build([
        line('Custom metrics', (props.customMetrics ?? 40) * REQUEST_PRICES.cloudWatchMetricMonth),
        line('Log ingestion', (props.logGbPerMonth ?? 30) * REQUEST_PRICES.cloudWatchLogsGbIngest),
        line('Alarms', (props.alarms ?? 20) * 0.1),
      ]),
  },

  budgets: {
    label: 'AWS Budgets',
    category: 'Management',
    role: 'costControl',
    icon: 'wallet',
    description: 'Spend thresholds that page you before the invoice does.',
    capacityRps: Infinity,
    security: { monitoring: true },
    availability: { azSpread: 3, annualUptime: 0.9999 },
    defaults: { budgets: 2 },
    cost: (props) => build([line('Budget actions', Math.max(0, (props.budgets ?? 2) - 2) * 0.02 * 30)]),
  },

  manualMonitoring: {
    label: 'Manual Monitoring',
    category: 'Legacy',
    role: 'observability',
    icon: 'chart',
    description: 'A Nagios box and someone refreshing a graph at 3am.',
    capacityRps: Infinity,
    security: {},
    availability: { azSpread: 0, annualUptime: 0.99 },
    legacy: true,
    cost: () => build([line('Monitoring server', 60)]),
  },
};

export const NODE_TYPES = Object.keys(CATALOG);

export function getType(type) {
  const def = CATALOG[type];
  if (!def) {
    const err = new Error(`Unknown service type: ${type}`);
    err.status = 400;
    throw err;
  }
  return def;
}

/** Merge a node's props over the catalog defaults. */
export function resolveProps(node) {
  const def = getType(node.type);
  return { ...(def.defaults ?? {}), ...(node.props ?? {}) };
}

/** Effective capacity in requests/sec for a node, honouring its props. */
export function nodeCapacity(node) {
  const def = getType(node.type);
  const props = resolveProps(node);
  if (typeof def.capacityFor === 'function') return def.capacityFor(props);
  return def.capacityRps;
}

/** Security facts for a node, honouring props that weaken or harden it. */
export function nodeSecurity(node) {
  const def = getType(node.type);
  const props = resolveProps(node);
  if (typeof def.securityFor === 'function') return def.securityFor(props);
  return def.security ?? {};
}

/** Availability facts for a node, honouring props such as Multi-AZ. */
export function nodeAvailability(node) {
  const def = getType(node.type);
  const props = resolveProps(node);
  if (typeof def.availabilityFor === 'function') return def.availabilityFor(props);
  return def.availability ?? { azSpread: 0, annualUptime: 0.99 };
}

/** The catalog as a flat list for the frontend palette. */
export function catalogForClient() {
  return NODE_TYPES.map((type) => {
    const def = CATALOG[type];
    return {
      type,
      label: def.label,
      category: def.category,
      role: def.role,
      icon: def.icon,
      description: def.description,
      defaults: def.defaults ?? {},
      legacy: Boolean(def.legacy),
      deprecated: Boolean(def.deprecated),
      elastic: Boolean(def.elastic),
    };
  });
}
