# How Visus Works — Interview Deep Dive

> A complete, end-to-end explanation of the Visus architecture, designed so you can
> confidently answer "walk me through your project" and any follow-up at any depth.

---

## 1. The 30-Second Pitch

**Visus is an autonomous Conversion Rate Optimization (CRO) agent.** You connect a
website (and optionally its GitHub repo). Visus then runs a continuous loop on its
own:

1. **Analyzes** the live site with a headless browser + a vision LLM.
2. **Watches real users** (rage clicks, dead clicks, scroll depth) via an injected tracker.
3. **Hypothesizes** what to change to lift conversions.
4. **Generates** redesigned variants (A = control, B = challenger) with an LLM.
5. **A/B tests** them on real traffic, deduped per visitor.
6. **Decides a winner** with a statistically rigorous two-proportion z-test.
7. **Ships the winner** as a GitHub Pull Request that patches the real source code.
8. **Remembers** every outcome in a vector DB so future hypotheses get smarter.

The key differentiator: it's not a dashboard a human drives — it's a closed feedback
loop that runs forever, gated by statistical significance so it never ships noise.

**One-liner:** *"Visus is a self-driving CRO engineer: it studies a site, tests
improvements on live traffic, and opens a PR with the winning code change — all
autonomously, and only when the result is statistically significant."*

---

## 2. Architecture at a Glance

```
┌─────────────────┐     ┌──────────────────────────────────────────────────┐
│  Client Site    │     │              Visus Backend (Express)               │
│  (any website)  │     │                                                    │
│                 │     │  ┌─────────────┐   ┌──────────────────────────┐    │
│  tracker.js  ───┼─────┼─▶│ Public APIs │   │  Background Loop (leader) │    │
│  - swaps DOM    │     │  │ /tracker    │   │  - polls every 60s        │    │
│  - records      │     │  │ /variant    │   │  - LangGraph state machine│    │
│    imp/clicks   │     │  │ /track      │   └──────────────────────────┘    │
│  - behavior     │     │  └─────────────┘            │                       │
└─────────────────┘     │  ┌─────────────┐            ▼                       │
                        │  │ Dashboard   │   ┌──────────────────────────┐    │
┌─────────────────┐     │  │ APIs (JWT)  │   │  AI Pipeline (nodes)      │    │
│  Next.js Client │─────┼─▶│ /auth /exp  │   │  analyze→crawl→ingest→    │    │
│  - landing page │     │  └─────────────┘   │  hypothesize→variants→    │    │
│  - dashboard    │     │                    │  evaluate→PR→learn        │    │
│  - login/signup │     └────────────────────┼──────────────────────────┼────┘
└─────────────────┘                          │                          │
                          ┌──────────────┐  ┌─────────┐  ┌────────────┐ │
                          │ PostgreSQL   │  │ ChromaDB│  │ Gemini /   │ │
                          │ (Prisma)     │  │ (vectors)│  │ Ollama LLM │ │
                          └──────────────┘  └─────────┘  └────────────┘ │
                                                         ┌────────────┐ │
                                                         │  GitHub PR │◀┘
                                                         └────────────┘
```

### Tech Stack
| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 15, React, Tailwind, Three.js / R3F | Landing page + dashboard; WebGL visuals |
| Backend | Node.js, Express, TypeScript | REST API + background loop |
| Orchestration | **LangGraph** (`@langchain/langgraph`) | State-machine for the AI pipeline |
| LLMs | **Gemini 2.0 Flash** (primary, vision) + **Ollama/llama3** (local fallback) | Quality + resilience + zero-cost fallback |
| Vector memory | **ChromaDB** + `nomic-embed-text` embeddings | Semantic recall of past experiment outcomes |
| Database | **PostgreSQL** via **Prisma** | Relational data + advisory locks for leader election |
| Browser automation | **Playwright** (Chromium headless) | Live site crawl, screenshots, element tagging |
| Source patching | **ts-morph** (AST) + Octokit (GitHub) | Real source diffs in PRs, not regex hacks |
| Auth | JWT + bcrypt | Dashboard login |

> **Deployment note:** The *currently deployed* artifact (on Vercel) is the landing
> page only. The backend + dashboard are a working prototype that runs locally /
> via `docker-compose`. Be upfront about this in an interview — it's a real,
> functioning system but the public deploy is the marketing site.

---

## 3. The Data Model (Prisma / PostgreSQL)

Understanding the schema makes the whole flow click. Key models:

- **User** → owns **Sites** (JWT auth).
- **Site** — the connected website. Holds `url`, optional `githubRepo` + encrypted
  `githubToken`, `autoMerge` flag, `ingestMode` (`auto|crawl|ast`), and tracker
  injection state (`trackerInjected`, `trackerPrNumber`).
- **SiteProfile** — one per site. The LLM's understanding of the site: `theme`,
  `tone`, `primaryColors`, `conversionGoal`, `weaknesses`, plus two critical JSON maps:
  - `selectorMap`: `trackId → { cssSelector, tagName, textContent, position, outerHTML }`
  - `componentMap`: `trackId → { filePath, signature }` (AST source location)
- **Experiment** — a test cycle for a site. Status: `analyzing → running → completed → cooldown`. Has a `cycleCount`.
- **Hypothesis** — one idea to test on a specific page. Status: `queued → running → completed`. Holds the target `elementSelector`, `pageUrl`/`pagePath`, the eventual `winnerId`, `liftPct`, and the resulting `prUrl`/`prNumber`.
- **Variant** — A or B for a hypothesis. Holds `html`, `css`, `version` (1=control, 2=challenger), and the counters `impressions` + `clicks`.
- **DiscoveredPage** — internal pages found during crawl, scored by conversion importance, each with its own `selectorMap`.
- **Session** — raw behavior telemetry (events JSON) per visitor session per page.

**Hierarchy:** `Site → Experiment → Hypothesis → Variant`. Multiple hypotheses run
in **parallel, one per page**, each independently gated on its own data.

---

## 4. The End-to-End Lifecycle

### Phase 0 — Onboarding
A user logs in (JWT), connects a site URL, and optionally a GitHub repo + token
(the token is **encrypted at rest** via `crypto.ts`). `startExperimentCycle()`
creates an `Experiment` and kicks off the setup graph.

### Phase 1 — The Setup Graph (LangGraph)
Defined in `server/src/ai/agent.ts`. A linear state machine:

```
analyze → crawl_discovered_pages → ingest → hypothesize → generate_variants → inject_tracker
```

**`analyze` (`analyzer.ts`)**
- Launches headless Chromium (Playwright), loads the URL.
- Runs `document.querySelectorAll` for a curated list of CRO-relevant elements
  (`TRACK_TARGETS`: h1, CTA buttons, forms, email inputs, hero/pricing/CTA sections, nav).
- Tags each with a stable `data-track="cta-button-0"` id and builds the **selectorMap**.
  Crucially it captures **real `outerHTML`** (capped at 600 chars) so later variant
  generation redesigns the *actual* element, not a synthesized skeleton. It deliberately
  skips hashed/random class names so selectors stay stable across deploys.
- Screenshots the page (JPEG base64) and sends it **+ extracted text to Gemini Flash
  (vision)** which returns a JSON profile: theme, tone, colors, conversion goal,
  weaknesses, etc. Has a hardcoded fallback profile if Gemini fails.
- Discovers internal links and scores them by conversion importance (`PAGE_SCORES`:
  pricing/checkout/signup = 10, blog = 1, etc.).

**`crawl_discovered_pages`** — visits the top-value internal pages (importance ≥ 4,
max 5) and captures each one's own selectorMap, so secondary pages can be tested too.
Per-page try/catch means one broken page never blocks the rest.

**`ingest` (`ingest.ts`)** — *the "real dev tool" upgrade.* For React/Next repos,
it pulls the source via GitHub, parses TSX/JSX with **ts-morph**, and matches each
runtime tracked element to the JSX node that produced it (by tag + text + className
scoring). The result is the **componentMap** (`trackId → { filePath, signature }`),
which later lets the patcher write a true AST source diff. Non-React repos get an
empty map and fall back to the regex patcher — gracefully degraded, never broken.

**`hypothesize` (`hypothesis.ts`)** — for each page (primary + crawled), it:
- Pulls **real behavior signals** for that page (`behavior.ts`).
- Retrieves **similar past experiments** from ChromaDB (`memory.ts`).
- Prompts the LLM (Ollama/llama3) to generate 3 ranked A/B hypotheses, each pinned
  to a valid `trackId`. Robust fallbacks map weaknesses → elements if the LLM output
  is unparseable.
- The **top hypothesis per page starts `running`; the rest `queue`** behind their page.

**`generate_variants` (`variants.ts`)** — for each running hypothesis lacking a pair,
generates Control (A, cleaned-up current) + Challenger (B, redesigned) HTML/CSS.
Quality-ordered fallback chain: **Gemini Flash → llama3 → deterministic string hack**,
so the pipeline never stalls. It feeds the LLM the element's real HTML *plus its parent
section's HTML* so the challenger's colors/contrast fit the surrounding section.
Challenger CSS classes are namespaced `visus-b-` to avoid collisions.

**`inject_tracker` (`injector.ts`)** — opens a GitHub PR that adds `tracker.js` to the
client site. Once merged + deployed, real data starts flowing.

### Phase 2 — Live Measurement (`tracker.js`)
This script runs **on the client's website**. On each page load it:
1. Generates a **stable anonymous visitor id** in localStorage (no PII, no cookies).
2. **Captures behavior**: scroll depth, and classifies every click as `click` /
   `dead_click` (non-interactive target) / `rage_click` (3+ rapid clicks in a tight
   area). Batched and flushed to `/track` on `pagehide`/`visibilitychange` with
   `keepalive` so it survives unload.
3. Fetches the page's selectorMap + active variants from `/tracker/:siteId?path=...`.
4. For each tracked element, deterministically buckets the visitor into A or B using
   an **FNV-1a hash of `visitorId + testKey`**. The testKey includes the variant ids,
   so a *new* hypothesis re-randomizes the visitor instead of inheriting an old split.
5. Swaps in the challenger DOM if bucket B, records an **impression**, and attaches a
   one-time click listener to record a **click**.
6. **Dedup:** impressions and clicks are recorded once per visitor per variant
   (localStorage sets), so impressions approximate *unique visitors*, not page loads.
   Element lookup has a 3-level fallback: CSS selector → tag+text match → positional.

### Phase 3 — The Background Loop (`loop.ts`)
A `setInterval` polling loop (every 60s). Important production-grade details:

- **Leader election via PostgreSQL advisory lock** (`pg_try_advisory_lock`) on a
  dedicated long-lived connection. Only one instance runs the loop; standbys retry
  for failover. This makes horizontal scaling safe.
- **Re-entrancy guard** so a slow poll (LLM calls) never overlaps itself.

Each poll:
1. **Resumes cooled-down experiments** past their 7-day cooldown into a new cycle.
2. For each running experiment:
   - Waits until the **tracker PR is merged** before expecting data.
   - **Watchdog:** regenerates variants for any running hypothesis stuck with <2 variants.
   - **Per-page evaluation:** a page's hypothesis is scored only when *its own* two
     variants each have ≥ 500 impressions (`MIN_IMPRESSIONS_PER_VARIANT`). No
     cross-page bleed.
   - When `autoMerge` is off, it **holds a page until its last shipped winner PR is
     merged** so the new baseline reflects the shipped change.
   - On evaluation, **promotes the next queued hypothesis for that page**.
3. Experiment completes only when no page has running/queued work → enters cooldown.
   If the **last 3 tests all had lift below threshold**, it pauses (diminishing returns).

### Phase 4 — Evaluation & Statistics (`stats.ts` + `winner.ts`)
This is the most interview-worthy module. The **eval graph** runs:
`evaluate → create_pr → learn`.

**The statistics (`stats.ts`)** — the original implementation used a flawed one-sample
z-test that treated the control rate as a *known constant*, ignoring control's own
sampling variance — which **understates standard error and overstates significance**,
i.e. false positives that ship bad changes. The fix is a correct **two-proportion
z-test with pooled variance**:

```
p̂ = (xA + xB) / (nA + nB)
SE = √( p̂(1-p̂) · (1/nA + 1/nB) )
z  = (rateB - rateA) / SE
```

p-value via the Abramowitz & Stegun erf approximation of the normal CDF. A change
ships **only** when **three gates** all pass (`shipChallenger`):
1. Challenger B actually beat control A (B wins ties go to A — never ship on a coin-flip).
2. Result is **statistically significant** (p < 0.05) **and** both variants have ≥ 500 impressions.
3. Relative lift ≥ **2%** (`MIN_LIFT_PCT`) — practical significance, not just statistical.

This is the heart of "it never ships noise." `winner.ts` records the winner + lift
and stores the outcome.

### Phase 5 — Shipping the Win (`patcher.ts` + `ast-patcher.ts`)
`create_pr` re-evaluates from raw counts (defense in depth) and only proceeds if
`shipChallenger` is true. Then it opens a GitHub PR with a 3-tier patch strategy:
1. **AST patch** (best): if `componentMap` mapped the element to a source node,
   ts-morph rewrites the exact JSX node → a real source diff.
2. **Regex patch** (fallback): search repo files for the element and swap it.
3. **Results doc** (last resort): writes `.visus/results/hypothesis-N.md` with the
   winning snippet for manual application.

The PR body includes the impressions/CTR table, lift %, and confidence. `autoMerge`
optionally squash-merges automatically. It's idempotent — reuses an existing branch/PR
rather than erroring each poll.

### Phase 6 — Learning (`memory.ts`)
`learn` stores every completed outcome in **ChromaDB** as a natural-language document
("On a {siteType} site, changing {element} — {change} — improved CTR by {x}%"),
embedded via Ollama's `nomic-embed-text`. Future `hypothesize` runs query this by
semantic similarity (`retrieveSimilar`), so the agent gets smarter across sites and
cycles. Lift is only credited when statistically significant, so the memory isn't
poisoned by noise.

---

## 5. Security & Integrity (`security.ts`, `auth.ts`, `crypto.ts`)

Worth highlighting because it shows production thinking:

- **The threat model is explicit:** `tracker.js` runs on arbitrary third-party sites,
  so it *cannot* hold a real secret. Perfect auth is impossible; the goal is raising
  the bar against realistic abuse.
- **HMAC-signed per-variant tokens** (bound to variant id + a day bucket) gate the
  impression/click endpoints, with constant-time (`timingSafeEqual`) verification.
  You can't POST to arbitrary `/variant/:id`, and tokens can't be replayed forever
  (current + previous day only).
- **Per-(IP, variant) sliding-window rate limiting** blunts counter inflation, with
  bounded memory (max 50k keys, opportunistic cleanup).
- **CORS split:** public CORS for telemetry routes (called from any origin),
  restricted CORS for dashboard/auth routes — with **JWT** as the real gate.
- **GitHub tokens encrypted at rest**; **passwords hashed with bcrypt**; stateless
  7-day JWTs.

---

## 6. Why It's Designed This Way — Talking Points

These are the "tell me about a hard decision" answers:

1. **LangGraph state machine vs. a script.** The pipeline has branching, retries,
   and per-page parallelism. Modeling it as composable graph nodes (`setupGraph`,
   `evalGraph`, `variantGraph`) makes each step independently testable and the eval
   loop able to re-enter just the part it needs.

2. **Two-LLM strategy (Gemini + Ollama).** Gemini Flash gives the best structured
   HTML/CSS and vision analysis; local llama3 is a free, unlimited fallback for quota
   or outages; and there's a deterministic last resort so the pipeline *never* stalls.
   Quality-ordered fallback = resilience without sacrificing the happy path.

3. **Statistical rigor as a first-class feature.** The single most important code in
   the repo is `stats.ts`. The whole product promise — "autonomously ships changes to
   your real codebase" — is only safe because of the two-proportion z-test + triple
   ship gate. The comment block documents the *bug it fixes* (false-positive one-sample
   test), which is a great story to tell.

4. **Per-page independence.** Real sites have many pages; testing them serially is
   slow. Each page runs its own hypothesis with its own impression gate and its own
   pending-PR hold, so a slow page never blocks a fast one.

5. **Leader election with Postgres advisory locks.** No extra infra (Redis/ZooKeeper)
   — the DB you already have provides safe single-leader execution and failover.

6. **AST patching vs. regex.** Anyone can string-replace HTML. Mapping a *runtime DOM
   element back to its source JSX node* via ts-morph is what turns this from a toy into
   a tool that produces clean, reviewable PRs.

7. **Privacy-respecting tracking.** Anonymous localStorage id, no cookies, no PII,
   deduped to unique visitors — both correct measurement *and* a privacy story.

---

## 7. Likely Interview Questions & Crisp Answers

**Q: How do you avoid shipping a change that just looks better by random chance?**
A two-proportion z-test with pooled variance + a triple gate: significance (p<0.05),
a minimum sample of 500 impressions/variant, and a ≥2% practical lift. Ties go to
control. We even re-evaluate from raw counts right before opening the PR.

**Q: How does a visitor get consistently bucketed into A or B?**
Deterministic FNV-1a hash of `visitorId + testKey`. The testKey embeds the variant
ids, so a new test re-randomizes everyone instead of inheriting a stale split — no
server round-trip needed for assignment.

**Q: What stops someone from spamming your impression endpoint?**
HMAC-signed per-variant tokens (id + day bucket, constant-time verified) plus
per-(IP, variant) rate limiting. It's not bot-proof — and the code says so — but it
stops random-ID spam, replay, and burst inflation.

**Q: What if the LLM returns garbage?**
Every LLM call has retry-with-backoff, robust JSON extraction (`extractJson` scans
for the first balanced object, tolerating fences/prose), and a non-LLM fallback path.
The pipeline degrades, it doesn't crash.

**Q: How do you run multiple server instances safely?**
A Postgres advisory lock elects a single loop leader on a dedicated connection;
others stand by and retry for failover. A re-entrancy guard prevents overlapping polls.

**Q: How do changes actually reach the customer's code?**
A GitHub PR. Best case, ts-morph rewrites the exact source JSX node (true diff);
otherwise a regex patch; otherwise a results doc. Optional auto-merge.

**Q: What would you improve next?**
Bayesian / sequential testing to reduce sample sizes; multi-armed bandits to cut
regret during the test; conversion events beyond CTR; webhook-driven PR-merge
detection instead of polling.

---

## 8. File Map (where to point during a walkthrough)

| Concern | File |
|---|---|
| AI orchestration (LangGraph nodes + graphs) | `server/src/ai/agent.ts` |
| Background loop, leader election, per-page gating | `server/src/ai/loop.ts` |
| **Statistics (the crown jewel)** | `server/src/ai/stats.ts` |
| Site crawl, element tagging, vision analysis | `server/src/ai/analyzer.ts` |
| Hypothesis generation (+ memory recall) | `server/src/ai/hypothesis.ts` |
| Variant generation (Gemini→llama3→fallback) | `server/src/ai/variants.ts` |
| Winner evaluation | `server/src/ai/winner.ts` |
| Behavior signal aggregation | `server/src/ai/behavior.ts` |
| Vector memory (ChromaDB) | `server/src/ai/memory.ts` |
| GitHub PR + patching | `server/src/ai/patcher.ts`, `ast-patcher.ts`, `ingest.ts` |
| LLM utilities (retry, JSON, providers) | `server/src/ai/llm.ts` |
| Client-side tracker | `client/public/tracker.js` |
| Serve variants + signed tokens | `server/src/routes/tracker.ts`, `variant.ts` |
| Endpoint integrity (HMAC, rate limit) | `server/src/security.ts` |
| Auth (JWT, bcrypt) | `server/src/auth.ts` |
| Schema | `server/prisma/schema.prisma` |

---

*Prepared as interview reference for the Visus project.*
