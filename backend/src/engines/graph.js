import { getType, resolveProps, nodeAvailability, nodeCapacity, nodeSecurity } from '../data/catalog.js';

/** Validate and normalise an arbitrary (possibly user-built) graph. */
export function normaliseGraph(input) {
  if (!input || !Array.isArray(input.nodes)) {
    const err = new Error('An architecture needs a `nodes` array.');
    err.status = 400;
    throw err;
  }
  const seen = new Set();
  const nodes = input.nodes.map((node, i) => {
    if (!node || typeof node.type !== 'string') {
      const err = new Error(`Node at index ${i} is missing a \`type\`.`);
      err.status = 400;
      throw err;
    }
    getType(node.type); // throws on unknown type
    const id = node.id ?? `${node.type}-${i}`;
    if (seen.has(id)) {
      const err = new Error(`Duplicate node id: ${id}`);
      err.status = 400;
      throw err;
    }
    seen.add(id);
    return { id, type: node.type, props: resolveProps(node), label: node.label ?? getType(node.type).label };
  });

  const ids = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  const edges = rawEdges
    .map((edge, i) => {
      const from = edge.from ?? edge.source;
      const to = edge.to ?? edge.target;
      return { id: edge.id ?? `e${i}`, from, to };
    })
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

  return { nodes, edges };
}

export function byRole(graph, role) {
  return graph.nodes.filter((n) => getType(n.type).role === role);
}

export function hasRole(graph, role) {
  return byRole(graph, role).length > 0;
}

export function byType(graph, type) {
  return graph.nodes.filter((n) => n.type === type);
}

export function hasType(graph, type) {
  return byType(graph, type).length > 0;
}

export function outgoing(graph, id) {
  return graph.edges.filter((e) => e.from === id).map((e) => e.to);
}

export function incoming(graph, id) {
  return graph.edges.filter((e) => e.to === id).map((e) => e.from);
}

export function nodeById(graph, id) {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * Nodes reachable from the request entry point, following edges forward.
 * Supporting roles (identity, encryption, monitoring) attach to the path
 * backwards, so they are added explicitly rather than treated as unreachable.
 */
const SUPPORTING_ROLES = new Set([
  'identity',
  'encryption',
  'firewall',
  'network',
  'observability',
  'costControl',
  'security',
  'dns',
]);

export function entryNodes(graph) {
  const roleOrder = ['dns', 'edge', 'loadBalancer', 'compute'];
  for (const role of roleOrder) {
    const found = byRole(graph, role);
    if (found.length) return found;
  }
  return graph.nodes.slice(0, 1);
}

export function reachableFromEntry(graph) {
  const reached = new Set();
  const queue = entryNodes(graph).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const next of outgoing(graph, id)) queue.push(next);
  }
  for (const node of graph.nodes) {
    if (SUPPORTING_ROLES.has(getType(node.type).role)) reached.add(node.id);
  }
  return reached;
}

export function orphanNodes(graph) {
  const reached = reachableFromEntry(graph);
  return graph.nodes.filter((n) => !reached.has(n.id));
}

/**
 * The ordered request path: edge -> load balancer -> compute -> data.
 * Used by the traffic simulator to find where requests pile up.
 */
export function requestPath(graph) {
  const order = ['dns', 'edge', 'loadBalancer', 'compute', 'cache', 'database', 'storage'];
  const tiers = [];
  for (const role of order) {
    const nodes = byRole(graph, role);
    if (nodes.length) tiers.push({ role, nodes });
  }
  return tiers;
}

export { nodeAvailability, nodeCapacity, nodeSecurity, resolveProps, getType };
