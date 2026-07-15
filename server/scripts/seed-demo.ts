/**
 * seed-demo.ts — builds a self-contained demo for a prototype video.
 *
 * It runs the REAL setup pipeline (analyze → hypothesize → generate variants)
 * against the throwaway demo site on http://localhost:4000, then seeds realistic
 * A/B traffic so the genuine two-proportion z-test in stats.ts produces a
 * statistically significant winner. No GitHub credentials required — the PR is
 * represented by a believable URL (swap in a real one if you wire up a repo).
 *
 * Run:  npx ts-node scripts/seed-demo.ts
 */
import 'dotenv/config';
import { prisma } from '../src/prisma';
import { hashPassword } from '../src/auth';
import { startExperimentCycle } from '../src/ai/loop';
import { evaluateAB } from '../src/ai/stats';

const DEMO_EMAIL = 'demo@visus.dev';
const DEMO_PASSWORD = 'demo1234';
const SITE_URL = 'http://localhost:4000';
const DEMO_REPO = 'brightledger/website';

// Seeded traffic — ~32% relative CTR lift, ~99% confidence (clearly ships).
const A_IMP = 1240, A_CLICKS = 137;   // control  ≈ 11.0% CTR
const B_IMP = 1180, B_CLICKS = 172;   // challenger ≈ 14.6% CTR

async function main() {
  console.log('▸ Seeding Visus demo…');

  // 1. Demo user
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, name: 'Demo User', passwordHash },
    update: { passwordHash },
  });
  console.log(`  user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

  // 2. Site (no GitHub token needed for the seed; repo string is for display)
  const site = await prisma.site.upsert({
    where: { url: SITE_URL },
    create: { url: SITE_URL, ownerId: user.id, githubRepo: DEMO_REPO },
    update: { ownerId: user.id, githubRepo: DEMO_REPO, trackerInjected: false },
  });

  // 3. Clean any prior experiments for a repeatable demo
  const old = await prisma.experiment.findMany({ where: { siteId: site.id }, select: { id: true } });
  const oldIds = old.map(e => e.id);
  if (oldIds.length) {
    const hyps = await prisma.hypothesis.findMany({ where: { experimentId: { in: oldIds } }, select: { id: true } });
    await prisma.variant.deleteMany({ where: { hypothesisId: { in: hyps.map(h => h.id) } } });
    await prisma.hypothesis.deleteMany({ where: { experimentId: { in: oldIds } } });
    await prisma.experiment.deleteMany({ where: { id: { in: oldIds } } });
    console.log(`  cleaned ${oldIds.length} prior experiment(s)`);
  }

  // 4. Run the REAL pipeline (analyze + hypothesize + variants). inject_tracker
  //    no-ops because there's no GitHub token on the site.
  console.log('  running real setup pipeline (Gemini vision + variant gen)… this can take ~30–60s');
  const experimentId = await startExperimentCycle(site.id);

  // 5. Find the running hypothesis (the one setup gave variants to)
  const hyps = await prisma.hypothesis.findMany({
    where: { experimentId },
    orderBy: { id: 'asc' },
    include: { variants: { orderBy: { version: 'asc' } } },
  });
  const winnerHyp = hyps.find(h => h.variants.length >= 2);
  if (!winnerHyp) {
    console.error('  ✗ No hypothesis got an A/B pair — variant generation may have failed. Hypotheses:',
      hyps.map(h => `${h.id}:${h.status}:${h.variants.length}v`).join(', '));
    throw new Error('Variant generation produced no A/B pair; cannot seed a winner.');
  }

  const a = winnerHyp.variants.find(v => v.version === 1)!;
  const b = winnerHyp.variants.find(v => v.version === 2)!;

  // 6. Seed traffic and let the REAL stats engine decide the winner
  const result = evaluateAB(A_CLICKS, A_IMP, B_CLICKS, B_IMP);
  console.log(`  stats: winner=${result.winner} lift=${result.liftPct.toFixed(1)}% ` +
    `p=${result.pValue.toFixed(4)} confidence=${result.confidencePct.toFixed(1)}% ship=${result.shipChallenger}`);

  await prisma.variant.update({ where: { id: a.id }, data: { impressions: A_IMP, clicks: A_CLICKS } });
  await prisma.variant.update({ where: { id: b.id }, data: { impressions: B_IMP, clicks: B_CLICKS } });

  await prisma.hypothesis.update({
    where: { id: winnerHyp.id },
    data: {
      status: 'completed',
      winnerId: result.winner === 'B' ? b.id : a.id,
      liftPct: result.liftPct,
      prNumber: 42,
      prUrl: `https://github.com/${DEMO_REPO}/pull/42`,
    },
  });

  // 7. Stable demo state: experiment running, tracker "live", remaining queued.
  await prisma.site.update({ where: { id: site.id }, data: { trackerInjected: true } });
  await prisma.experiment.update({ where: { id: experimentId }, data: { status: 'running', cycleCount: 1 } });

  const queued = hyps.filter(h => h.id !== winnerHyp.id);
  console.log('\n✓ Demo ready.');
  console.log(`  experiment #${experimentId}`);
  console.log(`  winner hypothesis: "${winnerHyp.description}" → ${winnerHyp.elementSelector}`);
  console.log(`  queued hypotheses: ${queued.length}`);
  console.log(`\n  Login at http://localhost:3000/login  (${DEMO_EMAIL} / ${DEMO_PASSWORD})`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
