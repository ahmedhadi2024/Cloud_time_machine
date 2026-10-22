import { architectureFor, MODERN_YEAR } from '../data/architectures.js';
import { scaleFor } from '../data/companies.js';
import { securityScore, availabilityScore } from './scoring.js';
import { estimateCost } from './cost.js';
import { simulateTraffic } from './traffic.js';
import { simulateFailure } from './failure.js';
import { simulateDdos } from './ddos.js';
import { normaliseGraph } from './graph.js';
import { getType } from '../data/catalog.js';

/**
 * Side-by-side comparison of two architectures under the same workload.
 * Used by "compare with the modern AWS architecture", and by the builder to
 * score a user design against the reference.
 */
export function compareArchitectures(leftGraph, rightGraph, usage) {
  const left = profile(leftGraph, usage);
  const right = profile(rightGraph, usage);
  return {
    usage,
    left,
    right,
    deltas: {
      monthlyCost: round(right.cost.monthly - left.cost.monthly),
      securityScore: right.security.score - left.security.score,
      availabilityScore: right.availability.score - left.availability.score,
      annualDowntimeMinutes:
        right.availability.annualDowntimeMinutes - left.availability.annualDowntimeMinutes,
      peakErrorRatePercent: round(right.traffic.errorRatePercent - left.traffic.errorRatePercent),
      dbOutageMinutes: right.dbFailure.downtimeMinutes - left.dbFailure.downtimeMinutes,
      ddosAvailabilityPercent: round(right.ddos.availabilityPercent - left.ddos.availabilityPercent),
    },
    narrative: narrate(left, right),
  };
}

function profile(graphInput, usage) {
  const graph = normaliseGraph(graphInput);
  return {
    nodeCount: graph.nodes.length,
    managedShare: Math.round(
      (graph.nodes.filter((n) => !getType(n.type).legacy).length / graph.nodes.length) * 100,
    ),
    cost: estimateCost(graph, usage),
    security: securityScore(graph),
    availability: availabilityScore(graph),
    traffic: simulateTraffic(graph, { rps: usage.peakRps, rampSeconds: 60, durationSeconds: 300 }),
    dbFailure: simulateFailure(graph, { scenario: 'database-primary' }),
    azFailure: simulateFailure(graph, { scenario: 'availability-zone' }),
    ddos: simulateDdos(graph, { attack: 'http-flood', legitimateRps: Math.max(1, usage.averageRps) }),
  };
}

/** Compare a company's year with its modern counterpart at the same workload. */
export function compareWithModern(companyId, year) {
  const usage = scaleFor(companyId, year);
  const historical = architectureFor(companyId, year);
  const modern = architectureFor(companyId, MODERN_YEAR);
  // Same workload on both sides, otherwise the comparison measures growth
  // rather than architecture.
  const modernAtSameScale = { ...modern, scale: usage };
  const comparison = compareArchitectures(historical, modernAtSameScale, usage);
  return {
    year,
    modernYear: MODERN_YEAR,
    historical: { ...historical, nodes: historical.nodes, edges: historical.edges },
    modern: { ...modernAtSameScale },
    comparison,
  };
}

function narrate(left, right) {
  const lines = [];
  const dCost = right.cost.monthly - left.cost.monthly;
  lines.push(
    dCost > 0
      ? `The modern design costs about $${Math.round(dCost).toLocaleString()}/month more at this workload, and buys the resilience below.`
      : `The modern design is about $${Math.round(-dCost).toLocaleString()}/month cheaper at this workload, because capacity follows demand instead of peak.`,
  );
  const dDown =
    left.availability.annualDowntimeMinutes - right.availability.annualDowntimeMinutes;
  if (dDown > 0) {
    lines.push(
      `Expected annual downtime falls by about ${Math.round(dDown)} minutes (${left.availability.uptimeLabel} to ${right.availability.uptimeLabel}).`,
    );
  }
  if (left.dbFailure.downtimeMinutes > right.dbFailure.downtimeMinutes) {
    lines.push(
      `Losing the primary database goes from ${left.dbFailure.downtimeLabel} of downtime to ${right.dbFailure.downtimeLabel}.`,
    );
  }
  if (left.traffic.errorRatePercent > right.traffic.errorRatePercent) {
    lines.push(
      `At peak, dropped requests fall from ${left.traffic.errorRatePercent}% to ${right.traffic.errorRatePercent}%.`,
    );
  }
  if (right.security.score > left.security.score) {
    lines.push(
      `Security score rises ${left.security.score} to ${right.security.score}, mostly from encryption, WAF and identity controls.`,
    );
  }
  return lines;
}

const round = (n) => Math.round(n * 100) / 100;
