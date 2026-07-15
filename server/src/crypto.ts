/**
 * Symmetric encryption for secrets at rest (GitHub PATs).
 *
 * AES-256-GCM with a key from TOKEN_ENC_KEY (64 hex chars = 32 bytes).
 * Ciphertext format: "v1:<ivB64>:<tagB64>:<dataB64>".
 *
 * `decryptSecret` tolerates legacy plaintext (anything without the "v1:" prefix)
 * so existing rows keep working until they're rewritten encrypted.
 */
import crypto from 'crypto';

const PREFIX = 'v1:';
const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENC_KEY;
  if (!hex || hex.length !== 64) {
    // Dev fallback — derive a stable 32-byte key so the app still runs without
    // a configured key (NOT for production; set TOKEN_ENC_KEY there).
    return crypto.createHash('sha256').update(hex ?? 'visus-dev-insecure-enc-key').digest();
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext — pass through

  try {
    const [, ivB64, tagB64, dataB64] = value.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[crypto] decrypt failed:', (err as Error).message);
    return null;
  }
}
