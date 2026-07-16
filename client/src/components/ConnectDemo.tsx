'use client';

/**
 * ConnectDemo — the live, self-running preview shown beside the connect form.
 * Loops the agent's real workflow: scan → analyze → flag weakness → generate a
 * variant → split live traffic → clear the z-test → open a PR. Purely cosmetic
 * (no network), driven imperatively via refs. All timers/rAF are tracked and
 * cancelled on unmount, and reduced-motion renders the settled end state only.
 */
import { useEffect, useRef } from 'react';

export default function ConnectDemo() {
  const siteRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLSpanElement>(null);
  const blipRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const fillARef = useRef<HTMLDivElement>(null);
  const fillBRef = useRef<HTMLDivElement>(null);
  const valARef = useRef<HTMLSpanElement>(null);
  const valBRef = useRef<HTMLSpanElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const prRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<number>();
    const rafs = new Set<number>();

    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const id = window.setTimeout(() => { timers.delete(id); res(); }, ms);
        timers.add(id);
      });

    const set = (el: HTMLElement | null, t: string) => { if (el) el.textContent = t; };

    // Count a percentage up to `target` over `ms`, via rAF.
    const tick = (el: HTMLElement | null, target: number, ms: number) =>
      new Promise<void>((res) => {
        const startT = performance.now();
        const step = (t: number) => {
          if (cancelled || !el) return res();
          const k = Math.min(1, (t - startT) / ms);
          el.textContent = (target * k).toFixed(2) + '%';
          if (k < 1) { const id = requestAnimationFrame(step); rafs.add(id); } else res();
        };
        const id = requestAnimationFrame(step); rafs.add(id);
      });

    const reset = () => {
      const scan = scanRef.current;
      if (scan) { scan.style.opacity = '0'; scan.style.transition = 'none'; scan.style.transform = 'translateY(0)'; }
      ctaRef.current?.classList.remove('is-flag', 'is-pop');
      set(ctaRef.current, 'Try free');
      badgeRef.current?.classList.remove('is-on');
      blipRef.current?.classList.add('is-idle');
      if (fillARef.current) fillARef.current.style.width = '0';
      if (fillBRef.current) fillBRef.current.style.width = '0';
      set(valARef.current, '—');
      set(valBRef.current, '—');
      verdictRef.current?.classList.remove('is-on');
      prRef.current?.classList.remove('is-on');
      set(statusRef.current, 'initializing…');
    };

    const settled = () => {
      blipRef.current?.classList.remove('is-idle');
      set(ctaRef.current, 'Start Free Trial');
      if (fillARef.current) fillARef.current.style.width = '71%';
      if (fillBRef.current) fillBRef.current.style.width = '94%';
      set(valARef.current, '11.05%');
      set(valBRef.current, '14.58%');
      verdictRef.current?.classList.add('is-on');
      prRef.current?.classList.add('is-on');
      set(statusRef.current, 'winner shipped ✓');
    };

    async function run() {
      while (!cancelled) {
        reset();
        blipRef.current?.classList.remove('is-idle');
        await wait(500); if (cancelled) return;

        set(statusRef.current, 'scanning page…');
        const scan = scanRef.current;
        const h = siteRef.current?.clientHeight ?? 190;
        if (scan) {
          scan.style.transition = 'transform 1.6s linear, opacity .3s';
          scan.style.opacity = '1';
          scan.style.transform = `translateY(${h}px)`;
        }
        await wait(1700); if (cancelled) return;
        if (scan) scan.style.opacity = '0';

        set(statusRef.current, 'analyzing with vision model…');
        await wait(900); if (cancelled) return;

        ctaRef.current?.classList.add('is-flag');
        badgeRef.current?.classList.add('is-on');
        set(statusRef.current, 'weakness found · cta-button-0');
        await wait(1400); if (cancelled) return;

        set(statusRef.current, 'generating variant…');
        badgeRef.current?.classList.remove('is-on');
        await wait(700); if (cancelled) return;

        ctaRef.current?.classList.add('is-pop');
        set(ctaRef.current, 'Start Free Trial');
        await wait(300); if (cancelled) return;
        ctaRef.current?.classList.remove('is-pop', 'is-flag');
        await wait(700); if (cancelled) return;

        set(statusRef.current, 'testing · splitting live traffic');
        if (fillARef.current) fillARef.current.style.width = '71%';
        if (fillBRef.current) fillBRef.current.style.width = '94%';
        void tick(valARef.current, 11.05, 1100);
        await tick(valBRef.current, 14.58, 1100); if (cancelled) return;
        await wait(700); if (cancelled) return;

        set(statusRef.current, 'z-test cleared · 95% confidence');
        verdictRef.current?.classList.add('is-on');
        await wait(600); if (cancelled) return;
        prRef.current?.classList.add('is-on');
        set(statusRef.current, 'winner shipped ✓');

        await wait(3200); if (cancelled) return;
      }
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reset();
      settled();
    } else {
      run();
    }

    return () => {
      cancelled = true;
      timers.forEach((id) => clearTimeout(id));
      rafs.forEach((id) => cancelAnimationFrame(id));
    };
  }, []);

  return (
    <div className="cn-term">
      <div className="cn-tbar">
        <span className="cn-dot cn-dot-r" />
        <span className="cn-dot cn-dot-y" />
        <span className="cn-dot cn-dot-g" />
        <span className="cn-ttl">live preview — no setup</span>
      </div>
      <div className="cn-tbody">
        <div className="cn-site" ref={siteRef}>
          <div className="cn-scan" ref={scanRef} />
          <div className="cn-badge" ref={badgeRef}>weak CTA detected</div>
          <div className="cn-sbar">
            <span className="cn-sd" /><span className="cn-sd" /><span className="cn-sd" />
            <span className="cn-surl">brightledger.app</span>
          </div>
          <div className="cn-render">
            <div className="cn-eb">Brightledger</div>
            <h5>Invoicing on autopilot</h5>
            <p>Send, track, and get paid — without the busywork.</p>
            <span className="cn-cta" ref={ctaRef}>Try free</span>
          </div>
        </div>

        <div className="cn-status">
          <span className="cn-blip is-idle" ref={blipRef} />
          <span ref={statusRef}>initializing…</span>
        </div>

        <div className="cn-bar">
          <span className="cn-bar-l">A</span>
          <div className="cn-track"><div className="cn-fill" ref={fillARef} /></div>
          <span className="cn-bar-v" ref={valARef}>—</span>
        </div>
        <div className="cn-bar cn-bar-b">
          <span className="cn-bar-l">B</span>
          <div className="cn-track"><div className="cn-fill" ref={fillBRef} /></div>
          <span className="cn-bar-v" ref={valBRef}>—</span>
        </div>

        <div className="cn-verdict" ref={verdictRef}>
          <div className="cn-lift">+31.9% CTR lift</div>
          <div className="cn-meta">variant B · 95% confidence</div>
          <div className="cn-pr" ref={prRef}>
            <span className="cn-pr-dot" />opened PR #6 → brightledger/website
          </div>
        </div>
      </div>
    </div>
  );
}
