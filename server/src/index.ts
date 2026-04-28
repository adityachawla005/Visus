import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import trackRouter from './routes/track';
import sessionsRouter from './routes/sessions';
import variantRouter from './routes/variant';
import optimizeRouter from './routes/optimize';
import crawlRouter from './routes/crawl';
import analyzeRouter from './routes/analyze';
import experimentRouter from './routes/experiment';
import trackerRouter from './routes/tracker';
import { startBackgroundLoop } from './ai/loop';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors({
  // /tracker and /variant routes are called from arbitrary client sites
  origin: (origin, cb) => cb(null, true),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

// Serve tracker.js so injected sites can load it from this server
app.get('/tracker.js', (_req: Request, res: Response) => {
  res.sendFile(path.resolve(__dirname, '../../client/public/tracker.js'));
});

app.get('/ping', (_req: Request, res: Response) => {
  res.send('pong');
});

app.use('/track', trackRouter);
app.use('/sessions', sessionsRouter);
app.use('/variant', variantRouter);
app.use('/optimize', optimizeRouter);
app.use('/crawl', crawlRouter);
app.use('/analyze', analyzeRouter);
app.use('/experiment', experimentRouter);
app.use('/tracker', trackerRouter);

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  startBackgroundLoop();
});