import { Router } from 'express';
import { config, awsEnabled } from '../config.js';
import { recentEvents } from '../aws/eventLog.js';
import { asyncRoute } from '../middleware/errors.js';

export const healthRouter = Router();

/** Target group health check: cheap, no dependencies, no logging. */
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/** Deep check used by dashboards: reports which integrations are live. */
healthRouter.get(
  '/readyz',
  asyncRoute(async (_req, res) => {
    res.json({
      status: 'ok',
      region: config.region,
      environment: config.nodeEnv,
      integrations: awsEnabled,
      version: process.env.APP_VERSION ?? 'dev',
    });
  }),
);

healthRouter.get(
  '/events',
  asyncRoute(async (req, res) => {
    res.json({ events: await recentEvents(req.sessionId, 50) });
  }),
);
