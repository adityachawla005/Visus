import { prisma } from '../prisma';
import { storeOutcome } from './memory';
import { SiteProfile } from './analyzer';

const MIN_IMPRESSIONS_PER_VARIANT = 500;
const Z_THRESHOLD = 1.645; // 95% one-tailed confidence

function zScore(clicksB: number, impressionsB: number, rateA: number): number {
  if (impressionsB === 0 || rateA <= 0) return 0;
  const rateB = clicksB / impressionsB;
  const se = Math.sqrt(rateA * (1 - rateA) / impressionsB);
  return se === 0 ? 0 : (rateB - rateA) / se;
}

export interface WinnerResult {
  winnerId: number;
  winnerName: string;
  ctrA: number;
  ctrB: number;
  ctrImprovement: number;
  significant: boolean;
}

export async function evaluateHypothesis(
  hypothesisId: number,
  profile: SiteProfile
): Promise<WinnerResult | null> {
  const hyp = await prisma.hypothesis.findUnique({
    where: { id: hypothesisId },
    include: { variants: { orderBy: { version: 'asc' } } },
  });

  if (!hyp || hyp.variants.length < 2) return null;
  if (hyp.status === 'completed') return null;

  const [a, b] = hyp.variants;

  // Not enough data yet
  if (a.impressions < MIN_IMPRESSIONS_PER_VARIANT || b.impressions < MIN_IMPRESSIONS_PER_VARIANT) {
    return null;
  }

  const rateA = a.clicks / a.impressions;
  const rateB = b.clicks / b.impressions;
  const z = zScore(b.clicks, b.impressions, rateA);
  const significant = Math.abs(z) >= Z_THRESHOLD;

  // Winner is always determined by raw CTR comparison, never by z sign (which can be negative when A beats B)
  const winner = rateB >= rateA ? b : a;
  const loser  = rateB >= rateA ? a : b;
  const winnerRate = Math.max(rateA, rateB);
  const ctrImprovement = rateA > 0 ? ((winnerRate - rateA) / rateA) * 100 : 0;

  console.log(`Hypothesis ${hypothesisId}: A=${(rateA * 100).toFixed(2)}% B=${(rateB * 100).toFixed(2)}% z=${z.toFixed(2)} significant=${significant}`);

  // Store outcome in ChromaDB regardless of significance
  await storeOutcome({
    id: `hyp-${hypothesisId}-${Date.now()}`,
    url: profile.url,
    siteType: `${profile.theme}, ${profile.tone}`,
    hypothesis: hyp.description,
    elementType: hyp.elementSelector,
    change: `${winner.name} won over ${loser.name} with CTR ${(winnerRate * 100).toFixed(2)}%`,
    ctrImprovement: significant ? ctrImprovement : 0,
    impressions: a.impressions + b.impressions,
  });

  await prisma.hypothesis.update({
    where: { id: hypothesisId },
    data: { status: 'completed', winnerId: winner.id },
  });

  return { winnerId: winner.id, winnerName: winner.name, ctrA: rateA, ctrB: rateB, ctrImprovement, significant };
}

export async function checkAndEvaluateExperiment(experimentId: number): Promise<boolean> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: {
      site: { include: { profile: true } },
      hypotheses: { include: { variants: true } },
    },
  });

  if (!experiment || experiment.status !== 'running') return false;

  const p = experiment.site.profile;
  const profile: SiteProfile = {
    url:            experiment.site.url,
    theme:          p?.theme ?? '',
    tone:           p?.tone ?? '',
    primaryColors:  (p?.primaryColors as string[]) ?? [],
    fontStyle:      p?.fontStyle ?? '',
    layoutPattern:  p?.layoutPattern ?? '',
    targetAudience: p?.targetAudience ?? '',
    conversionGoal: p?.conversionGoal ?? '',
    copy:           p?.copy ?? '',
    weaknesses:     (p?.weaknesses as string[]) ?? [],
    screenshotBase64: p?.screenshotB64 ?? '',
    selectorMap:      (p?.selectorMap as Record<string, { cssSelector: string; tagName: string; textContent: string; position: number }>) ?? {},
    discoveredPages:  [],
  };

  for (const hyp of experiment.hypotheses) {
    if (hyp.status === 'running') {
      await evaluateHypothesis(hyp.id, profile);
    }
  }

  const updated = await prisma.experiment.findUnique({
    where: { id: experimentId },
    include: { hypotheses: true },
  });

  const allComplete = updated?.hypotheses.every(h => h.status === 'completed') ?? false;

  if (allComplete && (updated?.hypotheses.length ?? 0) > 0) {
    await prisma.experiment.update({
      where: { id: experimentId },
      data: { status: 'completed', cycleCount: { increment: 1 } },
    });
    return true;
  }

  return false;
}
