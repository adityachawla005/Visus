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

/* ── Shared clean video player ───────────────────────────────── */
function VideoPlayer({ src, label }: { src: string; label: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlayback = () => {
    if (!videoRef.current) return;
    playing ? videoRef.current.pause() : videoRef.current.play().catch(() => {});
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    videoRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration;
  };

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  return (
    <div className="telemetry-video-bezel" style={{ width: '100%', maxWidth: '440px' }}>
      <div className="telemetry-video-title-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: playing ? '#ff5500' : '#c8a96e', display: 'inline-block', transition: 'background 0.3s' }} />
          <span className="mono" style={{ fontSize: 9, color: 'rgba(6,6,4,0.4)', letterSpacing: '0.1em', fontWeight: 700 }}>{label}</span>
        </div>
        <span className="mono" style={{ fontSize: 9, color: 'rgba(6,6,4,0.35)', fontWeight: 600 }}>{fmt(currentTime)} / {fmt(duration)}</span>
      </div>

      <div className="telemetry-video-screen" style={{ position: 'relative', overflow: 'hidden', height: '260px', background: '#000', borderRadius: '4px' }}>
        <video
          ref={videoRef}
          src={src}
          loop
          muted={muted}
          playsInline
          onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
          onTimeUpdate={() => {
            const c = videoRef.current?.currentTime || 0;
            const d = videoRef.current?.duration || 1;
            setCurrentTime(c);
            setProgress((c / d) * 100);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button onClick={togglePlayback} style={{ background: 'rgba(200,169,110,0.1)', border: '1px solid #c8a96e', borderRadius: 4, width: 32, height: 24, display: 'grid', placeItems: 'center', color: '#c8a96e', cursor: 'pointer', fontSize: 10, fontWeight: 800 }}>
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted(m => !m); } }} style={{ background: 'rgba(6,6,4,0.04)', border: '1px solid rgba(6,6,4,0.12)', borderRadius: 4, width: 32, height: 24, display: 'grid', placeItems: 'center', color: 'rgba(6,6,4,0.5)', cursor: 'pointer', fontSize: 9, fontWeight: 700 }}>
          {muted ? '🔇' : '🔊'}
        </button>
        <div onClick={handleSeek} style={{ flex: 1, height: 4, background: 'rgba(6,6,4,0.08)', borderRadius: 2, cursor: 'pointer', overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#c8a96e', borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

function PlayableCopyTelemetryVideo() {
  return <VideoPlayer src="/wh0wh0.mp4" label="Gaze Heatmap · Session 01" />;
}

function PlayableTelemetryShard() {
  return <VideoPlayer src="/cutter.mp4" label="Ocular Session · Feed 02" />;
}

/* ── Work 03 Playable Telemetry: Code Diff Patcher ─────────────── */
function PlayableCodeDiffVideo() {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const drawCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Editor grid
      ctx.strokeStyle = 'rgba(6,6,4,0.015)';
      ctx.lineWidth = 1;
      const size = 16;
      for (let x = 0; x < canvas.width; x += size) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }

      // Code backdrop block
      ctx.fillStyle = 'rgba(6, 6, 4, 0.02)';
      ctx.fillRect(8, 12, 224, 115);

      // Syntax lines
      ctx.fillStyle = 'rgba(6,6,4,0.4)';
      ctx.font = '8px monospace';
      ctx.fillText('1: export default function Pricing() {', 14, 25);
      ctx.fillText('2:   return (', 14, 35);
      ctx.fillText('3:     <div className="pricing-grid">', 14, 45);

      // Deletion
      ctx.fillStyle = 'rgba(255, 62, 96, 0.06)';
      ctx.fillRect(14, 52, 212, 10);
      ctx.fillStyle = '#ff3e60';
      ctx.fillText('4: -     <Card primary={true} />', 14, 60);

      // Addition
      ctx.fillStyle = 'rgba(200, 169, 110, 0.08)';
      ctx.fillRect(14, 64, 212, 10);
      ctx.fillStyle = '#c8a96e';
      ctx.fillText('5: +     <Card optimizedCTR={true} />', 14, 72);

      ctx.fillStyle = 'rgba(6,6,4,0.4)';
      ctx.fillText('6:     </div>', 14, 84);
      ctx.fillText('7:   )', 14, 94);
      ctx.fillText('8: }', 14, 104);

      // confidence
      ctx.fillStyle = 'rgba(6, 6, 4, 0.45)';
      ctx.fillText('BAYESIAN STATS CONFIDENCE:', 8, 144);
      
      const confidence = 88.4 + (progress / 100) * 11.3;
      ctx.fillStyle = '#c8a96e';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`${confidence.toFixed(2)}%`, 142, 144);

      // Raising Git PR Status
      if (progress > 85) {
        ctx.fillStyle = 'rgba(200, 169, 110, 0.95)';
        ctx.fillRect(8, 52, 224, 35);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('✓ CONFIDENCE REACHED: Opening Git PR...', 16, 68);
        ctx.fillText('✓ PATCH MERGED AUTOMATICALLY', 16, 78);
      }
    };

    drawCanvas();
  }, [progress, playing]);

  const togglePlayback = () => {
    if (playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      intervalRef.current = setInterval(() => {
        setProgress((prev) => (prev >= 100 ? 0 : prev + 1));
      }, 55);
    }
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <div className="telemetry-video-bezel">
      <div className="telemetry-video-title-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`radar-dot ${playing ? 'neon-pulse-cyan' : ''}`} style={{ background: '#c8a96e', width: 6, height: 6 }} />
          <span className="mono" style={{ fontSize: 9, color: 'rgba(6,6,4,0.4)', letterSpacing: '0.1em' }}>CODE MERGE PATCH TUNNEL</span>
        </div>
        <span className="mono" style={{ fontSize: 9, color: '#c8a96e' }}>MERGING</span>
      </div>
      <div className="telemetry-video-screen">
        <canvas ref={canvasRef} width={240} height={180} style={{ width: '100%', height: '100%' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button onClick={togglePlayback} style={{ background: 'rgba(200,169,110,0.1)', border: '1px solid #c8a96e', color: '#c8a96e', borderRadius: 4, width: 32, height: 24, cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
          {playing ? 'II' : '►'}
        </button>
        <div style={{ flex: 1, height: 4, background: 'rgba(6,6,4,0.08)', borderRadius: 2 }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#c8a96e', borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

/* ── Manifesto Ocular Retina Scanner HUD ───────────────────────── */
function OcularRetinaScanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setScanning(true);
    };

    const handleMouseLeave = () => {
      setScanning(false);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleMouseMove);
      container.addEventListener('mouseleave', handleMouseLeave);
    }
    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="retina-scanner-hud-container">
      <div className="scanner-radar-mesh" />
      
      {/* Top indices */}
      <div style={{ display: 'flex', justifyContent: 'space-between', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`radar-dot ${scanning ? 'neon-pulse-cyan' : ''}`} style={{ background: '#c8a96e', width: 6, height: 6 }} />
          <span className="mono" style={{ fontSize: 9, color: 'rgba(6,6,4,0.4)', letterSpacing: '0.1em' }}>DIAGNOSTIC RETINAL SYSTEM</span>
        </div>
        <span className="mono" style={{ fontSize: 9, color: '#c8a96e' }}>
          {scanning ? 'SCAN: ACTIVE' : 'SCAN: READY'}
        </span>
      </div>

      {/* Concentric targets */}
      <div className="scanner-target-retina">
        <svg width="220" height="220" viewBox="0 0 100 100" style={{ transform: 'rotate(45deg)' }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(200, 169, 110, 0.18)" strokeWidth="1" strokeDasharray="3, 3" />
          <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(200, 169, 110, 0.35)" strokeWidth="0.8" />
          <circle cx="50" cy="50" r="12" fill="none" stroke="rgba(200, 169, 110, 0.5)" strokeWidth="1" strokeDasharray="10, 5" />
          <line x1="50" y1="8" x2="50" y2="92" stroke="rgba(200, 169, 110, 0.15)" strokeWidth="0.5" />
          <line x1="8" y1="50" x2="92" y2="50" stroke="rgba(200, 169, 110, 0.15)" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Laser cursor tracker */}
      {scanning && (
        <div 
          style={{ 
            position: 'absolute', 
            left: mousePos.x, 
            top: mousePos.y, 
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 20
          }}
        >
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r="18" fill="none" stroke="#c8a96e" strokeWidth="1" strokeDasharray="6, 8" />
            <line x1="30" y1="5" x2="30" y2="12" stroke="#c8a96e" strokeWidth="1.2" />
            <line x1="30" y1="48" x2="30" y2="55" stroke="#c8a96e" strokeWidth="1.2" />
            <line x1="5" y1="30" x2="12" y2="30" stroke="#c8a96e" strokeWidth="1.2" />
            <line x1="48" y1="30" x2="55" y2="30" stroke="#c8a96e" strokeWidth="1.2" />
          </svg>
        </div>
      )}

      {/* Diagnostics details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12, zIndex: 5, background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(6,6,4,0.05)', padding: 10, borderRadius: 6 }}>
        <div>
          <span style={{ fontSize: 8, color: 'rgba(6,6,4,0.4)', display: 'block' }}>TARGET MATRIX</span>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
            {scanning ? `X: ${mousePos.x.toFixed(0)} Y: ${mousePos.y.toFixed(0)}` : 'STANDBY'}
          </span>
        </div>
        <div>
          <span style={{ fontSize: 8, color: 'rgba(6,6,4,0.4)', display: 'block' }}>DIAGNOSTIC STATUS</span>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: scanning ? '#c8a96e' : 'rgba(6,6,4,0.3)' }}>
            {scanning ? '✓ BIOMETRICS PARSED' : 'AWAITING TRACK TARGET'}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Data ─────────────────────────────────────────────────────── */
const WORKS = [
  { id: '01', title: 'Gaze Heatmap Scan',    tag: 'Funnel Analysis',  sub: 'Maps where real visitors look, hesitate, and drop off — down to the pixel.' },
  { id: '02', title: 'Session Recording',    tag: 'Session Replay',   sub: 'Captures full user journeys so friction points are visible, not guessed.' },
  { id: '03', title: 'Pricing Plan Reorder', tag: 'A/B Testing',      sub: 'Layout variants ranked by live conversion data, not opinion.' },
];

const SERVICES = [
  { n: '01', title: 'Funnel Scan',          body: 'Crawls every page, surfaces friction points, dead zones, and hierarchy breaks.' },
  { n: '02', title: 'AI Layout Generation', body: 'Generates optimised variants matched to your brand, tone, and conversion goal.' },
  { n: '03', title: 'Live A/B Traffic',     body: 'Splits real visitors across variants, collects click and scroll telemetry in real-time.' },
  { n: '04', title: 'Auto PR & Merge',      body: 'At 95% confidence, Visus opens a GitHub PR and merges the winning layout automatically.' },
];

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
