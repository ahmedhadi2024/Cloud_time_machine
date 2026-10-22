/**
 * Configuration is entirely environment driven so the same image runs locally
 * and on EC2. Every AWS integration is optional: if the variable is absent the
 * feature falls back to an in-process implementation and the API keeps working,
 * which is what makes `npm run dev` possible without an AWS account.
 */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  region: process.env.AWS_REGION ?? 'us-east-1',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),

  aws: {
    eventsTable: process.env.EVENTS_TABLE ?? '',
    designsTable: process.env.DESIGNS_TABLE ?? '',
    assetsBucket: process.env.ASSETS_BUCKET ?? '',
    notificationTopicArn: process.env.NOTIFICATION_TOPIC_ARN ?? '',
    simulationQueueUrl: process.env.SIMULATION_QUEUE_URL ?? '',
    stateMachineArn: process.env.STATE_MACHINE_ARN ?? '',
    metricNamespace: process.env.METRIC_NAMESPACE ?? 'CloudTimeMachine',
  },

  limits: {
    maxNodes: Number(process.env.MAX_NODES ?? 60),
    maxRps: Number(process.env.MAX_SIMULATED_RPS ?? 5_000_000),
  },
};

export const awsEnabled = {
  events: Boolean(config.aws.eventsTable),
  designs: Boolean(config.aws.designsTable),
  assets: Boolean(config.aws.assetsBucket),
  notifications: Boolean(config.aws.notificationTopicArn),
  queue: Boolean(config.aws.simulationQueueUrl),
  workflow: Boolean(config.aws.stateMachineArn),
  metrics: config.nodeEnv === 'production',
};
