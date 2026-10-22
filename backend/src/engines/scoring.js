import { getType } from '../data/catalog.js';
import { normaliseGraph, byRole, hasType, byType, nodeAvailability, nodeSecurity } from './graph.js';

/**
 * Security scoring.
 *
 * Each control is worth a fixed number of points and reports back whether it is
 * satisfied, so the UI can show exactly which 18 points are missing rather than
 * only a number. Penalties are applied for active misconfigurations.
 */
const SECURITY_CONTROLS = [
  {
    id: 'network-isolation',
    weight: 12,
    title: 'Private network with isolated subnets',
    pillar: 'Infrastructure protection',
    check: (g) => hasType(g, 'vpc'),
    remedy: 'Place compute and data tiers in a VPC with private subnets; only the load balancer sits in public subnets.',
  },
  {
    id: 'firewall',
    weight: 8,
    title: 'Least-privilege security groups',
    pillar: 'Infrastructure protection',
    check: (g) => byType(g, 'securityGroup').some((n) => n.props.openToWorld !== true),
    remedy: 'Restrict each security group to the port and source it needs; never 0.0.0.0/0 on the application or database tier.',
  },
  {
    id: 'identity',
    weight: 10,
    title: 'IAM roles instead of static credentials',
    pillar: 'Identity and access management',
    check: (g) => hasType(g, 'iam'),
    remedy: 'Attach an instance profile or execution role so no access key is ever written to disk.',
  },
  {
    id: 'encryption-at-rest',
    weight: 12,
    title: 'Encryption at rest on every data store',
    pillar: 'Data protection',
    check: (g) => {
      const stores = [...byRole(g, 'database'), ...byRole(g, 'storage'), ...byRole(g, 'archive')];
      return stores.length > 0 && stores.every((n) => nodeSecurity(n).encryptionAtRest);
    },
    remedy: 'Enable encryption on RDS, EBS, S3 and DynamoDB. It cannot be turned on in place for RDS, so plan a snapshot-and-restore.',
  },
  {
    id: 'key-management',
    weight: 8,
    title: 'Customer-managed KMS keys',
    pillar: 'Data protection',
    check: (g) => hasType(g, 'kms'),
    remedy: 'Use customer-managed keys so key use is audited and rotation is yours to control.',
  },
  {
    id: 'tls',
    weight: 8,
    title: 'TLS in transit at the edge',
    pillar: 'Data protection',
    check: (g) => [...byRole(g, 'edge'), ...byRole(g, 'loadBalancer')].some((n) => nodeSecurity(n).tlsInTransit),
    remedy: 'Terminate HTTPS at CloudFront or the ALB with an ACM certificate and redirect HTTP.',
  },
  {
    id: 'waf',
    weight: 10,
    title: 'Layer-7 firewall in front of the application',
    pillar: 'Infrastructure protection',
    check: (g) => hasType(g, 'waf'),
    remedy: 'Attach a WAF web ACL with the AWS managed rule sets and a rate-based rule.',
  },
  {
    id: 'ddos',
    weight: 8,
    title: 'DDoS absorption at the edge',
    pillar: 'Infrastructure protection',
    check: (g) => g.nodes.some((n) => getType(n.type).absorbsDdosRatio),
    remedy: 'Serve through CloudFront so volumetric traffic is absorbed by the edge network rather than your origin.',
  },
  {
    id: 'secrets',
    weight: 6,
    title: 'Managed, rotated secrets',
    pillar: 'Identity and access management',
    check: (g) => hasType(g, 'secretsManager'),
    remedy: 'Move database credentials into Secrets Manager with automatic rotation.',
  },
  {
    id: 'backups',
    weight: 10,
    title: 'Automated backups with a tested restore',
    pillar: 'Data protection',
    check: (g) => byRole(g, 'database').some((n) => nodeSecurity(n).automatedBackups),
    remedy: 'Keep at least 7 days of automated backups, and verify a restore on a schedule.',
  },
  {
    id: 'monitoring',
    weight: 8,
    title: 'Centralised logging and alarms',
    pillar: 'Detection',
    check: (g) => hasType(g, 'cloudwatch'),
    remedy: 'Ship logs and metrics to CloudWatch with alarms on error rate, latency and saturation.',
  },
];

const SECURITY_PENALTIES = [
  {
    id: 'public-bucket',
    points: 20,
    title: 'Object storage is publicly readable',
    severity: 'critical',
    check: (g) => byType(g, 's3').some((n) => n.props.publicAccessBlocked === false),
    remedy: 'Turn on Block Public Access and serve objects through CloudFront with an origin access control.',
  },
  {
    id: 'open-security-group',
    points: 15,
    title: 'A security group is open to the whole internet',
    severity: 'critical',
    check: (g) => byType(g, 'securityGroup').some((n) => n.props.openToWorld === true),
    remedy: 'Replace 0.0.0.0/0 ingress with the load balancer security group as the source.',
  },
  {
    id: 'unencrypted-db',
    points: 12,
    title: 'A database stores data unencrypted',
    severity: 'high',
    check: (g) => byType(g, 'rds').some((n) => n.props.encrypted === false),
    remedy: 'Snapshot, copy the snapshot with encryption enabled, and restore.',
  },
  {
    id: 'legacy-unmanaged',
    points: 10,
    title: 'Self-managed components have no patch guarantee',
    severity: 'medium',
    check: (g) => g.nodes.some((n) => getType(n.type).legacy),
    remedy: 'Migrate to managed equivalents, or at minimum enrol the hosts in Systems Manager Patch Manager.',
  },
  {
    id: 'no-backup',
    points: 15,
    title: 'No recoverable backup of the primary data store',
    severity: 'critical',
    check: (g) => {
      const dbs = byRole(g, 'database');
      return dbs.length > 0 && !dbs.some((n) => nodeSecurity(n).automatedBackups);
    },
    remedy: 'Enable automated backups with point-in-time recovery.',
  },
];

export function securityScore(graphInput) {
  const graph = normaliseGraph(graphInput);
  const controls = SECURITY_CONTROLS.map((c) => ({
    id: c.id,
    title: c.title,
    pillar: c.pillar,
    weight: c.weight,
    satisfied: Boolean(c.check(graph)),
    remedy: c.remedy,
  }));
  const possible = controls.reduce((acc, c) => acc + c.weight, 0);
  const earned = controls.filter((c) => c.satisfied).reduce((acc, c) => acc + c.weight, 0);

  const findings = SECURITY_PENALTIES.filter((p) => p.check(graph)).map((p) => ({
    id: p.id,
    title: p.title,
    severity: p.severity,
    points: p.points,
    remedy: p.remedy,
  }));
  const penalty = findings.reduce((acc, f) => acc + f.points, 0);

  const raw = (earned / possible) * 100 - penalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score,
    grade: grade(score),
    earned,
    possible,
    penalty,
    controls,
    findings,
    missing: controls.filter((c) => !c.satisfied),
  };
}

function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

/**
 * Availability scoring.
 *
 * Tiers in the request path multiply, because a request needs all of them.
 * Redundant nodes within a tier are treated as parallel, so a tier fails only
 * when every node in it fails.
 */
export function availabilityScore(graphInput) {
  const graph = normaliseGraph(graphInput);
  const tierRoles = ['dns', 'edge', 'loadBalancer', 'compute', 'database', 'storage'];
  const tiers = [];

  for (const role of tierRoles) {
    const nodes = byRole(graph, role);
    if (!nodes.length) continue;
    const failures = nodes.map((n) => 1 - nodeAvailability(n).annualUptime);
    // Parallel nodes: the tier is down only if all of them are down.
    const tierFailure = failures.reduce((acc, f) => acc * f, 1);
    const uptime = 1 - tierFailure;
    tiers.push({
      role,
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        uptime: nodeAvailability(n).annualUptime,
        azSpread: nodeAvailability(n).azSpread,
      })),
      uptime,
      annualDowntimeMinutes: Math.round((1 - uptime) * 525600),
    });
  }

  const composite = tiers.reduce((acc, t) => acc * t.uptime, 1);
  const annualDowntimeMinutes = Math.round((1 - composite) * 525600);

  const singlePoints = [];
  for (const tier of tiers) {
    const redundantInTier = tier.nodes.length > 1;
    for (const node of tier.nodes) {
      if (node.azSpread < 2 && !redundantInTier) {
        singlePoints.push({
          id: node.id,
          label: node.label,
          role: tier.role,
          reason:
            node.azSpread === 0
              ? 'Runs in a single location with no automatic failover.'
              : 'Runs in a single Availability Zone.',
        });
      }
    }
  }

  const recovery = recoveryProfile(graph);

  // Score blends uptime against the single points of failure that cause the
  // long outages an uptime average hides.
  const uptimeScore = Math.max(0, Math.min(100, (composite - 0.95) / 0.0499 * 100));
  const spofPenalty = Math.min(45, singlePoints.length * 15);
  const rtoPenalty = recovery.rtoMinutes > 60 ? 15 : recovery.rtoMinutes > 5 ? 5 : 0;
  const score = Math.max(0, Math.round(uptimeScore - spofPenalty - rtoPenalty));

  return {
    score,
    grade: grade(score),
    compositeUptime: Number(composite.toFixed(6)),
    uptimeLabel: `${(composite * 100).toFixed(3)}%`,
    annualDowntimeMinutes,
    annualDowntimeLabel: humanDowntime(annualDowntimeMinutes),
    tiers,
    singlePointsOfFailure: singlePoints,
    recovery,
  };
}

function recoveryProfile(graph) {
  const dbs = byRole(graph, 'database');
  let rto = 0;
  let rpo = 0;
  for (const db of dbs) {
    const av = nodeAvailability(db);
    rto = Math.max(rto, av.rtoMinutes ?? 0);
    rpo = Math.max(rpo, av.rpoMinutes ?? 0);
  }
  return {
    rtoMinutes: rto,
    rpoMinutes: rpo,
    rtoLabel: humanDowntime(rto),
    rpoLabel: humanDowntime(rpo),
  };
}

export function humanDowntime(minutes) {
  if (minutes <= 0) return 'none';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} days`;
}
