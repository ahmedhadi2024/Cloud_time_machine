import { config } from '../config.js';

/**
 * Lazily constructed AWS SDK clients.
 *
 * They are created on first use so a local run never needs credentials, and so
 * an unused service never costs a connection. On EC2 the credentials come from
 * the instance profile; nothing here reads an access key.
 */
const cache = new Map();

async function client(key, loader) {
  if (!cache.has(key)) cache.set(key, loader());
  return cache.get(key);
}

export function dynamo() {
  return client('dynamo', async () => {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
    return DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  });
}

export function s3() {
  return client('s3', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({ region: config.region });
  });
}

export function sns() {
  return client('sns', async () => {
    const { SNSClient } = await import('@aws-sdk/client-sns');
    return new SNSClient({ region: config.region });
  });
}

export function sqs() {
  return client('sqs', async () => {
    const { SQSClient } = await import('@aws-sdk/client-sqs');
    return new SQSClient({ region: config.region });
  });
}

export function sfn() {
  return client('sfn', async () => {
    const { SFNClient } = await import('@aws-sdk/client-sfn');
    return new SFNClient({ region: config.region });
  });
}

export function cloudwatch() {
  return client('cloudwatch', async () => {
    const { CloudWatchClient } = await import('@aws-sdk/client-cloudwatch');
    return new CloudWatchClient({ region: config.region });
  });
}
