import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Stat, Verdict, Advice, Loading, ErrorBox, Bar, formatNumber } from './common.jsx';

const PRESETS = [
  { label: 'Quiet night', factor: 0.2 },
  { label: 'Normal day', factor: 1 },
  { label: 'Peak hour', factor: null }, // uses the company's own peak
  { label: 'Launch day', factor: 4 },
  { label: 'Hug of death', factor: 20 },
];

/** Interactive traffic simulator: pick a load, watch where it saturates. */
export default function TrafficPanel({ architecture, onHighlight }) {
  const scale = architecture.scale;
  const [rps, setRps] = useState(Math.max(10, scale.peakRps));
  const [ramp, setRamp] = useState(30);

  const { loading, data, error, run } = useAsync(
    async (requestRps) => {
      const result = await api.traffic({
        graph: { nodes: architecture.nodes, edges: architecture.edges },
        usage: scale,
        rps: requestRps,
        rampSeconds: ramp,
        durationSeconds: 300,
      });
      onHighlight?.({
        saturatedIds: result.steps.filter((s) => s.utilisation >= 95).flatMap((s) => s.nodeIds),
        utilisation: Object.fromEntries(
          result.steps.flatMap((s) => s.nodeIds.map((id) => [id, s.utilisation])),
        ),
        animateEdges: result.errorRatePercent === 0,
      });
      return result;
    },
    [architecture, ramp],
    { immediate: false },
  );

  const maxRps = Math.max(scale.peakRps * 25, 1000);

  return (
    <>
      <Card title="Offered load">
        <div className="row wrap" style={{ marginBottom: 8 }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setRps(preset.factor === null ? scale.peakRps : Math.max(1, Math.round(scale.averageRps * preset.factor)))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="rps">Requests per second: {formatNumber(rps)}</label>
          <input
            id="rps"
            type="range"
            min="10"
            max={maxRps}
            step={Math.max(1, Math.round(maxRps / 400))}
            value={Math.min(rps, maxRps)}
            onChange={(event) => setRps(Number(event.target.value))}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="ramp">Ramp-up seconds</label>
            <input id="ramp" type="number" min="0" max="300" value={ramp} onChange={(e) => setRamp(Number(e.target.value))} />
          </div>
          <button type="button" className="primary" style={{ alignSelf: 'flex-end' }} onClick={() => run(rps)} disabled={loading}>
            {loading ? 'Running…' : 'Run simulation'}
          </button>
        </div>
        <div className="card-note" style={{ marginTop: 8 }}>
          This company's own peak is {formatNumber(scale.peakRps)} rps in {architecture.year}.
        </div>
      </Card>

      {error ? <ErrorBox error={error} onRetry={() => run(rps)} /> : null}
      {loading && !data ? <Loading what="Pushing traffic through the architecture" /> : null}

      {data ? (
        <>
          <Verdict level={data.verdict.level} message={data.verdict.message} />

          <Card>
            <div className="stat-grid">
              <Stat label="Served" value={`${formatNumber(data.servedRps)} rps`} tone="ok" />
              <Stat label="Dropped" value={`${formatNumber(data.droppedRps)} rps`} tone={data.droppedRps ? 'bad' : undefined} />
              <Stat label="Error rate" value={`${data.errorRatePercent}%`} tone={data.errorRatePercent > 1 ? 'bad' : 'ok'} />
              <Stat label="p99 latency" value={`${formatNumber(data.p99LatencyMs)} ms`} tone={data.p99LatencyMs > 800 ? 'bad' : data.p99LatencyMs > 300 ? 'warn' : 'ok'} />
            </div>
          </Card>

          {data.bottleneck ? (
            <Card title="Bottleneck">
              <p>
                The <strong>{data.bottleneck.role}</strong> tier ({data.bottleneck.nodes.join(', ')}) tops out at{' '}
                {formatNumber(data.bottleneck.capacityRps)} rps but was offered {formatNumber(data.bottleneck.offeredRps)} rps.
              </p>
            </Card>
          ) : null}

          <Card title="Through the tiers">
            <table className="data">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th className="num">Offered</th>
                  <th className="num">Capacity</th>
                  <th className="num">Used</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map((step) => (
                  <tr key={step.role}>
                    <td>
                      {step.label}
                      {step.offloadPercent ? (
                        <div className="card-note">{step.offloadPercent}% absorbed here</div>
                      ) : null}
                    </td>
                    <td className="num">{formatNumber(step.offeredRps)}</td>
                    <td className="num">{step.capacityRps === null ? '∞' : formatNumber(step.capacityRps)}</td>
                    <td className="num" style={{ minWidth: 62 }}>
                      {step.capacityRps === null ? '—' : `${step.utilisation}%`}
                      {step.capacityRps === null ? null : (
                        <Bar
                          value={step.utilisation}
                          tone={step.utilisation >= 100 ? 'bad' : step.utilisation >= 80 ? 'warn' : 'ok'}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Over time" note={`Elastic tiers need about ${data.timeline.scaleWarmupSeconds}s to reach full capacity.`}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data.timeline.series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#26304d" strokeDasharray="3 3" />
                <XAxis dataKey="second" stroke="#6b779b" fontSize={10} tickFormatter={(v) => `${v}s`} />
                <YAxis stroke="#6b779b" fontSize={10} tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{ background: '#141a2e', border: '1px solid #26304d', borderRadius: 6, fontSize: 12 }}
                  formatter={(value, name) => [formatNumber(value), name]}
                  labelFormatter={(v) => `${v} seconds`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="offeredRps" name="Offered" stroke="#4f9cf9" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="servedRps" name="Served" stroke="#34d399" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="droppedRps" name="Dropped" stroke="#f87171" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Advice items={data.advice} />
        </>
      ) : null}
    </>
  );
}
