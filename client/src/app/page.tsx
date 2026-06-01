'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const GrainOverlay = dynamic(() => import('@/components/GrainOverlay'), { ssr: false });
const EyeIntro     = dynamic(() => import('@/components/EyeIntro'),     { ssr: false });
const StickySteps  = dynamic(() => import('@/components/StickySteps'),  { ssr: false });

/* ── Magnetic cursor ─────────────────────────────────────────── */
function Cursor() {
  const dot  = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const pos  = useRef({ x: 0, y: 0 });
  const lag  = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const move = (e: MouseEvent) => { pos.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', move);
    let raf: number;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const tick = () => {
      if (dot.current)  dot.current.style.transform  = `translate(${pos.current.x}px,${pos.current.y}px)`;
      lag.current.x = lerp(lag.current.x, pos.current.x, 0.1);
      lag.current.y = lerp(lag.current.y, pos.current.y, 0.1);
      if (ring.current) ring.current.style.transform = `translate(${lag.current.x}px,${lag.current.y}px)`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { window.removeEventListener('mousemove', move); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <div ref={dot}  className="cur-dot"  aria-hidden />
      <div ref={ring} className="cur-ring" aria-hidden />
    </>
  );
}

/* ── Typewriter ───────────────────────────────────────────────── */
function Typewriter({ text }: { text: string }) {
  const [n, setN]         = useState(0);
  const [going, setGoing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !going) {
        setGoing(true);
        let i = 0;
        const iv = setInterval(() => {
          i++;
          setN(i);
          if (i >= text.length) clearInterval(iv);
        }, 72);
      }
    }, { threshold: 0.4 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [text, going]);

  return (
    <div ref={ref} className="tw-root" style={{ fontFamily: 'var(--font-geist-mono), monospace' }}>
      <span className="tw-typed">{text.slice(0, n)}</span>
      <span className="tw-cursor" aria-hidden />
      <span className="tw-ghost"  aria-hidden>{text.slice(n)}</span>
    </div>
  );
}

/* ── Scroll reveal ────────────────────────────────────────────── */
function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); } }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ── Page ─────────────────────────────────────────────────────── */
export default function Landing() {
  const [ready, setReady] = useState(false);
  const [heroIn, setHeroIn] = useState(false);
  const [introOver, setIntroOver] = useState(false);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  useReveal();

  useEffect(() => {
    setReady(true);
    const t = setTimeout(() => setHeroIn(true), 1500);
    bgVideoRef.current?.play().catch(() => {});
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      {/* Background video — outside mw-root so overflow:hidden doesn't clip it */}
      <video
        ref={bgVideoRef}
        src="/output.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          zIndex: 0,
          pointerEvents: 'none'
        }}
      />

    <div className="mw-root">
      {ready && <GrainOverlay />}
      <Cursor />

      {/* Eye-Opening Intro Preloader */}
      <EyeIntro onDone={() => setIntroOver(true)} />

      {/* ── STICKY NAV HUD ──── */}
      <header className={`mw-nav${(heroIn && introOver) ? ' mw-nav-in' : ''}`}>
        <Link href="/" className="mw-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Visus" style={{ marginRight: 8, width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} />
          <span>VISUS</span>
        </Link>

        <nav className="mw-nav-center">
          <a href="#works"    className="mw-nav-link">Experiments</a>
          <a href="#services" className="mw-nav-link">Telemetry</a>
          <a href="#about"    className="mw-nav-link">Manifesto</a>
        </nav>

        <button type="button" className="mw-get-started">Get started</button>
      </header>

      {/* ══════════════════════════════════════════
          01  HERO  — full bleed WebGL + text bottom-left
      ══════════════════════════════════════════ */}
      <section className="mw-hero">
        <div className={`mw-hero-copy${(heroIn && introOver) ? ' hero-in' : ''}`}>
          <h1 className="mw-hero-h" style={{ fontSize: 'clamp(52px, 8.2vw, 110px)', lineHeight: 0.85, fontWeight: 900 }}>
            {['Observe.', 'Optimize.', 'Ship the diff.'].map((line, i) => (
              <span key={line} className="mw-clip-row">
                <span className="mw-clip-inner" style={{ transitionDelay: `${0.15 + i * 0.1}s` }}>
                  {line}
                </span>
              </span>
            ))}
          </h1>
        </div>

        {/* Scroll cue — bottom right */}
        <div className={`mw-scroll-cue${(heroIn && introOver) ? ' cue-in' : ''}`} aria-hidden>
          <span className="mw-scroll-bar" />
          <span className="mw-scroll-txt">Telemetric Scan</span>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          02  TYPEWRITER (solid black)
      ══════════════════════════════════════════ */}
      <div className="mw-dark-band">
        <section className="mw-typed-section">
          <Typewriter text="Your winner is already in the data." />
        </section>
      </div>

      {/* ══════════════════════════════════════════
          03+  STEPS → CLOSING → FOOTER (tinted band)
      ══════════════════════════════════════════ */}
      <div className="mw-tint-band">
        <StickySteps />

        <section id="about" className="mw-closing">
          <h2 className="mw-closing-h">
            Your site gets better<br />while you sleep.
          </h2>
          <div className="mw-closing-stats">
            {[
              { n: '95%', l: 'Confidence threshold' },
              { n: '0',   l: 'Engineers needed'     },
              { n: '24/7',l: 'Always running'       },
            ].map(s => (
              <div key={s.n} className="mw-stat">
                <span className="mw-stat-n">{s.n}</span>
                <span className="mw-stat-l">{s.l}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="mw-footer">
          <div className="mw-footer-wordmark" aria-hidden>VISUS</div>
          <div className="mw-footer-bar" style={{ fontSize: 11 }}>
            <span>© 2026 Visus Inc. Systems fully synchronized.</span>
            <span className="mw-footer-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>autonomous conversion control</span>
          </div>
        </footer>
      </div>

    </div>
    </>
  );
}
