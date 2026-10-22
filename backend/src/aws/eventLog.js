import { randomUUID } from 'node:crypto';
import { config, awsEnabled } from '../config.js';
import { dynamo } from './clients.js';

/**
 * Event logging.
 *
 * Every simulation a user runs is an event: high write volume, append only,
 * never updated, queried by session. That is the DynamoDB shape from the
 * proposal. Without a table configured, events are kept in a bounded in-memory
 * ring so the API behaves identically in development.
 */
const localEvents = [];
const LOCAL_LIMIT = 1000;

export async function logEvent(event) {
  const record = {
    sessionId: event.sessionId ?? 'anonymous',
    eventId: `${Date.now()}#${randomUUID()}`,
    timestamp: new Date().toISOString(),
    kind: event.kind,
    companyId: event.companyId ?? null,
    year: event.year ?? null,
    detail: event.detail ?? {},
    // DynamoDB TTL: simulation events are only interesting for 30 days.
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400,
  };

  if (!awsEnabled.events) {
    localEvents.push(record);
    if (localEvents.length > LOCAL_LIMIT) localEvents.shift();
    return record;
  }

  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const client = await dynamo();
  await client.send(new PutCommand({ TableName: config.aws.eventsTable, Item: record }));
  return record;
}

export async function recentEvents(sessionId, limit = 50) {
  if (!awsEnabled.events) {
    return localEvents
      .filter((e) => !sessionId || e.sessionId === sessionId)
      .slice(-limit)
      .reverse();
  }
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const client = await dynamo();
  const out = await client.send(
    new QueryCommand({
      TableName: config.aws.eventsTable,
      KeyConditionExpression: 'sessionId = :s',
      ExpressionAttributeValues: { ':s': sessionId ?? 'anonymous' },
      Limit: limit,
      ScanIndexForward: false,
    }),
  );
  return out.Items ?? [];
}

/** Fire-and-forget: logging must never fail a user's request. */
export function logEventAsync(event) {
  logEvent(event).catch((err) => {
    console.warn('[eventLog] dropped event:', err.message);
  });
}
