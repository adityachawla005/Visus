import { prisma } from '../prisma';
import { setupGraph, evalGraph, variantGraph } from './agent';
import { SiteProfile } from './analyzer';
import { isPRMerged } from './patcher';
import { MIN_IMPRESSIONS_PER_VARIANT, MIN_LIFT_PCT } from './stats';
import { decryptSecret } from '../crypto';
import { logger } from '../logger';
import { Client } from 'pg';

const MIN_IMPRESSIONS   = MIN_IMPRESSIONS_PER_VARIANT;
const POLL_MS           = 60_000;
const COOLDOWN_DAYS     = 7;
const STOP_IF_LIFT_BELOW = MIN_LIFT_PCT; // % — pause after 3 consecutive tests under this threshold

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

// ── Generate variants for the running hypothesis (with verification) ──────────
// Returns true only if the running hypothesis ends up with ≥2 variants.
// Reconstructs the site profile from the DB when one isn't supplied (watchdog).

async function generateVariantsFor(
  siteId: string,
  experimentId: number,
  profile?: SiteProfile,
  selectorMap?: SiteProfile['selectorMap'],
  verifyHypothesisId?: number,
): Promise<boolean> {
  if (!profile || !selectorMap) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    const p    = await prisma.siteProfile.findUnique({ where: { siteId } });
    if (!site || !p) return false;
    profile = {
      url:            site.url,
      theme:          p.theme,
      tone:           p.tone,
      primaryColors:  (p.primaryColors as string[]) ?? [],
      fontStyle:      p.fontStyle,
      layoutPattern:  p.layoutPattern,
      targetAudience: p.targetAudience,
      conversionGoal: p.conversionGoal,
      copy:           p.copy,
      weaknesses:     (p.weaknesses as string[]) ?? [],
      screenshotBase64: p.screenshotB64 ?? '',
      selectorMap:      (p.selectorMap as unknown as SiteProfile['selectorMap']) ?? {},
      discoveredPages:  [],
    };
    selectorMap = profile.selectorMap;
  }

  try {
    // generateVariantsNode generates for every running hypothesis lacking a pair.
    await variantGraph.invoke({ siteId, experimentId, profile, selectorMap });
  } catch (err) {
    console.error('[Loop] Variant gen error:', (err as Error).message);
    return false;
  }

  // Verify the specific hypothesis we care about (a page's running one) got its
  // pair; fall back to "any running has a pair" when no id is supplied.
  if (verifyHypothesisId !== undefined) {
    const h = await prisma.hypothesis.findUnique({
      where: { id: verifyHypothesisId },
      include: { variants: true },
    });
    return !!h && h.variants.length >= 2;
  }

  const active = await prisma.hypothesis.findFirst({
    where: { experimentId, status: 'running' },
    include: { variants: true },
  });
  return !!active && active.variants.length >= 2;
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

let polling = false;

// Arbitrary 64-bit advisory-lock key (only instances using the same key compete).
const LOOP_LOCK_KEY = 0x5675_5300; // "VuS\0"

// Hold the lock on a dedicated long-lived connection so the Prisma pool can't
// release it. Only the leader runs the poll; standbys retry for failover.
async function acquireLeadership(): Promise<Client | null> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LOOP_LOCK_KEY]);
    if (r.rows[0]?.locked) return client;
    await client.end();
    return null;
  } catch (err) {
    logger.error('[Loop] Leadership acquisition failed', { err: (err as Error).message });
    try { await client.end(); } catch { /* ignore */ }
    return null;
  }
}

async function pollOnce(): Promise<void> {
  // Re-entrancy guard: a poll cycle can take longer than POLL_MS (analyze +
  // LLM calls). Skip overlapping ticks so experiments aren't double-promoted.
  if (polling) {
    logger.warn('[Loop] Previous poll still running — skipping this tick');
    return;
  }
  polling = true;
  try {
    await pollCooldowns();
    await pollRunningExperiments();
  } catch (err) {
    logger.error('[Loop] Poll error', { err: (err as Error).message });
  } finally {
    polling = false;
  }
}

export function startBackgroundLoop(): void {
  void runWhenLeader();
}

async function runWhenLeader(): Promise<void> {
  const leader = await acquireLeadership();
  if (leader) {
    logger.info('[Loop] Acquired leadership — evaluation loop running (60s)');
    setInterval(() => { void pollOnce(); }, POLL_MS);
  } else {
    logger.info('[Loop] Another instance holds the loop lock — standing by');
    setTimeout(() => { void runWhenLeader(); }, POLL_MS); // retry for failover
  }
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
      const merged = await isPRMerged(decryptSecret(site.githubToken)!, site.githubRepo, site.trackerPrNumber);
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

  // Build the site profile once — needed for variant regeneration + evaluation.
  const profileRow = await prisma.siteProfile.findUnique({ where: { siteId: exp.siteId } });
  const siteProfile: SiteProfile = {
    url:            site.url,
    theme:          profileRow?.theme ?? '',
    tone:           profileRow?.tone ?? '',
    primaryColors:  (profileRow?.primaryColors as string[]) ?? [],
    fontStyle:      profileRow?.fontStyle ?? '',
    layoutPattern:  profileRow?.layoutPattern ?? '',
    targetAudience: profileRow?.targetAudience ?? '',
    conversionGoal: profileRow?.conversionGoal ?? '',
    copy:           profileRow?.copy ?? '',
    weaknesses:     (profileRow?.weaknesses as string[]) ?? [],
    screenshotBase64: profileRow?.screenshotB64 ?? '',
    selectorMap:     (profileRow?.selectorMap as unknown as SiteProfile['selectorMap']) ?? {},
    discoveredPages: [],
  };
  const selectorMap = siteProfile.selectorMap;

  // Watchdog: regenerate variants for ANY running hypothesis stuck with <2
  // variants. With parallel per-page testing several can be running at once.
  const stuck = await prisma.hypothesis.findMany({
    where: { experimentId: exp.id, status: 'running' },
    include: { variants: true },
  });
  for (const hyp of stuck) {
    if (hyp.variants.length >= 2) continue;
    console.warn(`[Loop] Hypothesis ${hyp.id} (page ${hyp.pageUrl ?? hyp.pagePath}) running with ${hyp.variants.length} variants — regenerating`);
    const ok = await generateVariantsFor(exp.siteId, exp.id, siteProfile, selectorMap, hyp.id);
    if (!ok) {
      console.error(`[Loop] Variant recovery failed for hypothesis ${hyp.id} — reverting to queued`);
      await prisma.hypothesis.update({ where: { id: hyp.id }, data: { status: 'queued' } });
    }
  }

  // Evaluate each page independently. A page's running hypothesis is scored only
  // when its OWN variants have enough data, and a pending winner PR holds only
  // that page — never the whole experiment.
  const running = await prisma.hypothesis.findMany({
    where: { experimentId: exp.id, status: 'running' },
    include: { variants: true },
  });

  for (const hyp of running) {
    const pageLabel = hyp.pageUrl ?? hyp.pagePath;

    // Per-page pending-PR gate (autoMerge off): hold this page until its last
    // shipped winner is merged + deployed so the new baseline reflects it.
    if (!site.autoMerge && site.githubToken && site.githubRepo) {
      const pagePR = await prisma.hypothesis.findFirst({
        where: {
          experimentId: exp.id, status: 'completed',
          prNumber: { not: null }, prUrl: { not: null },
          pageUrl: hyp.pageUrl ?? null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (pagePR?.prNumber) {
        const merged = await isPRMerged(decryptSecret(site.githubToken)!, site.githubRepo, pagePR.prNumber);
        if (!merged) continue; // hold just this page
      }
    }

    // Readiness for THIS hypothesis's variants only — no cross-page bleed.
    const ready = hyp.variants.length >= 2 && hyp.variants.every(v => v.impressions >= MIN_IMPRESSIONS);
    if (!ready) continue;

    console.log(`[Loop] Experiment ${exp.id} page ${pageLabel} — hypothesis ${hyp.id} ready, evaluating`);

    await evalGraph.invoke({
      siteId:        exp.siteId,
      experimentId:  exp.id,
      profile:       siteProfile,
      hypothesisIds: [hyp.id],
      cycleCount:    exp.cycleCount,
      selectorMap,
      targetPageUrl: hyp.pageUrl ?? undefined,
    });

    // Promote the next queued hypothesis for THIS page only.
    const nextQueued = await prisma.hypothesis.findFirst({
      where: { experimentId: exp.id, status: 'queued', pageUrl: hyp.pageUrl ?? null },
      orderBy: { id: 'asc' },
    });
    if (nextQueued) {
      console.log(`[Loop] Promoting hypothesis ${nextQueued.id} (page ${pageLabel}) to running`);
      await prisma.hypothesis.update({ where: { id: nextQueued.id }, data: { status: 'running' } });
      const ok = await generateVariantsFor(exp.siteId, exp.id, siteProfile, selectorMap, nextQueued.id);
      if (!ok) {
        console.error(`[Loop] Variant gen failed for hypothesis ${nextQueued.id} — reverting to queued`);
        await prisma.hypothesis.update({ where: { id: nextQueued.id }, data: { status: 'queued' } });
      }
    }
  }

  // Experiment-level completion: only when no page has running or queued work.
  const remaining = await prisma.hypothesis.count({
    where: { experimentId: exp.id, status: { in: ['running', 'queued'] } },
  });
  if (remaining > 0) return;

  const pause = await shouldPause(exp.id);
  if (pause) {
    console.log(`[Loop] Experiment ${exp.id} — low lift over last 3 tests, pausing`);
    await prisma.experiment.update({ where: { id: exp.id }, data: { status: 'completed' } });
    return;
  }

  // Enter cooldown before re-analyzing
  const cooldownUntil = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  console.log(`[Loop] Experiment ${exp.id} complete — cooldown until ${cooldownUntil.toISOString()}`);
  await prisma.experiment.update({ where: { id: exp.id }, data: { status: 'cooldown', cooldownUntil } });
}
