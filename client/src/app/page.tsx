'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
  analyzing: '#eab308',
  running:   '#60a5fa',
  completed: '#22c55e',
  cooldown:  '#a78bfa',
  failed:    '#ef4444',
};

export default function Dashboard() {
  const [url, setUrl]             = useState('');
  const [githubRepo, setRepo]     = useState('');
  const [githubToken, setToken]   = useState('');
  const [autoMerge, setAutoMerge] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [sites, setSites]         = useState<Site[]>([]);
  const [error, setError]         = useState('');

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch(`${API}/experiment`);
      const data = await res.json();
      setSites(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchSites();
    const iv = setInterval(fetchSites, 10000);
    return () => clearInterval(iv);
  }, [fetchSites]);

  async function startExperiment() {
    if (!url.startsWith('http')) { setError('Enter a valid URL starting with http'); return; }
    if (!githubRepo || !githubToken) { setError('GitHub repo and token are required'); return; }
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

  const active    = sites.filter(s => s.experiments[0] && ['running', 'analyzing'].includes(s.experiments[0].status));
  const completed = sites.filter(s => s.experiments[0] && !['running', 'analyzing'].includes(s.experiments[0].status));

  const totalLift = sites.flatMap(s =>
    s.experiments.flatMap(e => e.hypotheses.filter(h => h.liftPct != null).map(h => h.liftPct!))
  );
  const avgLift = totalLift.length > 0
    ? (totalLift.reduce((a, b) => a + b, 0) / totalLift.length).toFixed(1)
    : null;

  return (
    <main style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)' }}>

      <header style={{ borderBottom: '1px solid var(--border)', padding: '20px 40px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>Visus</span>
        <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 4 }}>autonomous CRO agent</span>
      </header>

      <div style={{ maxWidth: 920, margin: '0 auto', padding: '48px 24px' }}>

        {/* Input */}
        <section style={{ marginBottom: 52 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.03em' }}>
            Give it a site.
          </h1>
          <p style={{ color: 'var(--muted)', marginBottom: 24, fontSize: 14 }}>
            Visus analyzes, runs sequential A/B tests, finds winners, and opens GitHub PRs — one at a time.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startExperiment()}
              placeholder="https://yoursite.com"
              style={inputStyle}
            />
            <button
              onClick={startExperiment}
              disabled={loading}
              style={{
                background: loading ? 'var(--accent-dim)' : 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '12px 24px',
                fontWeight: 600,
                fontSize: 14,
                cursor: loading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Starting…' : 'Start Loop'}
            </button>
          </div>

          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '18px 20px',
            marginBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              GitHub — required to verify ownership &amp; inject tracker
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Repository (owner/repo)
                </label>
                <input
                  value={githubRepo}
                  onChange={e => setRepo(e.target.value)}
                  placeholder="acme/website"
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  Personal Access Token
                </label>
                <input
                  value={githubToken}
                  onChange={e => setToken(e.target.value)}
                  placeholder="ghp_…"
                  type="password"
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoMerge}
                  onChange={e => setAutoMerge(e.target.checked)}
                  style={{ width: 14, height: 14 }}
                />
                Auto-merge winner PRs at 95% confidence
              </label>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Token needs <code>repo</code> scope
              </span>
            </div>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        </section>

        {/* Stats */}
        {sites.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 40 }}>
            {[
              { label: 'Sites tracked',    value: sites.length },
              { label: 'Active now',       value: active.length },
              { label: 'Tests run',        value: sites.flatMap(s => s.experiments.flatMap(e => e.hypotheses)).length },
              { label: 'Avg lift',         value: avgLift ? `+${avgLift}%` : '—' },
            ].map(stat => (
              <div key={stat.label} style={{
                flex: 1,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '14px 18px',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{stat.value}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {active.length > 0 && (
          <section style={{ marginBottom: 36 }}>
            <SectionLabel>Active</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {active.map(site => <SiteRow key={site.id} site={site} />)}
            </div>
          </section>
        )}

        {completed.length > 0 && (
          <section>
            <SectionLabel>Completed / Cooldown</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {completed.map(site => <SiteRow key={site.id} site={site} />)}
            </div>
          </section>
        )}

        {sites.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '80px 0', fontSize: 14 }}>
            No sites yet. Enter a URL above to begin.
          </div>
        )}
      </div>
    </main>
  );
}

function SiteRow({ site }: { site: Site }) {
  const exp   = site.experiments[0];
  const done  = exp?.hypotheses.filter(h => h.status === 'completed').length ?? 0;
  const total = exp?.hypotheses.length ?? 0;
  const color = STATUS_COLOR[exp?.status ?? ''] ?? 'var(--muted)';

  const wins = exp?.hypotheses.filter(h => h.prUrl).length ?? 0;

  return (
    <Link href={exp ? `/experiment/${exp.id}` : '#'} style={{ textDecoration: 'none' }}>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {site.url}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {total > 0
              ? `${done}/${total} tests  ·  ${wins > 0 ? `${wins} PR${wins > 1 ? 's' : ''} opened` : 'no PRs yet'}`
              : 'Analyzing…'}
            {site.githubRepo && (
              <span style={{ marginLeft: 8, opacity: 0.6 }}>· {site.githubRepo}</span>
            )}
            {site.trackerPrUrl && !site.trackerInjected && (
              <a
                href={site.trackerPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ marginLeft: 8, color: '#eab308', fontWeight: 600 }}
              >
                · Merge tracker PR to start collecting data
              </a>
            )}
            {site.trackerInjected && (
              <span style={{ marginLeft: 8, color: 'var(--green)', fontWeight: 500 }}>· tracker live</span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color, fontWeight: 500, flexShrink: 0, textTransform: 'capitalize' }}>
          {exp?.status ?? 'pending'}
        </div>
      </div>
    </Link>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '12px 16px',
  color: 'var(--foreground)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
      {children}
    </div>
  );
}
