/**
 * Minimal leveled logger. Pretty single-line output in dev; structured JSON in
 * production (so a log aggregator can parse it). Controlled by LOG_LEVEL
 * (debug|info|warn|error, default info) and NODE_ENV.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = RANK[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? RANK.info;
const JSON_OUTPUT = process.env.NODE_ENV === 'production';

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (RANK[level] < MIN) return;
  if (JSON_OUTPUT) {
    process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }) + '\n');
  } else {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${level}] ${msg}`, meta && Object.keys(meta).length ? meta : '');
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
