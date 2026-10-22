import { useState } from 'react';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Stat, Verdict, Advice, Loading, ErrorBox, Bar, formatNumber, formatMoney } from './common.jsx';

/** DDoS simulator: watch each defence layer peel traffic off the attack. */
export default function DdosPanel({ architecture, attackTypes, onHighlight }) {
  const [attack, setAttack] = useState('http-flood');
  const [attackRps, setAttackRps] = useState(400000);
  const [hours, setHours] = useState(2);

  const { loading, data, error, run } = useAsync(
    async () => {
      const result = await api.ddos({
        graph: { nodes: architecture.nodes, edges: architecture.edges },
        usage: architecture.scale,
        attack,
        attackRps,
        legitimateRps: Math.max(1, architecture.scale.averageRps),
        durationHours: hours,
      });
      onHighlight?.({ animateEdges: result.availabilityPercent > 95 });
      return result;
    },
    [architecture, attack, attackRps, hours],
    { immediate: false },
  );

  return (
    <>
      <Card title="Attack">
        <div className="field">
          <label htmlFor="attack">Attack type</label>
          <select id="attack" value={attack} onChange={(e) => setAttack(e.target.value)}>
            {attackTypes.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
        <p className="card-note" style={{ marginTop: 6 }}>
          {attackTypes.find((a) => a.id === attack)?.description}
        </p>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="attack-rps">Attack volume: {formatNumber(attackRps)} rps</label>
          <input
            id="attack-rps"
            type="range"
            min="10000"
            max="5000000"
            step="10000"
            value={attackRps}
            onChange={(e) => setAttackRps(Number(e.target.value))}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="hours">Duration (hours)</label>
            <input id="hours" type="number" min="1" max="72" value={hours} onChange={(e) => setHours(Number(e.target.value))} />
          </div>
          <button type="button" className="primary" style={{ alignSelf: 'flex-end' }} onClick={() => run()} disabled={loading}>
            {loading ? 'Attacking…' : 'Launch attack'}
          </button>
        </div>
      </Card>

      {error ? <ErrorBox error={error} onRetry={() => run()} /> : null}
      {loading && !data ? <Loading what="Routing the attack through your defences" /> : null}

      {data ? (
        <>
          <Verdict level={data.verdict.level} message={data.verdict.message} />

          <Card>
            <div className="stat-grid">
              <Stat
                label="Real users served"
                value={`${data.availabilityPercent}%`}
                tone={data.availabilityPercent > 99 ? 'ok' : data.availabilityPercent > 80 ? 'warn' : 'bad'}
              />
              <Stat label="Reaching origin" value={`${formatNumber(data.reachingOriginRps)} rps`} />
              <Stat
                label="Origin capacity"
                value={data.originCapacityRps === null ? '∞' : `${formatNumber(data.originCapacityRps)} rps`}
              />
              <Stat label="Attack cost" value={formatMoney(data.costImpact.extraEgressCost)} tone="warn" />
            </div>
          </Card>

          <Card title="Defence layers" note={data.costImpact.note}>
            <ul className="list">
              {data.layers.map((layer, index) => {
                const absorbedPercent = data.attackRps ? (layer.absorbedRps / data.attackRps) * 100 : 0;
                return (
                  <li key={`${layer.name}-${index}`}>
                    <div className="row between">
                      <span className="title">{layer.name}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        −{formatNumber(layer.absorbedRps)} rps
                      </span>
                    </div>
                    <Bar value={absorbedPercent} tone={absorbedPercent > 50 ? 'ok' : 'warn'} />
                    <div className="detail" style={{ marginTop: 3 }}>{layer.note}</div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Advice items={data.advice} title="How to absorb this" />
        </>
      ) : null}
    </>
  );
}
