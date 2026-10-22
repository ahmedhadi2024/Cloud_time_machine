import { config, awsEnabled } from '../config.js';
import { sns, sqs, sfn, cloudwatch } from './clients.js';

/**
 * Outbound integrations: SNS for notifications, SQS for work that should not
 * block a request, Step Functions for the multi-step scenario workflow, and
 * CloudWatch for custom metrics. Each one degrades to a log line locally.
 */

export async function publishNotification(subject, message, attributes = {}) {
  if (!awsEnabled.notifications) {
    console.log(`[sns:local] ${subject}: ${typeof message === 'string' ? message : JSON.stringify(message)}`);
    return { published: false, reason: 'no topic configured' };
  }
  const { PublishCommand } = await import('@aws-sdk/client-sns');
  const client = await sns();
  await client.send(
    new PublishCommand({
      TopicArn: config.aws.notificationTopicArn,
      Subject: subject.slice(0, 100),
      Message: typeof message === 'string' ? message : JSON.stringify(message, null, 2),
      MessageAttributes: Object.fromEntries(
        Object.entries(attributes).map(([k, v]) => [k, { DataType: 'String', StringValue: String(v) }]),
      ),
    }),
  );
  return { published: true };
}

export async function enqueueWork(payload) {
  if (!awsEnabled.queue) {
    console.log('[sqs:local] enqueued', payload.kind ?? 'job');
    return { queued: false, reason: 'no queue configured' };
  }
  const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
  const client = await sqs();
  const out = await client.send(
    new SendMessageCommand({
      QueueUrl: config.aws.simulationQueueUrl,
      MessageBody: JSON.stringify(payload),
    }),
  );
  return { queued: true, messageId: out.MessageId };
}

export async function startScenarioWorkflow(input) {
  if (!awsEnabled.workflow) {
    return { started: false, reason: 'no state machine configured' };
  }
  const { StartExecutionCommand } = await import('@aws-sdk/client-sfn');
  const client = await sfn();
  const out = await client.send(
    new StartExecutionCommand({
      stateMachineArn: config.aws.stateMachineArn,
      input: JSON.stringify(input),
    }),
  );
  return { started: true, executionArn: out.executionArn };
}

export async function putMetric(name, value, unit = 'Count', dimensions = {}) {
  if (!awsEnabled.metrics) return;
  try {
    const { PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch');
    const client = await cloudwatch();
    await client.send(
      new PutMetricDataCommand({
        Namespace: config.aws.metricNamespace,
        MetricData: [
          {
            MetricName: name,
            Value: value,
            Unit: unit,
            Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value: String(Value) })),
          },
        ],
      }),
    );
  } catch (err) {
    console.warn('[cloudwatch] metric dropped:', err.message);
  }
}
