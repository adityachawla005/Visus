/**
 * Shared LLM utilities for the Visus pipeline.
 *
 * - `geminiGenerate` — configured Gemini Flash text entry point (JSON mode).
 * - `extractJson` — robust JSON extraction from messy LLM output (handles
 *   prose around the payload, markdown fences, and trailing text).
 * - `makeOllama` — env-driven Ollama factory so the host/model is configurable.
 * - `withRetry` — retry-with-backoff for flaky local/remote model calls.
 */
import { ChatOllama } from '@langchain/ollama';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
export const OLLAMA_MODEL    = process.env.OLLAMA_MODEL    ?? 'llama3';
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

// Single shared client. Env is loaded (dotenv) before this module initializes,
// so the key is present; an empty key just means calls fail → caller fallback.
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');

/**
 * Generate text with Gemini Flash. With `json: true` the model is constrained to
 * emit a JSON document (no prose/fences), which pairs with `extractJson` for a
 * belt-and-suspenders parse.
 */
export async function geminiGenerate(
  prompt: string,
  opts: { json?: boolean; model?: string; temperature?: number } = {},
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: opts.model ?? GEMINI_MODEL,
    generationConfig: {
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/** Build a ChatOllama instance from env config (single place to swap providers later). */
export function makeOllama(overrides: { model?: string; temperature?: number; json?: boolean } = {}): ChatOllama {
  return new ChatOllama({
    baseUrl: OLLAMA_BASE_URL,
    model:   overrides.model ?? OLLAMA_MODEL,
    temperature: overrides.temperature,
    // Ollama's native JSON mode constrains output to valid JSON — makes the
    // fallback far more parseable than free-form llama3 output.
    ...(overrides.json ? { format: 'json' } : {}),
  });
}

/** Generate text with local Ollama (used as a fallback when Gemini is unavailable). */
export async function ollamaGenerate(
  prompt: string,
  opts: { model?: string; temperature?: number; json?: boolean } = {},
): Promise<string> {
  const res = await makeOllama(opts).invoke(prompt);
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

/**
 * Extract the first balanced JSON object or array from an arbitrary string.
 * Tolerates: leading/trailing prose, ```json fences, and text after the payload.
 * Scans char-by-char tracking string/escape state so braces inside strings don't
 * confuse the balance counter. Returns the parsed value or throws.
 */
export function extractJson<T = unknown>(raw: string): T {
  if (!raw || typeof raw !== 'string') {
    throw new Error('extractJson: empty input');
  }

  // Find the first opening bracket of either kind.
  const firstObj = raw.indexOf('{');
  const firstArr = raw.indexOf('[');
  let start = -1;
  let open = '';
  let close = '';

  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr; open = '['; close = ']';
  } else if (firstObj !== -1) {
    start = firstObj; open = '{'; close = '}';
  }

  if (start === -1) {
    throw new Error('extractJson: no JSON object or array found');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped)        escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"')  inString = false;
      continue;
    }

    if (ch === '"')        inString = true;
    else if (ch === open)  depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1);
        return JSON.parse(candidate) as T;
      }
    }
  }

  throw new Error('extractJson: unbalanced JSON payload');
}

/** Like extractJson but returns a fallback instead of throwing. */
export function tryExtractJson<T = unknown>(raw: string, fallback: T): T {
  try {
    return extractJson<T>(raw);
  } catch {
    return fallback;
  }
}

/**
 * Retry an async fn with exponential backoff. Throws the last error if all
 * attempts fail. Default: 3 attempts, 400ms base delay.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base     = opts.baseDelayMs ?? 400;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delay = base * 2 ** (attempt - 1);
        if (opts.label) {
          console.warn(`[LLM] ${opts.label} failed (attempt ${attempt}/${attempts}): ${(err as Error).message} — retrying in ${delay}ms`);
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
