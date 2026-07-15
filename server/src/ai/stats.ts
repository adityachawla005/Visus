/**
 * A/B test statistics for Visus.
 *
 * The previous implementation used a one-sample z-test that treated the control
 * rate as a known constant (ignoring control's sampling variance), which
 * understates the standard error and overstates significance — i.e. false
 * positives that ship bad changes to client repos.
 *
 * This module uses the correct two-proportion z-test with pooled variance.
 */

export const MIN_IMPRESSIONS_PER_VARIANT = 500;
export const SIGNIFICANCE_ALPHA = 0.05;     // two-tailed → 95% confidence
export const MIN_LIFT_PCT = 2.0;            // require ≥2% relative CTR lift to act

export type WinnerSide = 'A' | 'B' | null;

export interface ABResult {
  rateA: number;          // control CTR (0..1)
  rateB: number;          // challenger CTR (0..1)
  z: number;              // two-proportion z statistic (B relative to A)
  pValue: number;         // two-tailed p-value
  confidencePct: number;  // (1 - pValue) * 100
  significant: boolean;   // pValue < alpha AND both samples big enough
  winner: WinnerSide;     // higher-CTR side, regardless of significance
  liftPct: number;        // relative lift of winner over the other side (%)
  enoughData: boolean;    // both variants meet MIN_IMPRESSIONS_PER_VARIANT
  /**
   * Whether this result justifies shipping a code change: the challenger (B)
   * beat the control (A), the result is statistically significant, and the
   * relative lift clears MIN_LIFT_PCT.
   */
  shipChallenger: boolean;
}

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation.
 * Accurate to ~1e-7, which is far more than enough for A/B confidence.
 */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p =
    d * t * (0.31938153 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 +
            t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Two-tailed p-value for a z statistic. */
export function twoTailedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/**
 * Two-proportion z-test with pooled variance.
 *
 *   p̂ = (xA + xB) / (nA + nB)
 *   SE = √( p̂(1-p̂) (1/nA + 1/nB) )
 *   z  = (rateB - rateA) / SE
 */
export function twoProportionZ(
  clicksA: number, impressionsA: number,
  clicksB: number, impressionsB: number,
): number {
  if (impressionsA <= 0 || impressionsB <= 0) return 0;
  const rateA = clicksA / impressionsA;
  const rateB = clicksB / impressionsB;
  const pPool = (clicksA + clicksB) / (impressionsA + impressionsB);
  if (pPool <= 0 || pPool >= 1) return 0;
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / impressionsA + 1 / impressionsB));
  return se === 0 ? 0 : (rateB - rateA) / se;
}

/**
 * Full evaluation of an A (control) vs B (challenger) experiment.
 * Pure function — no DB, fully unit-testable.
 */
export function evaluateAB(
  clicksA: number, impressionsA: number,
  clicksB: number, impressionsB: number,
  opts: { alpha?: number; minImpressions?: number; minLiftPct?: number } = {},
): ABResult {
  const alpha          = opts.alpha ?? SIGNIFICANCE_ALPHA;
  const minImpressions = opts.minImpressions ?? MIN_IMPRESSIONS_PER_VARIANT;
  const minLiftPct     = opts.minLiftPct ?? MIN_LIFT_PCT;

  const rateA = impressionsA > 0 ? clicksA / impressionsA : 0;
  const rateB = impressionsB > 0 ? clicksB / impressionsB : 0;

  const z             = twoProportionZ(clicksA, impressionsA, clicksB, impressionsB);
  const pValue        = twoTailedP(z);
  const confidencePct = (1 - pValue) * 100;

  const enoughData  = impressionsA >= minImpressions && impressionsB >= minImpressions;
  const significant = enoughData && pValue < alpha;

  const winner: WinnerSide = rateB > rateA ? 'B' : rateA > rateB ? 'A' : null;

  const higher = Math.max(rateA, rateB);
  const lower  = Math.min(rateA, rateB);
  const liftPct = lower > 0 ? ((higher - lower) / lower) * 100 : (higher > 0 ? 100 : 0);

  const shipChallenger =
    winner === 'B' && significant && liftPct >= minLiftPct;

  return {
    rateA, rateB, z, pValue, confidencePct,
    significant, winner, liftPct, enoughData, shipChallenger,
  };
}
