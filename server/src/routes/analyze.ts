import { Router, Request, Response } from 'express';
import { analyzeSite } from '../ai/analyzer';

const analyzeRouter = Router();

analyzeRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body;

  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'Valid URL required' });
    return;
  }

  try {
    const profile = await analyzeSite(url);
    // Don't send the raw screenshot back — it's large and stored if needed
    const { screenshotBase64: _, ...safeProfile } = profile;
    res.json({ success: true, profile: safeProfile });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default analyzeRouter;
