import { randomUUID } from 'node:crypto';
import { config, awsEnabled } from '../config.js';
import { dynamo, s3 } from './clients.js';

/**
 * Saved user architectures.
 *
 * Metadata lives in DynamoDB (small, queried by id); the graph itself goes to
 * S3 when a bucket is configured, because an architecture with sixty nodes and
 * its review output is larger than a row wants to be. Locally both live in a
 * Map.
 */
const localDesigns = new Map();

export async function saveDesign({ name, graph, review, author }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const record = { id, name: name || 'Untitled architecture', author: author || 'anonymous', createdAt, score: review?.score ?? null, grade: review?.grade ?? null, nodeCount: graph.nodes.length };

  if (!awsEnabled.designs) {
    localDesigns.set(id, { ...record, graph, review });
    return record;
  }

  let s3Key = null;
  if (awsEnabled.assets) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    s3Key = `designs/${id}.json`;
    const client = await s3();
    await client.send(
      new PutObjectCommand({
        Bucket: config.aws.assetsBucket,
        Key: s3Key,
        Body: JSON.stringify({ graph, review }),
        ContentType: 'application/json',
        ServerSideEncryption: 'aws:kms',
      }),
    );
  }

  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const client = await dynamo();
  await client.send(
    new PutCommand({
      TableName: config.aws.designsTable,
      Item: { ...record, s3Key, graph: s3Key ? undefined : graph },
    }),
  );
  return { ...record, s3Key };
}

export async function loadDesign(id) {
  if (!awsEnabled.designs) return localDesigns.get(id) ?? null;

  const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
  const client = await dynamo();
  const out = await client.send(new GetCommand({ TableName: config.aws.designsTable, Key: { id } }));
  if (!out.Item) return null;
  if (out.Item.s3Key && awsEnabled.assets) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const bucket = await s3();
    const object = await bucket.send(
      new GetObjectCommand({ Bucket: config.aws.assetsBucket, Key: out.Item.s3Key }),
    );
    const body = JSON.parse(await object.Body.transformToString());
    return { ...out.Item, ...body };
  }
  return out.Item;
}

export async function listDesigns(limit = 25) {
  if (!awsEnabled.designs) {
    return [...localDesigns.values()]
      .map(({ graph, review, ...rest }) => rest)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const client = await dynamo();
  const out = await client.send(
    new ScanCommand({ TableName: config.aws.designsTable, Limit: limit }),
  );
  return (out.Items ?? []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
