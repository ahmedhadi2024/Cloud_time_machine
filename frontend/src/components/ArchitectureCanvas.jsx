import { useEffect, useMemo, useRef } from 'react';
import ReactFlow, { Background, Controls, MarkerType, useReactFlow, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';
import ServiceNode from '../nodes/ServiceNode.jsx';

const NODE_TYPES = { service: ServiceNode };

/**
 * Columns are assigned by the role of a service, so a request reads left to
 * right: governance, edge, balancing, compute, data, storage. Nodes within a
 * column stack vertically and the column is centred, which keeps the diagram
 * readable without a layout engine.
 */
const ROLE_COLUMN = {
  network: 0, firewall: 0, identity: 0, encryption: 0,
  dns: 1, security: 1,
  edge: 2,
  loadBalancer: 3,
  compute: 4,
  cache: 5, queue: 5,
  database: 6, orchestration: 6,
  storage: 7, notification: 7,
  archive: 8, observability: 8, costControl: 8,
};

const COLUMN_WIDTH = 196;
const ROW_HEIGHT = 86;

export function layoutGraph(architecture, services) {
  const byType = new Map((services ?? []).map((s) => [s.type, s]));
  const columns = new Map();

  for (const node of architecture.nodes) {
    const service = byType.get(node.type);
    const column = ROLE_COLUMN[service?.role] ?? 4;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push({ node, service });
  }

  const tallest = Math.max(...[...columns.values()].map((c) => c.length), 1);
  const nodes = [];

  for (const [column, entries] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const offset = ((tallest - entries.length) * ROW_HEIGHT) / 2;
    entries.forEach(({ node, service }, index) => {
      nodes.push({
        id: node.id,
        type: 'service',
        position: { x: column * COLUMN_WIDTH, y: offset + index * ROW_HEIGHT },
        data: {
          label: service?.label ?? node.type,
          icon: service?.icon,
          description: service?.description,
          legacy: service?.legacy,
          meta: describeProps(node),
        },
      });
    });
  }

  const edges = architecture.edges.map((edge) => ({
    id: edge.id ?? `${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--border-strong)' },
  }));

  return { nodes, edges };
}

/** The one or two properties worth showing on the face of a node. */
function describeProps(node) {
  const p = node.props ?? {};
  const parts = [];
  if (p.instanceType) parts.push(p.instanceType);
  if (p.instanceClass) parts.push(p.instanceClass);
  if (p.nodeType) parts.push(p.nodeType);
  if (p.units) parts.push(`x${p.units}`);
  if (p.desired !== undefined) parts.push(`${p.min}-${p.max} (${p.desired})`);
  if (p.tasks) parts.push(`${p.tasks} tasks`);
  if (p.multiAz) parts.push('Multi-AZ');
  if (p.readReplicas) parts.push(`+${p.readReplicas} replicas`);
  if (p.azCount) parts.push(`${p.azCount} AZ`);
  if (p.storageGb) parts.push(formatGb(p.storageGb));
  if (p.cacheHitRatio) parts.push(`${Math.round(p.cacheHitRatio * 100)}% hit`);
  if (p.publicAccessBlocked === false) parts.push('PUBLIC');
  if (p.encrypted === false) parts.push('unencrypted');
  if (p.openToWorld) parts.push('0.0.0.0/0');
  return parts.slice(0, 3).join(' · ');
}

function formatGb(gb) {
  if (gb >= 1e6) return `${(gb / 1e6).toFixed(1)}PB`;
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)}TB`;
  return `${gb}GB`;
}

function Inner({ architecture, services, highlight, onSelect, previousNodeIds }) {
  const { fitView } = useReactFlow();
  const signature = architecture.nodes.map((n) => n.id).join(',');
  const lastSignature = useRef('');

  const { nodes, edges } = useMemo(() => {
    const base = layoutGraph(architecture, services);
    const decorated = base.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        state: highlight?.failedIds?.includes(node.id)
          ? 'failed'
          : highlight?.saturatedIds?.includes(node.id)
            ? 'saturated'
            : undefined,
        utilisation: highlight?.utilisation?.[node.id],
        isNew: previousNodeIds ? !previousNodeIds.includes(node.id) : false,
      },
    }));
    const activeEdges = base.edges.map((edge) => ({
      ...edge,
      animated: Boolean(highlight?.animateEdges),
    }));
    return { nodes: decorated, edges: activeEdges };
  }, [architecture, services, highlight, previousNodeIds]);

  // Refit only when the set of nodes actually changes, so a simulation
  // highlight does not jerk the viewport the user has panned.
  useEffect(() => {
    if (signature !== lastSignature.current) {
      lastSignature.current = signature;
      const id = setTimeout(() => fitView({ padding: 0.14, duration: 420 }), 40);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [signature, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_event, node) => onSelect?.(node.id)}
      fitView
      fitViewOptions={{ padding: 0.14 }}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
    >
      <Background color="#1d2642" gap={22} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default function ArchitectureCanvas(props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
