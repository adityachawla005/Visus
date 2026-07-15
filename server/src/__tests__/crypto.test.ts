import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../crypto';

describe('secret encryption', () => {
  it('round-trips a value', () => {
    const plain = 'ghp_supersecrettoken123';
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);          // not stored in cleartext
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
  });
  it('passes through legacy plaintext (no v1: prefix)', () => {
    expect(decryptSecret('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });
  it('handles null', () => {
    expect(decryptSecret(null)).toBe(null);
  });
  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });
});
