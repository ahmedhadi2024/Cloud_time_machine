import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
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

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
