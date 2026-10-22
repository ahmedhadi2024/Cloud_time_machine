import { getType } from '../data/catalog.js';
import { normaliseGraph, byRole, byType, hasType, outgoing, incoming, orphanNodes } from './graph.js';
import { securityScore, availabilityScore } from './scoring.js';
import { estimateCost, optimiseCost } from './cost.js';
import { simulateTraffic } from './traffic.js';

/**
 * Review a user-built architecture.
 *
 * Returns structural findings (things that are wrong or missing), the same
 * security/availability/cost scores the stock architectures get, and a single
 * overall grade so the drag-and-drop builder can be scored against the
 * reference design.
 */

const STRUCTURE_RULES = [
  {
    id: 'no-compute',
    severity: 'error',
    title: 'Nothing serves requests',
    check: (g) => byRole(g, 'compute').length === 0,
    detail: 'Add EC2, an Auto Scaling Group, ECS or Lambda: something has to run the application.',
  },
  {
    id: 'no-database',
    severity: 'warning',
    title: 'No data store',
    check: (g) => byRole(g, 'database').length === 0 && byRole(g, 'storage').length === 0,
    detail: 'Almost every application needs somewhere to keep state. Add RDS, DynamoDB or S3.',
  },
  {
    id: 'compute-not-behind-lb',
    severity: 'error',
    title: 'Compute is exposed directly to users',
    check: (g) => {
      const compute = byRole(g, 'compute');
      if (!compute.length) return false;
      const lbIds = byRole(g, 'loadBalancer').map((n) => n.id);
      const edgeIds = byRole(g, 'edge').map((n) => n.id);
      const front = new Set([...lbIds, ...edgeIds]);
      if (!front.size) return true;
      // At least one request-serving compute node must be fed by the front door.
      return !compute.some((n) => incoming(g, n.id).some((src) => front.has(src)));
    },
    detail: 'Put an Application Load Balancer in front of the compute tier so instances are not individually addressable and health checks can remove bad ones.',
  },
  {
    id: 'db-reachable-from-edge',
    severity: 'error',
    title: 'A data store is wired directly to the edge',
    check: (g) => {
      const dbIds = new Set([...byRole(g, 'database'), ...byRole(g, 'storage')].map((n) => n.id));
      return byRole(g, 'loadBalancer').some((lb) => outgoing(g, lb.id).some((id) => dbIds.has(id)));
    },
    detail: 'Data stores belong in private subnets, reachable only from the application tier.',
  },
  {
    id: 'no-vpc',
    severity: 'warning',
    title: 'No network boundary',
    check: (g) => !hasType(g, 'vpc') && byRole(g, 'compute').some((n) => !getType(n.type).legacy),
    detail: 'Add a VPC so the compute and data tiers sit in private subnets.',
  },
  {
    id: 'no-monitoring',
    severity: 'warning',
    title: 'Nothing is being observed',
    check: (g) => byRole(g, 'observability').length === 0,
    detail: 'Add CloudWatch. An architecture you cannot see is one you cannot operate.',
  },
  {
    id: 'orphans',
    severity: 'warning',
    title: 'Disconnected components',
    check: (g) => orphanNodes(g).length > 0,
    detail: 'Some components are not connected to the request path, so they do no work. Connect or remove them.',
    describe: (g) => orphanNodes(g).map((n) => n.label).join(', '),
  },
  {
    id: 'queue-no-consumer',
    severity: 'warning',
    title: 'A queue has no consumer',
    check: (g) => byRole(g, 'queue').some((q) => outgoing(g, q.id).length === 0),
    detail: 'Connect the queue to compute (Lambda or a worker fleet), otherwise messages accumulate until they expire.',
  },
  {
    id: 'single-az-database',
    severity: 'warning',
    title: 'The database cannot survive an AZ failure',
    check: (g) => byType(g, 'rds').some((n) => !n.props.multiAz),
    detail: 'Enable Multi-AZ on RDS. It roughly doubles the instance cost and removes hours of downtime from your worst day.',
  },
  {
    id: 'public-bucket',
    severity: 'error',
    title: 'A bucket is open to the internet',
    check: (g) => byType(g, 's3').some((n) => n.props.publicAccessBlocked === false),
    detail: 'Block public access and serve objects through CloudFront with an origin access control.',
  },
  {
    id: 'legacy-mixed',
    severity: 'info',
    title: 'Self-managed components remain',
    check: (g) => g.nodes.some((n) => getType(n.type).legacy),
    detail: 'These still work, but you own the patching, backups and failover for them.',
    describe: (g) => g.nodes.filter((n) => getType(n.type).legacy).map((n) => n.label).join(', '),
  },
  {
    id: 'deprecated',
    severity: 'info',
    title: 'A deprecated service is in use',
    check: (g) => g.nodes.some((n) => getType(n.type).deprecated),
    detail: 'The Classic Load Balancer has no path routing, no HTTP/2 and no WAF integration. Use an ALB.',
  },
];

const GOOD_PRACTICES = [
  { id: 'cdn', title: 'Traffic served through a CDN', check: (g) => hasType(g, 'cloudfront') },
  { id: 'elastic', title: 'Compute scales with demand', check: (g) => byRole(g, 'compute').some((n) => getType(n.type).elastic) },
  { id: 'multi-az-db', title: 'Database survives an AZ failure', check: (g) => byRole(g, 'database').some((n) => (n.props.multiAz || n.type === 'dynamodb' || n.type === 'aurora')) },
  { id: 'decoupled', title: 'Slow work is decoupled behind a queue', check: (g) => byRole(g, 'queue').length > 0 },
  { id: 'cache', title: 'Hot reads are cached', check: (g) => byRole(g, 'cache').length > 0 },
  { id: 'encrypted', title: 'Customer-managed encryption keys', check: (g) => hasType(g, 'kms') },
  { id: 'waf', title: 'Layer-7 firewall at the edge', check: (g) => hasType(g, 'waf') },
  { id: 'budgets', title: 'Spend has a guardrail', check: (g) => hasType(g, 'budgets') },
  { id: 'archive', title: 'Cold data is tiered to archive storage', check: (g) => byRole(g, 'archive').some((n) => !getType(n.type).legacy) },
  { id: 'orchestration', title: 'Multi-step work is orchestrated', check: (g) => byRole(g, 'orchestration').length > 0 },
];

export function reviewArchitecture(graphInput, usage) {
  const graph = normaliseGraph(graphInput);

  const findings = STRUCTURE_RULES.filter((r) => r.check(graph)).map((r) => ({
    id: r.id,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    components: r.describe ? r.describe(graph) : undefined,
  }));

  const practices = GOOD_PRACTICES.map((p) => ({
    id: p.id,
    title: p.title,
    met: Boolean(p.check(graph)),
  }));

  const security = securityScore(graph);
  const availability = availabilityScore(graph);
  const cost = estimateCost(graph, usage);
  const optimisation = optimiseCost(graph, usage);

  let traffic = null;
  try {
    traffic = simulateTraffic(graph, { rps: usage.peakRps, rampSeconds: 60, durationSeconds: 300 });
  } catch {
    traffic = null; // no request path: the structure findings already say so
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const practiceScore = (practices.filter((p) => p.met).length / practices.length) * 100;
  const resilienceScore = traffic ? Math.max(0, 100 - traffic.errorRatePercent * 4) : 0;

  const raw =
    security.score * 0.25 +
    availability.score * 0.25 +
    practiceScore * 0.25 +
    resilienceScore * 0.25 -
    errors * 12 -
    warnings * 4;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score,
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F',
    summary: summarise(score, errors, warnings),
    findings,
    practices,
    scores: {
      security: security.score,
      availability: availability.score,
      bestPractice: Math.round(practiceScore),
      resilience: Math.round(resilienceScore),
    },
    security,
    availability,
    cost,
    optimisation,
    traffic,
    nextSteps: nextSteps(findings, practices, security, availability),
  };
}

function summarise(score, errors, warnings) {
  if (errors) return `${errors} structural problem(s) would stop this working as drawn.`;
  if (score >= 90) return 'A sound, Well-Architected design. The remaining points are tuning.';
  if (score >= 75) return 'Solid. The request path is right; resilience or security needs filling in.';
  if (score >= 55) return `Workable, with ${warnings} gap(s) that will hurt on a bad day.`;
  return 'This would run, but it would not survive peak load or a failed component.';
}

function nextSteps(findings, practices, security, availability) {
  const steps = [];
  for (const f of findings.filter((x) => x.severity === 'error')) {
    steps.push({ priority: 1, action: f.detail, because: f.title });
  }
  for (const spof of availability.singlePointsOfFailure.slice(0, 3)) {
    steps.push({
      priority: 2,
      action: `Make ${spof.label} redundant across Availability Zones.`,
      because: spof.reason,
    });
  }
  for (const control of security.missing.slice(0, 3)) {
    steps.push({ priority: 2, action: control.remedy, because: `Missing control: ${control.title}` });
  }
  for (const practice of practices.filter((p) => !p.met).slice(0, 3)) {
    steps.push({ priority: 3, action: `Consider: ${practice.title.toLowerCase()}.`, because: 'Common pattern not present' });
  }
  return steps.sort((a, b) => a.priority - b.priority).slice(0, 8);
}

/** A blank canvas seeded with the essentials, for the builder's "start" button. */
export function starterGraph() {
  return {
    nodes: [
      { id: 'vpc', type: 'vpc' },
      { id: 'lb', type: 'alb' },
      { id: 'app', type: 'autoScalingGroup' },
      { id: 'db', type: 'rds', props: { multiAz: false } },
    ],
    edges: [
      { from: 'vpc', to: 'lb' },
      { from: 'lb', to: 'app' },
      { from: 'app', to: 'db' },
    ],
  };
}
