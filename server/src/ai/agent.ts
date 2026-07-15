import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { prisma } from '../prisma';
import { analyzeSite, crawlPageElements, SiteProfile, SelectorEntry } from './analyzer';
import { generateHypotheses, Hypothesis } from './hypothesis';
import { generateVariantPair } from './variants';
import { evaluateHypothesis } from './winner';
import { storeOutcome } from './memory';
import { createWinnerPR } from './patcher';
import { injectTrackerPR } from './injector';
import { evaluateAB } from './stats';
import { ingestRepo, ComponentEntry } from './ingest';
import { getBehaviorSignals } from './behavior';
import { decryptSecret } from '../crypto';

// ── State ─────────────────────────────────────────────────────────────────────

const AgentState = Annotation.Root({
  siteId:        Annotation<string>({ reducer: (_, b) => b }),
  experimentId:  Annotation<number>({ reducer: (_, b) => b }),
  profile:       Annotation<SiteProfile | null>({ reducer: (_, b) => b, default: () => null }),
  hypothesisIds: Annotation<number[]>({ reducer: (_, b) => b, default: () => [] }),
  cycleCount:    Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  selectorMap:   Annotation<Record<string, SelectorEntry>>({ reducer: (_, b) => b, default: () => ({}) }),
  // When set, the eval node only evaluates the running hypothesis on this page
  // (lets the loop run evalGraph independently per page).
  targetPageUrl: Annotation<string | undefined>({ reducer: (_, b) => b, default: () => undefined }),
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

  // Store discovered pages ranked by conversion importance. Reset status to
  // 'pending' on re-analysis so each new cycle re-crawls them (pages change,
  // and the crawl node only picks up 'pending' pages).
  for (const dp of profile.discoveredPages) {
    await prisma.discoveredPage.upsert({
      where:  { siteId_path: { siteId: state.siteId, path: dp.path } },
      create: { siteId: state.siteId, url: dp.url, path: dp.path, importance: dp.importance, category: dp.category },
      update: { importance: dp.importance, category: dp.category, status: 'pending' },
    });
  }

  return { profile, selectorMap: profile.selectorMap };
}

// ── Node: Crawl discovered pages ──────────────────────────────────────────────
// analyzeNode discovers internal pages but doesn't visit them. This node crawls
// the highest-value ones (importance ≥ 4, capped) to capture each page's own
// selectorMap, so hypotheses can target secondary pages too. Per-page try/catch
// means one bad page never blocks the rest.

const CRAWL_MIN_IMPORTANCE = 4;
const CRAWL_MAX_PAGES = 5;

async function crawlDiscoveredPagesNode(state: State): Promise<Partial<State>> {
  const pages = await prisma.discoveredPage.findMany({
    where:   { siteId: state.siteId, importance: { gte: CRAWL_MIN_IMPORTANCE }, status: 'pending' },
    orderBy: { importance: 'desc' },
    take:    CRAWL_MAX_PAGES,
  });

  if (pages.length === 0) return {};
  console.log(`[Agent] crawl_discovered_pages — ${pages.length} page(s)`);

  for (const dp of pages) {
    try {
      const { title, selectorMap } = await crawlPageElements(dp.url);
      if (Object.keys(selectorMap).length === 0) {
        // Nothing trackable here — don't waste a future cycle re-crawling.
        await prisma.discoveredPage.update({ where: { id: dp.id }, data: { status: 'done' } }).catch(() => {});
        continue;
      }
      await prisma.discoveredPage.update({
        where: { id: dp.id },
        data:  { selectorMap: selectorMap as any, title, status: 'analyzing' },
      });
    } catch (err) {
      // Leave as pending so a later cycle can retry; failure is isolated.
      console.warn(`[Agent] Failed to crawl ${dp.url}:`, (err as Error).message);
    }
  }

  return {};
}

// ── Node: Ingest (AST) ────────────────────────────────────────────────────────
// For AST-capable repos, map tracked elements to their real source JSX nodes so
// the patcher can write a true source diff. No-op (empty map) for crawl-only
// sites — the rest of the pipeline is unchanged.

async function ingestNode(state: State): Promise<Partial<State>> {
  const site = await prisma.site.findUnique({ where: { id: state.siteId } });
  if (!site?.githubRepo || !site?.githubToken) return {};
  if (site.ingestMode === 'crawl') return {}; // ingestion explicitly disabled for this site

  console.log(`[Agent] ingest — mode=${site.ingestMode}`);

  try {
    const componentMap = await ingestRepo({
      token:       decryptSecret(site.githubToken)!,
      repo:        site.githubRepo,
      selectorMap: state.selectorMap,
    });

    if (Object.keys(componentMap).length > 0) {
      await prisma.siteProfile.update({
        where: { siteId: state.siteId },
        data:  { componentMap: componentMap as any },
      });
    }
  } catch (err) {
    // Ingestion is best-effort — failure just means we use the crawl path.
    console.warn('[Agent] ingest failed, using crawl path:', (err as Error).message);
  }

  return {};
}

// ── Node: Hypothesize ─────────────────────────────────────────────────────────

async function hypothesizeNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] hypothesize');

  const site = await prisma.site.findUnique({ where: { id: state.siteId } });
  const primaryUrl = site?.url ?? state.profile!.url;

  // Pages already crawled by crawlDiscoveredPagesNode (have their own selectorMap).
  const crawled = await prisma.discoveredPage.findMany({
    where:   { siteId: state.siteId, status: 'analyzing' },
    orderBy: { importance: 'desc' },
  });

  // Page targets: the primary connected URL (root selectorMap) + each crawled page.
  type PageTarget = { path: string; url: string; selectorMap?: Record<string, SelectorEntry> };
  const targets: PageTarget[] = [
    { path: '/', url: primaryUrl }, // undefined selectorMap → generateHypotheses uses profile.selectorMap
    ...crawled.map(dp => ({
      path: dp.path,
      url:  dp.url,
      selectorMap: dp.selectorMap as unknown as Record<string, SelectorEntry>,
    })),
  ];

  const ids: number[] = [];

  // Generate hypotheses per page independently. The global SiteProfile (theme,
  // tone, conversionGoal …) is always passed so the LLM has brand context even
  // for secondary pages. The top hypothesis of EACH page starts running so pages
  // are tested in parallel; the rest queue behind their own page.
  for (const target of targets) {
    // Real behavior telemetry for this page (rage/dead clicks, scroll depth) so
    // hypotheses target observed friction, not just the static screenshot.
    const signals = await getBehaviorSignals(state.siteId, target.path);

    let hyps: Hypothesis[];
    if (target.path === '/') {
      hyps = await generateHypotheses(state.profile!, undefined, signals);
    } else {
      if (!target.selectorMap || Object.keys(target.selectorMap).length === 0) continue;
      hyps = await generateHypotheses(state.profile!, { path: target.path, selectorMap: target.selectorMap }, signals);
    }

    hyps.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (let i = 0; i < hyps.length; i++) {
      const h = hyps[i];
      const record = await prisma.hypothesis.create({
        data: {
          experimentId:    state.experimentId,
          description:     h.description,
          elementSelector: h.elementSelector,
          rationale:       h.rationale,
          pagePath:        h.pagePath ?? target.path,
          pageUrl:         target.url,
          status:          i === 0 ? 'running' : 'queued',
        },
      });
      ids.push(record.id);
    }
  }

  // Crawled pages now have hypotheses queued/running against them.
  await prisma.discoveredPage.updateMany({
    where: { siteId: state.siteId, status: 'analyzing' },
    data:  { status: 'testing' },
  });

  return { hypothesisIds: ids };
}

// ── Node: Generate Variants ───────────────────────────────────────────────────

async function generateVariantsNode(state: State): Promise<Partial<State>> {
  console.log('[Agent] generate_variants');

  // Generate variants for EVERY running hypothesis that lacks a full pair.
  // With parallel per-page testing there can be several running at once (one
  // per page); this node is idempotent and safe to call repeatedly.
  const runningList = await prisma.hypothesis.findMany({
    where: { experimentId: state.experimentId, status: 'running' },
    include: { variants: true },
  });

  // Cache per-page selectorMaps so we don't refetch DiscoveredPage per hypothesis.
  const pageMaps = new Map<string, Record<string, SelectorEntry>>();

  for (const running of runningList) {
    // Idempotency: skip complete pairs; clear partial sets before regenerating.
    if (running.variants.length >= 2) continue;
    if (running.variants.length > 0) {
      await prisma.variant.deleteMany({ where: { hypothesisId: running.id } });
    }

    const selectorMap = await resolvePageSelectorMap(state, running.pagePath, pageMaps);

    const selectorEntry = selectorMap[running.elementSelector];
    const cssSelector   = selectorEntry?.cssSelector ?? running.elementSelector;

    // Prefer the real outerHTML captured during the crawl so the model redesigns
    // the actual element rather than a synthesized skeleton. Fall back to a
    // stored PageElement, then to a minimal skeleton as a last resort.
    let currentHtml = selectorEntry?.outerHTML;

    if (!currentHtml) {
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
      currentHtml = existing?.outerHTML
        ?? `<${selectorEntry?.tagName ?? 'div'} data-track="${running.elementSelector}">${selectorEntry?.textContent ?? ''}</${selectorEntry?.tagName ?? 'div'}>`;
    }

    // Surrounding section context so the challenger's colors/contrast fit the
    // section it lives in (e.g. a button inside a dark gradient hero).
    const parentHtml = findParentContext(selectorMap, running.elementSelector, currentHtml);

    const pair = await generateVariantPair(
      state.profile!,
      { description: running.description, elementSelector: running.elementSelector, rationale: running.rationale, priority: 5, pagePath: running.pagePath ?? '/' },
      currentHtml,
      parentHtml,
    );

    await prisma.variant.createMany({
      data: [
        { name: 'Control (A)',    elementId: running.elementSelector, version: 1, html: pair.controlHtml,    css: pair.controlCss,    hypothesisId: running.id },
        { name: 'Challenger (B)', elementId: running.elementSelector, version: 2, html: pair.challengerHtml, css: pair.challengerCss, hypothesisId: running.id },
      ],
    });
  }

  return {};
}

// Section-like tracked elements that can serve as a parent context for the LLM.
const CONTEXT_PREFIXES = ['hero-section', 'cta-section', 'pricing', 'navigation'];

// Find the surrounding section's outerHTML for an element. Prefers a section
// whose markup actually contains the element (true ancestor), then falls back to
// the first hero/CTA section on the page. Returns '' when nothing fits.
function findParentContext(
  selectorMap: Record<string, SelectorEntry>,
  trackId: string,
  elementHtml: string,
): string {
  const needle = (elementHtml ?? '').trim().slice(0, 60);

  if (needle) {
    for (const [id, entry] of Object.entries(selectorMap)) {
      if (id === trackId) continue;
      if (!CONTEXT_PREFIXES.some(p => id.startsWith(p))) continue;
      if (entry.outerHTML && entry.outerHTML.includes(needle)) return entry.outerHTML;
    }
  }

  for (const prefix of CONTEXT_PREFIXES) {
    const id = Object.keys(selectorMap).find(k => k.startsWith(prefix));
    if (id && selectorMap[id]?.outerHTML) return selectorMap[id].outerHTML!;
  }

  return '';
}

// Resolve the selectorMap for a hypothesis's page: the root profile map for '/',
// otherwise the crawled DiscoveredPage's own map (so secondary-page variants use
// the right element's real outerHTML, not the root page's).
async function resolvePageSelectorMap(
  state: State,
  pagePath: string,
  cache: Map<string, Record<string, SelectorEntry>>,
): Promise<Record<string, SelectorEntry>> {
  if (!pagePath || pagePath === '/') return state.selectorMap;
  if (cache.has(pagePath)) return cache.get(pagePath)!;

  const dp = await prisma.discoveredPage.findUnique({
    where: { siteId_path: { siteId: state.siteId, path: pagePath } },
  });
  const map = (dp?.selectorMap as unknown as Record<string, SelectorEntry>) ?? state.selectorMap;
  cache.set(pagePath, map);
  return map;
}

// ── Node: Evaluate ────────────────────────────────────────────────────────────

async function evaluateNode(state: State): Promise<Partial<State>> {
  console.log(`[Agent] evaluate${state.targetPageUrl ? ` — page ${state.targetPageUrl}` : ''}`);

  // When targetPageUrl is set, evaluate only that page's running hypothesis so
  // pages are scored independently and impressions never bleed across pages.
  const running = await prisma.hypothesis.findFirst({
    where: {
      experimentId: state.experimentId,
      status: 'running',
      ...(state.targetPageUrl ? { pageUrl: state.targetPageUrl } : {}),
    },
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

  const control    = hyp.variants.find(v => v.version === 1);
  const challenger = hyp.variants.find(v => v.version === 2);
  if (!control || !challenger) return {};

  // Re-evaluate from the raw counts and only ship when the challenger (B)
  // significantly beat the control (A) by at least the minimum lift. Control
  // wins, ties, and non-significant results never produce a PR — we keep the
  // existing design.
  const ab = evaluateAB(control.clicks, control.impressions, challenger.clicks, challenger.impressions);

  if (!ab.shipChallenger) {
    console.log(
      `[Agent] No PR — challenger not a significant winner ` +
      `(winner=${ab.winner ?? 'none'} significant=${ab.significant} lift=${ab.liftPct.toFixed(1)}%)`,
    );
    return {};
  }

  // If ingestion mapped this element to a source node, patch it via AST.
  const profile = await prisma.siteProfile.findUnique({ where: { siteId: state.siteId } });
  const componentMap = (profile?.componentMap as Record<string, ComponentEntry> | null) ?? {};
  const astEntry = componentMap[hyp.elementSelector];

  const result = await createWinnerPR({
    token:           decryptSecret(site.githubToken)!,
    repo:            site.githubRepo,
    hypothesisId:    hyp.id,
    description:     hyp.description,
    elementSelector: hyp.elementSelector,
    winnerHtml:      challenger.html,
    winnerCss:       challenger.css,
    liftPct:         ab.liftPct,
    ctrA:            ab.rateA,
    ctrB:            ab.rateB,
    impressionsA:    control.impressions,
    impressionsB:    challenger.impressions,
    confidencePct:   ab.confidencePct,
    autoMerge:       site.autoMerge,
    astTarget:       astEntry ? { filePath: astEntry.filePath, signature: astEntry.signature } : undefined,
  });

  if (result) {
    await prisma.hypothesis.update({
      where: { id: hyp.id },
      data: { prUrl: result.prUrl, prNumber: result.prNumber, liftPct: ab.liftPct },
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
    token:  decryptSecret(site.githubToken)!,
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

// Setup graph: analyze → crawl_discovered_pages → ingest → hypothesize → generate_variants → inject_tracker
export const setupGraph = new StateGraph(AgentState)
  .addNode('analyze',                analyzeNode)
  .addNode('crawl_discovered_pages', crawlDiscoveredPagesNode)
  .addNode('ingest',                 ingestNode)
  .addNode('hypothesize',            hypothesizeNode)
  .addNode('generate_variants',      generateVariantsNode)
  .addNode('inject_tracker',         injectTrackerNode)
  .addEdge(START,                    'analyze')
  .addEdge('analyze',                'crawl_discovered_pages')
  .addEdge('crawl_discovered_pages', 'ingest')
  .addEdge('ingest',                 'hypothesize')
  .addEdge('hypothesize',            'generate_variants')
  .addEdge('generate_variants',      'inject_tracker')
  .addEdge('inject_tracker',         END)
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
