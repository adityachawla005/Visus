/**
 * Behavior aggregation — turns raw tracked Sessions (rage/dead clicks, scroll
 * depth, element clicks) into a concise, signal-focused summary that seeds the
 * hypothesis prompt. This is what makes Visus "watch how users behave" rather
 * than guessing from a static screenshot alone.
 */
import { prisma } from '../prisma';

interface Ev { type: string; trackId?: string | null; value?: number }

const MIN_SESSIONS = 15;      // below this, behavior data isn't representative
const MAX_SESSIONS = 500;     // cap the scan

type Counts = Record<string, number>;

function topN(counts: Counts, n: number): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}
const fmt = (entries: Array<[string, number]>) => entries.map(([k, v]) => `${k} (${v})`).join(', ');

export async function getBehaviorSignals(siteId: string, pagePath: string): Promise<string> {
  const sessions = await prisma.session.findMany({
    where: { siteId, page: pagePath },
    orderBy: { createdAt: 'desc' },
    take: MAX_SESSIONS,
  });
  if (sessions.length < MIN_SESSIONS) return '';

  let scrollSum = 0, scrollCount = 0, rageTotal = 0, deadTotal = 0;
  const rage: Counts = {}, dead: Counts = {}, clicks: Counts = {};

  for (const s of sessions) {
    const events = Array.isArray(s.events) ? (s.events as unknown as Ev[]) : [];
    for (const e of events) {
      if (e.type === 'scroll_depth' && typeof e.value === 'number') { scrollSum += e.value; scrollCount++; }
      else if (e.type === 'rage_click') { rageTotal++; if (e.trackId) rage[e.trackId] = (rage[e.trackId] ?? 0) + 1; }
      else if (e.type === 'dead_click') { deadTotal++; if (e.trackId) dead[e.trackId] = (dead[e.trackId] ?? 0) + 1; }
      else if (e.type === 'click' && e.trackId) { clicks[e.trackId] = (clicks[e.trackId] ?? 0) + 1; }
    }
  }

  const avgScroll = scrollCount ? Math.round(scrollSum / scrollCount) : null;
  const lines: string[] = [`From ${sessions.length} recent sessions on ${pagePath}:`];

  if (avgScroll != null) {
    lines.push(`- Average scroll depth ${avgScroll}%${avgScroll < 50 ? ' — most visitors never reach the lower half, so content below the fold is being missed.' : '.'}`);
  }
  if (rageTotal > 0) {
    const t = topN(rage, 2);
    lines.push(`- ${rageTotal} rage-clicks${t.length ? `, concentrated on ${fmt(t)}` : ''} — repeated rapid clicks signal frustration or an element that feels unresponsive.`);
  }
  if (deadTotal > 0) {
    const t = topN(dead, 2);
    lines.push(`- ${deadTotal} dead-clicks${t.length ? ` on ${fmt(t)}` : ''} — clicks on non-interactive elements users expected to be clickable.`);
  }
  const topClicks = topN(clicks, 3);
  if (topClicks.length) {
    lines.push(`- Most-engaged tracked elements: ${fmt(topClicks)}.`);
  }

  // Only header → no real signal worth injecting.
  return lines.length > 1 ? lines.join('\n') : '';
}
