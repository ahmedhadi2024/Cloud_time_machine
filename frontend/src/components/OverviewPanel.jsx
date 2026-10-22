import { Card, Gauge, Stat, Pill, formatMoney, formatNumber, formatGb, scoreTone } from './common.jsx';

/** The default tab: scores, workload, and what changed in this era. */
export default function OverviewPanel({ architecture }) {
  const { scores, scale, evolution, narrative, companyNote } = architecture;
  const security = scores.security;
  const availability = scores.availability;
  const cost = scores.cost;

  return (
    <>
      <Card>
        <div className="gauges">
          <Gauge name="Security" score={security.score} />
          <Gauge name="Availability" score={availability.score} />
          <Gauge name="Cost efficiency" score={costEfficiency(cost, scale)} />
        </div>
        <div className="row between" style={{ marginTop: 10 }}>
          <Pill tone={scoreTone(security.score)}>Security {security.grade}</Pill>
          <Pill tone={scoreTone(availability.score)}>{availability.uptimeLabel} uptime</Pill>
          <Pill tone="neutral">{formatMoney(cost.monthly, { compact: true })}/mo</Pill>
        </div>
      </Card>

      <Card title="This era">
        <p style={{ color: 'var(--text-muted)' }}>{narrative}</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>{companyNote}</p>
        {evolution?.length ? (
          <ul className="bullets">
            {evolution.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Workload" note="Derived from the company's growth curve for the selected year.">
        <div className="stat-grid">
          <Stat label="Requests/day" value={formatNumber(scale.requestsPerDay)} />
          <Stat label="Average load" value={`${formatNumber(scale.averageRps)} rps`} />
          <Stat label="Peak load" value={`${formatNumber(scale.peakRps)} rps`} />
          <Stat label="Stored data" value={formatGb(scale.storageGb)} />
          <Stat label="Egress/month" value={formatGb(scale.monthlyEgressGb)} />
          <Stat label="Cost/M requests" value={formatMoney(cost.perMillionRequests)} />
        </div>
      </Card>

      <Card title="Resilience">
        <div className="stat-grid">
          <Stat
            label="Annual downtime"
            value={availability.annualDowntimeLabel}
            tone={availability.annualDowntimeMinutes > 300 ? 'bad' : 'ok'}
          />
          <Stat label="Recovery time" value={availability.recovery.rtoLabel} />
          <Stat label="Data loss window" value={availability.recovery.rpoLabel} />
        </div>
        {availability.singlePointsOfFailure.length ? (
          <>
            <h3 style={{ margin: '12px 0 4px' }}>Single points of failure</h3>
            <ul className="list">
              {availability.singlePointsOfFailure.map((spof) => (
                <li key={spof.id}>
                  <span className="title">{spof.label}</span>
                  <div className="detail">{spof.reason}</div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ color: 'var(--ok)', marginTop: 10 }}>
            Every tier in the request path is redundant across Availability Zones.
          </p>
        )}
      </Card>

      {security.findings.length ? (
        <Card title="Security findings">
          <ul className="list">
            {security.findings.map((finding) => (
              <li key={finding.id}>
                <div className="row between">
                  <span className="title">{finding.title}</span>
                  <Pill tone={finding.severity === 'critical' ? 'critical' : 'warn'}>
                    {finding.severity}
                  </Pill>
                </div>
                <div className="detail">{finding.remedy}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {security.missing.length ? (
        <Card title={`Missing controls (${security.earned}/${security.possible} points earned)`}>
          <ul className="list">
            {security.missing.map((control) => (
              <li key={control.id}>
                <span className="title">{control.title}</span>
                <div className="detail">{control.remedy}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

/**
 * Cost efficiency is cost per million requests benchmarked against a $25
 * reference: cheap at scale scores well, which rewards caching and elasticity
 * rather than simply spending less.
 */
function costEfficiency(cost, scale) {
  if (!scale.monthlyRequests) return 0;
  const perMillion = cost.perMillionRequests;
  if (perMillion <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(100 - (perMillion / 25) * 100)));
}
