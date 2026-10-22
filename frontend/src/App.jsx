import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client.js';
import { useAsync } from './hooks/useAsync.js';
import ArchitectureCanvas from './components/ArchitectureCanvas.jsx';
import OverviewPanel from './components/OverviewPanel.jsx';
import TrafficPanel from './components/TrafficPanel.jsx';
import FailurePanel from './components/FailurePanel.jsx';
import DdosPanel from './components/DdosPanel.jsx';
import StoragePanel from './components/StoragePanel.jsx';
import CostPanel from './components/CostPanel.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import Builder from './components/Builder.jsx';
import { Loading, ErrorBox, formatMoney } from './components/common.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'failure', label: 'Failures' },
  { id: 'ddos', label: 'Attacks' },
  { id: 'storage', label: 'Storage' },
  { id: 'cost', label: 'Cost' },
  { id: 'compare', label: 'vs 2025' },
];

export default function App() {
  const meta = useAsync(() => api.meta(), []);
  const [companyId, setCompanyId] = useState('shopcart');
  // The builder keeps its own target so switching modes does not change the
  // workload a design is being judged against. EduLearn is the gentlest of the
  // six, which makes it a fair default for a first design.
  const [builderCompanyId, setBuilderCompanyId] = useState('edulearn');
  const [year, setYear] = useState(2005);
  const [tab, setTab] = useState('overview');
  const [mode, setMode] = useState('explore');
  const [highlight, setHighlight] = useState(null);
  const [playing, setPlaying] = useState(false);
  const previousNodeIds = useRef([]);

  const architecture = useAsync(() => api.architecture(companyId, year), [companyId, year]);
  const timeline = useAsync(() => api.timeline(companyId), [companyId]);

  // Remember the previous node set so newly arrived services can animate in.
  useEffect(() => {
    if (architecture.data) {
      return () => {
        previousNodeIds.current = architecture.data.nodes.map((n) => n.id);
      };
    }
    return undefined;
  }, [architecture.data]);

  // Clear simulation highlighting whenever the architecture itself changes.
  useEffect(() => setHighlight(null), [companyId, year]);

  /** Animated evolution: step through the era years, pausing on each. */
  useEffect(() => {
    if (!playing || !meta.data) return undefined;
    const eras = meta.data.timeline.eras;
    const next = eras.find((eraYear) => eraYear > year);
    if (next === undefined) {
      setPlaying(false);
      return undefined;
    }
    const id = setTimeout(() => setYear(next), 2600);
    return () => clearTimeout(id);
  }, [playing, year, meta.data]);

  const onCompanyChange = useCallback((id) => {
    setCompanyId(id);
    setPlaying(false);
  }, []);

  if (meta.loading) return <Loading what="Loading the time machine" />;
  if (meta.error) return <ErrorBox error={meta.error} onRetry={meta.run} />;

  const { companies, services, timeline: timelineMeta, failureScenarios, attackTypes } = meta.data;
  const company = companies.find((c) => c.id === companyId) ?? companies[0];
  const current = architecture.data;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">⏳</span>
          <h1>Cloud Time Machine</h1>
          <span className="tagline">See how cloud architectures evolve — then design the future yourself.</span>
        </div>
        <div className="spacer" />
        <div className="modes">
          <button type="button" aria-pressed={mode === 'explore'} onClick={() => setMode('explore')}>
            Explore
          </button>
          <button type="button" aria-pressed={mode === 'build'} onClick={() => setMode('build')}>
            Build your own
          </button>
        </div>
      </header>

      {mode === 'build' ? (
        <Builder
          services={services}
          companies={companies}
          companyId={builderCompanyId}
          onCompanyChange={setBuilderCompanyId}
        />
      ) : (
        <>
          <div className="controls">
            <div className="company-picker">
              <select
                value={companyId}
                onChange={(event) => onCompanyChange(event.target.value)}
                aria-label="Company"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.industry}
                  </option>
                ))}
              </select>
            </div>

            <div className="year-control">
              <div className="year-head">
                <span className="year-value">{year}</span>
                <span className="year-era">
                  {current ? current.eraName : '…'}
                  {company.foundedYear > year ? ` · before ${company.name} existed` : ''}
                </span>
              </div>
              <input
                type="range"
                min={timelineMeta.start}
                max={timelineMeta.end}
                value={year}
                onChange={(event) => {
                  setPlaying(false);
                  setYear(Number(event.target.value));
                }}
                aria-label="Year"
              />
              <div className="year-ticks">
                {timelineMeta.eras.map((eraYear) => (
                  <span key={eraYear}>{eraYear}</span>
                ))}
              </div>
            </div>

            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (playing) {
                    setPlaying(false);
                  } else {
                    setYear(timelineMeta.start);
                    setPlaying(true);
                  }
                }}
              >
                {playing ? '❚❚ Pause' : '▶ Play evolution'}
              </button>
            </div>
          </div>

          {timeline.data ? (
            <div className="timeline-strip" style={{ padding: '8px 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
              {timeline.data.snapshots.map((snapshot) => (
                <button
                  key={snapshot.year}
                  type="button"
                  aria-pressed={snapshot.era === current?.era}
                  onClick={() => {
                    setPlaying(false);
                    setYear(snapshot.year);
                  }}
                >
                  <div className="y">{snapshot.year}</div>
                  <div className="s">
                    sec {snapshot.scores.security} · {formatMoney(snapshot.scores.monthlyCost, { compact: true })}
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          <div className="workspace">
            <div className="canvas-wrap">
              {architecture.error ? (
                <ErrorBox error={architecture.error} onRetry={architecture.run} />
              ) : current ? (
                <>
                  <ArchitectureCanvas
                    architecture={current}
                    services={services}
                    highlight={highlight}
                    previousNodeIds={previousNodeIds.current}
                  />
                  <div className="canvas-caption">
                    <h3>{current.eraName}</h3>
                    <p>{current.companyNote}</p>
                  </div>
                </>
              ) : (
                <Loading what="Drawing the architecture" />
              )}
            </div>

            <aside className="sidebar">
              <nav className="tabs">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={tab === item.id}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <div className="tab-body">
                {!current ? (
                  <Loading />
                ) : tab === 'overview' ? (
                  <OverviewPanel architecture={current} />
                ) : tab === 'traffic' ? (
                  <TrafficPanel architecture={current} onHighlight={setHighlight} />
                ) : tab === 'failure' ? (
                  <FailurePanel architecture={current} scenarios={failureScenarios} onHighlight={setHighlight} />
                ) : tab === 'ddos' ? (
                  <DdosPanel architecture={current} attackTypes={attackTypes} onHighlight={setHighlight} />
                ) : tab === 'storage' ? (
                  <StoragePanel architecture={current} />
                ) : tab === 'cost' ? (
                  <CostPanel architecture={current} />
                ) : (
                  <ComparePanel companyId={companyId} year={year} />
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
