import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { prisma } from '../prisma';
import { analyzeSite, crawlPageElements, SiteProfile } from './analyzer';
import { generateHypotheses, Hypothesis } from './hypothesis';
import { generateVariantPair } from './variants';
import { evaluateHypothesis } from './winner';
import { storeOutcome } from './memory';
import { createWinnerPR } from './patcher';
import { injectTrackerPR } from './injector';

// ── State ─────────────────────────────────────────────────────────────────────

const AgentState = Annotation.Root({
  siteId:        Annotation<string>({ reducer: (_, b) => b }),
  experimentId:  Annotation<number>({ reducer: (_, b) => b }),
  profile:       Annotation<SiteProfile | null>({ reducer: (_, b) => b, default: () => null }),
  hypothesisIds: Annotation<number[]>({ reducer: (_, b) => b, default: () => [] }),
  cycleCount:    Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  selectorMap:   Annotation<Record<string, { cssSelector: string; tagName: string; textContent: string; position: number }>>({ reducer: (_, b) => b, default: () => ({}) }),
});

type State = typeof AgentState.State;

// ── Node: Analyze ─────────────────────────────────────────────────────────────

async function analyzeNode(state: State): Promise<Partial<State>> {
  console.log(`[Agent] analyze — experiment ${state.experimentId}`);

  const site = await prisma.site.findUnique({ where: { id: state.siteId } });
  if (!site) throw new Error(`Site ${state.siteId} not found`);

  const profile = await analyzeSite(site.url);

  // Upsert site profile
  await prisma.siteProfile.upsert({
    where: { siteId: state.siteId },
    create: {
      siteId:         state.siteId,
      theme:          profile.theme,
      tone:           profile.tone,
      primaryColors:  profile.primaryColors,
      fontStyle:      profile.fontStyle,
      layoutPattern:  profile.layoutPattern,
      targetAudience: profile.targetAudience,
      conversionGoal: profile.conversionGoal,
      copy:           profile.copy,
      weaknesses:     profile.weaknesses,
      selectorMap:    profile.selectorMap as any,
      screenshotB64:  profile.screenshotBase64,
    },
    update: {
      theme:          profile.theme,
      tone:           profile.tone,
      primaryColors:  profile.primaryColors,
      fontStyle:      profile.fontStyle,
      layoutPattern:  profile.layoutPattern,
      targetAudience: profile.targetAudience,
      conversionGoal: profile.conversionGoal,
      copy:           profile.copy,
      weaknesses:     profile.weaknesses,
      selectorMap:    profile.selectorMap as any,
      screenshotB64:  profile.screenshotBase64,
      analyzedAt:     new Date(),
    },
  });

  await prisma.experiment.update({
    where: { id: state.experimentId },
    data: { status: 'running' },
  });

  // Store discovered pages ranked by conversion importance
  for (const dp of profile.discoveredPages) {
    await prisma.discoveredPage.upsert({
      where:  { siteId_path: { siteId: state.siteId, path: dp.path } },
      create: { siteId: state.siteId, url: dp.url, path: dp.path, importance: dp.importance, category: dp.category },
      update: { importance: dp.importance, category: dp.category },
    });
  }

  return { profile, selectorMap: profile.selectorMap };
}

// ── Node: Hypothesize ─────────────────────────────────────────────────────────

async function hypothesizeNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] hypothesize');

  // Root page hypotheses (path = '/')
  const rootHypotheses = await generateHypotheses(state.profile!);

  // Crawl high-priority discovered pages and generate hypotheses for each
  const topPages = await prisma.discoveredPage.findMany({
    where:   { siteId: state.siteId, importance: { gte: 7 }, status: 'pending' },
    orderBy: { importance: 'desc' },
    take:    3,
  });

  const pageHypotheses: Hypothesis[] = [];
  for (const dp of topPages) {
    console.log(`[Agent] Crawling high-priority page: ${dp.url}`);
    try {
      const { title, selectorMap } = await crawlPageElements(dp.url);
      if (Object.keys(selectorMap).length === 0) continue;

      await prisma.discoveredPage.update({
        where: { id: dp.id },
        data:  { selectorMap: selectorMap as any, title, status: 'analyzing' },
      });

      const hyps = await generateHypotheses(state.profile!, { path: dp.path, selectorMap });
      pageHypotheses.push(...hyps);
    } catch (err) {
      console.warn(`[Agent] Failed to crawl ${dp.url}:`, (err as Error).message);
    }
  }

  // Merge and sort by priority — highest impact test runs first
  const all = [...rootHypotheses, ...pageHypotheses]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const ids: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const h = all[i];
    const record = await prisma.hypothesis.create({
      data: {
        experimentId:    state.experimentId,
        description:     h.description,
        elementSelector: h.elementSelector,
        rationale:       h.rationale,
        pagePath:        h.pagePath ?? '/',
        status: i === 0 ? 'running' : 'queued',
      },
    });
    ids.push(record.id);
  }

  // Mark crawled pages as testing
  for (const dp of topPages) {
    await prisma.discoveredPage.update({
      where: { id: dp.id },
      data:  { status: 'testing' },
    }).catch(() => {});
  }

  return { hypothesisIds: ids };
}

// ── Node: Generate Variants ───────────────────────────────────────────────────

async function generateVariantsNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] generate_variants');

  // Only generate variants for the running hypothesis
  const running = await prisma.hypothesis.findFirst({
    where: { experimentId: state.experimentId, status: 'running' },
  });
  if (!running) return {};

  // Resolve trackId → CSS selector from the state's selector map
  const selectorEntry = state.selectorMap[running.elementSelector];
  const cssSelector   = selectorEntry?.cssSelector ?? running.elementSelector;

  const existing = await prisma.pageElement.findFirst({
    where: {
      siteId: state.siteId,
      OR: [
        { domId:   { contains: cssSelector } },
        { classes: { contains: cssSelector.replace(/^[a-z]+\./, '') } },
        { tag:     selectorEntry?.tagName ?? running.elementSelector },
      ],
    },
  });

  const currentHtml = existing?.outerHTML
    ?? `<${selectorEntry?.tagName ?? 'div'} data-track="${running.elementSelector}">${selectorEntry?.textContent ?? ''}</${selectorEntry?.tagName ?? 'div'}>`;

  const pair = await generateVariantPair(
    state.profile!,
    { description: running.description, elementSelector: running.elementSelector, rationale: running.rationale, priority: 5, pagePath: running.pagePath ?? '/' },
    currentHtml,
  );

  await prisma.variant.createMany({
    data: [
      { name: 'Control (A)',    elementId: running.elementSelector, version: 1, html: pair.controlHtml,    css: pair.controlCss,    hypothesisId: running.id },
      { name: 'Challenger (B)', elementId: running.elementSelector, version: 2, html: pair.challengerHtml, css: pair.challengerCss, hypothesisId: running.id },
    ],
  });

  return {};
}

// ── Node: Evaluate ────────────────────────────────────────────────────────────

async function evaluateNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] evaluate');

  const running = await prisma.hypothesis.findFirst({
    where: { experimentId: state.experimentId, status: 'running' },
  });
  if (!running) return {};

  await evaluateHypothesis(running.id, state.profile!);
  return {};
}

// ── Node: Create PR ───────────────────────────────────────────────────────────

async function createPRNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] create_pr');

  const site = await prisma.site.findUnique({ where: { id: state.siteId } });
  if (!site?.githubRepo || !site?.githubToken) return {};

  // Find the most recently completed hypothesis without a PR
  const hyp = await prisma.hypothesis.findFirst({
    where: { experimentId: state.experimentId, status: 'completed', prUrl: null },
    include: { variants: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!hyp) return {};

  const winner = hyp.variants.find(v => v.id === hyp.winnerId);
  const loser  = hyp.variants.find(v => v.id !== hyp.winnerId);
  if (!winner || !loser) return {};

  const ctrWinner = winner.impressions > 0 ? winner.clicks / winner.impressions : 0;
  const ctrLoser  = loser.impressions  > 0 ? loser.clicks  / loser.impressions  : 0;
  const liftPct   = ctrLoser > 0 ? ((ctrWinner - ctrLoser) / ctrLoser) * 100 : 0;

  const result = await createWinnerPR({
    token:           site.githubToken,
    repo:            site.githubRepo,
    hypothesisId:    hyp.id,
    description:     hyp.description,
    elementSelector: hyp.elementSelector,
    winnerHtml:      winner.html,
    winnerCss:       winner.css,
    liftPct,
    ctrA: winner.version === 1 ? ctrWinner : ctrLoser,
    ctrB: winner.version === 2 ? ctrWinner : ctrLoser,
    impressionsA: winner.version === 1 ? winner.impressions : loser.impressions,
    impressionsB: winner.version === 2 ? winner.impressions : loser.impressions,
    autoMerge: site.autoMerge,
  });

  if (result) {
    await prisma.hypothesis.update({
      where: { id: hyp.id },
      data: { prUrl: result.prUrl, prNumber: result.prNumber, liftPct },
    });
    console.log(`[Agent] PR created: ${result.prUrl}`);
  }

  return {};
}

// ── Node: Learn ───────────────────────────────────────────────────────────────

async function learnNode(state: State): Promise<Partial<State>> {
  console.log(`[Agent] learn — cycle ${state.cycleCount}`);

  const hypotheses = await prisma.hypothesis.findMany({
    where: { experimentId: state.experimentId, status: 'completed' },
    include: { variants: true },
  });

  for (const hyp of hypotheses) {
    const winner = hyp.variants.find(v => v.id === hyp.winnerId);
    const loser  = hyp.variants.find(v => v.id !== hyp.winnerId);
    if (!winner || !loser) continue;

    const wCtr = winner.impressions > 0 ? winner.clicks / winner.impressions : 0;
    const lCtr = loser.impressions  > 0 ? loser.clicks  / loser.impressions  : 0;
    const improvement = lCtr > 0 ? ((wCtr - lCtr) / lCtr) * 100 : 0;

    const site = await prisma.site.findUnique({ where: { id: state.siteId } });

    await storeOutcome({
      id:             `hyp-${hyp.id}-cycle-${state.cycleCount}`,
      url:            state.profile!.url,
      siteType:       `${state.profile!.theme}, ${state.profile!.tone}`,
      hypothesis:     hyp.description,
      elementType:    hyp.elementSelector,
      change:         `${winner.name} won — CTR ${(wCtr * 100).toFixed(2)}%`,
      ctrImprovement: improvement,
      impressions:    winner.impressions + loser.impressions,
    });

    // If GitHub is configured, store lift on hypothesis for dashboard
    if (site?.githubRepo && hyp.liftPct === null) {
      await prisma.hypothesis.update({
        where: { id: hyp.id },
        data: { liftPct: improvement },
      });
    }
  }

  return {};
}

// ── Node: Inject Tracker ──────────────────────────────────────────────────────

async function injectTrackerNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] inject_tracker');

  const site = await prisma.site.findUnique({ where: { id: state.siteId } });
  if (!site?.githubRepo || !site?.githubToken) return {};
  if (site.trackerInjected || site.trackerPrNumber) return {}; // already done

  const result = await injectTrackerPR({
    token:  site.githubToken,
    repo:   site.githubRepo,
    siteId: state.siteId,
  });

  if (result) {
    await prisma.site.update({
      where: { id: state.siteId },
      data:  { trackerPrUrl: result.prUrl, trackerPrNumber: result.prNumber },
    });
    console.log(`[Agent] Tracker PR opened: ${result.prUrl}`);
  }

  return {};
}

// ── Graphs ────────────────────────────────────────────────────────────────────

// Setup graph: analyze → hypothesize → generate_variants → inject_tracker
export const setupGraph = new StateGraph(AgentState)
  .addNode('analyze',           analyzeNode)
  .addNode('hypothesize',       hypothesizeNode)
  .addNode('generate_variants', generateVariantsNode)
  .addNode('inject_tracker',    injectTrackerNode)
  .addEdge(START,               'analyze')
  .addEdge('analyze',           'hypothesize')
  .addEdge('hypothesize',       'generate_variants')
  .addEdge('generate_variants', 'inject_tracker')
  .addEdge('inject_tracker',    END)
  .compile();

// Eval graph: evaluate → create_pr → learn
// Triggered by the background loop when the active hypothesis has enough data
export const evalGraph = new StateGraph(AgentState)
  .addNode('evaluate',   evaluateNode)
  .addNode('create_pr',  createPRNode)
  .addNode('learn',      learnNode)
  .addEdge(START,        'evaluate')
  .addEdge('evaluate',   'create_pr')
  .addEdge('create_pr',  'learn')
  .addEdge('learn',      END)
  .compile();

// Variant-gen graph: called when a queued hypothesis is promoted to running
export const variantGraph = new StateGraph(AgentState)
  .addNode('generate_variants', generateVariantsNode)
  .addEdge(START,               'generate_variants')
  .addEdge('generate_variants', END)
  .compile();
