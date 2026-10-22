import { Router } from 'express';
import { simulateTraffic } from '../engines/traffic.js';
import { simulateFailure } from '../engines/failure.js';
import { simulateDdos } from '../engines/ddos.js';
import { projectStorage } from '../engines/storage.js';
import { estimateCost, optimiseCost } from '../engines/cost.js';
import { securityScore, availabilityScore } from '../engines/scoring.js';
import { compareArchitectures } from '../engines/compare.js';
import { architectureFor } from '../data/architectures.js';
import { scaleFor } from '../data/companies.js';
import { asyncRoute } from '../middleware/errors.js';
import { requireGraph, requireUsage, intParam } from '../middleware/validate.js';
import { logEventAsync } from '../aws/eventLog.js';
import { putMetric, publishNotification, enqueueWork } from '../aws/notify.js';
import { config } from '../config.js';

export const simulateRouter = Router();

/**
 * Every simulation endpoint takes a graph in the body, so the same route serves
 * a stock era architecture and one the user has just dragged together. Passing
 * `{ companyId, year }` instead of `graph` loads the stock architecture.
 */
function graphFromBody(req) {
  if (req.body?.companyId && req.body?.year) {
    const year = intParam(req.body.year, 2025, { min: 1990, max: 2040 });
    const architecture = architectureFor(req.body.companyId, year);
    return { graph: architecture, usage: req.body.usage ?? architecture.scale };
  }
  const graph = requireGraph(req);
  const usage = req.body?.usage ?? req.body?.graph?.scale ?? graph.scale;
  if (!usage) {
    const err = new Error('Provide a `usage` object, or `companyId` and `year` so one can be derived.');
    err.status = 400;
    throw err;
  }
  return { graph, usage };
}

simulateRouter.post(
  '/traffic',
  asyncRoute(async (req, res) => {
    const { graph } = graphFromBody(req);
    const rps = intParam(req.body?.rps, 1000, { min: 1, max: config.limits.maxRps });
    const result = simulateTraffic(graph, {
      rps,
      durationSeconds: intParam(req.body?.durationSeconds, 120, { min: 10, max: 600 }),
      rampSeconds: intParam(req.body?.rampSeconds, 20, { min: 0, max: 600 }),
    });

    logEventAsync({ sessionId: req.sessionId, kind: 'simulate.traffic', companyId: req.body?.companyId, year: req.body?.year, detail: { rps, errorRatePercent: result.errorRatePercent } });
    putMetric('TrafficSimulation', 1, 'Count');
    if (result.verdict.level === 'critical') {
      // A collapse is the kind of event the proposal wants SNS to announce.
      publishNotification(
        'Cloud Time Machine: architecture collapsed under simulated load',
        { rps, errorRatePercent: result.errorRatePercent, bottleneck: result.bottleneck },
        { severity: 'critical' },
      ).catch(() => {});
    }
    res.json(result);
  }),
);

simulateRouter.post(
  '/failure',
  asyncRoute(async (req, res) => {
    const { graph } = graphFromBody(req);
    const result = simulateFailure(graph, { scenario: req.body?.scenario });
    logEventAsync({ sessionId: req.sessionId, kind: 'simulate.failure', companyId: req.body?.companyId, year: req.body?.year, detail: { scenario: result.scenario, downtimeMinutes: result.downtimeMinutes } });
    res.json(result);
  }),
);

simulateRouter.post(
  '/ddos',
  asyncRoute(async (req, res) => {
    const { graph, usage } = graphFromBody(req);
    const result = simulateDdos(graph, {
      attack: req.body?.attack,
      attackRps: req.body?.attackRps === undefined ? undefined : intParam(req.body.attackRps, 200000, { min: 1000, max: 20_000_000 }),
      legitimateRps: intParam(req.body?.legitimateRps, Math.max(1, usage.averageRps ?? 1000), { min: 1, max: config.limits.maxRps }),
      durationHours: intParam(req.body?.durationHours, 1, { min: 1, max: 72 }),
    });
    logEventAsync({ sessionId: req.sessionId, kind: 'simulate.ddos', companyId: req.body?.companyId, year: req.body?.year, detail: { attack: result.attack.id, availabilityPercent: result.availabilityPercent } });
    res.json(result);
  }),
);

simulateRouter.post(
  '/storage',
  asyncRoute(async (req, res) => {
    const { graph } = graphFromBody(req);
    const result = projectStorage(graph, {
      months: intParam(req.body?.months, 36, { min: 6, max: 120 }),
      monthlyGrowthPercent: intParam(req.body?.monthlyGrowthPercent, 8, { min: 0, max: 100 }),
      startGb: req.body?.startGb === undefined ? undefined : intParam(req.body.startGb, 500, { min: 1, max: 100_000_000 }),
    });
    logEventAsync({ sessionId: req.sessionId, kind: 'simulate.storage', companyId: req.body?.companyId, year: req.body?.year });
    res.json(result);
  }),
);

simulateRouter.post(
  '/cost',
  asyncRoute(async (req, res) => {
    const { graph, usage } = graphFromBody(req);
    res.json(estimateCost(graph, usage));
  }),
);

simulateRouter.post(
  '/cost/optimise',
  asyncRoute(async (req, res) => {
    const { graph, usage } = graphFromBody(req);
    const result = optimiseCost(graph, usage);
    logEventAsync({ sessionId: req.sessionId, kind: 'simulate.optimise', detail: { saving: result.totalMonthlySaving } });
    res.json(result);
  }),
);

simulateRouter.post(
  '/scores',
  asyncRoute(async (req, res) => {
    const { graph, usage } = graphFromBody(req);
    res.json({
      security: securityScore(graph),
      availability: availabilityScore(graph),
      cost: estimateCost(graph, usage),
    });
  }),
);

simulateRouter.post(
  '/compare',
  asyncRoute(async (req, res) => {
    const left = req.body?.left;
    const right = req.body?.right;
    if (!left || !right) {
      const err = new Error('Provide `left` and `right` architecture graphs.');
      err.status = 400;
      throw err;
    }
    const usage = req.body?.usage ?? (req.body?.companyId && req.body?.year ? scaleFor(req.body.companyId, req.body.year) : null);
    if (!usage) {
      const err = new Error('Provide a `usage` object, or `companyId` and `year`.');
      err.status = 400;
      throw err;
    }
    res.json(compareArchitectures(left, right, usage));
  }),
);

/**
 * Run every simulation in one call. Heavy, so it is also the endpoint that
 * demonstrates handing work to SQS when the queue is configured.
 */
simulateRouter.post(
  '/full-report',
  asyncRoute(async (req, res) => {
    const { graph, usage } = graphFromBody(req);
    const report = {
      usage,
      cost: optimiseCost(graph, usage),
      security: securityScore(graph),
      availability: availabilityScore(graph),
      traffic: simulateTraffic(graph, { rps: usage.peakRps, rampSeconds: 60, durationSeconds: 300 }),
      failures: ['database-primary', 'availability-zone', 'compute-node', 'cache-flush'].map((scenario) =>
        simulateFailure(graph, { scenario }),
      ),
      ddos: simulateDdos(graph, { attack: 'http-flood', legitimateRps: Math.max(1, usage.averageRps) }),
      storage: projectStorage(graph, { months: 36 }),
    };
    enqueueWork({ kind: 'report.generated', companyId: req.body?.companyId, year: req.body?.year }).catch(() => {});
    res.json(report);
  }),
);
