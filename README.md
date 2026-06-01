# Visus — Autonomous CRO Agent

**Give it a URL. Watch your conversion rate climb.**

Visus is a self-running A/B testing engine. Point it at any website, connect a GitHub repo, and it crawls your pages, generates AI-powered hypotheses, runs tests against real traffic, and ships winners as pull requests — then immediately starts the next cycle.

---

## How it works

```
1. Connect   →  Paste your site URL + GitHub repo
2. Crawl     →  Visus maps every page and ranks by conversion importance
3. Hypothesize  →  LLaMA3 generates targeted test ideas per element
4. Test      →  Serve A/B variants to real visitors, collect click data
5. Ship      →  Winner hits 95% confidence → PR opened automatically
6. Repeat    →  Loop restarts — forever
```

---

## Features

| Feature | Description |
|---|---|
| **Autonomous loop** | Runs 24/7 with zero manual input after setup |
| **AI hypotheses** | Local LLaMA3 (via Ollama) generates targeted UX improvements |
| **Real traffic testing** | No synthetic users — actual visitors decide the winner |
| **GitHub PR integration** | Winning variants become reviewable pull requests |
| **Auto-merge** | Optional: merge winning PRs automatically at 95% confidence |
| **Funnel mapping** | Crawls all pages, prioritizes highest-conversion-value paths |
| **Session analytics** | Tracks clicks, scrolls, and interaction events per session |
| **Variant preview** | Live A/B HTML preview inside the dashboard |

---

## Tech Stack

| Layer | Stack |
|---|---|
| **Frontend** | Next.js 15, React 19, Tailwind CSS 4, Recharts |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | Neon PostgreSQL (serverless) + Prisma ORM |
| **AI** | LangChain + Ollama (local LLaMA3) |
| **Crawler** | Playwright |

---

## Getting Started

### Prerequisites

- Node.js 20+
- [Ollama](https://ollama.ai) running locally with `llama3` pulled
- A [Neon](https://neon.tech) database (or any Postgres)
- A GitHub personal access token with `repo` scope

### 1. Clone & install

```bash
git clone https://github.com/your-username/visus
cd visus

# Install server deps
cd server && npm install

# Install client deps
cd ../client && npm install
```

### 2. Configure the server

```bash
cd server
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="postgresql://..."
GITHUB_TOKEN="ghp_..."
OLLAMA_BASE_URL="http://localhost:11434"
PORT=8080
```

### 3. Run migrations

```bash
cd server
npx prisma migrate dev
```

### 4. Start everything

```bash
# Terminal 1 — server
cd server && npm run dev

# Terminal 2 — client
cd client && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

1. Open the dashboard at `/dashboard`
2. Enter your site URL (must be publicly accessible)
3. Enter your GitHub repo (`owner/repo`) and personal access token
4. Click **Start Loop**
5. Visus will open a tracker PR in your repo — merge it and deploy
6. Once deployed, real visitor data starts flowing and A/B tests begin automatically

---

## Project Structure

```
visus/
├── client/                  # Next.js frontend
│   └── src/app/
│       ├── page.tsx         # Landing page
│       ├── dashboard/       # Dashboard (/dashboard)
│       └── experiment/[id]/ # Experiment detail
│
└── server/                  # Express backend
    └── src/
        ├── routes/          # API endpoints
        └── ai/              # LangChain agents & analyzers
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/experiment/start` | Start a new experiment loop for a site |
| `GET` | `/experiment` | List all sites and their experiments |
| `GET` | `/experiment/:id` | Get experiment detail with hypotheses |
| `GET` | `/experiment/:id/queue` | Get current test queue and progress |
| `POST` | `/experiment/:id/approve` | Manually approve and merge a winning PR |

---

## License

MIT
