<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/🧭-Viclaw-000000?style=flat">
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/🧭-Viclaw-FFFFFF?style=flat">
    <img alt="viclaw" height="48" src="https://img.shields.io/badge/🧭%20Viclaw-black?style=flat">
  </picture>
</p>

<p align="center">
  <strong>AI coding agent that runs on your machine</strong><br>
  <sub>Bring your own provider — or pay nothing at all with the $0 free stack.</sub>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 22+"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.3-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

---

**Viclaw** is an AI coding agent that runs on your machine. It connects to any AI provider, understands your codebase, researches across the web, reasons through complex problems, and helps you build software — all from your terminal or browser. Built with TypeScript, designed for developers who want an agent that works *their* way.

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#free-stack">Free Stack</a> ·
  <a href="#models">Models</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#features">Features</a> ·
  <a href="#security">Security</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

## Models (selection + auth)

Viclaw connects to **any** AI provider. You pick the provider, you pay them directly, Viclaw charges nothing.

- **Ollama** — free, runs locally on your machine. No API key, no internet needed. Best for privacy.
- **Anthropic** — Claude models. Get API key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
- **OpenAI** — GPT models. Get API key at [platform.openai.com](https://platform.openai.com/api-keys).
- **OpenRouter** — 200+ models from one key. Some models free. Get key at [openrouter.ai](https://openrouter.ai/keys).
- **Google** — Gemini models. Free tier available. Get key at [aistudio.google.com](https://aistudio.google.com/app/apikey).

Model note: while many providers/models are supported, for the best coding experience we recommend **Claude Sonnet 4** (Anthropic) or **GPT-4o** (OpenAI). For free local usage, **Qwen3-Coder 8B** via Ollama runs on an 8GB GPU; **Qwen3-Coder 30B** fits a 24GB card.

---

## Install (recommended)

**Requires:** [Node.js](https://nodejs.org) 22+ and [Git](https://git-scm.com).

```bash
git clone https://github.com/nganphungthi-pixel/viclaw.git
cd viclaw
npm install
```

After install, the setup wizard shows you all available providers and models:

```bash
# Interactive setup (pick provider + model)
npm run setup

# Or see all options without selecting
node scripts/setup.js providers
node scripts/setup.js models
```

---

## Quick start (TL;DR)

```bash
# 1. Pick your provider & set API key
cp .env.example .env
# Edit .env → add ONE provider's API key (or skip keys entirely: see Free Stack)

# 2. Start chatting
npm run dev
# npx tsx src/cli.ts chat

# 3. Try the fancy terminal UI
npx tsx src/cli.ts chat --tui

# 4. Or open in your browser
npx tsx src/cli.ts serve
# → http://localhost:8080
```

Upgrade note: `git pull && npm install` to get the latest version.

---

## Free Stack ($0 inference)

No key, no card, no bill. One switch routes every turn cheapest-first:

```bash
export VICLAW_FREE_STACK=true
```

1. **Ollama** (local — private, unlimited; `ollama pull qwen3-coder:8b`)
2. **Gemini free tier** (no card; trains on prompts — never send secrets)
3. **OpenRouter `:free` router** (auto-selects a free tool-calling model)

A leg that is down, capped, or unconfigured fails fast and the next leg answers. Honest limits: roughly 1–5 real medium tasks/day on free quotas; local small models score below frontier on hard multi-file work — supervise them (`plan`/`ask` modes). Overrides: `OLLAMA_MODEL`, `GEMINI_MODEL`, `OPENROUTER_FREE_MODEL`.

---

## Highlights

- **[Any AI provider](#models)** — Anthropic, OpenAI, Google, OpenRouter, Ollama, Bedrock. Switch anytime, with automatic fallback chains — including the $0 free stack.
- **[Built-in research](#research)** — multi-engine web search, deep reasoning, multi-agent task decomposition.
- **[Connector catalog](#integrations)** — config metadata for Supabase, Firebase, Vercel, GitHub, Slack, Discord and many more.
- **[Team controls](#governance)** — budgets, approval workflows, audit logging, sandboxed execution. (No SSO/SOC2 — see [SECURITY.md](SECURITY.md) for the honest threat model.)
- **[Runs anywhere](#platform)** — Windows, macOS, Linux. Local AI with zero API costs via Ollama.
- **[Unattended runs](#scheduler)** — cron-style scheduler with persistent jobs and a run ledger.
- **[Money safety](#mandates)** — AP2-shaped mandate ledger: the model can only ever receive approve/deny, never a transfer capability.
- **[Voice support](#voice)** — Transcription (Whisper/Deepgram) + TTS (OpenAI/ElevenLabs/Edge TTS).
- **[MCP integration](#mcp)** — Model Context Protocol over stdio transport with auto-discovery.
- **[Plugin system](#plugins)** — hot-reload, community extensible.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     viclaw core                             │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Agent    │  │ Tool     │  │ Memory   │  │ Learning   │  │
│  │ Loop     │──│ Executor │──│ System   │──│ Engine     │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│       │              │             │              │          │
│  ┌────┴─────┐  ┌─────┴────┐  ┌────┴─────┐  ┌───┴──────┐   │
│  │ Provider │  │ Sandbox  │  │ Memory   │  │ Hook     │   │
│  │ Router   │  │ Manager  │  │ System   │  │ System   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  Scheduler (at/every/cron) │ Mandate ledger (approve/deny)  │
│                                                             │
│  Channels                                                   │
│  Telegram │ Discord │ Slack │ Webhook │ CLI │ WebSocket     │
│                                                             │
│  Voice System                                               │
│  Transcription (Whisper, Deepgram) │ TTS (OpenAI, ElevenLabs)│
│                                                             │
│  Governance                                                 │
│  Companies │ Agents │ Issues │ Budgets │ Org Chart           │
│                                                             │
│  MCP Integration (stdio)                                    │
│  Filesystem │ Git │ GitHub │ Postgres │ Browser              │
└─────────────────────────────────────────────────────────────┘
```

---

## Everything built so far

### Core platform
- **Agent loop** — streaming, retry logic, loop detection, structured context compaction
- **Provider abstraction** — 6 providers with fallback chains; prompt caching on Anthropic by default
- **Tool system** — Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Memory, Skills, Browser, MCP
- **Permission modes** — `normal` / `acceptEdits` / `ask` / `plan` / `deny` (`plan` is read-only, `ask` fails closed)
- **Learning engine** — records interactions, analyzes failures, extracts patterns

### Scheduler + money safety
- **Scheduler** — `at` / `every` / `cron` jobs, persistent store, run ledger, exponential-backoff retries, per-run timeouts, overdue-skip on restart
- **Mandate ledger** — human-approved spending mandates (amount range, payee allowlist, daily cap, expiry); idempotent authorization with hash-bound receipts

### Channels
- **CLI** — interactive readline with 24 slash commands
- **TUI** — React/Ink terminal UI with streaming output
- **WebSocket** — token-authenticated gateway for web clients and external apps
- **Web UI** — browser-based chat interface at `http://localhost:8080`
- **Telegram** — bot integration with group support
- **Discord** — guild and channel support
- **Slack** — Bolt-based integration with socket mode
- **Voice** — speak to Viclaw, get spoken responses

### Research & reasoning
- **Search engines** — Exa (default), Brave, Serper/Bing, Tavily, GitHub, DuckDuckGo keyless fallback
- **Deep reasoning** — chain-of-thought analysis with 4 depth modes (quick/standard/deep/expert)
- **Multi-agent** — spawn sub-agents for parallel task decomposition
- **Expertise patterns** — auto-detects context (Next.js, React, Tailwind, WordPress, etc.)

### Tools + automation
- **Security scanner** — 20 vulnerability classes (SQLi, XSS, Command Injection, Secrets, etc.)
- **Governance** — approval workflows, audit logging, budgets with hard stops
- **Rate limiting** — per-identifier rate limiting with sliding windows
- **Cost tracking** — token-based cost estimation with budget enforcement

### Runtime + safety
- **Sandboxed execution** — Docker and process isolation for code execution
- **Path validation** — separator-aware allow/block lists for file access
- **Command allow-list** — strict binary-token gating for shell commands
- **SSRF guard** — cloud instance-metadata endpoints refused by WebFetch
- **Untrusted-web wrapping** — fetched content labelled as data, never instructions
- **Input validation** — Zod schemas for all tool inputs
- **Session management** — JSON-based session store with history

### Ops + packaging
- **Config system** — hot-reload config with audit trail and atomic writes
- **Docker** — multi-stage build + docker compose with profiles
- **Tests** — 159 tests across providers, tools, search, scheduler, mandates, memory, agent, security and tool-calling wire format

---

## Integrations

### Databases & Backend
Supabase · Firebase · PostgreSQL · SQLite · MongoDB · MySQL · Databricks · Snowflake · MotherDuck · Dremio · Starburst · PlanetScale · BigQuery · Hex · Metabase · Tableau · Airtable

### Deploy & Hosting
Vercel · Netlify · Cloudflare · Hostinger · Wix · Webflow · WordPress.com

### CRM & Sales
HubSpot · Salesforce · Attio · Close CRM · Apollo · ZoomInfo · Clay · Common Room · Zoho CRM

### Communication
Slack · Gmail · Google Calendar · Resend · MailerLite · Mailchimp · Klaviyo · ActiveCampaign · Intercom · IFTTT · Zapier · Make · n8n · Workato

### Design & Creativity
Figma · Canva · Miro · tldraw · Excalidraw · Mermaid Chart · Lucid · Sketch · Gamma

### Finance
Stripe · PayPal · Square · Razorpay · GoCardless · Brex · Mercury · Ramp · QuickBooks · TurboTax · Credit Karma

### Monitoring & Security
Sentry · Grafana · Honeycomb · Dynatrace · Socket · Postman · Kubernetes

---

## Security

Read [SECURITY.md](SECURITY.md) before exposing anything. Short version:

- **Sandboxed execution** — Docker/process isolation for code execution
- **Path validation** — separator-aware allow/block lists (prefix bypass fixed)
- **Secret detection** — automated scanning for hardcoded credentials
- **Input validation** — Zod schemas for all tool inputs
- **Rate limiting** — per-identifier rate limiting
- **Audit logging** — comprehensive activity tracking with config audit trail
- **Gateway token** — mandatory when the WebSocket port leaves localhost
- **Known limits** — no SSO/SOC2, `ask` mode fails closed instead of prompting, Bash needs Unix `sh`

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

---

## Configuration

Viclaw is configured via `.env` file. After `npm install`:

```bash
cp .env.example .env
```

```bash
# Pick ONE provider (or use the free stack below — no keys needed)
OLLAMA_HOST=http://localhost:11434          # Free, local
# ANTHROPIC_API_KEY=sk-ant-...              # Claude models
# OPENAI_API_KEY=sk-...                     # GPT models
# OPENROUTER_API_KEY=sk-or-...              # 200+ models
# GEMINI_API_KEY=...                        # Gemini models, free tier available

# $0 inference: Ollama -> Gemini free -> OpenRouter :free
# VICLAW_FREE_STACK=true

# Gateway (set a token if the port leaves localhost)
# GATEWAY_TOKEN=change-me-to-a-long-random-secret

# Optional: Web search
# EXA_API_KEY=...
# TAVILY_API_KEY=...

# Optional: Channels
# TELEGRAM_BOT_TOKEN=...
# DISCORD_BOT_TOKEN=...
# SLACK_BOT_TOKEN=...
```

---

## Project structure

```
viclaw/
├── src/
│   ├── agent/          # Agent loop, learning, sub-agents, streaming
│   ├── channels/       # Telegram, Discord, Slack, Webhook
│   ├── commands/       # 24 slash commands
│   ├── config/         # Hot-reload config with audit trail
│   ├── connectors/     # Service connector catalog (config metadata)
│   ├── expertise/      # Domain expertise patterns
│   ├── gateway/        # Token-authenticated WebSocket server + Web UI
│   ├── governance/     # Company management, budgets, org charts
│   ├── hooks/          # Pre/post processing pipeline
│   ├── mandates/       # AP2-shaped spending-mandate ledger
│   ├── mcp/            # Model Context Protocol (stdio transport)
│   ├── memory/         # JSON + SQLite memory
│   ├── platform/       # Cross-platform (Windows/macOS/Linux)
│   ├── plugins/        # Plugin API with hot-reload
│   ├── providers/      # AI provider abstraction (6 providers + free stack)
│   ├── reasoning/      # Chain-of-thought reasoning engine
│   ├── research/       # Multi-engine search system
│   ├── sandbox/        # Docker/process isolation
│   ├── scheduler/      # at/every/cron jobs + run ledger
│   ├── security/       # Vulnerability scanners + audit
│   ├── session/        # Session management
│   ├── skills/         # Skill system registry
│   ├── tools/          # Tool execution engine (Grep/Glob/permission modes)
│   ├── voice/          # Transcription + TTS
│   ├── tui/            # React terminal UI
│   └── cli.ts          # Main entry point
├── tests/              # 159 tests
├── scripts/            # Setup wizard and utilities
├── public/             # Web UI
├── .github/            # CI (typecheck + tests + build)
├── Dockerfile
├── docker-compose.yml
├── SECURITY.md         # Threat model + hardening guide
├── CONTRIBUTING.md     # Contributor rules
├── CHANGELOG.md        # Release history
├── CODE_OF_CONDUCT.md
├── .env.example
└── package.json
```

---

## Chat commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model` | Switch AI model |
| `/provider` | Switch AI provider |
| `/status` | Show agent status and metrics |
| `/research <q>` | Multi-engine web research |
| `/reason <q>` | Deep chain-of-thought reasoning |
| `/security` | Run security audit |
| `/connectors` | Browse the service connector catalog |
| `/plugins` | List available plugins |
| `/skills` | List available skills |
| `/search-skills` | Search skills |
| `/session` | Session management |
| `/bughunt` | Scan for vulnerabilities |
| `/config` | Show configuration |
| `/memory` | View memory state |
| `/compact` | Compact conversation context |
| `/clear` | Clear conversation history |
| `/commit` | Create git commit |
| `/review` | Review code |
| `/think` | Set thinking level |
| `/max-iter` | Set max agent iterations |
| `/version` | Show version |
| `/exit` | Exit |

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/providers.test.ts
```

New behavior must ship with a test that fails without the fix — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Docker

```bash
# Build and run
docker compose up -d

# With local AI (Ollama)
docker compose --profile local-ai up -d

# Production with Redis
docker compose --profile production up -d
```

Set `GATEWAY_TOKEN` in your environment when gateway ports are reachable beyond localhost. Redis and Ollama bind `127.0.0.1` only — both are unauthenticated.

---

## Contributing

Rules, setup, and definition of done live in [CONTRIBUTING.md](CONTRIBUTING.md). Short version:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License — see the [LICENSE](LICENSE) file.

---

## ☕ Support This Project

Viclaw is free and open source. If it helps you build something great, good issues and contributions are very welcome.

---

<p align="center">
  <sub><strong>viclaw</strong> — an AI coding agent you can actually read the source of. 🚀</sub>
</p>
