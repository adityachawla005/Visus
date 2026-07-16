/**
 * Integrity controls for the public impression/click endpoints.
 *
 * Threat model: tracker.js runs on arbitrary third-party sites, so it cannot
 * hold a real secret — perfect auth is impossible. These controls raise the bar
 * against the realistic abuse: random-ID spam, indefinite replay, and burst
 * inflation. They are NOT a substitute for bot detection.
 *
 *  - HMAC-signed per-variant tokens: /tracker hands each served variant a token
 *    bound to its id and a day bucket. impression/click must present a valid,
 *    unexpired token, so you can't POST to arbitrary /variant/:id and you can't
 *    replay a token forever.
 *  - Per-(IP, variant) rate limiting: caps how fast any single source can
 *    increment a counter, blunting inflation.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const SECRET = process.env.VISUS_TRACKER_SECRET ?? 'visus-dev-insecure-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

function sign(variantId: number, bucket: number): string {
  return crypto.createHmac('sha256', SECRET)
    .update(`${variantId}:${bucket}`)
    .digest('hex')
    .slice(0, 32);
}

/** Token for a variant, valid for the current (and previous) day bucket. */
export function signVariantToken(variantId: number): string {
  return sign(variantId, Math.floor(Date.now() / DAY_MS));
}

/** Constant-time verification, accepting current and previous day buckets. */
export function verifyVariantToken(variantId: number, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 32) return false;
  const tokenBuf = Buffer.from(token);
  const bucket = Math.floor(Date.now() / DAY_MS);
  for (const b of [bucket, bucket - 1]) {
    const expected = Buffer.from(sign(variantId, b));
    if (tokenBuf.length === expected.length && crypto.timingSafeEqual(tokenBuf, expected)) {
      return true;
    }
  }
  return false;
}

// ── In-memory sliding-window rate limiter ─────────────────────────────────────

interface Window { start: number; count: number; }
const buckets = new Map<string, Window>();
const MAX_KEYS = 50_000; // guard against unbounded growth

/** Returns true if the action is allowed, false if the limit is exceeded. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic cleanup so the map can't grow forever.
  if (buckets.size > MAX_KEYS) {
    for (const [k, w] of buckets) {
      if (now - w.start >= windowMs) buckets.delete(k);
    }
  }

  const w = buckets.get(key);
  if (!w || now - w.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  if (w.count >= max) return false;
  w.count++;
  return true;
}

/** Best-effort client IP from common proxy headers, falling back to the socket. */
export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

// ── LLM route protection ──────────────────────────────────────────────────────

// Caps how many LLM-backed requests one caller can make in a window. This guards
// the Gemini quota/key from abuse — even a valid login (or a stolen token) can't
// burn unlimited generations. Tune via LLM_RATE_MAX / LLM_RATE_WINDOW_MS.
const LLM_RATE_MAX = Number(process.env.LLM_RATE_MAX ?? 20);
const LLM_RATE_WINDOW_MS = Number(process.env.LLM_RATE_WINDOW_MS ?? 60_000);

/**
 * Express middleware for expensive Gemini-backed routes. Keys the limit by
 * authenticated user id when present (set by requireAuth), else by client IP,
 * so one account can't monopolise the quota and unauthenticated abuse is capped
 * per source. Mount AFTER requireAuth so req.user is populated.
 */
export function llmRateLimit(req: Request, res: Response, next: NextFunction): void {
  const who = req.user?.id ? `user:${req.user.id}` : `ip:${clientIp(req)}`;
  if (!rateLimit(`llm:${who}`, LLM_RATE_MAX, LLM_RATE_WINDOW_MS)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please slow down and try again shortly.' });
    return;
  }
  next();
}
