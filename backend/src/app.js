import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { catalogRouter } from './routes/catalog.js';
import { architectureRouter } from './routes/architectures.js';
import { simulateRouter } from './routes/simulate.js';
import { builderRouter } from './routes/builder.js';
import { healthRouter } from './routes/health.js';
import { notFound, errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', true); // behind ALB + CloudFront
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // A session id groups a visitor's simulation events in DynamoDB without
  // storing anything identifying.
  app.use((req, _res, next) => {
    req.sessionId = req.get('x-session-id') || `anon-${randomUUID().slice(0, 8)}`;
    next();
  });

  app.use('/', healthRouter);
  app.use('/api', catalogRouter);
  app.use('/api/architectures', architectureRouter);
  app.use('/api/simulate', simulateRouter);
  app.use('/api/builder', builderRouter);

  serveFrontendIfBundled(app);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/**
 * In the main deployment CloudFront serves the front end from S3 and only
 * /api/* reaches this process. The AWS Academy deployment has no CDN, so the
 * build is bundled into ./public and served from here instead, keeping
 * everything on one origin. Absent that directory this is a no-op, which is
 * the case locally and in the main deployment.
 */
function serveFrontendIfBundled(app) {
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  if (!existsSync(publicDir)) return;

  // Hashed assets are safe to cache forever; index.html must not be, or a
  // deployment stays invisible until the cache expires.
  app.use(express.static(publicDir, { index: false, maxAge: '1y' }));

  // Single-page app: any non-API path is a client-side route, not a 404.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/events')) return next();
    res.sendFile(join(publicDir, 'index.html'), { maxAge: 0 });
  });
}
