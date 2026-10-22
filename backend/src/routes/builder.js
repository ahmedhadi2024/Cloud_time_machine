import { Router } from 'express';
import { reviewArchitecture, starterGraph } from '../engines/builder.js';
import { compareArchitectures } from '../engines/compare.js';
import { architectureFor, MODERN_YEAR } from '../data/architectures.js';
import { scaleFor } from '../data/companies.js';
import { asyncRoute } from '../middleware/errors.js';
import { requireGraph, intParam } from '../middleware/validate.js';
import { saveDesign, loadDesign, listDesigns } from '../aws/designStore.js';
import { logEventAsync } from '../aws/eventLog.js';
import { publishNotification, startScenarioWorkflow } from '../aws/notify.js';

export const builderRouter = Router();

builderRouter.get(
  '/starter',
  asyncRoute(async (_req, res) => res.json({ graph: starterGraph() })),
);

/** Score a user-built architecture and tell them what to fix. */
builderRouter.post(
  '/review',
  asyncRoute(async (req, res) => {
    const graph = requireGraph(req);
    const usage =
      req.body?.usage ??
      scaleFor(req.body?.companyId ?? 'shopcart', intParam(req.body?.year, MODERN_YEAR, { min: 1990, max: 2040 }));
    const review = reviewArchitecture(graph, usage);
    logEventAsync({
      sessionId: req.sessionId,
      kind: 'builder.review',
      companyId: req.body?.companyId,
      detail: { score: review.score, nodeCount: graph.nodes.length },
    });
    res.json({ usage, ...review });
  }),
);

/** Score a user design against the reference architecture for the same company. */
builderRouter.post(
  '/benchmark',
  asyncRoute(async (req, res) => {
    const graph = requireGraph(req);
    const companyId = req.body?.companyId ?? 'shopcart';
    const year = intParam(req.body?.year, MODERN_YEAR, { min: 1990, max: 2040 });
    const usage = req.body?.usage ?? scaleFor(companyId, year);
    const reference = architectureFor(companyId, MODERN_YEAR);
    res.json({
      usage,
      yours: reviewArchitecture(graph, usage),
      reference: { eraName: reference.eraName, nodes: reference.nodes, edges: reference.edges },
      comparison: compareArchitectures(graph, reference, usage),
    });
  }),
);

builderRouter.post(
  '/designs',
  asyncRoute(async (req, res) => {
    const graph = requireGraph(req);
    const usage = req.body?.usage ?? scaleFor(req.body?.companyId ?? 'shopcart', MODERN_YEAR);
    const review = reviewArchitecture(graph, usage);
    const saved = await saveDesign({
      name: req.body?.name,
      author: req.body?.author,
      graph,
      review,
    });
    publishNotification('Cloud Time Machine: architecture saved', {
      id: saved.id,
      name: saved.name,
      score: review.score,
    }).catch(() => {});
    startScenarioWorkflow({ designId: saved.id, kind: 'design.saved' }).catch(() => {});
    logEventAsync({ sessionId: req.sessionId, kind: 'builder.save', detail: { id: saved.id, score: review.score } });
    res.status(201).json({ design: saved, review });
  }),
);

builderRouter.get(
  '/designs',
  asyncRoute(async (_req, res) => res.json({ designs: await listDesigns() })),
);

builderRouter.get(
  '/designs/:id',
  asyncRoute(async (req, res) => {
    const design = await loadDesign(req.params.id);
    if (!design) {
      const err = new Error(`No design with id ${req.params.id}`);
      err.status = 404;
      throw err;
    }
    res.json({ design });
  }),
);
