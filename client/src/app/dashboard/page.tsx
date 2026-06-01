'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API = 'http://localhost:8080';

interface Hypothesis {
  id: number;
  description: string;
  status: string;
  winnerId: number | null;
  liftPct: number | null;
  prUrl: string | null;
}

interface Experiment {
  id: number;
  status: string;
  cycleCount: number;
  createdAt: string;
  hypotheses: Hypothesis[];
}

interface Site {
  id: string;
  url: string;
  githubRepo: string | null;
  autoMerge: boolean;
  trackerPrUrl: string | null;
  trackerInjected: boolean;
  createdAt: string;
  profile: { theme: string; tone: string; weaknesses: unknown[] } | null;
  experiments: Experiment[];
}

const STATUS_COLOR: Record<string, string> = {
  analyzing: '#ffe66d',
  running: '#00e7ff',
  completed: '#d7ff3f',
  cooldown: '#ff3d8b',
  failed: '#ff4f6d',
};

function DashboardContent() {
  const searchParams = useSearchParams();
  const prefillUrl = searchParams?.get('url') ?? '';

  const [url, setUrl] = useState(prefillUrl);
  const [githubRepo, setRepo] = useState('');
  const [githubToken, setToken] = useState('');
  const [autoMerge, setAutoMerge] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch(`${API}/experiment`);
      const data = await res.json();
      setSites(Array.isArray(data) ? data : []);
    } catch {
      /* keep the dashboard usable when the API is offline */
    }
  }, []);

  useEffect(() => {
    fetchSites();
    const iv = setInterval(fetchSites, 10000);
    return () => clearInterval(iv);
  }, [fetchSites]);

  async function startExperiment() {
    if (!url.startsWith('http')) {
      setError('Enter a valid URL starting with http');
      return;
    }
    if (!githubRepo || !githubToken) {
      setError('GitHub repo and token are required');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/experiment/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, githubRepo, githubToken, autoMerge }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to start');
      } else {
        setUrl('');
        setRepo('');
        setToken('');
        await fetchSites();
      }
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  }

  const active = sites.filter(site => {
    const status = site.experiments[0]?.status;
    return status && ['running', 'analyzing'].includes(status);
  });
  const completed = sites.filter(site => {
    const status = site.experiments[0]?.status;
    return status && !['running', 'analyzing'].includes(status);
  });
  const tests = sites.flatMap(site => site.experiments.flatMap(exp => exp.hypotheses));
  const liftValues = tests.filter(h => h.liftPct != null).map(h => h.liftPct!);
  const avgLift = liftValues.length ? (liftValues.reduce((a, b) => a + b, 0) / liftValues.length).toFixed(1) : null;

  return (
    <main
      className="dash-shell deck-3d"
      style={{ '--mx': cursor.x, '--my': cursor.y } as React.CSSProperties}
      onMouseMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setCursor({
          x: Number(((event.clientX - rect.left) / rect.width - 0.5).toFixed(3)),
          y: Number(((event.clientY - rect.top) / rect.height - 0.5).toFixed(3)),
        });
      }}
    >
      <header className="topbar">
        <div className="container topbar-inner">
          <Link className="brand" href="/">
            <span className="brand-mark">V</span>
            <span className="neon-glow-text" style={{ fontWeight: 800 }}>Visus</span>
          </Link>
          <nav className="nav-links">
            <span className="nav-link neon-glow-text" style={{ color: 'var(--accent)' }}>dashboard portal</span>
            <Link className="button button-ghost" href="/">Home</Link>
          </nav>
        </div>
      </header>

      <div className="dash-layout container" style={{ marginTop: 24 }}>
        <aside className="dash-sidebar tilt-wrapper-gentle" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <p className="section-kicker mono">New optimization loop</p>
            <h1 className="dash-title" style={{ marginTop: 12, fontSize: 32, fontWeight: 900, lineHeight: 1.1 }}>
              Secure the conversion rate.
            </h1>
            <p className="section-copy" style={{ fontSize: 13, marginTop: 8, color: 'var(--muted)' }}>
              Connect your domain and repository. Visus crawls the conversion funnel, runs autonomous A/B tests, and merges winners.
            </p>
          </div>

          <div className="hologram-panel panel-pad">
            <div className="laser-horizontal" />
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="site-url">Website URL</label>
                <input
                  id="site-url"
                  className="input"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && startExperiment()}
                  placeholder="https://yoursite.com"
                  style={{ background: 'rgba(5,7,12,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="github-repo">Repository</label>
                <input
                  id="github-repo"
                  className="input"
                  value={githubRepo}
                  onChange={e => setRepo(e.target.value)}
                  placeholder="owner/repo"
                  style={{ background: 'rgba(5,7,12,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="github-token">Personal access token</label>
                <input
                  id="github-token"
                  className="input"
                  value={githubToken}
                  onChange={e => setToken(e.target.value)}
                  placeholder="ghp_..."
                  type="password"
                  style={{ background: 'rgba(5,7,12,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
                />
              </div>

              <div className="toggle-row" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                <label className="cyber-switch">
                  <input type="checkbox" checked={autoMerge} onChange={e => setAutoMerge(e.target.checked)} />
                  <span className="cyber-switch-slider" />
                </label>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>Auto-merge winners at 95%</span>
              </div>

              <button className="button button-accent" onClick={startExperiment} disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Initiating telemetry...' : 'Start Loop'}
              </button>
            </div>
            {error && <p className="error" style={{ color: 'var(--red)', marginTop: 12, fontSize: 12 }}>{error}</p>}
          </div>
        </aside>

        <section className="dash-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="stats-grid">
            <Stat label="Sites Tracked" value={sites.length.toString()} type="cyan" />
            <Stat label="Active Loops" value={active.length.toString()} type={active.length > 0 ? 'cyan' : 'pink'} />
            <Stat label="Total Tests" value={tests.length.toString()} type="cyan" />
            <Stat label="Avg CTR Lift" value={avgLift ? `+${avgLift}%` : '—'} type="lime" />
          </div>

          <div className="hologram-panel panel-pad" style={{ minHeight: 400 }}>
            <div className="laser-horizontal" style={{ animationDelay: '-2s' }} />
            <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
              <div>
                <p className="section-kicker mono">Optimization command center</p>
                <h2 style={{ marginTop: 8, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Active Experiments</h2>
              </div>
              <span className="mono muted" style={{ fontSize: 11, letterSpacing: '0.05em' }}>cyber telemetry active</span>
            </div>

            {active.length > 0 && (
              <section style={{ marginBottom: 28 }}>
                <SectionLabel>Live Scans</SectionLabel>
                <div className="site-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {active.map(site => <SiteRow key={site.id} site={site} />)}
                </div>
              </section>
            )}

            {completed.length > 0 && (
              <section>
                <SectionLabel>Cooldown & Complete</SectionLabel>
                <div className="site-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {completed.map(site => <SiteRow key={site.id} site={site} />)}
                </div>
              </section>
            )}

            {sites.length === 0 && (
              <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260 }}>
                <span className="radar-dot neon-pulse-pink" style={{ color: 'var(--accent-3)', background: 'var(--accent-3)', width: 12, height: 12, marginBottom: 16 }} />
                <p style={{ color: 'var(--muted)', fontSize: 13 }}>No pipelines active. Initialize your first loop on the left.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function SiteRow({ site }: { site: Site }) {
  const exp = site.experiments[0];
  const done = exp?.hypotheses.filter(h => h.status === 'completed').length ?? 0;
  const total = exp?.hypotheses.length ?? 0;
  const color = STATUS_COLOR[exp?.status ?? ''] ?? 'var(--muted)';
  const wins = exp?.hypotheses.filter(h => h.prUrl).length ?? 0;

  const isRunning = exp?.status === 'running' || exp?.status === 'analyzing';

  return (
    <Link className="cyber-row-grid" href={exp ? `/experiment/${exp.id}` : '#'}>
      <span className={`radar-dot ${isRunning ? 'neon-pulse-cyan' : ''}`} style={{ color, background: color }} />
      <span style={{ minWidth: 0 }}>
        <strong className="truncate" style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{site.url}</strong>
        <span className="truncate" style={{ display: 'block', marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
          {total > 0 ? `${done}/${total} tests · ${wins > 0 ? `${wins} PR${wins > 1 ? 's' : ''} opened` : 'no PRs yet'}` : 'Analyzing page funnel...'}
          {site.githubRepo ? ` · ${site.githubRepo}` : ''}
          {site.trackerInjected ? ' · telemetry live' : ''}
        </span>
      </span>
      <span className="mono" style={{ color, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {exp?.status ?? 'pending'}
      </span>
    </Link>
  );
}

function Stat({ label, value, type = 'cyan' }: { label: string; value: string; type?: 'cyan' | 'lime' | 'pink' }) {
  const pulseClass = type === 'lime' ? 'neon-pulse-lime' : type === 'pink' ? 'neon-pulse-pink' : 'neon-pulse-cyan';
  const colorVal = type === 'lime' ? 'var(--accent-2)' : type === 'pink' ? 'var(--accent-3)' : 'var(--accent)';
  return (
    <div className="hologram-panel" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span className={`radar-dot ${pulseClass}`} style={{ color: colorVal, background: colorVal, width: 6, height: 6 }} />
      </div>
      <strong className={type === 'lime' ? 'neon-glow-text-lime' : type === 'cyan' ? 'neon-glow-text' : ''} style={{ display: 'block', fontSize: 28, marginTop: 12, fontWeight: 900, color: type === 'lime' ? 'var(--accent-2)' : '#fff' }}>
        {value}
      </strong>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="section-label" style={{ fontSize: 10, letterSpacing: '0.08em', fontWeight: 800 }}>{children}</div>;
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="empty-state">Loading Visus Dashboard...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
