<div align="center">

# VISUS

### Observe. Optimize. Ship the diff.

**An autonomous agent that reads your landing page, tests real variants against live traffic, and ships the winner as a GitHub pull request — with no human in the loop until the merge.**

[Live →](https://visus-zeta.vercel.app) &nbsp;·&nbsp; Next.js 15 · LangGraph · Playwright · Gemini · ChromaDB · PostgreSQL

</div>

---

## The problem

Conversion optimization is a manual loop that barely deserves the name "loop." Someone guesses at a UI change, a developer hand-codes the variant, everyone waits two weeks, someone eyeballs the numbers and declares a winner — usually far too early — and then a developer re-implements that winner by hand, often introducing a regression on the way in.

Every step is a human bottleneck, and the one step that matters most — *deciding whether a variant actually won* — is the one done worst.

## What Visus does

Point it at a URL and a repo. From there it runs the entire cycle on its own:

**Scan** → Playwright loads the page and captures the DOM plus a screenshot.
**Analyze** → a vision model (Gemini) inspects the render for conversion problems: buried CTAs, weak hierarchy, friction in forms.
**Hypothesize** → findings flow through a ChromaDB RAG pipeline that retrieves prior winning patterns, so generated A/B variants are grounded in what has actually worked.
**Test** → traffic is split by deterministic client-side hashing of the visitor ID, so a returning user always sees the same arm and the sample stays clean.
**Ship** → the winner is patched back into the JSX source and opened as a pull request for a human to review and merge.

The whole cycle typically closes in under two minutes.

## The parts that aren't the LLM

The interesting engineering isn't the model call — it's everything that keeps the agent honest.

**It refuses to ship garbage.** A variant can only win after clearing a two-proportion z-test: 95% confidence, a minimum sample per arm, and a real lift threshold. If it can't clear the bar, it dies. The agent is allowed to fail.

**It patches real source code.** The agent sees rendered DOM, but the source is JSX. Visus maps DOM nodes back to their JSX origins via `ts-morph` AST traversal with a three-tier fallback. Patches are idempotent — re-running on an already-patched file is a no-op — so the PR is always a clean diff.

**It coordinates itself.** With multiple instances polling the same experiment table, two agents could both decide a test had concluded and both open a PR. Visus uses PostgreSQL advisory-lock leader election so exactly one instance owns the decision step at a time.

## Architecture

```
 URL + repo
     │
     ▼
 Playwright ─▶ Gemini (vision) ─▶ ChromaDB RAG ─▶ variant generation
     │                                                   │
     │                                                   ▼
     │                                      deterministic traffic split
     │                                                   │
     │                                                   ▼
     │                             two-proportion z-test  (95% · min sample · lift)
     │                                                   │
     ▼                                                   ▼
 ts-morph AST patch (DOM → JSX, 3-tier fallback) ──▶ GitHub PR
                        │
   PostgreSQL advisory-lock leader election  (one decider at a time)
```

## Stack

| Layer | Tech |
|---|---|
| Agent orchestration | LangGraph |
| Page analysis | Playwright · Gemini (vision) |
| Retrieval | ChromaDB (RAG) |
| Source patching | ts-morph (TypeScript AST) |
| Data & coordination | PostgreSQL · Prisma |
| Auth & secrets | JWT · bcrypt · encrypted GitHub tokens · HMAC endpoint tokens |
| Frontend | Next.js 15 · React · Tailwind |
| Infra | Docker · docker-compose |

## Status

- **Pipeline:** implemented end-to-end and unit-tested (analyze → crawl → ingest → hypothesize → variants → tracker inject → measurement → z-test → PR → RAG learning).
- **Live deployment:** the marketing site is live on Vercel. The agent backend and dashboard run locally / via `docker-compose`.
- **Next:** wiring the live demo to real experiment data and a full end-to-end run against a production site.

## Run it locally

```bash
# frontend
cd client && npm install && npm run dev     # http://localhost:3000

# backend + services
docker-compose up
```

## What I'd do differently

- The three-tier AST fallback is a symptom, not a fix — the right answer is a **build-time DOM→JSX source map** rather than reconstructing the mapping at runtime.
- The statistical gate is a **fixed-horizon** test, so results can't be peeked at early without inflating false positives. A **sequential test** would let the agent stop the moment the evidence is there.

---

<div align="center">
Built by <b>Aditya Chawla</b> · <a href="https://github.com/adityachawla005">github.com/adityachawla005</a>
</div>