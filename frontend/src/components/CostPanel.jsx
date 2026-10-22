import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Stat, Loading, ErrorBox, Pill, formatMoney } from './common.jsx';

const CATEGORY_COLOURS = {
  Compute: '#4f9cf9',
  Database: '#a78bfa',
  Storage: '#34d399',
  Networking: '#fbbf24',
  Security: '#f87171',
  Integration: '#22d3ee',
  Management: '#94a3b8',
  Legacy: '#64748b',
};

/** Cost calculator and the optimisation list, ranked by monthly saving. */
export default function CostPanel({ architecture }) {
  const { loading, data, error, run } = useAsync(
    () =>
      api.optimise({
        graph: { nodes: architecture.nodes, edges: architecture.edges },
        usage: architecture.scale,
      }),
    [architecture],
  );

  if (error) return <ErrorBox error={error} onRetry={() => run()} />;
  if (loading && !data) return <Loading what="Pricing the architecture" />;
  if (!data) return null;

  const { current, recommendations } = data;
  const pie = Object.entries(current.byCategory)
    .filter(([, amount]) => amount > 0)
    .map(([name, value]) => ({ name, value }));

  return (
    <>
      <Card>
        <div className="stat-grid">
          <Stat label="Monthly" value={formatMoney(current.monthly)} />
          <Stat label="Annual" value={formatMoney(current.annual)} />
          <Stat label="Per M requests" value={formatMoney(current.perMillionRequests)} />
          <Stat label="After optimising" value={formatMoney(data.optimisedMonthly)} tone="ok" sub={`−${data.savingPercent}%`} />
        </div>
      </Card>

      <Card title="Where the money goes">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={pie} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
              {pie.map((entry) => (
                <Cell key={entry.name} fill={CATEGORY_COLOURS[entry.name] ?? '#4f9cf9'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#141a2e', border: '1px solid #26304d', borderRadius: 6, fontSize: 12 }}
              formatter={(value, name) => [formatMoney(value), name]}
            />
          </PieChart>
        </ResponsiveContainer>
        <table className="data">
          <tbody>
            {pie
              .sort((a, b) => b.value - a.value)
              .map((entry) => (
                <tr key={entry.name}>
                  <td>
                    <span
                      style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 6,
                        background: CATEGORY_COLOURS[entry.name] ?? '#4f9cf9',
                      }}
                    />
                    {entry.name}
                  </td>
                  <td className="num">{formatMoney(entry.value)}</td>
                  <td className="num">{Math.round((entry.value / current.monthly) * 100)}%</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      <Card title="Line items">
        <table className="data">
          <thead>
            <tr>
              <th>Component</th>
              <th className="num">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {current.items
              .filter((item) => item.monthly > 0)
              .map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.label}
                    <div className="card-note">
                      {item.lines.filter((l) => l.amount > 0).map((l) => l.label).join(' · ')}
                    </div>
                  </td>
                  <td className="num">{formatMoney(item.monthly)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      <Card title={`Optimisations (${formatMoney(data.totalMonthlySaving)}/month)`}>
        <ul className="list">
          {recommendations.map((rec) => (
            <li key={rec.id}>
              <div className="row between">
                <span className="title">{rec.title}</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--ok)', fontSize: 12 }}>
                  {rec.monthlySaving > 0 ? `−${formatMoney(rec.monthlySaving)}` : '—'}
                </span>
              </div>
              <div className="detail">{rec.detail}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <Pill tone="info">{rec.pillar}</Pill>
                <Pill tone="neutral">{rec.effort} effort</Pill>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Assumptions">
        <ul className="bullets">
          {current.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
