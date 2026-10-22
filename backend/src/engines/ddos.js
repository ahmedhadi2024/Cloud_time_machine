import { getType } from '../data/catalog.js';
import { normaliseGraph, byRole, nodeCapacity } from './graph.js';
import { TRANSFER_GB } from '../data/pricing.js';

/**
 * DDoS simulator.
 *
 * Attack traffic is filtered layer by layer. Each defence absorbs a share, and
 * whatever is left competes with real users for origin capacity. The output is
 * the share of legitimate requests that still succeed, plus the bandwidth bill
 * the attack generates.
 */

export const ATTACK_TYPES = [
  {
    id: 'volumetric',
    label: 'Volumetric flood (L3/L4)',
    description: 'UDP/SYN flood aimed at saturating the network path.',
    defaultGbps: 60,
    edgeAbsorbs: true,
  },
  {
    id: 'http-flood',
    label: 'HTTP flood (L7)',
    description: 'Millions of valid-looking GET requests to expensive pages.',
    defaultRps: 400000,
    edgeAbsorbs: false,
  },
  {
    id: 'slow-loris',
    label: 'Slow connection exhaustion',
    description: 'Thousands of half-open connections that hold worker slots.',
    defaultRps: 60000,
    edgeAbsorbs: false,
  },
];

export function simulateDdos(graphInput, options = {}) {
  const graph = normaliseGraph(graphInput);
  const attackId = options.attack ?? 'http-flood';
  const attack = ATTACK_TYPES.find((a) => a.id === attackId);
  if (!attack) {
    const err = new Error(`Unknown attack type: ${attackId}`);
    err.status = 400;
    throw err;
  }

  const attackRps = Math.max(1000, Math.round(options.attackRps ?? attack.defaultRps ?? 200000));
  const legitimateRps = Math.max(1, Math.round(options.legitimateRps ?? 2000));

  const layers = [];
  let remaining = attackRps;

  const defences = graph.nodes
    .filter((n) => getType(n.type).absorbsDdosRatio)
    .sort((a, b) => getType(b.type).absorbsDdosRatio - getType(a.type).absorbsDdosRatio);

  // Shield Standard protects anything fronted by CloudFront or an ALB at no cost.
  const hasAwsEdge = graph.nodes.some((n) => ['cloudfront', 'alb'].includes(n.type));
  if (hasAwsEdge) {
    const absorbed = attack.edgeAbsorbs ? remaining * 0.85 : remaining * 0.1;
    layers.push({
      name: 'AWS Shield Standard',
      kind: 'always-on',
      absorbedRps: Math.round(absorbed),
      remainingRps: Math.round(remaining - absorbed),
      note: attack.edgeAbsorbs
        ? 'Network-layer floods are dropped in the AWS edge network before they reach your account.'
        : 'Shield Standard does not inspect layer 7, so a valid-looking HTTP flood passes through.',
    });
    remaining -= absorbed;
  } else {
    layers.push({
      name: 'No edge protection',
      kind: 'missing',
      absorbedRps: 0,
      remainingRps: Math.round(remaining),
      note: 'Traffic arrives straight at your own network path.',
    });
  }

  for (const node of defences) {
    const def = getType(node.type);
    let ratio = def.absorbsDdosRatio;
    if (node.type === 'waf') {
      // A rate-based rule is what actually stops an L7 flood.
      ratio = attack.id === 'volumetric' ? 0.3 : 0.9;
    }
    if (node.type === 'cloudfront' && attack.id === 'http-flood') {
      ratio = node.props.cacheHitRatio ?? 0.85; // cached responses never hit origin
    }
    const absorbed = remaining * ratio;
    layers.push({
      name: node.label,
      kind: 'configured',
      absorbedRps: Math.round(absorbed),
      remainingRps: Math.round(remaining - absorbed),
      note: ddosNote(node, attack),
    });
    remaining -= absorbed;
  }

  const originCapacity = originRps(graph);
  const totalAtOrigin = remaining + legitimateRps;
  const saturated = originCapacity !== Infinity && totalAtOrigin > originCapacity;
  const legitimateServed = saturated
    ? Math.round(legitimateRps * (originCapacity / totalAtOrigin))
    : legitimateRps;
  const availabilityPercent = Math.round((legitimateServed / legitimateRps) * 1000) / 10;

  // Cost: the attack traffic you are billed to receive and answer.
  const attackGb = (remaining * 2 * 3600 * (options.durationHours ?? 1)) / 1e6; // ~2 KB per response
  const costImpact = {
    attackDurationHours: options.durationHours ?? 1,
    extraEgressGb: Math.round(attackGb),
    extraEgressCost: Math.round(attackGb * TRANSFER_GB.internetEgress * 100) / 100,
    note: graph.nodes.some((n) => n.type === 'shieldAdvanced')
      ? 'Shield Advanced cost protection credits back scaling charges caused by a verified attack.'
      : 'Without Shield Advanced, the bandwidth and scaling an attack causes is billed as normal usage.',
  };

  return {
    attack: { id: attack.id, label: attack.label, description: attack.description },
    attackRps,
    legitimateRps,
    layers,
    reachingOriginRps: Math.round(remaining),
    originCapacityRps: originCapacity === Infinity ? null : Math.round(originCapacity),
    legitimateServedRps: legitimateServed,
    availabilityPercent,
    verdict:
      availabilityPercent > 99
        ? { level: 'healthy', message: 'The attack is absorbed before it matters.' }
        : availabilityPercent > 80
          ? { level: 'degraded', message: 'Real users are being affected but the site is up.' }
          : { level: 'critical', message: 'The attack is an outage for real users.' },
    costImpact,
    advice: ddosAdvice(graph, attack, availabilityPercent),
  };
}

function originRps(graph) {
  const compute = byRole(graph, 'compute');
  if (!compute.length) return Infinity;
  return compute.reduce((acc, n) => acc + nodeCapacity(n), 0);
}

function ddosNote(node, attack) {
  if (node.type === 'cloudfront') {
    return attack.id === 'volumetric'
      ? 'The edge network absorbs the flood across hundreds of points of presence.'
      : 'Cache hits are answered at the edge, so only cache misses reach the origin.';
  }
  if (node.type === 'waf') {
    return attack.id === 'volumetric'
      ? 'WAF inspects HTTP, so a network-layer flood is mostly outside its remit.'
      : 'A rate-based rule blocks source IPs over the threshold, and managed rules catch known bad bots.';
  }
  if (node.type === 'shieldAdvanced') {
    return 'Automatic application-layer mitigation plus a response team on call.';
  }
  return '';
}

function ddosAdvice(graph, attack, availabilityPercent) {
  const advice = [];
  const has = (type) => graph.nodes.some((n) => n.type === type);
  if (!has('cloudfront')) {
    advice.push('Put CloudFront in front of the origin: it is the single biggest change, and Shield Standard comes with it.');
  }
  if (!has('waf')) {
    advice.push('Attach a WAF web ACL with a rate-based rule; this is what stops a layer-7 flood.');
  }
  if (!has('autoScalingGroup') && !has('lambda')) {
    advice.push('Elastic compute buys time during an attack: a fixed fleet saturates and stays saturated.');
  }
  if (availabilityPercent < 80 && !has('shieldAdvanced')) {
    advice.push('At this attack size, Shield Advanced adds automatic L7 mitigation and credits back the resulting cost.');
  }
  if (has('cloudfront') && (graph.nodes.find((n) => n.type === 'cloudfront')?.props.cacheHitRatio ?? 0) < 0.8) {
    advice.push('Raise the cache hit ratio: every cached path is a path an attacker cannot make expensive.');
  }
  return advice;
}
