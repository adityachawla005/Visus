/**
 * Visus tracker — injected into the client's site.
 * Reads window.__VISUS_SITE_ID__ and window.__VISUS_API__ (set by the crawl route).
 * Fetches the selector map + active variants, swaps elements, records impressions/clicks.
 */
(async () => {
  const SITE_ID = window.__VISUS_SITE_ID__;
  const API     = window.__VISUS_API__ || 'https://your-visus-server.com';

  if (!SITE_ID) return; // no-op if the site hasn't been configured

  // ── Sticky bucket: same visitor always sees the same variant ──────────────
  let bucket = localStorage.getItem('visus_bucket');
  if (!bucket) {
    bucket = Math.random() < 0.5 ? 'A' : 'B';
    localStorage.setItem('visus_bucket', bucket);
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
    const el = findElement(entry);
    if (!el) continue;

    // Tag the element so the old impression/click paths still work
    el.setAttribute('data-track', trackId);

    const variantSet = variants[trackId];
    if (!variantSet) continue;

    const chosen = variantSet[bucket];
    if (!chosen?.html) continue;

    // Inject scoped CSS
    if (chosen.css) {
      const style = document.createElement('style');
      style.setAttribute('data-visus', trackId);
      style.textContent = chosen.css;
      document.head.appendChild(style);
    }

    // Swap element
    const wrapper = document.createElement('div');
    wrapper.innerHTML = chosen.html;
    const newEl = wrapper.firstElementChild;
    if (!newEl) continue;

    el.replaceWith(newEl);

    // Impression
    fetch(`${API}/variant/${chosen.id}/impression`, { method: 'POST' }).catch(() => {});

    // Click
    newEl.addEventListener('click', () => {
      fetch(`${API}/variant/${chosen.id}/click`, { method: 'POST' }).catch(() => {});
    }, { once: true });
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
