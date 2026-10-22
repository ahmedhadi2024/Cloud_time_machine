import { test } from 'node:test';
import assert from 'node:assert/strict';

import { architectureFor, timelineFor, eraForYear } from '../src/data/architectures.js';
import { scaleFor, COMPANIES } from '../src/data/companies.js';
import { estimateCost, optimiseCost } from '../src/engines/cost.js';
import { securityScore, availabilityScore } from '../src/engines/scoring.js';
import { simulateTraffic } from '../src/engines/traffic.js';
import { simulateFailure } from '../src/engines/failure.js';
import { simulateDdos } from '../src/engines/ddos.js';
import { projectStorage } from '../src/engines/storage.js';
import { reviewArchitecture } from '../src/engines/builder.js';
import { compareWithModern } from '../src/engines/compare.js';
import { normaliseGraph } from '../src/engines/graph.js';

const usage = scaleFor('shopcart', 2025);
const modern = architectureFor('shopcart', 2025);
const legacy = architectureFor('shopcart', 2005);

test('every company produces a valid graph in every era', () => {
  for (const company of COMPANIES) {
    for (const snapshot of timelineFor(company.id)) {
      const graph = normaliseGraph(snapshot);
      assert.ok(graph.nodes.length > 0, `${company.id} ${snapshot.year} has no nodes`);
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const edge of graph.edges) {
        assert.ok(ids.has(edge.from) && ids.has(edge.to), 'edge references a missing node');
      }
    }
  }
});

test('era selection picks the latest era at or before the year', () => {
  assert.equal(eraForYear(2005).year, 2005);
  assert.equal(eraForYear(2010).year, 2008);
  assert.equal(eraForYear(2016).year, 2014);
  assert.equal(eraForYear(2030).year, 2025);
});

test('workload grows monotonically with the year', () => {
  let previous = 0;
  for (let year = 2005; year <= 2025; year += 1) {
    const scale = scaleFor('shopcart', year);
    assert.ok(scale.requestsPerDay >= previous, `traffic dipped at ${year}`);
    previous = scale.requestsPerDay;
  }
});

test('cost breakdown sums to the reported monthly total', () => {
  const cost = estimateCost(modern, usage);
  const summed = cost.items.reduce((acc, i) => acc + i.monthly, 0);
  assert.ok(Math.abs(summed - cost.monthly) < 1, `${summed} vs ${cost.monthly}`);
  assert.equal(cost.annual, Math.round(cost.monthly * 12 * 100) / 100);
});

test('each cost item sums to its own line items', () => {
  for (const item of estimateCost(modern, usage).items) {
    const summed = item.lines.reduce((acc, l) => acc + l.amount, 0);
    assert.ok(Math.abs(summed - item.monthly) < 0.05, `${item.label}: ${summed} vs ${item.monthly}`);
  }
});

test('the optimiser never proposes a negative saving', () => {
  const result = optimiseCost(legacy, scaleFor('shopcart', 2005));
  for (const rec of result.recommendations) {
    assert.ok(rec.monthlySaving >= 0, `${rec.id} proposes a negative saving`);
  }
  assert.ok(result.optimisedMonthly >= 0);
});

test('the modern architecture scores higher than the legacy one', () => {
  assert.ok(securityScore(modern).score > securityScore(legacy).score);
  assert.ok(availabilityScore(modern).score > availabilityScore(legacy).score);
});

test('scores stay inside 0-100', () => {
  for (const company of COMPANIES) {
    for (const snapshot of timelineFor(company.id)) {
      const sec = securityScore(snapshot).score;
      const av = availabilityScore(snapshot).score;
      assert.ok(sec >= 0 && sec <= 100, `security out of range: ${sec}`);
      assert.ok(av >= 0 && av <= 100, `availability out of range: ${av}`);
    }
  }
});

test('a public bucket is a critical security finding', () => {
  const graph = {
    nodes: [
      { id: 'b', type: 's3', props: { publicAccessBlocked: false } },
      { id: 'a', type: 'autoScalingGroup' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  };
  const findings = securityScore(graph).findings;
  assert.ok(findings.some((f) => f.id === 'public-bucket' && f.severity === 'critical'));
});

test('Multi-AZ turns a database failure from hours into minutes', () => {
  const single = {
    nodes: [{ id: 'a', type: 'autoScalingGroup' }, { id: 'db', type: 'rds', props: { multiAz: false } }],
    edges: [{ from: 'a', to: 'db' }],
  };
  const multi = {
    nodes: [{ id: 'a', type: 'autoScalingGroup' }, { id: 'db', type: 'rds', props: { multiAz: true } }],
    edges: [{ from: 'a', to: 'db' }],
  };
  const a = simulateFailure(single, { scenario: 'database-primary' });
  const b = simulateFailure(multi, { scenario: 'database-primary' });
  assert.equal(a.automatic, false);
  assert.equal(b.automatic, true);
  assert.ok(a.downtimeMinutes > b.downtimeMinutes * 10);
  assert.equal(b.dataLossMinutes, 0);
});

test('a single-AZ architecture does not survive losing its AZ', () => {
  const result = simulateFailure(legacy, { scenario: 'availability-zone' });
  assert.equal(result.survived, false);
  assert.equal(result.capacityLossPercent, 100);
});

test('a three-AZ architecture survives losing one AZ', () => {
  const result = simulateFailure(modern, { scenario: 'availability-zone' });
  assert.equal(result.survived, true);
  assert.ok(result.capacityLossPercent < 100);
});

test('traffic beyond capacity is dropped and names the bottleneck', () => {
  const result = simulateTraffic(legacy, { rps: 100_000 });
  assert.ok(result.droppedRps > 0);
  assert.ok(result.errorRatePercent > 50);
  assert.ok(result.bottleneck);
  assert.equal(result.verdict.level, 'critical');
});

test('traffic within capacity is served without errors', () => {
  const result = simulateTraffic(modern, { rps: 5000 });
  assert.equal(result.droppedRps, 0);
  assert.equal(result.errorRatePercent, 0);
});

test('served plus dropped always equals the offered load', () => {
  for (const rps of [10, 1000, 50_000, 1_000_000]) {
    const result = simulateTraffic(architectureFor('edulearn', 2014), { rps });
    assert.equal(result.servedRps + result.droppedRps, result.requestedRps);
  }
});

test('a queue converts overflow into latency rather than errors', () => {
  const withQueue = architectureFor('shopcart', 2017);
  const result = simulateTraffic(withQueue, { rps: 20_000 });
  const queueStep = result.steps.find((s) => s.buffered);
  if (queueStep) assert.equal(queueStep.droppedRps, 0);
});

test('the edge absorbs a volumetric attack that an origin cannot', () => {
  const protected_ = simulateDdos(modern, { attack: 'volumetric', legitimateRps: 2000 });
  const exposed = simulateDdos(legacy, { attack: 'volumetric', legitimateRps: 200 });
  assert.ok(protected_.availabilityPercent > exposed.availabilityPercent);
  assert.ok(protected_.availabilityPercent >= 99);
});

test('DDoS filtering layers never absorb more than arrives', () => {
  const result = simulateDdos(modern, { attack: 'http-flood', attackRps: 500_000, legitimateRps: 1000 });
  let previous = result.attackRps;
  for (const layer of result.layers) {
    assert.ok(layer.remainingRps <= previous + 1, `${layer.name} increased the traffic`);
    assert.ok(layer.absorbedRps >= 0);
    previous = layer.remainingRps;
  }
  assert.ok(result.reachingOriginRps <= result.attackRps);
});

test('storage tiering is never more expensive than all-Standard', () => {
  const result = projectStorage(modern, { months: 36 });
  assert.ok(result.totals.recommended <= result.totals.allStandard);
  assert.ok(result.totals.savingVsStandard >= 0);
  assert.equal(result.series.length, 37);
  assert.ok(result.endGb > result.startGb);
});

test('reviewing the reference architecture scores well', () => {
  const review = reviewArchitecture(modern, usage);
  assert.ok(review.score >= 85, `scored ${review.score}`);
  assert.equal(review.findings.filter((f) => f.severity === 'error').length, 0);
});

test('reviewing a naive two-node design reports structural errors', () => {
  const review = reviewArchitecture(
    { nodes: [{ id: 'a', type: 'ec2' }, { id: 'd', type: 'rds' }], edges: [{ from: 'a', to: 'd' }] },
    usage,
  );
  assert.ok(review.findings.some((f) => f.severity === 'error'));
  assert.ok(review.score < 50);
  assert.ok(review.nextSteps.length > 0);
});

test('a data store wired to the load balancer is flagged', () => {
  const review = reviewArchitecture(
    {
      nodes: [
        { id: 'lb', type: 'alb' },
        { id: 'app', type: 'autoScalingGroup' },
        { id: 'db', type: 'rds' },
      ],
      edges: [{ from: 'lb', to: 'app' }, { from: 'lb', to: 'db' }],
    },
    usage,
  );
  assert.ok(review.findings.some((f) => f.id === 'db-reachable-from-edge'));
});

test('an orphaned component is reported', () => {
  const review = reviewArchitecture(
    {
      nodes: [
        { id: 'lb', type: 'alb' },
        { id: 'app', type: 'autoScalingGroup' },
        { id: 'lonely', type: 'dynamodb' },
      ],
      edges: [{ from: 'lb', to: 'app' }],
    },
    usage,
  );
  assert.ok(review.findings.some((f) => f.id === 'orphans'));
});

test('comparison against the modern design favours the modern design', () => {
  const { comparison } = compareWithModern('shopcart', 2008);
  assert.ok(comparison.deltas.securityScore > 0);
  assert.ok(comparison.deltas.annualDowntimeMinutes < 0);
  assert.ok(comparison.narrative.length > 0);
});

test('an unknown service type is rejected with a 400', () => {
  assert.throws(
    () => normaliseGraph({ nodes: [{ id: 'x', type: 'not-a-service' }] }),
    (err) => err.status === 400,
  );
});

test('duplicate node ids are rejected', () => {
  assert.throws(
    () => normaliseGraph({ nodes: [{ id: 'x', type: 'ec2' }, { id: 'x', type: 'rds' }] }),
    (err) => err.status === 400,
  );
});

test('edges referencing missing nodes are dropped rather than thrown', () => {
  const graph = normaliseGraph({
    nodes: [{ id: 'a', type: 'ec2' }],
    edges: [{ from: 'a', to: 'ghost' }],
  });
  assert.equal(graph.edges.length, 0);
});
