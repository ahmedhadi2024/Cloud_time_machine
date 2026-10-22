import { config } from '../config.js';

export function requireGraph(req) {
  const graph = req.body?.graph ?? req.body;
  if (!graph || !Array.isArray(graph.nodes)) {
    const err = new Error('Request body must contain an architecture graph with a `nodes` array.');
    err.status = 400;
    throw err;
  }
  if (graph.nodes.length > config.limits.maxNodes) {
    const err = new Error(`An architecture may contain at most ${config.limits.maxNodes} components.`);
    err.status = 400;
    throw err;
  }
  return graph;
}

export function intParam(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n)) {
    const err = new Error(`Expected a number, received "${value}".`);
    err.status = 400;
    throw err;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function requireUsage(req) {
  const body = req.body ?? {};
  if (body.usage) return body.usage;
  const err = new Error('Request body must contain a `usage` object (use /api/companies/:id/scale/:year to get one).');
  err.status = 400;
  throw err;
}
