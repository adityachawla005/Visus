'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

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
  trackerInjected: boolean;
  createdAt: string;
  profile: { theme: string; tone: string } | null;
  experiments: Experiment[];
}

const STATUS_CLASS: Record<string, string> = {
  running: 'running', analyzing: 'analyzing', completed: 'completed',
  cooldown: 'cooldown', failed: 'failed',
};

function hypIcon(status: string): string {
  return status === 'completed' ? '✅' : status === 'running' ? '🔄' : '⏳';
}

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<Site[]>('/experiment')
      .then(setSites)
      .catch((e) => setError(e.message ?? 'Failed to load'));
  }, []);

  if (error) return <main className="dh-main"><div className="dh-empty">{error}</div></main>;
  if (!sites) return <main className="dh-main"><div className="dh-loading">Loading experiments…</div></main>;

  // Summary stats across all sites.
  const allHyps = sites.flatMap((s) => s.experiments[0]?.hypotheses ?? []);
  const active = sites.filter((s) => ['running', 'analyzing'].includes(s.experiments[0]?.status ?? '')).length;
  const shipped = allHyps.filter((h) => h.prUrl).length;
  const bestLift = allHyps.reduce((m, h) => Math.max(m, h.liftPct ?? 0), 0);

  return (
    <main className="dh-main">
      <div className="dh-head">
        <div>
          <h1 className="dh-h1">Experiments</h1>
          <p className="dh-sub">Every connected site and what Visus is testing right now.</p>
        </div>
        <Link href="/dashboard/connect" className="dh-btn dh-btn-gold">+ Connect site</Link>
      </div>

      <div className="dh-stats">
        <div className="dh-stat"><b>{sites.length}</b><span>Connected sites</span></div>
        <div className="dh-stat"><b>{active}</b><span>Active experiments</span></div>
        <div className="dh-stat"><b>{shipped}</b><span>Winners shipped (PRs)</span></div>
        <div className="dh-stat"><b>{bestLift > 0 ? `+${bestLift.toFixed(1)}%` : '—'}</b><span>Best CTR lift</span></div>
      </div>

      {sites.length === 0 ? (
        <div className="dh-empty">
          No sites connected yet.<br />
          Connect a site and GitHub repo to start testing — <code>POST /experiment/start</code>.
        </div>
      ) : (
        <div className="dh-list">
          {sites.map((site) => {
            const exp = site.experiments[0];
            const status = exp?.status ?? 'none';
            const hyps = exp?.hypotheses ?? [];
            const best = hyps.reduce((m, h) => Math.max(m, h.liftPct ?? 0), 0);

            return (
              <section key={site.id} className="dh-card">
                <div className="dh-card-head">
                  <a className="dh-card-url" href={site.url} target="_blank" rel="noreferrer">
                    {site.url.replace(/^https?:\/\//, '')}
                  </a>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {exp && <Link href={`/dashboard/experiments/${exp.id}`} className="dh-pr">View →</Link>}
                    <span className={`dh-badge ${STATUS_CLASS[status] ?? 'none'}`}>{status}</span>
                  </div>
                </div>

                <div className="dh-meta">
                  {site.profile && <span><b>{site.profile.theme}</b> · {site.profile.tone}</span>}
                  {site.githubRepo && <span>{site.githubRepo}</span>}
                  <span>tracker {site.trackerInjected ? 'live' : 'pending'}</span>
                  {exp && <span>cycle {exp.cycleCount}</span>}
                  {best > 0 && <span className="dh-lift">+{best.toFixed(1)}% best lift</span>}
                </div>

                {hyps.length > 0 && (
                  <div className="dh-hyps">
                    {hyps.slice(0, 5).map((h) => (
                      <div key={h.id} className="dh-hyp">
                        <span>{hypIcon(h.status)}</span>
                        <span className="dh-hyp-desc" title={h.description}>{h.description}</span>
                        {h.liftPct != null && h.liftPct > 0 && <span className="dh-lift">+{h.liftPct.toFixed(1)}%</span>}
                        {h.prUrl && <a className="dh-pr" href={h.prUrl} target="_blank" rel="noreferrer">PR ↗</a>}
                      </div>
                    ))}
                    {hyps.length > 5 && <div className="dh-meta">+{hyps.length - 5} more hypotheses</div>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
