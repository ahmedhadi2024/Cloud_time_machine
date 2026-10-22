import { useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Stat, Advice, Loading, ErrorBox, formatGb, formatMoney } from './common.jsx';

/** Storage growth visualisation and the case for lifecycle tiering. */
export default function StoragePanel({ architecture }) {
  const [months, setMonths] = useState(36);
  const [growth, setGrowth] = useState(8);

  const { loading, data, error, run } = useAsync(
    () =>
      api.storage({
        graph: { nodes: architecture.nodes, edges: architecture.edges },
        usage: architecture.scale,
        months,
        monthlyGrowthPercent: growth,
      }),
    [architecture, months, growth],
  );

  return (
    <>
      <Card title="Growth assumptions">
        <div className="row">
          <div className="field">
            <label htmlFor="months">Projection (months)</label>
            <input id="months" type="number" min="6" max="120" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="growth">Growth %/month</label>
            <input id="growth" type="number" min="0" max="50" value={growth} onChange={(e) => setGrowth(Number(e.target.value))} />
          </div>
          <button type="button" style={{ alignSelf: 'flex-end' }} onClick={() => run()} disabled={loading}>
            Recalculate
          </button>
        </div>
      </Card>

      {error ? <ErrorBox error={error} onRetry={() => run()} /> : null}
      {loading && !data ? <Loading what="Projecting storage growth" /> : null}

      {data ? (
        <>
          <Card>
            <div className="stat-grid">
              <Stat label="Today" value={formatGb(data.startGb)} />
              <Stat label={`In ${data.months} months`} value={formatGb(data.endGb)} sub={`${data.multiple}x growth`} />
              <Stat label="Saving with tiering" value={formatMoney(data.totals.savingVsStandard)} tone="ok" sub="over the window" />
            </div>
          </Card>

          <Card title="Volume over time">
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={data.series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="gbFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f9cf9" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#4f9cf9" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#26304d" strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke="#6b779b" fontSize={10} tickFormatter={(v) => `m${v}`} />
                <YAxis stroke="#6b779b" fontSize={10} tickFormatter={(v) => formatGb(v)} />
                <Tooltip
                  contentStyle={{ background: '#141a2e', border: '1px solid #26304d', borderRadius: 6, fontSize: 12 }}
                  formatter={(value) => formatGb(value)}
                  labelFormatter={(v) => `Month ${v}`}
                />
                <Area type="monotone" dataKey="totalGb" name="Stored" stroke="#4f9cf9" fill="url(#gbFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Monthly cost by policy">
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={data.series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#26304d" strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke="#6b779b" fontSize={10} tickFormatter={(v) => `m${v}`} />
                <YAxis stroke="#6b779b" fontSize={10} tickFormatter={(v) => formatMoney(v, { compact: true })} />
                <Tooltip
                  contentStyle={{ background: '#141a2e', border: '1px solid #26304d', borderRadius: 6, fontSize: 12 }}
                  formatter={(value) => formatMoney(value)}
                  labelFormatter={(v) => `Month ${v}`}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="allStandardCost" name="All Standard" stroke="#f87171" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="configuredCost" name="As configured" stroke="#fbbf24" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="recommendedCost" name="Recommended tiering" stroke="#34d399" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Recommended tier split" note="Shares assume steady growth, so older data is a smaller slice of the whole.">
            <table className="data">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th className="num">Volume</th>
                  <th className="num">$/GB/mo</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((tier) => (
                  <tr key={tier.tier}>
                    <td>{tier.tier}</td>
                    <td className="num">{formatGb(tier.gb)}</td>
                    <td className="num">${tier.pricePerGb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Advice items={data.advice} title="Storage notes" />
        </>
      ) : null}
    </>
  );
}
