'use client';

import { useEffect, useState } from 'react';

const STEP_MS = 4500;

const STEPS = [
  { n: '01', title: 'We scan.',  body: 'Visus crawls every page and maps exactly where visitors hesitate, stall, and leave.' },
  { n: '02', title: 'We build.', body: 'An AI agent writes the layout fix — matched to your brand, ready to test.' },
  { n: '03', title: 'We test.',  body: 'Variants go live to your real traffic. Clicks and scrolls decide the winner.' },
  { n: '04', title: 'We ship.',  body: 'At 95% confidence, the winning variant opens a PR and merges itself.' },
];

/* ── Window chrome wrapper — gives the "computer screen" vibe ── */
function Win({ title, children, on }: { title: string; children: React.ReactNode; on: boolean }) {
  return (
    <div className={`ss-card ${on ? 'on' : ''}`}>
      <div className="ss-win">
        <div className="ss-win-bar">
          <span className="ss-win-dot r" />
          <span className="ss-win-dot y" />
          <span className="ss-win-dot g" />
          <span className="ss-win-title">{title}</span>
        </div>
        <div className="ss-win-body">{children}</div>
      </div>
    </div>
  );
}

/* ── Per-step visuals (clean, minimal) ───────────────────────── */
function Visual({ active }: { active: number }) {
  return (
    <div className="ss-visual">
      {/* 01 — Scan: wireframe page with sweeping line */}
      <Win title="visus — scanning" on={active === 0}>
        <div className="ss-scan-page">
          <div className="ss-bar w60" />
          <div className="ss-bar w90" />
          <div className="ss-bar w40" />
          <div className="ss-block" />
          <div className="ss-bar w75" />
          <div className="ss-bar w50" />
          <div className="ss-scanline" />
        </div>
      </Win>

      {/* 02 — Build: code being written */}
      <Win title="variant.tsx" on={active === 1}>
        <div className="ss-code">
          <div className="ss-code-line"><span className="ss-k">const</span> <span className="ss-v">variant</span> = visus.<span className="ss-fn">build</span>(&#123;</div>
          <div className="ss-code-line ss-ind">goal: <span className="ss-s">&apos;conversion&apos;</span>,</div>
          <div className="ss-code-line ss-ind">tone: <span className="ss-s">&apos;brand&apos;</span></div>
          <div className="ss-code-line">&#125;)</div>
          <div className="ss-code-line ss-ok">✓ variant ready</div>
        </div>
      </Win>

      {/* 03 — Test: A/B bars racing */}
      <Win title="experiment #14 — live" on={active === 2}>
        <div className="ss-ab">
          <div className="ss-ab-row">
            <span className="ss-ab-tag">A</span>
            <div className="ss-ab-track"><div className="ss-ab-fill a" /></div>
            <span className="ss-ab-pct">4.1%</span>
          </div>
          <div className="ss-ab-row win">
            <span className="ss-ab-tag">B</span>
            <div className="ss-ab-track"><div key={active} className="ss-ab-fill b" /></div>
            <span className="ss-ab-pct">7.8%</span>
          </div>
          <div className="ss-ab-note">Variant B winning · 97% confidence</div>
        </div>
      </Win>

      {/* 04 — Ship: PR merged */}
      <Win title="pull request #38" on={active === 3}>
        <div className="ss-pr">
          <div className="ss-pr-head">
            <span className="ss-pr-branch">main ← visus/variant-b</span>
          </div>
          <div className="ss-pr-file">+ pricing-hero.tsx</div>
          <div className="ss-pr-file">+ cta-button.tsx</div>
          <div className="ss-pr-merged">
            <span className="ss-pr-check">✓</span> Merged automatically
          </div>
        </div>
      </Win>
    </div>
  );
}

export default function StickySteps() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % STEPS.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="ss-wrap" id="works">
      <div className="ss-sticky">
        <div className="ss-grid">
          {/* Left — step text */}
          <div className="ss-left">
            <span className="ss-eyebrow">How it works</span>
            <div className="ss-list">
              {STEPS.map((s, i) => (
                <div key={s.n} className={`ss-item ${active === i ? 'on' : ''}`}>
                  <span className="ss-item-n">{s.n}</span>
                  <div className="ss-item-text">
                    <h3 className="ss-item-title">{s.title}</h3>
                    <p className="ss-item-body">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="ss-progress">
              {STEPS.map((_, i) => (
                <span key={i} className={`ss-dot ${active === i ? 'on' : ''}`} />
              ))}
            </div>
          </div>

          {/* Right — visual */}
          <Visual active={active} />
        </div>
      </div>
    </div>
  );
}
