import { getType } from '../data/catalog.js';
import { normaliseGraph, byRole, hasType, byType } from './graph.js';
import { COMMITMENT_DISCOUNTS, TRANSFER_GB, STORAGE_GB_MONTH } from '../data/pricing.js';

const money = (n) => Math.round(n * 100) / 100;

/**
 * Monthly cost estimate for a graph under a workload, broken down per node and
 * per category, plus the egress the architecture cannot avoid.
 */
export function estimateCost(graphInput, usage) {
  const graph = normaliseGraph(graphInput);
  const items = [];

  // CloudFront absorbs a share of egress; whatever it caches never leaves the
  // origin, so origin egress is reduced before the per-node pass.
  const cdn = byType(graph, 'cloudfront')[0];
  const cacheHit = cdn ? cdn.props.cacheHitRatio ?? 0.85 : 0;
  const nodeUsage = {
    ...usage,
    monthlyEgressGb: usage.monthlyEgressGb,
  };

  for (const node of graph.nodes) {
    const def = getType(node.type);
    const result = def.cost(node.props, nodeUsage);
    items.push({
      id: node.id,
      type: node.type,
      label: def.label,
      category: def.category,
      monthly: result.monthly,
      lines: result.lines,
    });
  }

  const originEgressGb = usage.monthlyEgressGb * (1 - cacheHit);
  const egress = money(originEgressGb * TRANSFER_GB.internetEgress);
  items.push({
    id: '__egress',
    type: 'dataTransfer',
    label: 'Internet data transfer out (origin)',
    category: 'Networking',
    monthly: egress,
    lines: [
      { label: `${Math.round(originEgressGb).toLocaleString()} GB from origin`, amount: egress },
    ],
  });

  const byCategory = {};
  for (const item of items) {
    byCategory[item.category] = money((byCategory[item.category] ?? 0) + item.monthly);
  }

  const monthly = money(items.reduce((acc, i) => acc + i.monthly, 0));

  return {
    monthly,
    annual: money(monthly * 12),
    perMillionRequests: usage.monthlyRequests
      ? money((monthly / usage.monthlyRequests) * 1e6)
      : 0,
    byCategory,
    items: items.sort((a, b) => b.monthly - a.monthly),
    assumptions: [
      'us-east-1 on-demand list prices, no enterprise discount.',
      'Average response size 180 KB; egress priced after CDN cache hits.',
      'Auto Scaling cost uses the average fleet size implied by average load.',
    ],
  };
}

/**
 * Optimisation recommendations. Each one states the saving it would make under
 * the current workload, so the UI can rank them by value.
 */
export function optimiseCost(graphInput, usage) {
  const graph = normaliseGraph(graphInput);
  const base = estimateCost(graph, usage);
  const recommendations = [];

  const computeNodes = byRole(graph, 'compute');
  const computeSpend = base.items
    .filter((i) => computeNodes.some((n) => n.id === i.id))
    .reduce((acc, i) => acc + i.monthly, 0);

  if (computeSpend > 50) {
    const saving = computeSpend * (1 - COMMITMENT_DISCOUNTS.computeSavingsPlan1yr);
    recommendations.push({
      id: 'savings-plan',
      title: 'Commit to a 1-year Compute Savings Plan',
      pillar: 'Cost Optimization',
      effort: 'low',
      detail:
        'Baseline capacity runs every hour of every month. A Savings Plan on that baseline cuts the rate roughly 28% while leaving burst capacity on-demand.',
      monthlySaving: money(saving * 0.7), // only the baseline portion is committed
    });
    recommendations.push({
      id: 'graviton',
      title: 'Move the fleet to Graviton instances',
      pillar: 'Cost Optimization',
      effort: 'medium',
      detail:
        'Equivalent m7g/c7g instances are about 20% cheaper per hour at similar throughput for interpreted web workloads. Requires an ARM build of the application.',
      monthlySaving: money(computeSpend * (1 - COMMITMENT_DISCOUNTS.graviton)),
    });
  }

  const asg = byType(graph, 'autoScalingGroup');
  const fixedEc2 = byType(graph, 'ec2');
  if (fixedEc2.length && !asg.length) {
    const spend = base.items
      .filter((i) => fixedEc2.some((n) => n.id === i.id))
      .reduce((acc, i) => acc + i.monthly, 0);
    recommendations.push({
      id: 'autoscale',
      title: 'Replace the fixed EC2 fleet with an Auto Scaling Group',
      pillar: 'Cost Optimization',
      effort: 'medium',
      detail:
        'A fixed fleet is sized for peak and paid for at 3am. Scaling on target tracking typically removes 30-45% of instance hours for a diurnal web workload.',
      monthlySaving: money(spend * 0.35),
    });
  }

  if (!hasType(graph, 'cloudfront')) {
    const originEgress = usage.monthlyEgressGb * TRANSFER_GB.internetEgress;
    recommendations.push({
      id: 'cdn',
      title: 'Put CloudFront in front of the origin',
      pillar: 'Cost Optimization',
      effort: 'low',
      detail:
        'Edge cache hits are both cheaper per GB than origin egress and never consume compute. An 85% hit ratio is normal for a mostly static front end.',
      monthlySaving: money(originEgress * 0.85 * 0.3),
    });
  }

  if (!hasType(graph, 'elasticache') && byRole(graph, 'database').length) {
    const dbSpend = base.items
      .filter((i) => byRole(graph, 'database').some((n) => n.id === i.id))
      .reduce((acc, i) => acc + i.monthly, 0);
    recommendations.push({
      id: 'cache',
      title: 'Add ElastiCache for hot reads',
      pillar: 'Performance Efficiency',
      effort: 'medium',
      detail:
        'Caching the top queries lets the database run one instance class smaller and removes most read replicas.',
      monthlySaving: money(dbSpend * 0.25),
    });
  }

  for (const bucket of byType(graph, 's3')) {
    if (!bucket.props.lifecycleToGlacierDays) {
      const gb = bucket.props.storageGb ?? 0;
      const saving = gb * 0.35 * (STORAGE_GB_MONTH.s3Standard - STORAGE_GB_MONTH.s3GlacierInstant);
      if (saving > 1) {
        recommendations.push({
          id: `lifecycle-${bucket.id}`,
          title: `Add a lifecycle rule on ${bucket.label ?? bucket.id}`,
          pillar: 'Cost Optimization',
          effort: 'low',
          detail:
            'Objects older than 120 days are rarely read. Transitioning them to Glacier Instant Retrieval costs about a sixth of Standard per GB.',
          monthlySaving: money(saving),
        });
      }
    }
  }

  for (const db of byType(graph, 'rds')) {
    if ((db.props.readReplicas ?? 0) > 2) {
      recommendations.push({
        id: `replicas-${db.id}`,
        title: `Consolidate ${db.props.readReplicas} read replicas behind a cache`,
        pillar: 'Cost Optimization',
        effort: 'medium',
        detail:
          'Replicas added to absorb repeated reads are more expensive per query than a cache layer in front of a single reader.',
        monthlySaving: money(((db.props.readReplicas ?? 0) - 1) * 0.171 * 730 * 0.6),
      });
    }
  }

  const vpcs = byType(graph, 'vpc');
  for (const vpc of vpcs) {
    if ((vpc.props.natGateways ?? 1) > 1) {
      recommendations.push({
        id: `nat-${vpc.id}`,
        title: 'Use VPC endpoints instead of NAT for AWS-bound traffic',
        pillar: 'Cost Optimization',
        effort: 'low',
        detail:
          'Gateway endpoints for S3 and DynamoDB are free and keep that traffic off the NAT gateways, which charge per GB processed.',
        monthlySaving: money(usage.monthlyEgressGb * 0.05 * 0.045),
      });
    }
  }

  if (!hasType(graph, 'budgets')) {
    recommendations.push({
      id: 'budgets',
      title: 'Create AWS Budgets with alert actions',
      pillar: 'Cost Optimization',
      effort: 'low',
      detail:
        'A budget does not reduce the bill by itself, but it is the control that stops a runaway cost from running for a full month.',
      monthlySaving: 0,
    });
  }

  const legacy = graph.nodes.filter((n) => getType(n.type).legacy);
  if (legacy.length) {
    const spend = base.items
      .filter((i) => legacy.some((n) => n.id === i.id))
      .reduce((acc, i) => acc + i.monthly, 0);
    recommendations.push({
      id: 'migrate-legacy',
      title: `Migrate ${legacy.length} self-managed component(s) to managed services`,
      pillar: 'Operational Excellence',
      effort: 'high',
      detail:
        'Owned hardware is paid for at peak capacity whether or not it is used, and the operational cost of patching and backups does not appear on the invoice at all.',
      monthlySaving: money(spend * 0.3),
    });
  }

  recommendations.sort((a, b) => b.monthlySaving - a.monthlySaving);
  const totalSaving = money(recommendations.reduce((acc, r) => acc + r.monthlySaving, 0));

  return {
    current: base,
    recommendations,
    totalMonthlySaving: totalSaving,
    optimisedMonthly: money(Math.max(0, base.monthly - totalSaving)),
    savingPercent: base.monthly ? Math.round((totalSaving / base.monthly) * 100) : 0,
  };
}
