import { useState } from 'react';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Stat, Verdict, Loading, ErrorBox, Pill } from './common.jsx';

/** Failure simulator: break a component, see the blast radius and recovery. */
export default function FailurePanel({ architecture, scenarios, onHighlight }) {
  const [scenario, setScenario] = useState('database-primary');

  const { loading, data, error, run } = useAsync(
    async (id) => {
      const result = await api.failure({
        graph: { nodes: architecture.nodes, edges: architecture.edges },
        usage: architecture.scale,
        scenario: id,
      });
      const failedIds = result.failedNode
        ? [result.failedNode.id]
        : (result.affectedNodes ?? []).map((n) => n.id);
      onHighlight?.({ failedIds });
      return result;
    },
    [architecture],
    { immediate: false },
  );

  return (
    <>
      <Card title="Break something">
        <div className="field">
          <label htmlFor="scenario">Scenario</label>
          <select id="scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <button type="button" className="primary" style={{ marginTop: 10 }} onClick={() => run(scenario)} disabled={loading}>
          {loading ? 'Simulating…' : 'Trigger failure'}
        </button>
      </Card>

      {error ? <ErrorBox error={error} onRetry={() => run(scenario)} /> : null}
      {loading && !data ? <Loading what="Failing the component" /> : null}

      {data ? (
        <>
          <Verdict
            level={data.survived ? 'healthy' : 'critical'}
            message={data.survived ? 'The architecture survives this failure' : 'This failure is an outage'}
          >
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>{data.impact}</p>
          </Verdict>

          <Card>
            <div className="stat-grid">
              <Stat label="Downtime" value={data.downtimeLabel} tone={data.downtimeMinutes > 5 ? 'bad' : 'ok'} />
              <Stat label="Data lost" value={data.dataLossLabel} tone={data.dataLossMinutes > 0 ? 'bad' : 'ok'} />
              <Stat
                label="Recovery"
                value={data.automatic ? 'Automatic' : 'Manual'}
                tone={data.automatic ? 'ok' : 'bad'}
              />
              {data.capacityLossPercent !== undefined ? (
                <Stat label="Capacity lost" value={`${data.capacityLossPercent}%`} tone={data.capacityLossPercent >= 100 ? 'bad' : 'warn'} />
              ) : null}
            </div>
          </Card>

          {data.timeline?.length ? (
            <Card title="How it plays out">
              <ul className="list">
                {data.timeline.map((event, index) => (
                  <li key={index}>
                    <div className="row between">
                      <span className="title">{formatClock(event.atSecond)}</span>
                      <Pill tone={event.state === 'recovered' ? 'ok' : event.state === 'down' ? 'critical' : 'warn'}>
                        {event.state}
                      </Pill>
                    </div>
                    <div className="detail">{event.event}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.lessons?.length ? (
            <Card title="What would change the outcome">
              <ul className="list">
                {data.lessons.map((lesson) => (
                  <li key={lesson.title}>
                    <span className="title">{lesson.title}</span>
                    <div className="detail">{lesson.detail}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function formatClock(seconds) {
  if (seconds < 60) return `T+${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `T+${minutes}m`;
  return `T+${(minutes / 60).toFixed(1)}h`;
}
