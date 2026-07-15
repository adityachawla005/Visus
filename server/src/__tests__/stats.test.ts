import { describe, it, expect } from 'vitest';
import { evaluateAB, twoProportionZ, normalCdf } from '../ai/stats';

describe('normalCdf', () => {
  it('is 0.5 at 0 and symmetric', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('twoProportionZ', () => {
  it('is 0 when rates are equal', () => {
    expect(twoProportionZ(50, 1000, 50, 1000)).toBeCloseTo(0, 6);
  });
  it('is positive when B beats A, negative when A beats B', () => {
    expect(twoProportionZ(50, 1000, 90, 1000)).toBeGreaterThan(0);
    expect(twoProportionZ(90, 1000, 50, 1000)).toBeLessThan(0);
  });
});

describe('evaluateAB ship-gating', () => {
  it('ships a clear, significant challenger win', () => {
    const r = evaluateAB(50, 2000, 90, 2000); // 2.5% vs 4.5%
    expect(r.winner).toBe('B');
    expect(r.significant).toBe(true);
    expect(r.shipChallenger).toBe(true);
    expect(r.liftPct).toBeCloseTo(80, 0);
  });

  it('does NOT ship a borderline, non-significant result', () => {
    const r = evaluateAB(50, 1000, 70, 1000); // p ≈ 0.06
    expect(r.winner).toBe('B');
    expect(r.significant).toBe(false);
    expect(r.shipChallenger).toBe(false);
  });

  it('never ships when the control wins', () => {
    const r = evaluateAB(90, 2000, 50, 2000);
    expect(r.winner).toBe('A');
    expect(r.shipChallenger).toBe(false);
  });

  it('requires the minimum sample size even if the rate gap looks large', () => {
    const r = evaluateAB(6, 30, 14, 30); // <500/variant
    expect(r.enoughData).toBe(false);
    expect(r.significant).toBe(false);
    expect(r.shipChallenger).toBe(false);
  });

  it('does not ship a tie', () => {
    const r = evaluateAB(50, 1000, 50, 1000);
    expect(r.winner).toBe(null);
    expect(r.shipChallenger).toBe(false);
  });

  it('enforces the minimum lift threshold', () => {
    // Significant but tiny lift → should not ship.
    const r = evaluateAB(1000, 100000, 1010, 100000, { minLiftPct: 5 });
    expect(r.shipChallenger).toBe(false);
  });
});
