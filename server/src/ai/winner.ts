import { prisma } from '../prisma';
import { storeOutcome } from './memory';
import { SiteProfile } from './analyzer';
import { evaluateAB, ABResult, MIN_IMPRESSIONS_PER_VARIANT } from './stats';

export interface WinnerResult {
  winnerId: number;
  winnerName: string;
  ctrA: number;
  ctrB: number;
  ctrImprovement: number;
  significant: boolean;
  /** True only when the challenger (B) significantly beat the control — safe to ship. */
  shipChallenger: boolean;
  confidencePct: number;
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

  // Not enough data yet — the proper gate lives in stats.evaluateAB, but we
  // short-circuit here to avoid marking the hypothesis completed prematurely.
  if (a.impressions < MIN_IMPRESSIONS_PER_VARIANT || b.impressions < MIN_IMPRESSIONS_PER_VARIANT) {
    return null;
  }

  const result: ABResult = evaluateAB(a.clicks, a.impressions, b.clicks, b.impressions);

  // True winner (higher CTR) is recorded for learning even when not significant.
  // 'A' wins ties so we never ship a challenger on a coin-flip.
  const winner = result.winner === 'B' ? b : a;
  const loser  = result.winner === 'B' ? a : b;

  console.log(
    `Hypothesis ${hypothesisId}: A=${(result.rateA * 100).toFixed(2)}% B=${(result.rateB * 100).toFixed(2)}% ` +
    `z=${result.z.toFixed(2)} p=${result.pValue.toFixed(4)} significant=${result.significant} ship=${result.shipChallenger}`,
  );

  // Store outcome in ChromaDB regardless of significance, but only credit lift
  // when the result is statistically significant (otherwise it's noise).
  await storeOutcome({
    id: `hyp-${hypothesisId}-${Date.now()}`,
    url: profile.url,
    siteType: `${profile.theme}, ${profile.tone}`,
    hypothesis: hyp.description,
    elementType: hyp.elementSelector,
    change: result.significant
      ? `${winner.name} won over ${loser.name} (CTR ${(Math.max(result.rateA, result.rateB) * 100).toFixed(2)}%, ${result.confidencePct.toFixed(1)}% confidence)`
      : `Inconclusive — no significant difference between ${a.name} and ${b.name}`,
    ctrImprovement: result.significant ? result.liftPct : 0,
    impressions: a.impressions + b.impressions,
  });

  // Record the winner (true higher-CTR variant) and the measured lift.
  // liftPct is only stored when significant so downstream pause/learn logic
  // isn't driven by noise.
  await prisma.hypothesis.update({
    where: { id: hypothesisId },
    data: {
      status: 'completed',
      winnerId: winner.id,
      liftPct: result.significant ? result.liftPct : 0,
    },
  });

  return {
    winnerId: winner.id,
    winnerName: winner.name,
    ctrA: result.rateA,
    ctrB: result.rateB,
    ctrImprovement: result.liftPct,
    significant: result.significant,
    shipChallenger: result.shipChallenger,
    confidencePct: result.confidencePct,
  };
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
    selectorMap:      (p?.selectorMap as unknown as SiteProfile['selectorMap']) ?? {},
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
