import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

/** Boot the real app on an ephemeral port and drive it over HTTP. */
let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': 'test-session' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('GET /healthz is a cheap liveness check', async () => {
  const { status, body } = await get('/healthz');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('GET /readyz reports which AWS integrations are live', async () => {
  const { body } = await get('/readyz');
  assert.ok(body.integrations);
  assert.equal(typeof body.integrations.events, 'boolean');
});

test('GET /api/meta returns companies, services and the timeline', async () => {
  const { body } = await get('/api/meta');
  assert.ok(body.companies.length >= 6);
  assert.ok(body.services.length >= 25);
  assert.equal(body.timeline.start, 2005);
  assert.ok(body.attackTypes.length >= 3);
});

test('GET an architecture returns nodes, edges and scores', async () => {
  const { body } = await get('/api/architectures/shopcart/2014');
  assert.equal(body.year, 2014);
  assert.ok(body.nodes.length > 5);
  assert.ok(body.scores.security.score > 0);
  assert.ok(body.scores.cost.monthly > 0);
});

test('the timeline route is not shadowed by the year route', async () => {
  const { status, body } = await get('/api/architectures/shopcart/timeline');
  assert.equal(status, 200);
  assert.equal(body.snapshots.length, 7);
});

test('POST a traffic simulation for a stock architecture', async () => {
  const { body } = await post('/api/simulate/traffic', { companyId: 'edulearn', year: 2014, rps: 50_000 });
  assert.ok(body.droppedRps > 0);
  assert.ok(body.steps.length > 0);
  assert.ok(body.timeline.series.length > 0);
});

test('POST a traffic simulation for a user-supplied graph', async () => {
  const { body } = await post('/api/simulate/traffic', {
    graph: { nodes: [{ id: 'a', type: 'autoScalingGroup' }], edges: [] },
    usage: { peakRps: 1000, averageRps: 400, monthlyRequests: 1e9, monthlyEgressGb: 1000, storageGb: 100 },
    rps: 1000,
  });
  assert.equal(body.errorRatePercent, 0);
});

test('POST a failure simulation', async () => {
  const { body } = await post('/api/simulate/failure', {
    companyId: 'fintrust',
    year: 2005,
    scenario: 'database-primary',
  });
  assert.equal(body.automatic, false);
  assert.ok(body.lessons.length > 0);
});

test('POST a DDoS simulation', async () => {
  const { body } = await post('/api/simulate/ddos', { companyId: 'socialgram', year: 2025, attack: 'http-flood' });
  assert.ok(body.layers.length > 0);
  assert.ok(body.availabilityPercent > 0);
});

test('POST a storage projection', async () => {
  const { body } = await post('/api/simulate/storage', { companyId: 'streamflix', year: 2025, months: 24 });
  assert.equal(body.series.length, 25);
  assert.ok(body.totals.savingVsStandard >= 0);
});

test('POST cost optimisation returns ranked recommendations', async () => {
  const { body } = await post('/api/simulate/cost/optimise', { companyId: 'shopcart', year: 2011 });
  assert.ok(body.recommendations.length > 0);
  const savings = body.recommendations.map((r) => r.monthlySaving);
  assert.deepEqual(savings, [...savings].sort((a, b) => b - a));
});

test('POST a builder review returns a grade and next steps', async () => {
  const { body } = await post('/api/builder/review', {
    graph: {
      nodes: [
        { id: 'vpc', type: 'vpc' },
        { id: 'cdn', type: 'cloudfront' },
        { id: 'lb', type: 'alb' },
        { id: 'app', type: 'autoScalingGroup' },
        { id: 'db', type: 'rds', props: { multiAz: true } },
        { id: 'cw', type: 'cloudwatch' },
      ],
      edges: [
        { from: 'cdn', to: 'lb' },
        { from: 'lb', to: 'app' },
        { from: 'app', to: 'db' },
        { from: 'app', to: 'cw' },
      ],
    },
    companyId: 'edulearn',
    year: 2025,
  });
  assert.ok(body.score > 40);
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(body.grade));
  assert.ok(body.scores.security >= 0);
});

test('a saved design can be listed and read back', async () => {
  const graph = { nodes: [{ id: 'app', type: 'autoScalingGroup' }], edges: [] };
  const created = await post('/api/builder/designs', { name: 'My design', graph, companyId: 'edulearn' });
  assert.equal(created.status, 201);
  const id = created.body.design.id;

  const list = await get('/api/builder/designs');
  assert.ok(list.body.designs.some((d) => d.id === id));

  const read = await get(`/api/builder/designs/${id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.design.name, 'My design');
});

test('simulation events are recorded against the session', async () => {
  await post('/api/simulate/traffic', { companyId: 'shopcart', year: 2020, rps: 100 });
  const res = await fetch(`${base}/events`, { headers: { 'x-session-id': 'test-session' } });
  const body = await res.json();
  assert.ok(body.events.some((e) => e.kind === 'simulate.traffic'));
});

test('an unknown company is a 404', async () => {
  const { status, body } = await get('/api/architectures/not-a-company/2015');
  assert.equal(status, 404);
  assert.match(body.error, /Unknown company/);
});

test('a malformed graph is a 400', async () => {
  const { status, body } = await post('/api/builder/review', { graph: { nodes: 'nope' } });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('an oversized architecture is rejected', async () => {
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, type: 'ec2' }));
  const { status } = await post('/api/builder/review', { graph: { nodes, edges: [] } });
  assert.equal(status, 400);
});

test('an unknown route is a 404 with a helpful message', async () => {
  const { status, body } = await get('/api/nope');
  assert.equal(status, 404);
  assert.match(body.error, /No route for GET/);
});
