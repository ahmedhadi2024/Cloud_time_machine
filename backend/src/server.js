import { createApp } from './app.js';
import { config, awsEnabled } from './config.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Cloud Time Machine API listening on :${config.port} (${config.nodeEnv})`);
  const live = Object.entries(awsEnabled)
    .filter(([, on]) => on)
    .map(([name]) => name);
  console.log(live.length ? `AWS integrations live: ${live.join(', ')}` : 'Running with local fallbacks for all AWS integrations');
});

// The ALB drains connections for 30s by default; finish in-flight requests
// before exiting so a deployment does not return 502s.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, draining connections`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 25_000).unref();
  });
}
