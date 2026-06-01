'use client';

import React, { use, useState, useEffect, useCallback } from 'react';
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
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [approving, setApproving] = useState<number | null>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);

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
    <div className="empty-state" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="radar-dot neon-pulse-cyan" style={{ color: 'var(--accent)', background: 'var(--accent)', width: 12, height: 12, marginRight: 12 }} />
      <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}>Decrypting cyber telemetry...</span>
    </div>
  );

  const activeHyp = exp.hypotheses.find(h => h.id === selected) ?? exp.hypotheses[0];
  const siteProfile = exp.site.profile;

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
      <header className="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/dashboard" className="button button-ghost" style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}>
            ← dashboard
          </Link>
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <span className="neon-glow-text" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--foreground)' }}>
            {exp.site.url}
          </span>
          {exp.site.githubRepo && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              ({exp.site.githubRepo})
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {exp.cycleCount > 0 && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              cycle: <strong style={{ color: 'var(--accent-2)' }}>0{exp.cycleCount}</strong>
            </span>
          )}
          <StatusBadge status={exp.status} />
        </div>
      </header>

      <div className="dash-layout container" style={{ gridTemplateColumns: '320px 1fr', gap: 24, marginTop: 24 }}>
        
        {/* Sidebar / Sidebar Panels */}
        <aside className="dash-sidebar tilt-wrapper-gentle" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 0 }}>
          
          {/* Test Queue */}
          <section className="hologram-panel panel-pad">
            <div className="laser-horizontal" />
            <SectionLabel>Test Queue</SectionLabel>
            {exp.hypotheses.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>
                Generating hypotheses...
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {exp.hypotheses.map(h => {
                const qi = queue?.queue.find(q => q.id === h.id);
                const progressVal = qi?.progress ?? 0;
                const isSelected = selected === h.id;
                const isActive = h.status === 'running';
                
                return (
                  <button
                    key={h.id}
                    onClick={() => setSelected(h.id)}
                    className="hologram-panel"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(0, 231, 255, 0.08)' : 'rgba(11, 17, 27, 0.44)',
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border-soft)',
                      position: 'relative',
                    }}
                  >
                    {/* Glowing progress layer behind button */}
                    {progressVal > 0 && (
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${progressVal}%`,
                        background: isActive ? 'rgba(0, 231, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                        transition: 'width 0.4s',
                        zIndex: 0,
                        pointerEvents: 'none'
                      }} />
                    )}
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, position: 'relative', zIndex: 1 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: isSelected ? 'var(--accent)' : 'var(--foreground)' }}>
                        {h.elementSelector}
                      </span>
                      <span className={isActive ? 'neon-pulse-cyan' : ''} style={{ fontSize: 13 }}>{h.queueLabel}</span>
                    </div>
                    
                    {h.pagePath && h.pagePath !== '/' && (
                      <div className="mono" style={{ fontSize: 10, color: 'var(--accent-2)', marginBottom: 6, position: 'relative', zIndex: 1 }}>
                        {h.pagePath}
                      </div>
                    )}
                    
                    <div style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.4, marginBottom: 6, position: 'relative', zIndex: 1 }}>
                      {h.description}
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                      {h.liftPct != null ? (
                        <div className="neon-glow-text-lime" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 800 }}>
                          +{h.liftPct.toFixed(1)}% CTR lift
                        </div>
                      ) : <span />}
                      {h.prUrl && (
                        <a
                          href={h.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 10, color: 'var(--accent)', textDecoration: 'none', fontWeight: 650 }}
                        >
                          View PR →
                        </a>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Conversion Funnel */}
          {exp.site.discoveredPages.length > 0 && (
            <section className="hologram-panel panel-pad" style={{ position: 'relative' }}>
              <SectionLabel>Funnel Prioritization</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
                {exp.site.discoveredPages.map((dp, idx) => {
                  const pageTests = exp.hypotheses.filter(h => h.pagePath === dp.path);
                  const running   = pageTests.find(h => h.status === 'running');
                  const done      = pageTests.filter(h => h.status === 'completed').length;
                  const dotColor  =
                    dp.status === 'testing' ? '#00e7ff' :
                    dp.status === 'done'    ? '#d7ff3f' :
                    dp.status === 'analyzing' ? '#ffe66d' : 'var(--border)';
                    
                  return (
                    <div key={dp.id} className={`pipeline-node ${running ? 'active' : ''}`} style={{ padding: '8px 10px' }}>
                      {/* Vertical pipeline paths */}
                      {idx < exp.site.discoveredPages.length - 1 && (
                        <div className="pipeline-connector-line" style={{ background: `linear-gradient(180deg, ${dotColor}, transparent)` }} />
                      )}
                      
                      <span className={`radar-dot ${running ? 'neon-pulse-cyan' : ''}`} style={{ color: dotColor, background: dotColor, marginTop: 4, width: 6, height: 6 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mono truncate" style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground)' }}>
                          {dp.path}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{
                            background: 'rgba(5,7,12,0.4)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 4,
                            padding: '0 4px',
                            fontSize: 9,
                            textTransform: 'uppercase'
                          }}>
                            {dp.category}
                          </span>
                          {pageTests.length > 0 && (
                            <span>{done}/{pageTests.length} tests</span>
                          )}
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>
                        {dp.importance}/10
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Cooldown Area */}
          {exp.status === 'cooldown' && exp.cooldownUntil && (
            <div className="hologram-panel panel-pad" style={{
              background: 'rgba(255, 61, 139, 0.08)',
              borderColor: 'var(--accent-3)',
            }}>
              <span className="radar-dot neon-pulse-pink" style={{ color: 'var(--accent-3)', background: 'var(--accent-3)', width: 6, height: 6, marginBottom: 8, display: 'block' }} />
              <div style={{ fontSize: 12, color: 'var(--foreground)', fontWeight: 700 }}>
                Autonomous Cooldown Active
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Loop is paused. Next optimization scans start: {new Date(exp.cooldownUntil).toLocaleDateString()}
              </div>
            </div>
          )}

          {/* Site Profile */}
          {siteProfile?.theme && (
            <section className="hologram-panel panel-pad">
              <SectionLabel>Cyber Profile</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <ProfileRow label="Theme"    value={siteProfile.theme} />
                <ProfileRow label="Tone"     value={siteProfile.tone} />
                <ProfileRow label="Layout"   value={siteProfile.layoutPattern} />
                <ProfileRow label="Goal"     value={siteProfile.conversionGoal} />
                {siteProfile.primaryColors && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {siteProfile.primaryColors.map(c => (
                      <div key={c} title={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.08)' }} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Weaknesses */}
          {(siteProfile?.weaknesses?.length ?? 0) > 0 && (
            <section className="hologram-panel panel-pad">
              <SectionLabel>Leaking Areas</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {siteProfile!.weaknesses!.map((w, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, paddingLeft: 8, borderLeft: '2px solid var(--accent-3)' }}>
                    {w}
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>

        {/* Main Work Area */}
        <section className="dash-main tilt-wrapper-gentle" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 0 }}>

          {/* Tracker Notification Banner */}
          {exp.site.trackerPrUrl && !exp.site.trackerInjected && (
            <div className="hologram-panel panel-pad" style={{
              background: 'rgba(255, 230, 109, 0.08)',
              borderColor: 'var(--warning)',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}>
              <span className="radar-dot" style={{ color: 'var(--warning)', background: 'var(--warning)', width: 10, height: 10 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--warning)', marginBottom: 4 }}>
                  Awaiting Telemetry integration
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                  Visus opened a PR injecting the telemetry scripts into your source code. Merge it and deploy to staging/production to unlock actual user click tracking.
                </div>
              </div>
              <a
                href={exp.site.trackerPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-accent"
                style={{
                  minHeight: 36,
                  background: 'var(--warning)',
                  color: '#000',
                  boxShadow: 'none',
                  fontSize: 12,
                }}
              >
                Merge telemetry
              </a>
            </div>
          )}

          {exp.site.trackerInjected && (
            <div style={{
              fontSize: 12,
              color: 'var(--green)',
              fontWeight: 650,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span className="radar-dot neon-pulse-lime" style={{ color: 'var(--accent-2)', background: 'var(--accent-2)', width: 6, height: 6 }} />
              <span>Telemetry live — collecting real visitor metrics</span>
            </div>
          )}

          {activeHyp ? (
            <>
              {/* Hypothesis Title Board */}
              <div className="hologram-panel panel-pad">
                <div className="laser-horizontal" style={{ animationDelay: '-1s' }} />
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 10, color: STATUS_COLOR[activeHyp.status], fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      {activeHyp.status === 'running' ? 'scanning live traffic' : activeHyp.status}
                    </div>
                    <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{activeHyp.description}</h2>
                    <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>{activeHyp.rationale}</p>
                  </div>
                  {activeHyp.liftPct != null && (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="neon-glow-text-lime" style={{ fontSize: 36, fontWeight: 900, color: 'var(--green)', lineHeight: 1 }}>
                        +{activeHyp.liftPct.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>
                        CTR LIFT
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Progress Bar */}
                {activeHyp.status === 'running' && queue && (() => {
                  const qi = queue.queue.find(q => q.id === activeHyp.id);
                  return qi ? (
                    <div style={{ marginTop: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                        <span className="mono">TRAFFIC PROGRESS</span>
                        <span className="mono">{qi.impressionsA + qi.impressionsB} / 1,000 visitors</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(5,7,12,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 9, overflow: 'hidden' }}>
                        <div style={{ width: `${qi.progress}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', borderRadius: 9, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* A/B results visual deck */}
              {activeHyp.variants.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <SectionLabel>Live Experiment Signals</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {activeHyp.variants.map(v => {
                      const isWinner = v.id === activeHyp.winnerId;
                      return (
                        <div key={v.id} className={isWinner ? 'hologram-panel hologram-panel-lime' : 'hologram-panel'} style={{
                          padding: '20px',
                          borderWidth: isWinner ? '1px' : '1px',
                          borderColor: isWinner ? 'var(--accent-2)' : 'rgba(247,251,255,0.08)',
                        }}>
                          {isWinner && (
                            <div style={{
                              position: 'absolute', top: 0, right: 0,
                              background: 'var(--accent-2)', color: '#000',
                              fontSize: 9, fontWeight: 900, padding: '3px 8px',
                              borderRadius: '0 0 0 8px', letterSpacing: '0.08em',
                            }}>
                              WINNER
                            </div>
                          )}
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>{v.name}</div>
                          <div className={isWinner ? 'neon-glow-text-lime' : 'neon-glow-text'} style={{ fontSize: 36, fontWeight: 900, color: isWinner ? 'var(--accent-2)' : 'var(--foreground)', lineHeight: 1 }}>
                            {v.ctr}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, fontWeight: 500 }}>
                            {v.clicks} clicks · {v.impressions} impressions
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* High-tech Recharts bar chart */}
                  {activeHyp.variants.some(v => v.impressions > 0) && (
                    <div className="hologram-panel panel-pad" style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={activeHyp.variants.map(v => ({
                          name: v.name,
                          ctr: parseFloat(v.ctr),
                          clicks: v.clicks,
                          impressions: v.impressions,
                          isWinner: v.id === activeHyp.winnerId,
                        }))}>
                          <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                          <YAxis unit="%" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: 'rgba(8,14,27,0.9)', border: '1px solid rgba(0,231,255,0.2)', borderRadius: 8, fontSize: 11, backdropFilter: 'blur(8px)' }}
                            formatter={(val, _, p) => [`${val}% CTR (${p.payload.clicks} / ${p.payload.impressions})`]}
                          />
                          <Bar dataKey="ctr" radius={[6, 6, 0, 0]}>
                            {activeHyp.variants.map(v => (
                              <Cell key={v.id} fill={v.id === activeHyp.winnerId ? 'var(--accent-2)' : 'var(--accent)'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* PR Deck Console */}
              {activeHyp.prUrl && (
                <div className="hologram-panel panel-pad" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  borderColor: 'var(--accent)',
                }}>
                  <div style={{ fontSize: 28, filter: 'drop-shadow(0 0 10px var(--accent))' }}>🔀</div>
                  <div style={{ flex: 1 }}>
                    <div className="neon-glow-text" style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', marginBottom: 4 }}>
                      Pull Request #{activeHyp.prNumber} ready
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                      A code patch has been prepared. Click merge to merge the changes directly on the GitHub repository branch.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <a
                      href={activeHyp.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="button button-ghost"
                      style={{
                        minHeight: 36,
                        fontSize: 12,
                      }}
                    >
                      Inspect branch
                    </a>
                    {!exp.site.autoMerge && (
                      <button
                        onClick={() => approvePR(activeHyp.id)}
                        disabled={approving === activeHyp.id}
                        className="button button-accent"
                        style={{
                          minHeight: 36,
                          fontSize: 12,
                          background: approving === activeHyp.id ? 'var(--accent-dim)' : 'var(--accent-2)',
                          color: '#000',
                        }}
                      >
                        {approving === activeHyp.id ? 'Injecting changes...' : 'Approve & Merge'}
                      </button>
                    )}
                    {exp.site.autoMerge && (
                      <div className="neon-glow-text-lime" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        AUTO-MERGED ✓
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Responsive Device Laboratory */}
              {activeHyp.variants.length >= 2 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                    <SectionLabel>Interactive Hologram Viewport</SectionLabel>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      {/* Segmented size buttons */}
                      <div style={{ display: 'flex', background: 'rgba(5,7,12,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden', padding: 2 }}>
                        {(['desktop', 'tablet', 'mobile'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => setViewport(v)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              background: viewport === v ? 'var(--accent)' : 'transparent',
                              color: viewport === v ? '#000' : 'var(--muted)',
                              border: 'none',
                              cursor: 'pointer',
                              borderRadius: 4,
                              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                            }}
                          >
                            {v}
                          </button>
                        ))}
                      </div>

                      {/* Variant A / B selectors */}
                      <div style={{ display: 'flex', background: 'rgba(5,7,12,0.6)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden', padding: 2 }}>
                        {(['A', 'B'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => setPreview(v)}
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              fontWeight: 800,
                              background: preview === v ? 'var(--accent-2)' : 'transparent',
                              color: preview === v ? '#000' : 'var(--muted)',
                              border: 'none',
                              cursor: 'pointer',
                              borderRadius: 4,
                              transition: 'all 0.3s'
                            }}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Visual device wrapper */}
                  <div className="cyber-bezel-wrapper">
                    <div className={`cyber-bezel-device ${viewport}`}>
                      <iframe
                        srcDoc={`<style>body{margin:0;padding:20px;font-family:system-ui,sans-serif;background:#fff;color:#05070c;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%}${activeHyp.variants[preview === 'A' ? 0 : 1].css}</style>${activeHyp.variants[preview === 'A' ? 0 : 1].html}`}
                        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                        title={`Preview ${activeHyp.variants[preview === 'A' ? 0 : 1].name}`}
                        sandbox="allow-scripts"
                      />
                    </div>
                    
                    {/* Expandable inspector code panel */}
                    <div style={{ marginTop: 14 }}>
                      <details className="code-compartment">
                        <summary style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer', padding: '8px 12px', fontWeight: 650, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>INSPECT DOM BINDING</span>
                          <button
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              await navigator.clipboard.writeText(
                                `${activeHyp.variants[preview === 'A' ? 0 : 1].css ? `/* CSS */\n${activeHyp.variants[preview === 'A' ? 0 : 1].css}\n\n` : ''}<!-- HTML -->\n${activeHyp.variants[preview === 'A' ? 0 : 1].html}`
                              );
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            className="button button-ghost"
                            style={{ minHeight: 20, padding: '0 6px', fontSize: 9, textTransform: 'uppercase' }}
                          >
                            {copied ? 'copied!' : 'copy snippet'}
                          </button>
                        </summary>
                        <pre className="mono" style={{ fontSize: 11, color: 'var(--accent)', padding: '12px', marginTop: 0, overflowX: 'auto', whiteSpace: 'pre-wrap', maxHeight: 220, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          {`${activeHyp.variants[preview === 'A' ? 0 : 1].css ? `/* CSS */\n${activeHyp.variants[preview === 'A' ? 0 : 1].css}\n\n` : ''}<!-- HTML -->\n${activeHyp.variants[preview === 'A' ? 0 : 1].html}`}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="hologram-panel panel-pad" style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '60px 0' }}>
              {exp.status === 'analyzing'
                ? 'Playwright crawlers scanning funnel categories...'
                : 'Select an active experiment node from the sidebar queue.'}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="mono" style={{
      fontSize: 10,
      fontWeight: 800,
      color: STATUS_COLOR[status] || 'var(--muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${STATUS_COLOR[status] || 'var(--border)'}`,
      borderRadius: 4,
      padding: '2px 6px'
    }}>
      {status}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-label" style={{ fontSize: 10, letterSpacing: '0.08em', fontWeight: 800 }}>
      {children}
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}>
      <span style={{ color: 'var(--muted)', minWidth: 60, fontWeight: 550 }}>{label}</span>
      <span className="mono truncate" style={{ flex: 1, color: 'var(--foreground)' }}>{value}</span>
    </div>
  );
}

