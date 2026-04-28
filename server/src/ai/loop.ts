import { prisma } from '../prisma';
import { setupGraph, evalGraph, variantGraph } from './agent';
import { SiteProfile } from './analyzer';
import { isPRMerged } from './patcher';

const MIN_IMPRESSIONS   = 500;
const POLL_MS           = 60_000;
const COOLDOWN_DAYS     = 7;
const STOP_IF_LIFT_BELOW = 2.0; // % — pause after 3 consecutive tests under this threshold

// ── Data readiness: only the single running hypothesis ────────────────────────

async function isDataReady(experimentId: number): Promise<boolean> {
  const active = await prisma.hypothesis.findFirst({
    where: { experimentId, status: 'running' },
    include: { variants: true },
  });
  if (!active || active.variants.length < 2) return false;
  return active.variants.every(v => v.impressions >= MIN_IMPRESSIONS);
}

// ── Check if last N completed hypotheses all had low lift ─────────────────────

async function shouldPause(experimentId: number): Promise<boolean> {
  const recent = await prisma.hypothesis.findMany({
    where: { experimentId, status: 'completed', liftPct: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  if (recent.length < 3) return false;
  return recent.every(h => (h.liftPct ?? 0) < STOP_IF_LIFT_BELOW);
}

// ── Check whether a PR has been merged (post-merge verification) ──────────────

async function waitForPRMerge(
  token: string,
  repo: string,
  prNumber: number,
): Promise<boolean> {
  // Called once per poll cycle — caller accumulates attempts externally
  return isPRMerged(token, repo, prNumber);
}

// ── Start a new experiment cycle for a site ───────────────────────────────────

export async function startExperimentCycle(siteId: string, experimentId?: number): Promise<number> {
  let id = experimentId;

  if (!id) {
    const exp = await prisma.experiment.create({
      data: { siteId, status: 'analyzing' },
    });
    id = exp.id;
  }

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new Error(`Site ${siteId} not found`);

  // Reconstruct a minimal profile from the DB if it already exists
  const profile = await prisma.siteProfile.findUnique({ where: { siteId } });

  await setupGraph.invoke({
    siteId,
    experimentId: id,
    cycleCount: 0,
    // Pass profile if available so analyze node still overwrites it with fresh data
    profile: profile ? {
      url:            site.url,
      theme:          profile.theme,
      tone:           profile.tone,
      primaryColors:  profile.primaryColors as string[],
      fontStyle:      profile.fontStyle,
      layoutPattern:  profile.layoutPattern,
      targetAudience: profile.targetAudience,
      conversionGoal: profile.conversionGoal,
      copy:           profile.copy,
      weaknesses:     profile.weaknesses as string[],
      screenshotBase64: profile.screenshotB64 ?? '',
      selectorMap:      (profile.selectorMap as Record<string, { cssSelector: string; tagName: string; textContent: string; position: number }>) ?? {},
      discoveredPages:  [],
    } : null,
    selectorMap: (profile?.selectorMap as Record<string, { cssSelector: string; tagName: string; textContent: string; position: number }>) ?? {},
  });

  return id;
}

// ── Background loop ───────────────────────────────────────────────────────────

export function startBackgroundLoop(): void {
  console.log('[Loop] Background evaluation loop started (60s)');

  setInterval(async () => {
    try {
      await pollCooldowns();
      await pollRunningExperiments();
    } catch (err) {
      console.error('[Loop] Poll error:', err);
    }
  }, POLL_MS);
}

// Resume experiments that have passed their cooldown
async function pollCooldowns() {
  const cooled = await prisma.experiment.findMany({
    where: {
      status: 'cooldown',
      cooldownUntil: { lte: new Date() },
    },
    select: { id: true, siteId: true, cycleCount: true },
  });

  for (const exp of cooled) {
    console.log(`[Loop] Cooldown over for experiment ${exp.id} — starting next cycle`);
    const next = await prisma.experiment.create({
      data: { siteId: exp.siteId, status: 'analyzing', cycleCount: exp.cycleCount + 1 },
    });
    startExperimentCycle(exp.siteId, next.id).catch(err =>
      console.error(`[Loop] New cycle failed for site ${exp.siteId}:`, err),
    );
  }
}

async function pollRunningExperiments() {
  const running = await prisma.experiment.findMany({
    where: { status: 'running' },
    select: { id: true, siteId: true, cycleCount: true },
  });

  for (const exp of running) {
    await processExperiment(exp);
  }
}

async function processExperiment(exp: { id: number; siteId: string; cycleCount: number }) {
  const site = await prisma.site.findUnique({ where: { id: exp.siteId } });
  if (!site) return;

  // Hold until the tracker PR has been merged and deployed — no data will arrive before that
  if (!site.trackerInjected) {
    if (site.trackerPrNumber && site.githubToken && site.githubRepo) {
      const merged = await isPRMerged(site.githubToken, site.githubRepo, site.trackerPrNumber);
      if (merged) {
        await prisma.site.update({ where: { id: exp.siteId }, data: { trackerInjected: true } });
        console.log(`[Loop] Tracker live for site ${exp.siteId}`);
      } else {
        return; // Waiting for tracker PR to be merged + deployed
      }
    } else {
      return; // Tracker injection not yet complete
    }
  }

  // Are we waiting for a winner PR to merge before starting cooldown?
  const pendingPR = await prisma.hypothesis.findFirst({
    where: { experimentId: exp.id, status: 'completed', prNumber: { not: null }, prUrl: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  // If autoMerge is off, hold until the developer approves the winner PR
  if (pendingPR?.prNumber && site.githubToken && site.githubRepo && !site.autoMerge) {
    const merged = await waitForPRMerge(site.githubToken, site.githubRepo, pendingPR.prNumber);
    if (!merged) return;
  }

  // Check if data is ready for the active hypothesis
  const ready = await isDataReady(exp.id);
  if (!ready) return;

  console.log(`[Loop] Experiment ${exp.id} — active hypothesis ready, evaluating`);

  const profile = await prisma.siteProfile.findUnique({ where: { siteId: exp.siteId } });
  const siteData = site!;

  const siteProfile: SiteProfile = {
    url:            siteData.url,
    theme:          profile?.theme ?? '',
    tone:           profile?.tone ?? '',
    primaryColors:  (profile?.primaryColors as string[]) ?? [],
    fontStyle:      profile?.fontStyle ?? '',
    layoutPattern:  profile?.layoutPattern ?? '',
    targetAudience: profile?.targetAudience ?? '',
    conversionGoal: profile?.conversionGoal ?? '',
    copy:           profile?.copy ?? '',
    weaknesses:     (profile?.weaknesses as string[]) ?? [],
    screenshotBase64: profile?.screenshotB64 ?? '',
    selectorMap:     (profile?.selectorMap as Record<string, { cssSelector: string; tagName: string; textContent: string; position: number }>) ?? {},
    discoveredPages: [],
  };

  const active = await prisma.hypothesis.findFirst({
    where: { experimentId: exp.id, status: 'running' },
  });

  const selectorMap = siteProfile.selectorMap;

  await evalGraph.invoke({
    siteId:        exp.siteId,
    experimentId:  exp.id,
    profile:       siteProfile,
    hypothesisIds: active ? [active.id] : [],
    cycleCount:    exp.cycleCount,
    selectorMap,
  });

  // Promote the next queued hypothesis
  const nextQueued = await prisma.hypothesis.findFirst({
    where: { experimentId: exp.id, status: 'queued' },
    orderBy: { id: 'asc' },
  });

  if (nextQueued) {
    console.log(`[Loop] Promoting hypothesis ${nextQueued.id} to running`);
    await prisma.hypothesis.update({
      where: { id: nextQueued.id },
      data: { status: 'running' },
    });

    variantGraph.invoke({
      siteId:       exp.siteId,
      experimentId: exp.id,
      profile:      siteProfile,
      selectorMap,
    }).catch(err => console.error('[Loop] Variant gen failed:', err));

    return; // Keep experiment running
  }

  // All hypotheses are done — check if we should pause
  const pause = await shouldPause(exp.id);
  if (pause) {
    console.log(`[Loop] Experiment ${exp.id} — low lift over last 3 tests, pausing`);
    await prisma.experiment.update({
      where: { id: exp.id },
      data: { status: 'completed' },
    });
    return;
  }

  // Enter cooldown before re-analyzing
  const cooldownUntil = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  console.log(`[Loop] Experiment ${exp.id} complete — cooldown until ${cooldownUntil.toISOString()}`);
  await prisma.experiment.update({
    where: { id: exp.id },
    data: { status: 'cooldown', cooldownUntil },
  });
}
