/**
 * Visus tracker — injected into the client's site.
 * Reads window.__VISUS_SITE_ID__ and window.__VISUS_API__ (set by the crawl route).
 * Fetches the selector map + active variants, swaps elements, records impressions/clicks.
 *
 * Measurement guarantees:
 *  - Sticky bucket is per-TEST (keyed to the active variant pair), so every new
 *    hypothesis re-randomizes the visitor instead of inheriting an old split.
 *  - Impressions and clicks are deduped per visitor per variant, so a returning
 *    visitor counts once — impressions approximate unique visitors, not page loads.
 */
(async () => {
  const SITE_ID = window.__VISUS_SITE_ID__;
  const API     = window.__VISUS_API__ || 'https://your-visus-server.com';

  if (!SITE_ID) return; // no-op if the site hasn't been configured

  // ── Stable anonymous visitor id (no PII, no cookies) ──────────────────────
  let vid = localStorage.getItem('visus_vid');
  if (!vid) {
    vid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('visus_vid', vid);
  }

  // ── Behavior capture ──────────────────────────────────────────────────────
  // Records the friction signals (rage clicks, dead clicks, scroll depth, which
  // tracked elements get clicked) that drive Visus's hypotheses. Batched and
  // flushed to /track when the page is hidden.
  const sessionId = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const behaviorEvents = [];
  let maxScrollPct = 0;
  let recentClicks = [];

  window.addEventListener('scroll', () => {
    const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    if (docH <= 0) return;
    const pct = Math.min(100, Math.round(((window.scrollY + window.innerHeight) / docH) * 100));
    if (pct > maxScrollPct) maxScrollPct = pct;
  }, { passive: true });

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || !el.closest) return;
    const interactive = el.closest('a,button,input,select,textarea,label,summary,[role="button"],[onclick]');
    const trackEl = el.closest('[data-track]');
    const trackId = trackEl ? trackEl.getAttribute('data-track') : null;

    const now = Date.now();
    recentClicks = recentClicks.filter(c => now - c.t < 700);
    recentClicks.push({ t: now, x: e.clientX, y: e.clientY });
    const isRage = recentClicks.length >= 3 &&
      recentClicks.every(c => Math.abs(c.x - e.clientX) < 40 && Math.abs(c.y - e.clientY) < 40);

    behaviorEvents.push({
      type: isRage ? 'rage_click' : (interactive ? 'click' : 'dead_click'),
      trackId,
      t: now,
    });
  }, true);

  let flushed = false;
  function flushBehavior() {
    if (flushed) return;
    if (behaviorEvents.length === 0 && maxScrollPct === 0) return;
    flushed = true;
    const payload = {
      session_id: sessionId,
      site_id: SITE_ID,
      page: window.location.pathname || '/',
      events: behaviorEvents.concat([{ type: 'scroll_depth', value: maxScrollPct }]),
    };
    try {
      fetch(`${API}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true, // survives page unload
      }).catch(() => {});
    } catch (_) { /* ignore */ }
  }
  window.addEventListener('pagehide', flushBehavior);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBehavior();
  });

  // Deterministic FNV-1a hash → stable per-visitor, per-test bucket assignment.
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function bucketFor(testKey) {
    return (hashStr(vid + ':' + testKey) & 1) === 0 ? 'A' : 'B';
  }

  // Persisted dedup sets: variant ids this visitor has already been counted for.
  function loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
    catch (_) { return new Set(); }
  }
  function saveSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify(Array.from(set))); } catch (_) {}
  }
  const seenImpressions = loadSet('visus_imp');
  const seenClicks      = loadSet('visus_clk');

  function recordImpression(variantId, token) {
    if (seenImpressions.has(variantId)) return;        // one impression per visitor per variant
    seenImpressions.add(variantId);
    saveSet('visus_imp', seenImpressions);
    fetch(`${API}/variant/${variantId}/impression?t=${encodeURIComponent(token || '')}`, { method: 'POST' }).catch(() => {});
  }
  function recordClick(variantId, token) {
    if (seenClicks.has(variantId)) return;             // one click per visitor per variant
    seenClicks.add(variantId);
    saveSet('visus_clk', seenClicks);
    fetch(`${API}/variant/${variantId}/click?t=${encodeURIComponent(token || '')}`, { method: 'POST' }).catch(() => {});
  }

  // ── Fetch selector map + active variants for this specific page ──────────
  const pagePath = encodeURIComponent(window.location.pathname || '/');
  let selectorMap, variants;
  try {
    const data = await fetch(`${API}/tracker/${SITE_ID}?path=${pagePath}`).then(r => r.json());
    selectorMap = data.selectorMap ?? {};
    variants    = data.variants    ?? {};
  } catch (err) {
    console.warn('[Visus] Could not reach API:', err);
    return;
  }

  // ── Find and swap each tracked element ───────────────────────────────────
  for (const [trackId, entry] of Object.entries(selectorMap)) {
    const variantSet = variants[trackId];
    if (!variantSet) continue;

    const a = variantSet.A;
    const b = variantSet.B;
    if (!a && !b) continue;

    // Bucket is keyed to THIS test's variant ids — a new hypothesis (new ids)
    // gives the visitor a fresh, independent assignment.
    const testKey = `${trackId}:${a?.id ?? 'x'}:${b?.id ?? 'x'}`;
    const bucket  = bucketFor(testKey);
    const chosen  = bucket === 'A' ? a : b;
    if (!chosen?.id) continue;

    const el = findElement(entry);
    if (!el) continue;

    el.setAttribute('data-track', trackId);

    // The control variant may legitimately have no html (keep the page as-is);
    // only swap when there's challenger markup, but always record the impression.
    let target = el;
    if (chosen.html) {
      if (chosen.css) {
        const style = document.createElement('style');
        style.setAttribute('data-visus', trackId);
        style.textContent = chosen.css;
        document.head.appendChild(style);
      }
      const wrapper = document.createElement('div');
      wrapper.innerHTML = chosen.html;
      const newEl = wrapper.firstElementChild;
      if (newEl) {
        el.replaceWith(newEl);
        target = newEl;
      }
    }

    recordImpression(chosen.id, chosen.token);
    target.addEventListener('click', () => recordClick(chosen.id, chosen.token), { once: true });
  }

  // ── Element finder with three-level fallback ──────────────────────────────
  function findElement(entry) {
    const { cssSelector, tagName, textContent, position } = entry;

    // 1. Try the stored CSS selector (works for stable class names / IDs)
    try {
      const el = document.querySelector(cssSelector);
      if (el) return el;
    } catch (_) { /* invalid selector — skip */ }

    // 2. Tag + exact text match (handles hashed class names like btn_a3f9x)
    if (textContent) {
      const match = Array.from(document.querySelectorAll(tagName))
        .find(e => e.textContent.trim() === textContent.trim());
      if (match) return match;
    }

    // 3. Positional fallback — nth element of that tag type
    const byPosition = document.querySelectorAll(tagName)[position];
    return byPosition || null;
  }
})();
