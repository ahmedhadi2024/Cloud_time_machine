import { getType } from '../data/catalog.js';
import { normaliseGraph, requestPath, nodeCapacity, byRole } from './graph.js';

/**
 * Traffic simulator.
 *
 * Pushes a request rate through the tiers of the request path and reports where
 * it saturates. Each tier can offload a share of traffic (a CDN cache hit or a
 * cache hit never reaches the next tier), elastic tiers add capacity after a
 * warm-up delay, and a buffering queue converts overflow into latency instead
 * of errors.
 */

const BASE_LATENCY_MS = {
  dns: 8,
  edge: 12,
  loadBalancer: 4,
  compute: 45,
  cache: 2,
  database: 18,
  storage: 25,
};

export function simulateTraffic(graphInput, options = {}) {
  const graph = normaliseGraph(graphInput);
  const requestedRps = Math.max(1, Math.round(options.rps ?? 1000));
  const durationSeconds = Math.max(10, Math.min(600, options.durationSeconds ?? 120));
  const rampSeconds = Math.max(0, Math.min(durationSeconds, options.rampSeconds ?? 20));

  const tiers = requestPath(graph);
  if (!tiers.length) {
    const err = new Error('This architecture has no request path to simulate.');
    err.status = 400;
    throw err;
  }

  const steps = [];
  let incoming = requestedRps;
  let latency = 0;
  let droppedTotal = 0;
  let firstBottleneck = null;

  for (const tier of tiers) {
    const capacity = tier.nodes.reduce((acc, n) => acc + nodeCapacity(n), 0);
    const elastic = tier.nodes.some((n) => getType(n.type).elastic);
    const buffered = tier.nodes.some((n) => getType(n.type).bufferingQueue);

    // Effective capacity: an elastic tier can reach its ceiling, but only after
    // scaling, which the warm-up penalty below accounts for.
    const effectiveCapacity = capacity === Infinity ? Infinity : capacity;
    const utilisation = effectiveCapacity === Infinity ? 0 : incoming / effectiveCapacity;

    let dropped = 0;
    let served = incoming;
    if (effectiveCapacity !== Infinity && incoming > effectiveCapacity) {
      const overflow = incoming - effectiveCapacity;
      if (buffered) {
        served = effectiveCapacity;
        latency += (overflow / effectiveCapacity) * 2000; // queue wait
      } else {
        served = effectiveCapacity;
        dropped = overflow;
      }
      if (!firstBottleneck) {
        firstBottleneck = {
          role: tier.role,
          nodes: tier.nodes.map((n) => n.label),
          capacityRps: Math.round(effectiveCapacity),
          offeredRps: Math.round(incoming),
        };
      }
    }
    droppedTotal += dropped;

    // Latency grows non-linearly as a tier approaches saturation (queueing).
    const base = BASE_LATENCY_MS[tier.role] ?? 10;
    const pressure = utilisation >= 1 ? 8 : 1 / Math.max(0.08, 1 - utilisation);
    latency += base * pressure;

    // What proportion continues to the next tier.
    const offload = tier.nodes.reduce((acc, n) => {
      const def = getType(n.type);
      return Math.max(acc, typeof def.offloadRatio === 'function' ? def.offloadRatio(n.props) : 0);
    }, 0);

    steps.push({
      role: tier.role,
      label: tier.nodes.map((n) => n.label).join(' + '),
      nodeIds: tier.nodes.map((n) => n.id),
      offeredRps: Math.round(incoming),
      capacityRps: effectiveCapacity === Infinity ? null : Math.round(effectiveCapacity),
      utilisation: effectiveCapacity === Infinity ? 0 : Math.round(utilisation * 100),
      servedRps: Math.round(served),
      droppedRps: Math.round(dropped),
      offloadPercent: Math.round(offload * 100),
      elastic,
      buffered,
      latencyContributionMs: Math.round(base * pressure),
    });

    incoming = served * (1 - offload);
  }

  const servedRps = Math.max(0, requestedRps - droppedTotal);
  const errorRate = requestedRps ? droppedTotal / requestedRps : 0;

  const timeline = buildTimeline({
    requestedRps,
    durationSeconds,
    rampSeconds,
    steps,
    graph,
    baseLatency: latency,
  });

  return {
    requestedRps,
    servedRps: Math.round(servedRps),
    droppedRps: Math.round(droppedTotal),
    errorRatePercent: Math.round(errorRate * 1000) / 10,
    p99LatencyMs: Math.round(latency * 1.8),
    averageLatencyMs: Math.round(latency),
    bottleneck: firstBottleneck,
    verdict: verdict(errorRate, latency),
    steps,
    timeline,
    advice: trafficAdvice(graph, firstBottleneck, errorRate),
  };
}

function verdict(errorRate, latency) {
  if (errorRate > 0.2) return { level: 'critical', message: 'The architecture collapses under this load.' };
  if (errorRate > 0.01) return { level: 'degraded', message: 'Requests are being dropped; capacity is short.' };
  if (latency > 800) return { level: 'degraded', message: 'No errors, but latency is past what users tolerate.' };
  if (latency > 300) return { level: 'warning', message: 'Serving the load, with little headroom left.' };
  return { level: 'healthy', message: 'Load absorbed comfortably.' };
}

/** Second-by-second series the UI animates: load, served, errors, latency. */
function buildTimeline({ requestedRps, durationSeconds, rampSeconds, steps, graph, baseLatency }) {
  const elasticTier = steps.find((s) => s.elastic && s.capacityRps !== null);
  const scaleWarmupSeconds = graph.nodes.some((n) => n.type === 'lambda') ? 5 : 180;
  const sampleEvery = Math.max(1, Math.round(durationSeconds / 60));
  const series = [];

  for (let t = 0; t <= durationSeconds; t += sampleEvery) {
    const rampFactor = rampSeconds ? Math.min(1, t / rampSeconds) : 1;
    const offered = requestedRps * rampFactor;

    // Before an elastic tier finishes scaling it only has its steady capacity.
    const warm = Math.min(1, t / scaleWarmupSeconds);
    let capacity = Infinity;
    for (const step of steps) {
      if (step.capacityRps === null) continue;
      const stepCapacity = step.elastic
        ? step.capacityRps * (0.35 + 0.65 * warm)
        : step.capacityRps;
      capacity = Math.min(capacity, stepCapacity);
    }

    const served = Math.min(offered, capacity);
    const dropped = Math.max(0, offered - served);
    const utilisation = capacity === Infinity ? 0 : served / capacity;
    const latency = baseLatency * (utilisation > 0.85 ? 1 + (utilisation - 0.85) * 6 : 1);

    series.push({
      second: t,
      offeredRps: Math.round(offered),
      servedRps: Math.round(served),
      droppedRps: Math.round(dropped),
      latencyMs: Math.round(latency),
      capacityRps: capacity === Infinity ? null : Math.round(capacity),
    });
  }
  return { scaleWarmupSeconds, elasticTier: elasticTier?.role ?? null, series };
}

function trafficAdvice(graph, bottleneck, errorRate) {
  const advice = [];
  if (!bottleneck && errorRate === 0) {
    advice.push('Nothing saturated. Raise the load until a tier reaches 100% to find the real ceiling.');
    return advice;
  }
  if (!bottleneck) return advice;

  switch (bottleneck.role) {
    case 'compute':
      if (!graph.nodes.some((n) => n.type === 'autoScalingGroup')) {
        advice.push('The compute tier is fixed-size. An Auto Scaling Group would add instances as load arrives.');
      } else {
        advice.push('Raise the Auto Scaling maximum, or use a larger instance type so each unit serves more.');
      }
      if (!graph.nodes.some((n) => n.type === 'cloudfront')) {
        advice.push('A CDN would remove the static share of this traffic from the compute tier entirely.');
      }
      break;
    case 'database':
      if (!graph.nodes.some((n) => n.type === 'elasticache')) {
        advice.push('Add ElastiCache: most of this read volume is the same rows repeatedly.');
      }
      advice.push('Add read replicas, or move the highest-volume append-only writes to DynamoDB.');
      break;
    case 'loadBalancer':
      advice.push('A Classic or hardware load balancer caps out here; an ALB scales with the load.');
      break;
    default:
      advice.push(`The ${bottleneck.role} tier is the ceiling at ${bottleneck.capacityRps} rps.`);
  }
  if (!graph.nodes.some((n) => getType(n.type).bufferingQueue)) {
    advice.push('With SQS between the web tier and slow work, overflow would wait in a queue instead of erroring.');
  }
  return advice;
}

/** Peak-load check used by the comparison view. */
export function headroom(graphInput, usage) {
  const result = simulateTraffic(graphInput, { rps: usage.peakRps, rampSeconds: 60, durationSeconds: 300 });
  const computeTier = result.steps.find((s) => s.role === 'compute');
  return {
    peakRps: usage.peakRps,
    survivesPeak: result.errorRatePercent < 1,
    errorRatePencent: result.errorRatePercent,
    computeUtilisation: computeTier?.utilisation ?? null,
    bottleneck: result.bottleneck,
  };
}
