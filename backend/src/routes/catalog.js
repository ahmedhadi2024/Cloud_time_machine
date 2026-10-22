import { Router } from 'express';
import { catalogForClient } from '../data/catalog.js';
import { companiesForClient, scaleFor, TIMELINE_START, TIMELINE_END } from '../data/companies.js';
import { ERA_YEARS } from '../data/architectures.js';
import { FAILURE_SCENARIOS } from '../engines/failure.js';
import { ATTACK_TYPES } from '../engines/ddos.js';
import { asyncRoute } from '../middleware/errors.js';
import { intParam } from '../middleware/validate.js';

export const catalogRouter = Router();

/** Everything the frontend needs to render its pickers and palette. */
catalogRouter.get(
  '/meta',
  asyncRoute(async (_req, res) => {
    res.json({
      companies: companiesForClient(),
      services: catalogForClient(),
      timeline: { start: TIMELINE_START, end: TIMELINE_END, eras: ERA_YEARS },
      failureScenarios: FAILURE_SCENARIOS.map(({ id, label }) => ({ id, label })),
      attackTypes: ATTACK_TYPES,
    });
  }),
);

catalogRouter.get(
  '/companies',
  asyncRoute(async (_req, res) => res.json({ companies: companiesForClient() })),
);

catalogRouter.get(
  '/companies/:id/scale/:year',
  asyncRoute(async (req, res) => {
    const year = intParam(req.params.year, TIMELINE_END, { min: 1990, max: 2040 });
    res.json(scaleFor(req.params.id, year));
  }),
);

catalogRouter.get(
  '/services',
  asyncRoute(async (_req, res) => res.json({ services: catalogForClient() })),
);
