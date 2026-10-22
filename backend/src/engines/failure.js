import { getType } from '../data/catalog.js';
import { normaliseGraph, byRole, byType, nodeAvailability, hasType } from './graph.js';
import { humanDowntime } from './scoring.js';

/**
 * Failure simulator.
 *
 * Kills a component and reports what the users see: how long writes fail, how
 * much data is lost, and whether recovery is automatic or a person's job.
 */

export const FAILURE_SCENARIOS = [
  { id: 'database-primary', label: 'Primary database instance fails', targetRole: 'database' },
  { id: 'availability-zone', label: 'An entire Availability Zone goes dark', targetRole: null },
  { id: 'compute-node', label: 'Half the application instances die', targetRole: 'compute' },
  { id: 'cache-flush', label: 'Cache cluster restarts and loses everything', targetRole: 'cache' },
  { id: 'load-balancer', label: 'The load balancer fails', targetRole: 'loadBalancer' },
];

export function simulateFailure(graphInput, options = {}) {
  const graph = normaliseGraph(graphInput);
  const scenarioId = options.scenario ?? 'database-primary';
  const scenario = FAILURE_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    const err = new Error(`Unknown failure scenario: ${scenarioId}`);
    err.status = 400;
    throw err;
  }

  switch (scenarioId) {
    case 'database-primary':
      return databaseFailure(graph, scenario);
    case 'availability-zone':
      return azFailure(graph, scenario);
    case 'compute-node':
      return computeFailure(graph, scenario);
    case 'cache-flush':
      return cacheFailure(graph, scenario);
    case 'load-balancer':
      return loadBalancerFailure(graph, scenario);
    default:
      throw new Error('unreachable');
  }
}

function result(scenario, fields) {
  return {
    scenario: scenario.id,
    scenarioLabel: scenario.label,
    ...fields,
    downtimeLabel: humanDowntime(fields.downtimeMinutes ?? 0),
    dataLossLabel: humanDowntime(fields.dataLossMinutes ?? 0),
  };
}

function databaseFailure(graph, scenario) {
  const dbs = byRole(graph, 'database');
  if (!dbs.length) {
    return result(scenario, {
      survived: true,
      downtimeMinutes: 0,
      dataLossMinutes: 0,
      automatic: true,
      impact: 'No database in this architecture to fail.',
      timeline: [],
      lessons: [],
    });
  }

  // The relational store is the one whose loss stops writes.
  const primary = dbs.find((d) => ['rds', 'aurora', 'selfHostedDb'].includes(d.type)) ?? dbs[0];
  const av = nodeAvailability(primary);
  const hasAlternative = dbs.some((d) => d.id !== primary.id && nodeAvailability(d).azSpread >= 2);
  const downtime = av.rtoMinutes ?? 0;
  const dataLoss = av.rpoMinutes ?? 0;
  const automatic = Boolean(av.managedFailover);

  const timeline = [];
  timeline.push({ atSecond: 0, event: `${primary.label} stops responding.`, state: 'down' });
  if (automatic) {
    timeline.push({ atSecond: 10, event: 'Health checks mark the primary unhealthy.', state: 'detecting' });
    timeline.push({ atSecond: 35, event: 'Standby in another AZ is promoted; the DNS endpoint is repointed.', state: 'failover' });
    timeline.push({ atSecond: Math.max(60, downtime * 60), event: 'Writes succeed again. No data loss.', state: 'recovered' });
  } else {
    timeline.push({ atSecond: 300, event: 'Someone notices; paging starts.', state: 'detecting' });
    timeline.push({ atSecond: 900, event: 'Latest backup located and a restore begins.', state: 'restoring' });
    timeline.push({
      atSecond: downtime * 60,
      event: `Service restored, losing up to ${humanDowntime(dataLoss)} of writes.`,
      state: 'recovered',
    });
  }

  const lessons = [];
  if (!automatic) {
    lessons.push({
      title: 'Turn on Multi-AZ',
      detail:
        'A Multi-AZ RDS deployment keeps a synchronous standby in a second AZ and promotes it automatically, which turns this outage from hours into about a minute, with no data loss.',
    });
  }
  if (dataLoss > 5) {
    lessons.push({
      title: 'Shorten the recovery point',
      detail:
        'Automated backups with point-in-time recovery reduce potential loss to roughly five minutes, instead of back to the last nightly dump.',
    });
  }
  if (!hasAlternative && !hasType(graph, 'dynamodb')) {
    lessons.push({
      title: 'Degrade instead of stopping',
      detail:
        'Reads served from a cache and writes buffered to SQS let the site stay partly usable while the database is unavailable.',
    });
  }

  return result(scenario, {
    survived: automatic,
    downtimeMinutes: downtime,
    dataLossMinutes: dataLoss,
    automatic,
    failedNode: { id: primary.id, label: primary.label, type: primary.type },
    impact: automatic
      ? 'Writes fail for the length of the failover; reads from cache continue.'
      : 'The site is down until a human restores from backup, and recent writes are lost.',
    requestsFailed: null,
    timeline,
    lessons,
  });
}

function azFailure(graph, scenario) {
  const affected = [];
  const survived = [];
  for (const node of graph.nodes) {
    const av = nodeAvailability(node);
    if (av.azSpread >= 2) survived.push(node);
    else affected.push(node);
  }

  const criticalRoles = ['compute', 'database', 'loadBalancer'];
  const lostTiers = criticalRoles.filter((role) => {
    const tier = byRole(graph, role);
    return tier.length > 0 && tier.every((n) => nodeAvailability(n).azSpread < 2);
  });

  const fullOutage = lostTiers.length > 0;
  const downtime = fullOutage
    ? Math.max(...lostTiers.map((role) => {
        const tier = byRole(graph, role);
        return Math.max(...tier.map((n) => nodeAvailability(n).rtoMinutes ?? 45));
      }))
    : 0;

  const capacityLossPercent = fullOutage ? 100 : Math.round((1 / 3) * 100);

  return result(scenario, {
    survived: !fullOutage,
    downtimeMinutes: downtime,
    dataLossMinutes: fullOutage ? Math.max(...byRole(graph, 'database').map((n) => nodeAvailability(n).rpoMinutes ?? 0), 0) : 0,
    automatic: !fullOutage,
    capacityLossPercent,
    lostTiers,
    affectedNodes: affected.map((n) => ({ id: n.id, label: n.label })),
    survivingNodes: survived.map((n) => ({ id: n.id, label: n.label })),
    impact: fullOutage
      ? `The ${lostTiers.join(', ')} tier(s) exist in only one AZ, so losing that AZ takes the whole service down.`
      : 'One third of capacity disappears. Auto Scaling replaces it in the remaining AZs and users see a brief latency bump.',
    timeline: fullOutage
      ? [
          { atSecond: 0, event: 'The AZ becomes unreachable.', state: 'down' },
          { atSecond: 60, event: 'Every request fails: nothing is running elsewhere.', state: 'down' },
          { atSecond: downtime * 60, event: 'Capacity rebuilt in another AZ by hand.', state: 'recovered' },
        ]
      : [
          { atSecond: 0, event: 'The AZ becomes unreachable.', state: 'degraded' },
          { atSecond: 20, event: 'The load balancer stops routing to targets in that AZ.', state: 'degraded' },
          { atSecond: 180, event: 'Auto Scaling has replaced the lost instances in the surviving AZs.', state: 'recovered' },
        ],
    lessons: fullOutage
      ? [
          {
            title: 'Spread every tier across at least two AZs',
            detail:
              'An Auto Scaling Group with subnets in three AZs, an ALB in all three, and Multi-AZ RDS turns an AZ loss into a capacity event rather than an outage.',
          },
        ]
      : [
          {
            title: 'Keep enough headroom to lose an AZ',
            detail:
              'With three AZs, size the fleet so two thirds of it can serve peak load, otherwise the surviving AZs saturate during the replacement window.',
          },
        ],
  });
}

function computeFailure(graph, scenario) {
  const compute = byRole(graph, 'compute');
  if (!compute.length) {
    return result(scenario, { survived: false, downtimeMinutes: 0, dataLossMinutes: 0, automatic: false, impact: 'No compute tier.', timeline: [], lessons: [] });
  }
  const selfHealing = compute.some((n) => getType(n.type).elastic);
  return result(scenario, {
    survived: true,
    downtimeMinutes: selfHealing ? 0 : 25,
    dataLossMinutes: 0,
    automatic: selfHealing,
    capacityLossPercent: 50,
    impact: selfHealing
      ? 'Health checks remove the dead instances and Auto Scaling launches replacements; capacity is halved for a few minutes.'
      : 'Half the capacity is gone until someone launches replacements, so latency doubles and some requests time out.',
    timeline: [
      { atSecond: 0, event: 'Half the instances stop responding.', state: 'degraded' },
      { atSecond: 30, event: 'Load balancer health checks take them out of rotation.', state: 'degraded' },
      selfHealing
        ? { atSecond: 240, event: 'Auto Scaling has launched and warmed replacements.', state: 'recovered' }
        : { atSecond: 1500, event: 'An engineer launches replacement instances by hand.', state: 'recovered' },
    ],
    lessons: selfHealing
      ? [{ title: 'Sessions must not live on the instance', detail: 'If sessions are stored on disk, every user on a dead instance is logged out. Keep them in ElastiCache or DynamoDB.' }]
      : [{ title: 'Use an Auto Scaling Group', detail: 'Even at fixed size, an ASG replaces failed instances automatically, which removes this class of incident.' }],
  });
}

function cacheFailure(graph, scenario) {
  const caches = byRole(graph, 'cache');
  const dbs = byRole(graph, 'database');
  if (!caches.length) {
    return result(scenario, {
      survived: true,
      downtimeMinutes: 0,
      dataLossMinutes: 0,
      automatic: true,
      impact: 'No cache in this architecture, so there is nothing to lose. Every read already reaches the database.',
      timeline: [],
      lessons: [{ title: 'A cache would help here', detail: 'Adding ElastiCache would cut database load, at the cost of needing to survive a cold start.' }],
    });
  }
  const hitRatio = caches[0].props.hitRatio ?? 0.8;
  const dbCapacity = dbs.length ? dbs.reduce((acc, d) => acc + (getType(d.type).capacityFor?.(d.props) ?? getType(d.type).capacityRps), 0) : 0;
  const thunderingHerd = Math.round(1 / Math.max(0.05, 1 - hitRatio));

  return result(scenario, {
    survived: false,
    downtimeMinutes: 4,
    dataLossMinutes: 0,
    automatic: true,
    impact: `Every cached read goes to the database at once: roughly ${thunderingHerd}x the normal database load until the cache refills.`,
    extra: { hitRatioPercent: Math.round(hitRatio * 100), databaseCapacityRps: dbCapacity },
    timeline: [
      { atSecond: 0, event: 'The cache cluster restarts empty.', state: 'degraded' },
      { atSecond: 5, event: `Database load jumps ~${thunderingHerd}x as every request misses.`, state: 'degraded' },
      { atSecond: 120, event: 'Hot keys are back in cache and load settles.', state: 'recovered' },
    ],
    lessons: [
      {
        title: 'Plan for a cold cache',
        detail:
          'Size the database for the miss storm, or protect it with request coalescing and a jittered TTL so keys do not all expire together.',
      },
      {
        title: 'Use a replication group',
        detail: 'A Multi-AZ ElastiCache replication group fails over to a warm replica instead of restarting empty.',
      },
    ],
  });
}

function loadBalancerFailure(graph, scenario) {
  const lbs = byRole(graph, 'loadBalancer');
  if (!lbs.length) {
    return result(scenario, { survived: false, downtimeMinutes: 60, dataLossMinutes: 0, automatic: false, impact: 'No load balancer: traffic hits instances directly, so losing one takes its share of users with it.', timeline: [], lessons: [] });
  }
  const managed = lbs.some((n) => nodeAvailability(n).azSpread >= 2);
  return result(scenario, {
    survived: managed,
    downtimeMinutes: managed ? 0 : 90,
    dataLossMinutes: 0,
    automatic: managed,
    impact: managed
      ? 'An ALB is a set of nodes across AZs behind one DNS name; losing one node is invisible to users.'
      : 'A single appliance is the whole front door. Every user is offline until it is replaced.',
    timeline: managed
      ? [
          { atSecond: 0, event: 'One load balancer node fails.', state: 'degraded' },
          { atSecond: 30, event: 'DNS stops returning that node; traffic continues.', state: 'recovered' },
        ]
      : [
          { atSecond: 0, event: 'The appliance fails.', state: 'down' },
          { atSecond: 1800, event: 'A spare is racked and configured.', state: 'down' },
          { atSecond: 5400, event: 'Traffic restored.', state: 'recovered' },
        ],
    lessons: managed
      ? []
      : [{ title: 'Use a managed load balancer', detail: 'An ALB spans AZs and scales itself, removing the single front-door failure entirely.' }],
  });
}
