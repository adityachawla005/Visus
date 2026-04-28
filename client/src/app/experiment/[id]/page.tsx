'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const API = 'http://localhost:8080';

interface Variant {
  id: number;
  name: string;
  version: number;
  impressions: number;
  clicks: number;
  ctr: string;
  html: string;
  css: string;
}

interface Hypothesis {
  id: number;
  description: string;
  elementSelector: string;
  rationale: string;
  pagePath: string;
  status: string;
  queueLabel: string;
  winnerId: number | null;
  liftPct: number | null;
  prUrl: string | null;
  prNumber: number | null;
  variants: Variant[];
}

interface DiscoveredPage {
  id: number;
  path: string;
  url: string;
  title: string;
  importance: number;
  category: string;
  status: string;
}

interface SiteProfile {
  theme?: string;
  tone?: string;
  primaryColors?: string[];
  layoutPattern?: string;
  targetAudience?: string;
  conversionGoal?: string;
  weaknesses?: string[];
}

interface Experiment {
  id: number;
  status: string;
  cycleCount: number;
  cooldownUntil: string | null;
  createdAt: string;
  site: {
    url: string;
    githubRepo: string | null;
    autoMerge: boolean;
    trackerPrUrl: string | null;
    trackerInjected: boolean;
    profile: SiteProfile | null;
    discoveredPages: DiscoveredPage[];
  };
  hypotheses: Hypothesis[];
}

interface QueueItem {
  id: number;
  description: string;
  elementSelector: string;
  pagePath: string;
  status: string;
  queueLabel: string;
  liftPct: number | null;
  prUrl: string | null;
  prNumber: number | null;
  progress: number;
  impressionsA: number;
  impressionsB: number;
  ctrA: string;
  ctrB: string;
}

interface QueueData {
  experimentStatus: string;
  cooldownUntil: string | null;
  queue: QueueItem[];
}

const STATUS_COLOR: Record<string, string> = {
  analyzing: '#eab308',
  running:   '#60a5fa',
  completed: '#22c55e',
  cooldown:  '#a78bfa',
  failed:    '#ef4444',
  queued:    '#6b7280',
};

export default function ExperimentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [exp, setExp]           = useState<Experiment | null>(null);
  const [queue, setQueue]       = useState<QueueData | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview]   = useState<'A' | 'B'>('A');
  const [approving, setApproving] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [expRes, queueRes] = await Promise.all([
        fetch(`${API}/experiment/${id}`),
        fetch(`${API}/experiment/${id}/queue`),
      ]);
      const expData   = await expRes.json();
      const queueData = await queueRes.json();
      setExp(expData);
      setQueue(queueData);
      if (!selected && expData.hypotheses?.length) {
        // Auto-select the running hypothesis, or first
        const running = expData.hypotheses.find((h: Hypothesis) => h.status === 'running');
        setSelected((running ?? expData.hypotheses[0]).id);
      }
    } catch { /* silent */ }
  }, [id, selected]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 8000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  async function approvePR(hypothesisId: number) {
    setApproving(hypothesisId);
    try {
      await fetch(`${API}/experiment/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hypothesisId }),
      });
      await fetchAll();
    } finally {
      setApproving(null);
    }
  }

  if (!exp) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
      Loading…
    </div>
  );

  const activeHyp = exp.hypotheses.find(h => h.id === selected) ?? exp.hypotheses[0];
  const siteProfile = exp.site.profile;

  return (
    <main style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)' }}>

      <header style={{ borderBottom: '1px solid var(--border)', padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <Link href="/" style={{ color: 'var(--muted)', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
        <div style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {exp.site.url}
        </span>
        {exp.site.githubRepo && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{exp.site.githubRepo}</span>
        )}
        <StatusBadge status={exp.status} />
        {exp.cycleCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>cycle {exp.cycleCount}</span>
        )}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 'calc(100vh - 53px)' }}>

        {/* Sidebar */}
        <aside style={{ borderRight: '1px solid var(--border)', padding: '20px 14px', overflowY: 'auto' }}>

          {/* Test Queue */}
          <section style={{ marginBottom: 28 }}>
            <SectionLabel>Test Queue</SectionLabel>
            {exp.hypotheses.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Generating…</div>
            )}
            {exp.hypotheses.map(h => (
              <button
                key={h.id}
                onClick={() => setSelected(h.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: selected === h.id ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${selected === h.id ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--foreground)',
                  fontSize: 12,
                  cursor: 'pointer',
                  marginBottom: 6,
                  lineHeight: 1.4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{h.elementSelector}</span>
                  <span style={{ fontSize: 14 }}>{h.queueLabel}</span>
                </div>
                {h.pagePath && h.pagePath !== '/' && (
                  <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 3, fontFamily: 'monospace' }}>
                    {h.pagePath}
                  </div>
                )}
                <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{h.description}</div>
                {h.liftPct != null && (
                  <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                    +{h.liftPct.toFixed(1)}% CTR
                  </div>
                )}
                {h.prUrl && (
                  <a
                    href={h.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 11, color: 'var(--accent)', display: 'block', marginTop: 4 }}
                  >
                    View PR →
                  </a>
                )}
              </button>
            ))}
          </section>

          {/* Conversion funnel */}
          {exp.site.discoveredPages.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <SectionLabel>Funnel</SectionLabel>
              {exp.site.discoveredPages.map(dp => {
                const pageTests = exp.hypotheses.filter(h => h.pagePath === dp.path);
                const running   = pageTests.find(h => h.status === 'running');
                const done      = pageTests.filter(h => h.status === 'completed').length;
                const dotColor  =
                  dp.status === 'testing' ? '#60a5fa' :
                  dp.status === 'done'    ? '#22c55e' :
                  dp.status === 'analyzing' ? '#eab308' : 'var(--border)';
                return (
                  <div key={dp.id} style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 10,
                    padding: '8px 10px',
                    background: running ? 'var(--accent-dim)' : 'transparent',
                    border: `1px solid ${running ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 7,
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, marginTop: 4, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dp.path}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 6 }}>
                        <span style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '1px 5px',
                        }}>
                          {dp.category}
                        </span>
                        {pageTests.length > 0 && (
                          <span>{done}/{pageTests.length} tests</span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', flexShrink: 0 }}>
                      {dp.importance}/10
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Cooldown notice */}
          {exp.status === 'cooldown' && exp.cooldownUntil && (
            <div style={{
              background: '#1e1b4b',
              border: '1px solid #a78bfa',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              color: '#a78bfa',
              marginBottom: 20,
            }}>
              Cooldown — next cycle starts {new Date(exp.cooldownUntil).toLocaleDateString()}
            </div>
          )}

          {/* Site profile */}
          {siteProfile?.theme && (
            <section style={{ marginBottom: 24 }}>
              <SectionLabel>Site Profile</SectionLabel>
              <ProfileRow label="Theme"    value={siteProfile.theme} />
              <ProfileRow label="Tone"     value={siteProfile.tone} />
              <ProfileRow label="Layout"   value={siteProfile.layoutPattern} />
              <ProfileRow label="Audience" value={siteProfile.targetAudience} />
              <ProfileRow label="Goal"     value={siteProfile.conversionGoal} />
              {siteProfile.primaryColors && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {siteProfile.primaryColors.map(c => (
                    <div key={c} title={c} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid var(--border)' }} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Weaknesses */}
          {(siteProfile?.weaknesses?.length ?? 0) > 0 && (
            <section>
              <SectionLabel>Detected Weaknesses</SectionLabel>
              {siteProfile!.weaknesses!.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, paddingLeft: 10, borderLeft: '2px solid var(--accent-dim)' }}>
                  {w}
                </div>
              ))}
            </section>
          )}
        </aside>

        {/* Main panel */}
        <section style={{ padding: '28px 32px', overflowY: 'auto' }}>

          {/* Tracker injection banner — shown until the PR is merged + deployed */}
          {exp.site.trackerPrUrl && !exp.site.trackerInjected && (
            <div style={{
              background: '#1c1a07',
              border: '1px solid #eab308',
              borderRadius: 10,
              padding: '16px 20px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}>
              <div style={{ fontSize: 20 }}>⏳</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#eab308', marginBottom: 4 }}>
                  Action required: merge the tracker PR
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Variants are ready. Visus opened a PR that injects the telemetry script into your repo.
                  Merge it, deploy, and real visitor data will start flowing automatically.
                </div>
              </div>
              <a
                href={exp.site.trackerPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '8px 18px',
                  background: '#eab308',
                  border: 'none',
                  borderRadius: 7,
                  color: '#000',
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                View PR on GitHub
              </a>
            </div>
          )}

          {exp.site.trackerInjected && (
            <div style={{
              fontSize: 12,
              color: 'var(--green)',
              fontWeight: 500,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
              Tracker live — collecting real visitor data
            </div>
          )}

          {activeHyp ? (
            <>
              {/* Hypothesis header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 11, color: STATUS_COLOR[activeHyp.status], fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    {activeHyp.status === 'running' ? 'Running now' : activeHyp.status}
                  </div>
                  <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{activeHyp.description}</h2>
                  <p style={{ fontSize: 13, color: 'var(--muted)' }}>{activeHyp.rationale}</p>
                </div>
                {activeHyp.liftPct != null && (
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 24 }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--green)' }}>
                      +{activeHyp.liftPct.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>CTR lift</div>
                  </div>
                )}
              </div>

              {/* Progress bar (while running) */}
              {activeHyp.status === 'running' && queue && (() => {
                const qi = queue.queue.find(q => q.id === activeHyp.id);
                return qi ? (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                      <span>Traffic collected</span>
                      <span>{qi.impressionsA + qi.impressionsB} / 1,000 visitors needed</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${qi.progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                ) : null;
              })()}

              {/* A/B stat cards */}
              {activeHyp.variants.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <SectionLabel>Live Results</SectionLabel>
                  <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
                    {activeHyp.variants.map(v => {
                      const isWinner = v.id === activeHyp.winnerId;
                      return (
                        <div key={v.id} style={{
                          flex: 1,
                          background: 'var(--surface)',
                          border: `1px solid ${isWinner ? 'var(--green)' : 'var(--border)'}`,
                          borderRadius: 12,
                          padding: '18px 20px',
                          position: 'relative',
                        }}>
                          {isWinner && (
                            <div style={{
                              position: 'absolute', top: -1, right: -1,
                              background: 'var(--green)', color: '#000',
                              fontSize: 9, fontWeight: 700, padding: '3px 8px',
                              borderRadius: '0 12px 0 8px', letterSpacing: '0.08em',
                            }}>
                              WINNER
                            </div>
                          )}
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{v.name}</div>
                          <div style={{ fontSize: 36, fontWeight: 700, color: isWinner ? 'var(--green)' : 'var(--foreground)', lineHeight: 1 }}>
                            {v.ctr}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                            {v.clicks} clicks · {v.impressions} impressions
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bar chart */}
                  {activeHyp.variants.some(v => v.impressions > 0) && (
                    <div style={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={activeHyp.variants.map(v => ({
                          name: v.name,
                          ctr: parseFloat(v.ctr),
                          clicks: v.clicks,
                          impressions: v.impressions,
                          isWinner: v.id === activeHyp.winnerId,
                        }))}>
                          <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis unit="%" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                            formatter={(val, _, p) => [`${val}% CTR (${p.payload.clicks} / ${p.payload.impressions})`]}
                          />
                          <Bar dataKey="ctr" radius={[6, 6, 0, 0]}>
                            {activeHyp.variants.map(v => (
                              <Cell key={v.id} fill={v.id === activeHyp.winnerId ? 'var(--green)' : 'var(--accent)'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* PR Card */}
              {activeHyp.prUrl && (
                <div style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '20px 24px',
                  marginBottom: 32,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                }}>
                  <div style={{ fontSize: 24 }}>🔀</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                      Pull Request #{activeHyp.prNumber} opened
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Winning variant ready to deploy — {activeHyp.liftPct != null ? `+${activeHyp.liftPct.toFixed(1)}% CTR lift` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <a
                      href={activeHyp.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '8px 16px',
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 7,
                        color: 'var(--foreground)',
                        fontSize: 13,
                        fontWeight: 500,
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      View on GitHub
                    </a>
                    {!exp.site.autoMerge && (
                      <button
                        onClick={() => approvePR(activeHyp.id)}
                        disabled={approving === activeHyp.id}
                        style={{
                          padding: '8px 18px',
                          background: approving === activeHyp.id ? 'var(--accent-dim)' : 'var(--green)',
                          border: 'none',
                          borderRadius: 7,
                          color: '#000',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: approving === activeHyp.id ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {approving === activeHyp.id ? 'Merging…' : 'Approve & Merge'}
                      </button>
                    )}
                    {exp.site.autoMerge && (
                      <div style={{ fontSize: 12, color: 'var(--green)', padding: '8px 0', fontWeight: 500 }}>
                        Auto-merged ✓
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Variant HTML Preview */}
              {activeHyp.variants.length >= 2 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <SectionLabel>Variant Preview</SectionLabel>
                    <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                      {(['A', 'B'] as const).map(v => (
                        <button
                          key={v}
                          onClick={() => setPreview(v)}
                          style={{
                            padding: '4px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            background: preview === v ? 'var(--accent)' : 'transparent',
                            color: preview === v ? '#fff' : 'var(--muted)',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <VariantPreview variant={activeHyp.variants[preview === 'A' ? 0 : 1]} />
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 40 }}>
              {exp.status === 'analyzing'
                ? 'Analyzing site with Claude Vision + Playwright…'
                : 'Select a test from the sidebar.'}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function VariantPreview({ variant }: { variant: Variant }) {
  if (!variant) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <iframe
        srcDoc={`<style>body{margin:20px;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100px}${variant.css}</style>${variant.html}`}
        style={{ width: '100%', height: 200, border: 'none' }}
        title={`Preview ${variant.name}`}
        sandbox="allow-scripts"
      />
      <details style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
        <summary style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>View HTML</summary>
        <pre style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
          {variant.css ? `/* CSS */\n${variant.css}\n\n/* HTML */\n` : ''}{variant.html}
        </pre>
      </details>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 12,
      fontWeight: 600,
      color: STATUS_COLOR[status] || 'var(--muted)',
      textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
      {children}
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: 'var(--muted)', minWidth: 60 }}>{label}</span>
      <span style={{ flex: 1 }}>{value}</span>
    </div>
  );
}
