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
  running: 'running', analyzing: 'analyzing', completed: 'completed', cooldown: 'cooldown', failed: 'failed', queued: 'queued',
};

// CTR arrives as a display string ("11.05%") — pull out the number for the bars.
function ctrNum(ctr: string): number {
  return parseFloat(String(ctr).replace(/[^0-9.]/g, '')) || 0;
}

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

      <div className="dh-section-label">Hypotheses <span>{String(data.hypotheses.length).padStart(2, '0')}</span></div>

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

              {h.variants.length > 0 ? (() => {
                const vs = [...h.variants].sort((a, b) => a.version - b.version);
                const host = data.site.url.replace(/^https?:\/\//, '');
                const maxCtr = Math.max(...vs.map((v) => ctrNum(v.ctr)), 0.0001);
                const totalViews = vs.reduce((s, v) => s + v.impressions, 0);
                const winIdx = vs.findIndex((v) => v.id === h.winnerId);
                const winLabel = winIdx >= 0 ? String.fromCharCode(65 + winIdx) : null;
                return (
                  <div className="dh-term">
                    <div className="dh-term-bar">
                      <span className="d r" /><span className="d y" /><span className="d g" />
                      <span className="title">experiment #{data.id} — live</span>
                    </div>
                    <div className="dh-term-body">
                      <div className="dh-ab">
                        {vs.map((v, i) => {
                          const isWinner = h.winnerId === v.id;
                          const arm = i === 0 ? `Control · ${String.fromCharCode(65 + i)}` : `Challenger · ${String.fromCharCode(65 + i)}`;
                          return (
                            <div key={v.id} className={`dh-variant${isWinner ? ' winner' : ''}`}>
                              <div className="dh-variant-name">
                                <span>{arm}</span>{isWinner && <span className="dh-win-tag">★ winner</span>}
                              </div>
                              <div className="dh-frame">
                                <div className="dh-frame-bar">
                                  <span className="fd" /><span className="fd" /><span className="fd" />
                                  <span className="furl">{host}</span>
                                </div>
                                {v.html ? (
                                  // Render the real variant markup + CSS in a sandboxed, script-free
                                  // iframe so its styles stay isolated from the dashboard.
                                  <iframe
                                    className="dh-render-frame"
                                    title={`${v.name} preview`}
                                    sandbox=""
                                    srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{background:#fff;color:#0a0a0a;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;min-height:120px;padding:26px 18px;display:flex;align-items:center;justify-content:center;text-align:center}${v.css ?? ''}</style></head><body>${v.html}</body></html>`}
                                  />
                                ) : (
                                  <div className="dh-render"><span className="dh-pcta">{v.name}</span></div>
                                )}
                              </div>
                              <div className="dh-variant-metrics">
                                <div><b>{v.ctr}</b><span>CTR</span></div>
                                <div><b>{v.impressions}</b><span>views</span></div>
                                <div><b>{v.clicks}</b><span>clicks</span></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="dh-readout">
                        {vs.map((v, i) => {
                          const isWinner = h.winnerId === v.id;
                          const w = Math.round((ctrNum(v.ctr) / maxCtr) * 100);
                          return (
                            <div key={v.id} className={`dh-bar-row${isWinner ? ' win' : ''}`}>
                              <span className="lab">{String.fromCharCode(65 + i)}</span>
                              <div className="dh-track"><div className="fill" style={{ width: `${w}%` }} /></div>
                              <span className="val">{v.ctr}</span>
                            </div>
                          );
                        })}
                        <div className="dh-verdict">
                          {winLabel
                            ? <>variant {winLabel} winning{h.liftPct != null && h.liftPct > 0 && <> · <b>+{h.liftPct.toFixed(1)}% lift</b></>} · {totalViews.toLocaleString()} views</>
                            : <>{totalViews.toLocaleString()} views collected · still gathering signal</>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div className="dh-ghost">variant not generated yet — built when this hypothesis reaches the front of the queue</div>
              )}

              <div className="dh-hyp-actions">
                {h.liftPct != null && h.liftPct > 0 && <span className="dh-lift">+{h.liftPct.toFixed(1)}% CTR lift</span>}
                {h.prUrl && <a className="dh-pr" href={h.prUrl} target="_blank" rel="noreferrer">view PR ↗</a>}
                {merged[h.id] && <span className="dh-ok">merged</span>}
                <span className="dh-spacer" />
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
