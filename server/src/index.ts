// Load env BEFORE any other import — modules like analyzer.ts read
// process.env at module-init time (e.g. the Gemini client), so dotenv must run
// first or those reads get undefined. ES imports execute top-to-bottom, so this
// side-effect import has to be the very first line.
import 'dotenv/config';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import trackRouter from './routes/track';
import sessionsRouter from './routes/sessions';
import variantRouter from './routes/variant';
import optimizeRouter from './routes/optimize';
import crawlRouter from './routes/crawl';
import analyzeRouter from './routes/analyze';
import experimentRouter from './routes/experiment';
import trackerRouter from './routes/tracker';
import authRouter from './routes/auth';
import { requireAuth } from './auth';
import { llmRateLimit } from './security';
import { logger } from './logger';
import { startBackgroundLoop } from './ai/loop';

const app = express();
const PORT = process.env.PORT || 8000;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Public CORS — telemetry routes are called from arbitrary client sites.
const publicCors = cors({ origin: (_o, cb) => cb(null, true), methods: METHODS, allowedHeaders: ['Content-Type', 'Authorization'] });

// Dashboard/auth CORS — restricted to the dashboard origin(s). The JWT is the
// real gate; this just stops other browser origins from calling these routes.
const dashboardOrigins = (process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000').split(',').map(s => s.trim());
const dashboardCors = cors({ origin: dashboardOrigins, methods: METHODS, allowedHeaders: ['Content-Type', 'Authorization'] });

app.use(express.json());

// Serve tracker.js so injected sites can load it from this server.
// Path is overridable (TRACKER_JS_PATH) for container builds.
const TRACKER_JS_PATH = process.env.TRACKER_JS_PATH ?? path.resolve(__dirname, '../../client/public/tracker.js');
app.get('/tracker.js', publicCors, (_req: Request, res: Response) => {
  res.type('application/javascript').sendFile(TRACKER_JS_PATH);
});

app.get('/ping', (_req: Request, res: Response) => {
  res.send('pong');
});

// Auth endpoints — public but origin-restricted to the dashboard.
app.use('/auth', dashboardCors, authRouter);

// Public telemetry — called from arbitrary client sites (variant/click have
// their own HMAC-token + rate-limit protection in routes/variant.ts).
app.use('/track', publicCors, trackRouter);
app.use('/variant', publicCors, variantRouter);
app.use('/tracker', publicCors, trackerRouter);

// Dashboard-facing routes — restricted origin + a valid login (JWT).
app.use('/sessions', dashboardCors, requireAuth, sessionsRouter);
// LLM-backed routes carry an extra per-user rate limit to protect the Gemini quota.
app.use('/optimize', dashboardCors, requireAuth, llmRateLimit, optimizeRouter);
app.use('/crawl', dashboardCors, requireAuth, crawlRouter);
app.use('/analyze', dashboardCors, requireAuth, llmRateLimit, analyzeRouter);
app.use('/experiment', dashboardCors, requireAuth, llmRateLimit, experimentRouter);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { err: err?.message ?? String(err) });
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  startBackgroundLoop();
});