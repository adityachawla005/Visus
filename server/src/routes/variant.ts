import express, { Request, Response } from 'express';
import { prisma } from '../prisma';
import { verifyVariantToken, rateLimit, clientIp } from '../security';

const router = express.Router();

// Max counter increments accepted per (IP, variant) per minute. A real visitor
// sends one (deduped client-side), so this only ever trips abuse.
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;

// 📊 Get metrics for a specific element
router.get('/:elementId/metrics', async (req: Request, res: Response): Promise<void> => {
  const { elementId } = req.params;

  try {
    const variants = await prisma.variant.findMany({
      where: { elementId },
      select: { clicks: true, impressions: true },
    });

    if (!variants.length) {
      res.status(404).json({ error: 'No variants found for this element' });
      return;
    }

    const totalClicks = variants.reduce((sum, v) => sum + (v.clicks || 0), 0);
    const totalImpressions = variants.reduce((sum, v) => sum + (v.impressions || 0), 0);
    const ctr = totalImpressions > 0
      ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%'
      : '0%';

    res.json({ elementId, totalClicks, totalImpressions, ctr });
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🎲 Get a random variant for an element
router.get('/:elementId', async (req: Request, res: Response): Promise<void> => {
  const { elementId } = req.params;

  try {
    const variants = await prisma.variant.findMany({ where: { elementId } });

    if (!variants.length) {
      res.status(404).json({ error: 'No variants found for this element' });
      return;
    }

    const randomIndex = Math.floor(Math.random() * variants.length);
    const chosen = variants[randomIndex];
    res.json(chosen);
  } catch (err) {
    console.error('Error fetching variant:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🆕 Create a new variant
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { name, elementId, version, html, css } = req.body;

  if (!name || !elementId || typeof version !== 'number') {
    res.status(400).json({ error: 'Missing or invalid fields' });
    return;
  }

  try {
    const variant = await prisma.variant.create({
      data: { name, elementId, version, html, css },
    });

    res.status(201).json(variant);
  } catch (err) {
    console.error('Error creating variant:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Shared gate: valid signed token for this variant + per-(IP, variant) rate limit.
function guardCounter(metric: 'imp' | 'clk', req: Request, res: Response): number | null {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Invalid variant id' }); return null; }

  if (!verifyVariantToken(id, req.query.t)) {
    res.status(401).json({ error: 'Invalid or missing token' });
    return null;
  }

  if (!rateLimit(`${metric}:${clientIp(req)}:${id}`, RATE_MAX, RATE_WINDOW_MS)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return null;
  }

  return id;
}

// 👁️ Add impression to variant — requires a valid signed token (?t=…)
router.post('/:id/impression', async (req: Request, res: Response): Promise<void> => {
  const id = guardCounter('imp', req, res);
  if (id === null) return;

  try {
    await prisma.variant.update({ where: { id }, data: { impressions: { increment: 1 } } });
    res.status(204).send();
  } catch (err) {
    console.error('Error updating impressions:', err);
    res.status(500).json({ error: 'Failed to update impressions' });
  }
});

// 🖱️ Add click to variant — requires a valid signed token (?t=…)
router.post('/:id/click', async (req: Request, res: Response): Promise<void> => {
  const id = guardCounter('clk', req, res);
  if (id === null) return;

  try {
    await prisma.variant.update({ where: { id }, data: { clicks: { increment: 1 } } });
    res.status(204).send();
  } catch (err) {
    console.error('Error updating clicks:', err);
    res.status(500).json({ error: 'Failed to update clicks' });
  }
});

export default router;
