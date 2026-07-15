'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api';

interface Variant {
  id: number; name: string; version: number;
  impressions: number; clicks: number; html: string; css: string; ctr: string;
}
interface Hypothesis {
  id: number; description: string; rationale: string; elementSelector: string;
  pagePath: string; pageUrl: string | null; status: string;
  winnerId: number | null; prUrl: string | null; prNumber: number | null; liftPct: number | null;
  variants: Variant[];
}
interface Detail {
  id: number; status: string; cycleCount: number;
  site: {
    url: string; githubRepo: string | null; autoMerge: boolean; trackerInjected: boolean;
    profile: { theme: string; tone: string; conversionGoal: string; targetAudience: string; weaknesses: string[] } | null;
  };
  hypotheses: Hypothesis[];
}

const STATUS_CLASS: Record<string, string> = {
  running: 'running', analyzing: 'analyzing', completed: 'completed', cooldown: 'cooldown', failed: 'failed',
};

export default function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState<number | null>(null);
  const [merged, setMerged] = useState<Record<number, boolean>>({});

  function load() {
    apiFetch<Detail>(`/experiment/${id}`).then(setData).catch((e) => setError(e.message ?? 'Failed to load'));
  }
  useEffect(load, [id]);

  async function approve(hypothesisId: number) {
    setApproving(hypothesisId);
    setError('');
    try {
      await apiFetch(`/experiment/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ hypothesisId }),
      });
      setMerged((m) => ({ ...m, [hypothesisId]: true }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Merge failed');
    } finally {
      setApproving(null);
    }
  }

  if (error && !data) return <main className="dh-main"><div className="dh-empty">{error}</div></main>;
  if (!data) return <main className="dh-main"><div className="dh-loading">Loading experiment…</div></main>;

  const p = data.site.profile;

  return (
    <main className="dh-main">
      <Link href="/dashboard" className="dh-back">← All experiments</Link>

      <div className="dh-detail-head">
        <div>
          <h1 className="dh-h1">{data.site.url.replace(/^https?:\/\//, '')}</h1>
          <p className="dh-sub">Experiment #{data.id} · cycle {data.cycleCount}{data.site.githubRepo ? ` · ${data.site.githubRepo}` : ''}</p>
        </div>
        <span className={`dh-badge ${STATUS_CLASS[data.status] ?? 'none'}`}>{data.status}</span>
      </div>

      {p && (
        <div className="dh-profile">
          <div><small>Theme</small><b>{p.theme || '—'}</b></div>
          <div><small>Tone</small><b>{p.tone || '—'}</b></div>
          <div><small>Conversion goal</small><b>{p.conversionGoal || '—'}</b></div>
          <div><small>Audience</small><b>{p.targetAudience || '—'}</b></div>
        </div>
      )}

      <div className="dh-section-label">Hypotheses ({data.hypotheses.length})</div>

      {error && <div className="dh-error" style={{ marginBottom: 14 }}>{error}</div>}

      {data.hypotheses.length === 0 ? (
        <div className="dh-empty">No hypotheses yet — Visus is still analyzing.</div>
      ) : (
        data.hypotheses.map((h) => {
          const canApprove = h.status === 'completed' && h.prUrl && !data.site.autoMerge && !merged[h.id];
          return (
            <section key={h.id} className="dh-hyp-block">
              <div className="dh-hyp-block-head">
                <div style={{ minWidth: 0 }}>
                  <div className="dh-hyp-title">{h.description}</div>
                  {h.rationale && <div className="dh-hyp-why">{h.rationale}</div>}
                  <div className="dh-hyp-page">{h.pageUrl ?? h.pagePath} · {h.elementSelector}</div>
                </div>
                <span className={`dh-badge ${STATUS_CLASS[h.status] ?? 'none'}`}>{h.status}</span>
              </div>

              {h.variants.length > 0 && (
                <div className="dh-ab">
                  {h.variants.sort((a, b) => a.version - b.version).map((v) => {
                    const isWinner = h.winnerId === v.id;
                    return (
                      <div key={v.id} className={`dh-variant${isWinner ? ' winner' : ''}`}>
                        <div className="dh-variant-name">
                          {v.name}{isWinner && <span className="dh-win-tag">★ winner</span>}
                        </div>
                        <div className="dh-variant-metrics">
                          <div><b>{v.ctr}</b><span>CTR</span></div>
                          <div><b>{v.impressions}</b><span>impressions</span></div>
                          <div><b>{v.clicks}</b><span>clicks</span></div>
                        </div>
                        {v.html && <code title={v.html}>{v.html}</code>}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="dh-hyp-actions">
                {h.liftPct != null && h.liftPct > 0 && <span className="dh-lift">+{h.liftPct.toFixed(1)}% CTR lift</span>}
                {h.prUrl && <a className="dh-pr" href={h.prUrl} target="_blank" rel="noreferrer">View PR ↗</a>}
                {merged[h.id] && <span className="dh-ok">✓ Merged</span>}
                {canApprove && (
                  <button className="dh-btn dh-btn-gold" disabled={approving === h.id} onClick={() => approve(h.id)}>
                    {approving === h.id ? 'Merging…' : 'Approve & merge winner'}
                  </button>
                )}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
