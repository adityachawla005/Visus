import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';

const router = Router();

// GET /tracker/:siteId?path=/pricing
// Called by tracker.js on the client site at page load.
// Returns the selectorMap + active variants for the current page path.
router.get('/:siteId', async (req: Request, res: Response): Promise<void> => {
  const { siteId } = req.params;
  const pagePath   = (req.query.path as string) || '/';

  try {
    // Resolve selectorMap: root profile for '/', DiscoveredPage record for everything else
    let selectorMap: Record<string, unknown>;

    if (pagePath === '/') {
      const profile = await prisma.siteProfile.findUnique({ where: { siteId } });
      if (!profile) { res.status(404).json({ error: 'Site not found' }); return; }
      selectorMap = profile.selectorMap as Record<string, unknown>;
    } else {
      const dp = await prisma.discoveredPage.findUnique({
        where: { siteId_path: { siteId, path: pagePath } },
      });
      // Fall back to root selectorMap if the page hasn't been crawled yet
      if (!dp || Object.keys(dp.selectorMap as object).length === 0) {
        const profile = await prisma.siteProfile.findUnique({ where: { siteId } });
        selectorMap = (profile?.selectorMap as Record<string, unknown>) ?? {};
      } else {
        selectorMap = dp.selectorMap as Record<string, unknown>;
      }
    }

    // Only running hypotheses for this specific page path
    const hypotheses = await prisma.hypothesis.findMany({
      where: {
        pagePath,
        status: 'running',
        experiment: { siteId, status: 'running' },
      },
      include: {
        variants: {
          select: { id: true, version: true, html: true, css: true, elementId: true },
        },
      },
    });

    // Build { trackId: { A: variant, B: variant } }
    const variants: Record<string, { A: object | null; B: object | null }> = {};
    for (const hyp of hypotheses) {
      const a = hyp.variants.find(v => v.version === 1) ?? null;
      const b = hyp.variants.find(v => v.version === 2) ?? null;
      variants[hyp.elementSelector] = { A: a, B: b };
    }

    res.json({ siteId, pagePath, selectorMap, variants });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
