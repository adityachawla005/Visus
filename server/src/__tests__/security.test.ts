import { describe, it, expect } from 'vitest';
import { signVariantToken, verifyVariantToken, rateLimit } from '../security';

describe('variant tokens', () => {
  it('verifies a freshly signed token', () => {
    const t = signVariantToken(42);
    expect(verifyVariantToken(42, t)).toBe(true);
  });
  it('rejects a token for a different variant id', () => {
    const t = signVariantToken(42);
    expect(verifyVariantToken(43, t)).toBe(false);
  });
  it('rejects a tampered / malformed token', () => {
    expect(verifyVariantToken(42, 'deadbeef')).toBe(false);
    expect(verifyVariantToken(42, '')).toBe(false);
    expect(verifyVariantToken(42, null)).toBe(false);
  });
});

describe('rateLimit', () => {
  it('allows up to max then blocks within the window', () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000)).toBe(true);
    expect(rateLimit(key, 5, 60_000)).toBe(false);
  });
  it('uses independent counters per key', () => {
    const a = `a-${Math.random()}`, b = `b-${Math.random()}`;
    expect(rateLimit(a, 1, 60_000)).toBe(true);
    expect(rateLimit(a, 1, 60_000)).toBe(false);
    expect(rateLimit(b, 1, 60_000)).toBe(true); // b unaffected by a
  });
});
