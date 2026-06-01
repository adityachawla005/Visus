'use client';

import { useEffect, useRef, useState } from 'react';

export default function EyeIntro({ onDone }: { onDone?: () => void }) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out' | 'gone'>('in');
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 200);
    const t2 = setTimeout(() => setPhase('out'),  900);
    const t3 = setTimeout(() => { setPhase('gone'); onDoneRef.current?.(); }, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []); // runs exactly once

  if (phase === 'gone') return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', inset: 0,
        zIndex: 9999,
        background: '#060604',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: phase === 'out' ? 0 : 1,
        transition: phase === 'out' ? 'opacity 0.55s cubic-bezier(0.4,0,0.2,1)' : undefined,
        pointerEvents: phase === 'out' ? 'none' : 'all',
      }}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        opacity: phase === 'in' ? 0 : 1,
        transform: phase === 'in' ? 'translateY(6px)' : 'translateY(0)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}>
        <span style={{
          fontFamily: 'var(--font-syne), sans-serif',
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: '0.55em',
          color: '#e8dfc8',
          textIndent: '0.55em',
        }}>
          VISUS
        </span>

        <div style={{ width: 48, height: 1, background: 'rgba(232,223,200,0.12)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: '#c8a96e',
            width: phase === 'hold' || phase === 'out' ? '100%' : '0%',
            transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
          }} />
        </div>

        <span style={{
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: 8,
          letterSpacing: '0.12em',
          color: 'rgba(232,223,200,0.35)',
          textTransform: 'uppercase',
        }}>
          /ˈviː.sus/ · Latin — sight, vision
        </span>
      </div>
    </div>
  );
}
