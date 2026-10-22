import { normaliseGraph, byRole, byType } from './graph.js';
import { STORAGE_GB_MONTH } from '../data/pricing.js';

/**
 * Storage growth projection.
 *
 * Projects data volume forward at a monthly growth rate and prices it three
 * ways: everything in Standard, with lifecycle tiering as currently configured,
 * and with a recommended tiering policy. The gap between them is the argument
 * for lifecycle rules.
 */
export function projectStorage(graphInput, options = {}) {
  const graph = normaliseGraph(graphInput);
  const months = Math.max(6, Math.min(120, options.months ?? 36));
  const monthlyGrowthPercent = options.monthlyGrowthPercent ?? 8;
  const growth = 1 + monthlyGrowthPercent / 100;

  const buckets = byType(graph, 's3');
  const blocks = byType(graph, 'ebs');
  const archives = byRole(graph, 'archive');
  const declaredGb = [...buckets, ...blocks, ...archives].reduce(
    (acc, n) => acc + (n.props.storageGb ?? 0),
    0,
  );
  const startGb = options.startGb ?? (declaredGb || 500);

  const configured = currentPolicy(graph);
  const recommended = { toIaDays: 30, toGlacierInstantDays: 90, toDeepArchiveDays: 365 };

  const series = [];
  for (let m = 0; m <= months; m += 1) {
    const totalGb = startGb * growth ** m;
    series.push({
      month: m,
      totalGb: Math.round(totalGb),
      allStandardCost: round(totalGb * STORAGE_GB_MONTH.s3Standard),
      configuredCost: round(tieredCost(totalGb, configured, m)),
      recommendedCost: round(tieredCost(totalGb, recommended, m)),
    });
  }

  const last = series[series.length - 1];
  const lifetimeStandard = round(series.reduce((a, s) => a + s.allStandardCost, 0));
  const lifetimeConfigured = round(series.reduce((a, s) => a + s.configuredCost, 0));
  const lifetimeRecommended = round(series.reduce((a, s) => a + s.recommendedCost, 0));

  return {
    months,
    monthlyGrowthPercent,
    startGb: Math.round(startGb),
    endGb: last.totalGb,
    multiple: Math.round((last.totalGb / startGb) * 10) / 10,
    series,
    tiers: tierBreakdown(last.totalGb, recommended),
    configuredPolicy: configured,
    recommendedPolicy: recommended,
    totals: {
      allStandard: lifetimeStandard,
      configured: lifetimeConfigured,
      recommended: lifetimeRecommended,
      savingVsStandard: round(lifetimeStandard - lifetimeRecommended),
      savingVsConfigured: round(lifetimeConfigured - lifetimeRecommended),
    },
    advice: storageAdvice(graph, configured, lifetimeConfigured - lifetimeRecommended),
  };
}

function currentPolicy(graph) {
  const bucket = byType(graph, 's3')[0];
  const hasGlacier = byRole(graph, 'archive').length > 0;
  if (!bucket) return { toIaDays: 0, toGlacierInstantDays: 0, toDeepArchiveDays: 0 };
  return {
    toIaDays: bucket.props.lifecycleToIaDays ?? 0,
    toGlacierInstantDays: bucket.props.lifecycleToGlacierDays ?? 0,
    toDeepArchiveDays: hasGlacier ? 365 : 0,
  };
}

/**
 * Share of data older than a cutoff, assuming steady growth: older data is a
 * smaller share of the total the faster the dataset is growing.
 */
function shareOlderThan(days, monthsElapsed) {
  const monthsOld = days / 30;
  if (monthsElapsed <= monthsOld) return 0;
  return Math.min(0.9, 1 - monthsOld / monthsElapsed);
}

function tieredCost(totalGb, policy, monthsElapsed) {
  const deep = policy.toDeepArchiveDays ? shareOlderThan(policy.toDeepArchiveDays, monthsElapsed) : 0;
  const glacier = policy.toGlacierInstantDays
    ? Math.max(0, shareOlderThan(policy.toGlacierInstantDays, monthsElapsed) - deep)
    : 0;
  const ia = policy.toIaDays
    ? Math.max(0, shareOlderThan(policy.toIaDays, monthsElapsed) - deep - glacier)
    : 0;
  const standard = Math.max(0, 1 - deep - glacier - ia);
  return (
    totalGb *
    (standard * STORAGE_GB_MONTH.s3Standard +
      ia * STORAGE_GB_MONTH.s3InfrequentAccess +
      glacier * STORAGE_GB_MONTH.s3GlacierInstant +
      deep * STORAGE_GB_MONTH.s3GlacierDeep)
  );
}

function tierBreakdown(totalGb, policy) {
  const monthsElapsed = 36;
  const deep = shareOlderThan(policy.toDeepArchiveDays, monthsElapsed);
  const glacier = Math.max(0, shareOlderThan(policy.toGlacierInstantDays, monthsElapsed) - deep);
  const ia = Math.max(0, shareOlderThan(policy.toIaDays, monthsElapsed) - deep - glacier);
  const standard = Math.max(0, 1 - deep - glacier - ia);
  return [
    { tier: 'S3 Standard', gb: Math.round(totalGb * standard), pricePerGb: STORAGE_GB_MONTH.s3Standard },
    { tier: 'S3 Standard-IA', gb: Math.round(totalGb * ia), pricePerGb: STORAGE_GB_MONTH.s3InfrequentAccess },
    { tier: 'Glacier Instant Retrieval', gb: Math.round(totalGb * glacier), pricePerGb: STORAGE_GB_MONTH.s3GlacierInstant },
    { tier: 'Glacier Deep Archive', gb: Math.round(totalGb * deep), pricePerGb: STORAGE_GB_MONTH.s3GlacierDeep },
  ];
}

function storageAdvice(graph, configured, saving) {
  const advice = [];
  if (!configured.toIaDays) {
    advice.push('No lifecycle transition is configured, so data written three years ago still costs Standard rates.');
  }
  if (!configured.toDeepArchiveDays) {
    advice.push('Glacier Deep Archive is about 1/23 of Standard per GB. For compliance copies nobody reads, that is the right tier.');
  }
  if (byType(graph, 'ebs').length) {
    advice.push('EBS volumes cost roughly 3.5x S3 Standard per GB and only one instance can read them. Move anything shared to S3.');
  }
  if (saving > 50) {
    advice.push(`Tiering as recommended would save about $${Math.round(saving)} over the projection window.`);
  }
  if (byType(graph, 's3').some((b) => b.props.versioning !== false)) {
    advice.push('With versioning on, add a rule to expire noncurrent versions, or deleted objects are stored forever.');
  }
  return advice;
}

const round = (n) => Math.round(n * 100) / 100;
