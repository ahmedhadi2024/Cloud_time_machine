import { useCallback, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background, Controls, MarkerType, ReactFlowProvider, addEdge,
  useEdgesState, useNodesState, useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import ServiceNode from '../nodes/ServiceNode.jsx';
import { api } from '../api/client.js';
import { Card, Gauge, Pill, Stat, Loading, ErrorBox, ICONS, formatGb, formatMoney, scoreTone } from './common.jsx';

const NODE_TYPES = { service: ServiceNode };

/**
 * Drag-and-drop architecture builder.
 *
 * The canvas is the source of truth; pressing Review sends the graph to the
 * same engines that score the stock architectures, so a user design is judged
 * by exactly the same rules.
 */
function BuilderInner({ services, companies, companyId, onCompanyChange }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewState, setReviewState] = useState({ loading: false, error: null });
  const [name, setName] = useState('My architecture');
  const [saved, setSaved] = useState(null);
  const counter = useRef(0);
  const wrapper = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  const serviceByType = useMemo(() => new Map(services.map((s) => [s.type, s])), [services]);
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const service of services) {
      if (!groups.has(service.category)) groups.set(service.category, []);
      groups.get(service.category).push(service);
    }
    return [...groups.entries()];
  }, [services]);

  const addNode = useCallback(
    (type, position) => {
      const service = serviceByType.get(type);
      if (!service) return;
      counter.current += 1;
      const id = `${type}-${counter.current}`;
      setNodes((current) => [
        ...current,
        {
          id,
          type: 'service',
          position,
          data: {
            label: service.label,
            icon: service.icon,
            description: service.description,
            legacy: service.legacy,
            serviceType: type,
            props: { ...service.defaults },
            meta: describe(service.defaults),
          },
        },
      ]);
      setSelectedId(id);
    },
    [serviceByType, setNodes],
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/ctm-service');
      if (!type) return;
      addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const onConnect = useCallback(
    (connection) =>
      setEdges((current) =>
        addEdge(
          { ...connection, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } },
          current,
        ),
      ),
    [setEdges],
  );

  const toGraph = useCallback(
    () => ({
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.data.serviceType,
        props: node.data.props,
      })),
      edges: edges.map((edge) => ({ id: edge.id, from: edge.source, to: edge.target })),
    }),
    [nodes, edges],
  );

  const runReview = useCallback(async () => {
    setReviewState({ loading: true, error: null });
    try {
      const result = await api.review({ graph: toGraph(), companyId, year: 2025 });
      setReview(result);
      setReviewState({ loading: false, error: null });
    } catch (error) {
      setReviewState({ loading: false, error });
    }
  }, [toGraph, companyId]);

  const loadStarter = useCallback(async () => {
    const { graph } = await api.starter();
    counter.current = 0;
    const laid = graph.nodes.map((node, index) => {
      const service = serviceByType.get(node.type);
      counter.current += 1;
      return {
        id: node.id,
        type: 'service',
        position: { x: 60 + index * 190, y: 140 },
        data: {
          label: service?.label ?? node.type,
          icon: service?.icon,
          description: service?.description,
          legacy: service?.legacy,
          serviceType: node.type,
          props: { ...(service?.defaults ?? {}), ...(node.props ?? {}) },
          meta: describe({ ...(service?.defaults ?? {}), ...(node.props ?? {}) }),
        },
      };
    });
    setNodes(laid);
    setEdges(
      graph.edges.map((edge, index) => ({
        id: `starter-${index}`,
        source: edge.from,
        target: edge.to,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      })),
    );
    setReview(null);
  }, [serviceByType, setNodes, setEdges]);

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setReview(null);
    setSelectedId(null);
  }, [setNodes, setEdges]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((current) => current.filter((n) => n.id !== selectedId));
    setEdges((current) => current.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }, [selectedId, setNodes, setEdges]);

  const updateProp = useCallback(
    (key, value) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== selectedId) return node;
          const props = { ...node.data.props, [key]: value };
          return { ...node, data: { ...node.data, props, meta: describe(props) } };
        }),
      );
    },
    [selectedId, setNodes],
  );

  const save = useCallback(async () => {
    const result = await api.saveDesign({ graph: toGraph(), name, companyId });
    setSaved(result.design);
  }, [toGraph, name, companyId]);

  const selected = nodes.find((n) => n.id === selectedId);

  return (
    <div className="builder">
      <aside className="palette">
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" onClick={loadStarter} style={{ flex: 1 }}>Starter</button>
          <button type="button" onClick={clearCanvas} className="ghost">Clear</button>
        </div>
        {grouped.map(([category, items]) => (
          <div key={category}>
            <h3>{category}</h3>
            {items.map((service) => (
              <div
                key={service.type}
                className={`palette-item ${service.legacy ? 'legacy' : ''}`}
                draggable
                title={service.description}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/ctm-service', service.type);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDoubleClick={() => addNode(service.type, { x: 120, y: 120 })}
              >
                <span className="icon" aria-hidden="true">{ICONS[service.icon] ?? '▫'}</span>
                <span>{service.label}</span>
              </div>
            ))}
          </div>
        ))}
      </aside>

      <div
        className="builder-canvas"
        ref={wrapper}
        onDrop={onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
      >
        <ReactFlow
          nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedId }))}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          deleteKeyCode={['Backspace', 'Delete']}
          minZoom={0.2}
          maxZoom={1.6}
          fitView
        >
          <Background color="#1d2642" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {nodes.length === 0 ? (
          <div className="builder-hint">
            Drag services from the left onto the canvas,
            <br />
            then join them by dragging between the dots on each box.
          </div>
        ) : null}
      </div>

      <aside className="sidebar">
        <div className="tab-body">
          <Card
            title="Design for"
            note={
              review
                ? `Judged against this company's 2025 peak: ${review.usage.peakRps.toLocaleString()} rps, ${formatGb(review.usage.storageGb)} stored.`
                : 'Your design is scored against this company\'s 2025 workload.'
            }
          >
            <div className="field">
              <select value={companyId} onChange={(event) => onCompanyChange(event.target.value)}>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} — {company.industry}
                  </option>
                ))}
              </select>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="primary" onClick={runReview} disabled={reviewState.loading || !nodes.length}>
                {reviewState.loading ? 'Reviewing…' : 'Review my design'}
              </button>
              {selectedId ? (
                <button type="button" onClick={deleteSelected}>Delete selected</button>
              ) : null}
            </div>
          </Card>

          {selected ? (
            <Card title={`Configure ${selected.data.label}`}>
              <PropEditor props={selected.data.props} onChange={updateProp} />
            </Card>
          ) : null}

          {reviewState.error ? <ErrorBox error={reviewState.error} onRetry={runReview} /> : null}
          {reviewState.loading && !review ? <Loading what="Scoring your architecture" /> : null}

          {review ? (
            <>
              <Card>
                <div className="gauges">
                  <Gauge name="Overall" score={review.score} />
                  <Gauge name="Security" score={review.scores.security} />
                  <Gauge name="Availability" score={review.scores.availability} />
                </div>
                <p style={{ marginTop: 10, color: 'var(--text-muted)' }}>{review.summary}</p>
                <div className="row between" style={{ marginTop: 6 }}>
                  <Pill tone={scoreTone(review.score)}>Grade {review.grade}</Pill>
                  <Pill tone="neutral">{formatMoney(review.cost.monthly, { compact: true })}/mo</Pill>
                  <Pill tone="info">{review.scores.bestPractice}% best practice</Pill>
                </div>
              </Card>

              {review.findings.length ? (
                <Card title="Findings">
                  <ul className="list">
                    {review.findings.map((finding) => (
                      <li key={finding.id}>
                        <div className="row between">
                          <span className="title">{finding.title}</span>
                          <Pill tone={finding.severity === 'error' ? 'critical' : finding.severity === 'warning' ? 'warn' : 'info'}>
                            {finding.severity}
                          </Pill>
                        </div>
                        <div className="detail">{finding.detail}</div>
                        {finding.components ? <div className="card-note">{finding.components}</div> : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {review.nextSteps.length ? (
                <Card title="Next steps">
                  <ul className="list">
                    {review.nextSteps.map((step, index) => (
                      <li key={index}>
                        <span className="title">{step.action}</span>
                        <div className="detail">{step.because}</div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <Card title="Patterns">
                <ul className="list">
                  {review.practices.map((practice) => (
                    <li key={practice.id}>
                      <div className="row between">
                        <span>{practice.title}</span>
                        <Pill tone={practice.met ? 'ok' : 'neutral'}>{practice.met ? 'yes' : 'no'}</Pill>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              {review.traffic ? (
                <Card title="Under this company's peak load">
                  <div className="stat-grid">
                    <Stat label="Peak" value={`${review.traffic.requestedRps.toLocaleString()} rps`} />
                    <Stat
                      label="Dropped"
                      value={`${review.traffic.errorRatePercent}%`}
                      tone={review.traffic.errorRatePercent > 1 ? 'bad' : 'ok'}
                    />
                    <Stat label="p99" value={`${review.traffic.p99LatencyMs} ms`} />
                  </div>
                  {review.traffic.bottleneck ? (
                    <p className="card-note" style={{ marginTop: 8 }}>
                      Bottleneck: {review.traffic.bottleneck.role} at{' '}
                      {review.traffic.bottleneck.capacityRps.toLocaleString()} rps.
                    </p>
                  ) : null}
                </Card>
              ) : null}

              <Card title="Save">
                <div className="row">
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
                  <button type="button" onClick={save}>Save</button>
                </div>
                {saved ? (
                  <p className="card-note" style={{ marginTop: 6 }}>
                    Saved as {saved.id} with score {saved.score}.
                  </p>
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

/** Edits the props the engines actually read, typed by the value's shape. */
function PropEditor({ props, onChange }) {
  const entries = Object.entries(props ?? {});
  if (!entries.length) return <p className="card-note">This service has nothing to configure.</p>;
  return (
    <div>
      {entries.map(([key, value]) => (
        <div className="prop" key={key}>
          <label htmlFor={`prop-${key}`}>{humanise(key)}</label>
          {typeof value === 'boolean' ? (
            <input
              id={`prop-${key}`}
              type="checkbox"
              checked={value}
              onChange={(event) => onChange(key, event.target.checked)}
            />
          ) : typeof value === 'number' ? (
            <input
              id={`prop-${key}`}
              type="number"
              value={value}
              step={value < 1 ? 0.05 : 1}
              min="0"
              onChange={(event) => onChange(key, Number(event.target.value))}
            />
          ) : (
            <input
              id={`prop-${key}`}
              type="text"
              value={String(value)}
              onChange={(event) => onChange(key, event.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function humanise(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bAz\b/g, 'AZ')
    .replace(/\bGb\b/g, 'GB')
    .replace(/\bIa\b/g, 'IA');
}

function describe(props = {}) {
  const parts = [];
  if (props.instanceType) parts.push(props.instanceType);
  if (props.instanceClass) parts.push(props.instanceClass);
  if (props.multiAz) parts.push('Multi-AZ');
  if (props.units) parts.push(`x${props.units}`);
  if (props.desired !== undefined) parts.push(`${props.min}-${props.max}`);
  if (props.publicAccessBlocked === false) parts.push('PUBLIC');
  return parts.slice(0, 3).join(' · ');
}

export default function Builder(props) {
  return (
    <ReactFlowProvider>
      <BuilderInner {...props} />
    </ReactFlowProvider>
  );
}
