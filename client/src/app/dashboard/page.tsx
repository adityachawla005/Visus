import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import RemoveSiteButton from '@/components/RemoveSiteButton';
import AutoRefresh from '@/components/AutoRefresh';

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

// Server component — the experiment list is fetched before the HTML is sent,
// so the page arrives populated instead of empty-then-filled.
export default async function DashboardPage() {
  const sites = await serverFetch<Site[]>('/experiment');

  // Summary stats across all sites.
  const allHyps = sites.flatMap((s) => s.experiments[0]?.hypotheses ?? []);
  const active = sites.filter((s) => ['running', 'analyzing'].includes(s.experiments[0]?.status ?? '')).length;
  const shipped = allHyps.filter((h) => h.prUrl).length;
  const bestLift = allHyps.reduce((m, h) => Math.max(m, h.liftPct ?? 0), 0);

  // Analysis runs in the background on the server; poll while any site is mid-cycle.
  const analyzing = sites.some((s) => s.experiments[0]?.status === 'analyzing');

  return (
    <main className="dh-main">
      <AutoRefresh active={analyzing} />
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
        <div className="dh-stat dh-stat-accent"><b>{bestLift > 0 ? `+${bestLift.toFixed(1)}%` : '—'}</b><span>Best CTR lift</span></div>
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
              <section key={site.id} className="dh-card" data-status={status}>
                <div className="dh-card-head">
                  <a className="dh-card-url" href={site.url} target="_blank" rel="noreferrer">
                    {site.url.replace(/^https?:\/\//, '')}
                  </a>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {exp && <Link href={`/dashboard/experiments/${exp.id}`} className="dh-pr">view →</Link>}
                    <span className={`dh-badge ${STATUS_CLASS[status] ?? 'none'}`}>{status}</span>
                    <RemoveSiteButton siteId={site.id} url={site.url} />
                  </div>
                </div>

                <div className="dh-card-body">
                  {site.profile?.theme && <p className="dh-card-desc">{site.profile.theme}</p>}

                  <div className="dh-chips">
                    {site.githubRepo && <span className="dh-chip">{site.githubRepo}</span>}
                    {site.profile?.tone && <span className="dh-chip">{site.profile.tone}</span>}
                    <span className="dh-chip">tracker {site.trackerInjected ? 'live' : 'pending'}</span>
                    {exp && <span className="dh-chip">cycle {exp.cycleCount}</span>}
                    {best > 0 && <span className="dh-chip o">+{best.toFixed(1)}% best lift</span>}
                  </div>

                  {hyps.length === 0 && status === 'analyzing' && (
                    <div className="dh-loading">analysing site — generating hypotheses…</div>
                  )}

                  {hyps.length > 0 && (
                    <div className="dh-hyps">
                      {hyps.slice(0, 5).map((h, i) => (
                        <div key={h.id} className="dh-hyp">
                          <span className="dh-hyp-idx">{String(i + 1).padStart(2, '0')}</span>
                          <span className="dh-hyp-desc" title={h.description}>{h.description}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {h.liftPct != null && h.liftPct > 0 && <span className="dh-lift">+{h.liftPct.toFixed(1)}%</span>}
                            {h.prUrl && <a className="dh-pr" href={h.prUrl} target="_blank" rel="noreferrer">PR ↗</a>}
                            <span className={`dh-badge ${STATUS_CLASS[h.status] ?? 'none'}`}>{h.status}</span>
                          </div>
                        </div>
                      ))}
                      {hyps.length > 5 && <div className="dh-meta" style={{ paddingTop: 12 }}>+{hyps.length - 5} more hypotheses</div>}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
