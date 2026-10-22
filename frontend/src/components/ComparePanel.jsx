import { api } from '../api/client.js';
import { useAsync } from '../hooks/useAsync.js';
import { Card, Loading, ErrorBox, Pill, formatMoney, formatNumber } from './common.jsx';

/**
 * Historical year versus the 2025 reference at the same workload, so the
 * difference measured is architecture rather than growth.
 */
export default function ComparePanel({ companyId, year, onPreviewModern }) {
  const { loading, data, error, run } = useAsync(() => api.compare(companyId, year), [companyId, year]);

  if (error) return <ErrorBox error={error} onRetry={() => run()} />;
  if (loading && !data) return <Loading what="Comparing architectures" />;
  if (!data) return null;

  const { comparison, modern } = data;
  const { left, right, deltas } = comparison;

  const rows = [
    {
      label: 'Monthly cost',
      left: formatMoney(left.cost.monthly),
      right: formatMoney(right.cost.monthly),
      delta: deltas.monthlyCost,
      betterIsLower: true,
    },
    {
      label: 'Security score',
      left: `${left.security.score} (${left.security.grade})`,
      right: `${right.security.score} (${right.security.grade})`,
      delta: deltas.securityScore,
      betterIsLower: false,
    },
    {
      label: 'Availability score',
      left: left.availability.score,
      right: right.availability.score,
      delta: deltas.availabilityScore,
      betterIsLower: false,
    },
    {
      label: 'Annual downtime',
      left: left.availability.annualDowntimeLabel,
      right: right.availability.annualDowntimeLabel,
      delta: deltas.annualDowntimeMinutes,
      betterIsLower: true,
      unit: ' min',
    },
    {
      label: 'Dropped at peak',
      left: `${left.traffic.errorRatePercent}%`,
      right: `${right.traffic.errorRatePercent}%`,
      delta: deltas.peakErrorRatePercent,
      betterIsLower: true,
      unit: '%',
    },
    {
      label: 'DB failure downtime',
      left: left.dbFailure.downtimeLabel,
      right: right.dbFailure.downtimeLabel,
      delta: deltas.dbOutageMinutes,
      betterIsLower: true,
      unit: ' min',
    },
    {
      label: 'Users served under attack',
      left: `${left.ddos.availabilityPercent}%`,
      right: `${right.ddos.availabilityPercent}%`,
      delta: deltas.ddosAvailabilityPercent,
      betterIsLower: false,
      unit: '%',
    },
  ];

  return (
    <>
      <Card
        title={`${year} versus ${data.modernYear}`}
        note={`Both sides run the ${year} workload: ${formatNumber(comparison.usage.requestsPerDay)} requests/day.`}
        actions={
          onPreviewModern ? (
            <button type="button" onClick={() => onPreviewModern(modern)}>
              Show modern on canvas
            </button>
          ) : null
        }
      >
        <table className="data">
          <thead>
            <tr>
              <th>Measure</th>
              <th className="num">{year}</th>
              <th className="num">{data.modernYear}</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const improved = row.betterIsLower ? row.delta < 0 : row.delta > 0;
              const neutral = Math.abs(row.delta) < 0.0001;
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num">{row.left}</td>
                  <td className="num">{row.right}</td>
                  <td className={`num delta ${neutral ? '' : improved ? 'better' : 'worse'}`}>
                    {neutral ? '—' : `${row.delta > 0 ? '+' : ''}${formatDelta(row.delta)}${row.unit ?? ''}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="In words">
        <ul className="bullets">
          {comparison.narrative.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      <Card title="Composition">
        <div className="compare-grid">
          <div className="side">
            <h4>{year}</h4>
            <div>{left.nodeCount} components</div>
            <div className="card-note">{left.managedShare}% managed services</div>
            <div style={{ marginTop: 6 }}>
              <Pill tone={left.azFailure.survived ? 'ok' : 'critical'}>
                {left.azFailure.survived ? 'Survives AZ loss' : 'Fails on AZ loss'}
              </Pill>
            </div>
          </div>
          <div className="side">
            <h4>{data.modernYear}</h4>
            <div>{right.nodeCount} components</div>
            <div className="card-note">{right.managedShare}% managed services</div>
            <div style={{ marginTop: 6 }}>
              <Pill tone={right.azFailure.survived ? 'ok' : 'critical'}>
                {right.azFailure.survived ? 'Survives AZ loss' : 'Fails on AZ loss'}
              </Pill>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}

function formatDelta(value) {
  if (Math.abs(value) >= 1000) return formatNumber(value);
  return Math.round(value * 10) / 10;
}
