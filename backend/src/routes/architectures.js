import { Router } from 'express';
import { architectureFor, timelineFor, MODERN_YEAR } from '../data/architectures.js';
import { scaleFor, TIMELINE_END } from '../data/companies.js';
import { securityScore, availabilityScore } from '../engines/scoring.js';
import { estimateCost } from '../engines/cost.js';
import { compareWithModern } from '../engines/compare.js';
import { asyncRoute } from '../middleware/errors.js';
import { intParam } from '../middleware/validate.js';
import { logEventAsync } from '../aws/eventLog.js';
import { putMetric } from '../aws/notify.js';

export const architectureRouter = Router();

/** Every era for a company: what the timeline scrubber animates between. */
architectureRouter.get(
  '/:companyId/timeline',
  asyncRoute(async (req, res) => {
    const snapshots = timelineFor(req.params.companyId).map((snapshot) => ({
      ...snapshot,
      scores: {
        security: securityScore(snapshot).score,
        availability: availabilityScore(snapshot).score,
        monthlyCost: estimateCost(snapshot, snapshot.scale).monthly,
      },
    }));
    res.json({ companyId: req.params.companyId, modernYear: MODERN_YEAR, snapshots });
  }),
);

/** The architecture for a company in a year, with its headline scores. */
architectureRouter.get(
  '/:companyId/:year',
  asyncRoute(async (req, res) => {
    const year = intParam(req.params.year, TIMELINE_END, { min: 1990, max: 2040 });
    const architecture = architectureFor(req.params.companyId, year);
    const usage = architecture.scale;

    logEventAsync({
      sessionId: req.sessionId,
      kind: 'architecture.view',
      companyId: req.params.companyId,
      year,
    });
    putMetric('ArchitectureViewed', 1, 'Count', { company: req.params.companyId });

    res.json({
      ...architecture,
      scores: {
        security: securityScore(architecture),
        availability: availabilityScore(architecture),
        cost: estimateCost(architecture, usage),
      },
    });
  }),
);

/** Historical year versus the modern reference, at the same workload. */
architectureRouter.get(
  '/:companyId/:year/compare',
  asyncRoute(async (req, res) => {
    const year = intParam(req.params.year, TIMELINE_END, { min: 1990, max: 2040 });
    logEventAsync({ sessionId: req.sessionId, kind: 'architecture.compare', companyId: req.params.companyId, year });
    res.json(compareWithModern(req.params.companyId, year));
  }),
);
