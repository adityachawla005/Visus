import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { startExperimentCycle } from '../ai/loop';
import { isPRMerged } from '../ai/patcher';
import { Octokit } from '@octokit/rest';

const router = Router();

// POST /experiment/start
router.post('/start', async (req: Request, res: Response): Promise<void> => {
  const { url, githubRepo, githubToken, autoMerge } = req.body;

  if (!url || !url.startsWith('http')) {
    res.status(400).json({ error: 'Valid URL required' });
    return;
  }
  if (!githubRepo || !githubToken) {
    res.status(400).json({ error: 'GitHub repo (owner/repo) and personal access token are required' });
    return;
  }

  // Verify the token actually has access to that repo — this proves site ownership
  try {
    const [owner, repo] = (githubRepo as string).split('/');
    if (!owner || !repo) {
      res.status(400).json({ error: 'githubRepo must be in owner/repo format' });
      return;
    }
    const octokit = new Octokit({ auth: githubToken });
    await octokit.rest.repos.get({ owner, repo });
  } catch {
    res.status(403).json({ error: 'GitHub token does not have access to that repository' });
    return;
  }

  try {
    // Upsert site so the same URL is never duplicated
    const site = await prisma.site.upsert({
      where: { url },
      create: {
        url,
        githubRepo:  githubRepo  || null,
        githubToken: githubToken || null,
        autoMerge:   autoMerge   ?? false,
      },
      update: {
        ...(githubRepo  && { githubRepo }),
        ...(githubToken && { githubToken }),
        ...(autoMerge !== undefined && { autoMerge }),
      },
    });

    const experiment = await prisma.experiment.create({
      data: { siteId: site.id, status: 'analyzing' },
    });

    res.status(202).json({
      siteId:       site.id,
      experimentId: experiment.id,
      status:       'analyzing',
      message:      'Experiment started. Poll GET /experiment/:id for status.',
    });

    startExperimentCycle(site.id, experiment.id).catch(async err => {
      console.error(`[Experiment ${experiment.id}] Setup failed:`, err);
      await prisma.experiment.update({
        where: { id: experiment.id },
        data: { status: 'failed' },
      });
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /experiment — list all sites + latest experiment per site
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const sites = await prisma.site.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        profile: { select: { theme: true, tone: true, weaknesses: true } },
        experiments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            hypotheses: { select: { id: true, description: true, status: true, winnerId: true, liftPct: true, prUrl: true } },
          },
        },
      },
    });
    res.json(sites);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /experiment/:id — full detail (id = experiment ID)
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  try {
    const experiment = await prisma.experiment.findUnique({
      where: { id },
      include: {
        site: { include: { profile: true, discoveredPages: { orderBy: { importance: 'desc' } } } },
        hypotheses: {
          orderBy: { id: 'asc' },
          include: {
            variants: {
              select: { id: true, name: true, version: true, impressions: true, clicks: true, html: true, css: true },
            },
          },
        },
      },
    });

    if (!experiment) { res.status(404).json({ error: 'Not found' }); return; }

    const enriched = {
      ...experiment,
      hypotheses: experiment.hypotheses.map(h => ({
        ...h,
        variants: h.variants.map(v => ({
          ...v,
          ctr: v.impressions > 0
            ? ((v.clicks / v.impressions) * 100).toFixed(2) + '%'
            : '0%',
        })),
        // Queue indicator for the dashboard
        queueLabel:
          h.status === 'completed' ? '✅' :
          h.status === 'running'   ? '🔄' : '⏳',
      })),
    };

    res.json(enriched);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /experiment/:id/queue — lightweight queue view for polling
router.get('/:id/queue', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  try {
    const hypotheses = await prisma.hypothesis.findMany({
      where: { experimentId: id },
      orderBy: { id: 'asc' },
      include: {
        variants: { select: { impressions: true, clicks: true, version: true } },
      },
    });

    const exp = await prisma.experiment.findUnique({ where: { id }, select: { status: true, cooldownUntil: true } });

    const queue = hypotheses.map(h => {
      const a = h.variants.find(v => v.version === 1);
      const b = h.variants.find(v => v.version === 2);
      const totalImpressions = (a?.impressions ?? 0) + (b?.impressions ?? 0);
      const progress = h.status === 'running'
        ? Math.min(100, Math.round((Math.min(a?.impressions ?? 0, b?.impressions ?? 0) / 500) * 100))
        : (h.status === 'completed' ? 100 : 0);

      return {
        id:              h.id,
        description:     h.description,
        elementSelector: h.elementSelector,
        pagePath:        h.pagePath,
        status:          h.status,
        queueLabel:      h.status === 'completed' ? '✅' : h.status === 'running' ? '🔄' : '⏳',
        liftPct:         h.liftPct,
        prUrl:           h.prUrl,
        prNumber:        h.prNumber,
        progress,
        impressionsA:    a?.impressions ?? 0,
        impressionsB:    b?.impressions ?? 0,
        ctrA:            (a?.impressions ?? 0) > 0 ? ((a!.clicks / a!.impressions) * 100).toFixed(2) + '%' : '—',
        ctrB:            (b?.impressions ?? 0) > 0 ? ((b!.clicks / b!.impressions) * 100).toFixed(2) + '%' : '—',
        totalImpressions,
      };
    });

    res.json({ experimentStatus: exp?.status, cooldownUntil: exp?.cooldownUntil, queue });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /experiment/:id/approve — manually trigger PR merge
router.post('/:id/approve', async (req: Request, res: Response): Promise<void> => {
  const experimentId = parseInt(req.params.id);
  const { hypothesisId } = req.body;
  if (isNaN(experimentId)) { res.status(400).json({ error: 'Invalid id' }); return; }

  try {
    const hyp = await prisma.hypothesis.findUnique({
      where: { id: hypothesisId },
      include: { experiment: { include: { site: true } } },
    });

    if (!hyp?.prNumber || !hyp.experiment.site.githubToken || !hyp.experiment.site.githubRepo) {
      res.status(400).json({ error: 'No PR or GitHub config found' });
      return;
    }

    const [owner, repo] = hyp.experiment.site.githubRepo.split('/');
    const octokit = new Octokit({ auth: hyp.experiment.site.githubToken });

    await octokit.rest.pulls.merge({
      owner, repo,
      pull_number: hyp.prNumber,
      merge_method: 'squash',
    });

    res.json({ merged: true, prUrl: hyp.prUrl });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /experiment/site/:siteId/settings — update autoMerge, github config
router.patch('/site/:siteId/settings', async (req: Request, res: Response): Promise<void> => {
  const { siteId } = req.params;
  const { githubRepo, githubToken, autoMerge } = req.body;

  try {
    const site = await prisma.site.update({
      where: { id: siteId },
      data: {
        ...(githubRepo  !== undefined && { githubRepo }),
        ...(githubToken !== undefined && { githubToken }),
        ...(autoMerge   !== undefined && { autoMerge }),
      },
    });
    res.json({ success: true, site });
  } catch {
    res.status(500).json({ error: 'Update failed' });
  }
});

export default router;
