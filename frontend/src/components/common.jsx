/** Small presentational primitives shared by every panel. */

export const ICONS = {
  dns: '🌐', cdn: '🛰️', shield: '🛡️', balancer: '⚖️', server: '🖥️', scale: '📈',
  function: 'λ', container: '📦', database: '🗄️', table: '🔖', cache: '⚡',
  bucket: '🪣', disk: '💽', archive: '🧊', queue: '📬', bell: '🔔', workflow: '🔀',
  network: '🕸️', lock: '🔒', key: '🔑', chart: '📊', wallet: '💰',
};

export function formatMoney(value, { compact = false } = {}) {
  if (value === null || value === undefined) return '—';
  if (compact && Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
  }
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

export function formatGb(gb) {
  if (gb >= 1e6) return `${(gb / 1e6).toFixed(1)} PB`;
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  return `${Math.round(gb)} GB`;
}

export function scoreTone(score) {
  if (score >= 85) return 'ok';
  if (score >= 60) return 'warn';
  return 'bad';
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Gauge({ name, score, suffix = '' }) {
  const tone = scoreTone(score);
  const colour = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)';
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <div className="gauge">
      <div className="ring">
        <svg width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
          <circle cx="31" cy="31" r={radius} fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle
            cx="31" cy="31" r={radius} fill="none" stroke={colour} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            style={{ transition: 'stroke-dasharray 500ms ease' }}
          />
        </svg>
        <div className="inner" style={{ color: colour }}>
          {Math.round(score)}{suffix}
        </div>
      </div>
      <div className="name">{name}</div>
    </div>
  );
}

export function Verdict({ level, message, children }) {
  const icon = { healthy: '✓', warning: '!', degraded: '▲', critical: '✕' }[level] ?? 'i';
  return (
    <div className={`verdict ${level}`}>
      <span className="icon">{icon}</span>
      <div>
        <strong>{message}</strong>
        {children}
      </div>
    </div>
  );
}

export function Bar({ value, max = 100, tone }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`bar ${tone ?? ''}`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Loading({ what = 'Loading' }) {
  return <div className="loading">{what}…</div>;
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="error-box">
      <div>{error?.message ?? 'Something went wrong'}</div>
      {onRetry ? (
        <button type="button" style={{ marginTop: 8 }} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Card({ title, note, children, actions }) {
  return (
    <section className="card">
      {title ? (
        <div className="row between" style={{ marginBottom: 8 }}>
          <h3>{title}</h3>
          {actions}
        </div>
      ) : null}
      {children}
      {note ? <div className="card-note" style={{ marginTop: 8 }}>{note}</div> : null}
    </section>
  );
}

export function Advice({ items, title = 'What would help' }) {
  if (!items?.length) return null;
  return (
    <Card title={title}>
      <ul className="bullets">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Card>
  );
}
