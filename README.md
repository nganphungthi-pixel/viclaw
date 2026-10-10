<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/🦞-Viclaw-000000?style=flat">
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/🦞-Viclaw-FFFFFF?style=flat">
    <img alt="viclaw" height="48" src="https://img.shields.io/badge/🦞%20Viclaw-black?style=flat">
  </picture>
</p>

<p align="center">
  <strong>AI coding agent that runs on your machine</strong><br>
  <sub>Bring your own provider. Local, scriptable, yours.</sub>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-%3E%3D22-brightgreen?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 22+"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.3-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

---

**Viclaw** is a fully-featured AI coding agent that runs on your machine. It connects to any AI provider, understands your codebase, researches across the web, reasons through complex problems, and helps you build software — all from your terminal or browser. Built with TypeScript, designed for developers who want an agent that works *their* way.

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#models">Models</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#features">Features</a> ·
  <a href="#integrations">Integrations</a> ·
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

Model note: while many providers/models are supported, for the best coding experience we recommend **Claude Sonnet 4** (Anthropic) or **GPT-4o** (OpenAI). For free local usage, **Qwen 2.5 72B** via Ollama is excellent.

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
# Edit .env → add ONE provider's API key

# 2. Start chatting
npx tsx src/cli.ts chat

# 3. Try the fancy terminal UI
npx tsx src/cli.ts chat --tui

# 4. Or open in your browser
npx tsx src/cli.ts serve
# → http://localhost:8080
```

Upgrade note: `git pull && npm install` to get the latest version.

---

## Highlights

- **[Any AI provider](#models)** — Anthropic, OpenAI, Google, OpenRouter, Ollama, Bedrock. Switch anytime.
- **[Built-in research](#research)** — multi-engine web search, deep reasoning, multi-agent task decomposition.
- **[Connector catalog](#integrations)** — config metadata for Supabase, Firebase, Vercel, GitHub, Slack, Discord and many more.
- **[Enterprise-ready](#governance)** — Company governance, budget tracking, audit logging, sandboxed execution.
- **[Runs anywhere](#platform)** — Windows, macOS, Linux. Local AI with zero API costs via Ollama.
- **[Voice support](#voice)** — Transcription (Whisper/Deepgram) + TTS (OpenAI/ElevenLabs/Edge TTS).
- **[MCP integration](#mcp)** — Full Model Context Protocol support with auto-discovery.
- **[Plugin system](#plugins)** — 30+ registration methods, hot-reload, community extensible.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     viclaw core                            │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Agent    │  │ Tool     │  │ Memory   │  │ Learning   │  │
│  │ Loop     │──│ Executor │──│ System   │──│ Engine     │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│       │              │             │              │          │
│  ┌────┴─────┐  ┌─────┴────┐  ┌────┴─────┐  ┌───┴──────┐   │
│  │ Provider │  │ Sandbox  │  │ Memory   │  │ Hook     │   │
│  │ Router   │  │ Manager  │  │ System   │  │ System   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
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
│  MCP Integration                                            │
│  Filesystem │ Git │ GitHub │ Postgres │ Browser              │
└─────────────────────────────────────────────────────────────┘
```

---

## Everything we built so far

### Core platform
- **Agent loop** — streaming, retry logic, loop detection, context compaction
- **Provider abstraction** — 6 providers with automatic fallback chains
- **Tool system** — Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Memory, Skills, Browser, MCP
- **Learning engine** — records interactions, analyzes failures, extracts patterns

### Channels
- **CLI** — interactive readline with 27 slash commands
- **TUI** — React/Ink terminal UI with streaming output
- **WebSocket** — real-time gateway for web clients and external apps
- **Web UI** — browser-based chat interface at `http://localhost:8080`
- **Telegram** — bot integration with group support
- **Discord** — guild and channel support
- **Slack** — Bolt-based integration with socket mode
- **Voice** — speak to Viclaw, get spoken responses

### Research & reasoning
- **Search engines** — Google (Serper), Brave, Bing, DuckDuckGo, Tavily, Exa, GitHub. Most need an API key; DuckDuckGo works keyless.
- **Deep reasoning** — chain-of-thought analysis with 4 depth modes (quick/standard/deep/expert)
- **Multi-agent** — spawn sub-agents for parallel task decomposition
- **Expertise patterns** — auto-detects context (Next.js, React, Tailwind, WordPress, etc.)

### Tools + automation
- **Security scanner** — 20 vulnerability classes (SQLi, XSS, Command Injection, Secrets, etc.)
- **Governance** — secret detection, approval workflows, audit logging
- **Rate limiting** — per-identifier rate limiting with sliding windows
- **Cost tracking** — token-based cost estimation with budget enforcement

### Runtime + safety
- **Sandboxed execution** — Docker and process isolation for code execution
- **Path validation** — allow/block lists for file access
- **Input validation** — Zod schemas for all tool inputs
- **Session management** — JSON-based session store with history

### Ops + packaging
- **Plugin system** — 30+ registration methods, hot-reload support
- **Config system** — hot-reload config with audit trail and atomic writes
- **Docker** — multi-stage build + docker compose with profiles
- **Tests** — 128 passing tests across providers, tools, memory, agent, security and tool-calling wire format

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

- **Sandboxed execution** — Docker/process isolation for code execution
- **Path validation** — allow/block lists for file access
- **Secret detection** — automated scanning for hardcoded credentials
- **Input validation** — Zod schemas for all tool inputs
- **Rate limiting** — per-identifier rate limiting
- **Audit logging** — comprehensive activity tracking with config audit trail

---

## Configuration

Viclaw is configured via `.env` file. After `npm install`:

```bash
cp .env.example .env
```

```json5
{
  // Pick ONE provider
  "OLLAMA_HOST": "http://localhost:11434",          // Free, local
  // "ANTHROPIC_API_KEY": "sk-ant-...",             // Claude models
  // "OPENAI_API_KEY": "sk-...",                    // GPT models
  // "OPENROUTER_API_KEY": "sk-or-...",             // 200+ models
  // "GEMINI_API_KEY": "...",                       // Gemini models

  // Optional: Override default model
  // "ANTHROPIC_MODEL": "claude-sonnet-4-20250514",
  // "OPENAI_MODEL": "gpt-4o",

  // Optional: Web search
  // "TAVILY_API_KEY": "...",
  // "EXA_API_KEY": "...",

  // Optional: Channels
  // "TELEGRAM_BOT_TOKEN": "...",
  // "DISCORD_BOT_TOKEN": "...",
  // "SLACK_BOT_TOKEN": "...",
}
```

---

## Project structure

```
viclaw/
├── src/
│   ├── agent/          # Agent loop, learning, sub-agents, streaming
│   ├── channels/       # Telegram, Discord, Slack, Webhook
│   ├── commands/       # 27 slash commands
│   ├── config/         # Hot-reload config with audit trail
│   ├── connectors/     # Service connector catalog (config metadata)
│   ├── expertise/      # Domain expertise patterns
│   ├── gateway/        # WebSocket server + Web UI
│   ├── governance/     # Company management, budgets, org charts
│   ├── hooks/          # Pre/post processing pipeline
│   ├── mcp/            # Model Context Protocol integration
│   ├── memory/         # JSON + SQLite memory
│   ├── platform/       # Cross-platform (Windows/macOS/Linux)
│   ├── plugins/        # Plugin API with 30+ registration methods
│   ├── providers/      # AI provider abstraction (6 providers)
│   ├── reasoning/      # Chain-of-thought reasoning engine
│   ├── research/       # Multi-engine search system
│   ├── sandbox/        # Docker/process isolation
│   ├── security/       # Vulnerability scanners + audit
│   ├── session/        # Session management
│   ├── skills/         # Skill system registry
│   ├── tools/          # Tool execution engine
│   ├── voice/          # Transcription + TTS
│   ├── tui/            # React terminal UI
│   └── cli.ts          # Main entry point
├── tests/              # 128 passing tests
├── scripts/            # Setup wizard and utilities
├── public/             # Web UI
├── Dockerfile
├── docker-compose.yml
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
| `/session` | Session management |
| `/bughunt` | Scan for vulnerabilities |
| `/config` | Show configuration |
| `/memory` | View memory state |
| `/compact` | Compact conversation context |
| `/clear` | Clear conversation history |
| `/commit` | Create git commit |
| `/review` | Review code |
| `/think` | Set thinking level |
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

---

## Contributing

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
