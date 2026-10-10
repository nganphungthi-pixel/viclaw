# Changelog

All notable changes to Viclaw, newest first. Format follows Keep a Changelog;
versions follow semver.

## [Unreleased] — 2026-10-10 (P0-1)

### Security

- Child-process environment scrubbing (`src/security/env.ts`): allow-list-built
  child env (PATH/HOME/locale/tmp + Windows startup vars + explicit
  `envPassthrough`) replaces `{...process.env}` in BashTool, MCP spawns,
  sandbox execs, and git helpers; known secret values redacted from tool
  output before it returns to the model. 14 tests (unit on all platforms +
  5 live hostile commands on Unix). Residuals documented in SECURITY.md
  (transformed secrets, secret files, host-env richness).

## [Unreleased] — 2026-10-10 (wiring round)

### Added

- CLI wiring for autonomy: `viclaw schedule add|list|log|run|remove|daemon`
  and `viclaw mandates create|list|revoke`, backed by the platform data dir.
  Verified live (no mocks): add/list/validation-errors/log/run-records-error/
  remove/revoke round-trips, plus a real daemon firing 2 unattended runs with
  ledger entries. Test residue removed afterwards.

## [Unreleased] — 2026-10-10 (npm verification round)

### Fixed

- Windows-only path gating failure: `isWithinDir` appended `/` while Windows
  resolves `\`, denying every allowed path on Windows (6 test failures;
  Linux Docker stayed green and hid it). Separators normalized first, with a
  cross-platform unit test locking both styles. Suite: **161/161** on Windows
  npm (also re-verified: typecheck clean, build + CLI smoke on `dist/`,
  `npm pack` includes `dist/`, proofs 23/23 + 24/24).

## [Unreleased] — 2026-10-10 (docker verification round)

### Fixed (all found by executing in Docker, not by reading)

- Scanner false-positive storm: `&&`/`||` precedence bug flagged every line
  containing `+` as critical (320 false alarms on our own code) — now 1 info.
  The failing old test exposed a second gap: SQLi rule missed classic
  `"..." + input` concatenation; pattern added, suite green.
- `viclaw ask <query>` printed the query then dropped into interactive mode,
  ignoring it — now runs one non-interactive turn (`askOnce`) with clean
  errors and exit codes (verified: keyless 401 surfaces, no hang).
- Docker was undeployable: no `/health` endpoint (added, incl. session count),
  ports mapped 3000 vs actual gateway 8080 (aligned to 8080), and container
  CMD printed help and exited (now runs `serve --host 0.0.0.0`).
- Ollama default model `llama3` → `qwen3-coder:8b` (coder default matching the
  free stack); `login` hint updated the same way.
- Verified live in Docker: full suite **160/160**, `scan`, `status`,
  `version`, `mcp`, `ask` error path, `research` keyless fallback,
  `/health` → 200 with gateway warning firing correctly.

## [Unreleased] — 2026-10-10 (rename)

- Full product rename to **Viclaw**: 266 occurrences across 58 files,
  directory `viclaw/`, package + bin + Docker user/paths, CLI banner/TUI,
  system prompt, env switch (`VICLAW_FREE_STACK`), docs and changelogs.
  Zero occurrences remain in product or docs (only the untouched original
  import tarball still carries the old bytes).
- OpenRouter referer now points at the repo URL instead of a placeholder domain.
- Action needed (human): rename the GitHub repo to `viclaw` so all links resolve.

## [Unreleased] — 2026-10-10

### Security

- Gateway token auth (`GATEWAY_TOKEN`): WebSocket `request` messages require
  `message.auth` when a token is configured; loud startup warning when binding a
  non-loopback interface without one.
- `WebFetchTool` refuses cloud instance-metadata endpoints (SSRF guard:
  169.254.169.254, 169.254.169.123, 100.100.100.200, metadata.google hosts).
- Fixed path-prefix bypass in `isPathAllowed` (`/app-evil` no longer passes
  `/app`) via separator-aware `isWithinDir`.
- Fixed allow-list bypass in `BashTool` (removed weak `startsWith` clause that
  let `github-x` pass `git`); added 256 KB output cap that kills runaway commands.
- `docker-compose.yml`: Redis and Ollama bound to `127.0.0.1`; docker-socket
  mount documented as host-control risk; `GATEWAY_TOKEN` wired through.

### Added (autonomy round, 2026-10-10)

- Scheduler + job ledger (`src/scheduler/`): `at` / `every` / `cron` (5-field,
  Vixie OR), persistent jobs, JSONL run ledger, backoff 30s→60m, per-run
  timeouts, skipped-vs-error tracking, one-shot auto-delete, overdue-skip on
  restart, preflight hook, injected runner (agent-agnostic). 12 vitest tests.
- Mandate ledger (`src/mandates/`, AP2-shaped): human-approved open mandates
  (amount range, payee allowlist, daily cap, expiry), idempotent authorization
  by transactionRef (no double charge), hash-bound receipts, revoke, persistent
  + corrupt-tolerant store. The model can only ever receive approve/deny. 6
  vitest tests.
- Publish readiness: `repository`/`homepage`/`bugs` fields added;
  `prepublishOnly` runs the build (publishing previously shipped no `dist/`).

### Added (self-earning round, 2026-10-10)

- `$0` free stack: `createProviderChain` (N-leg failover with aggregate errors),
  `getFreeStackConfigs` / `createFreeStackProvider` (Ollama → Gemini free →
  OpenRouter `:free` router), explicit `ProviderConfig.provider` routing,
  `VICLAW_FREE_STACK=true` one-switch in the agent loop. 5 new chain tests.
- Fixed during verification: first chain draft recursed into itself
  (`primary.chat` calling the overwritten method → stack overflow); caught by
  the dependency-free proof harness before release, bound originals first.
- Docs: `docs/SELF-EARNING-BLUEPRINT.md` (avenue verdicts, money rails, law,
  free economics, phased product plan), `docs/FREE-STACK.md` (hardware tiers,
  env recipe, limits, ToS warnings).

### Added (earlier)

- Permission modes: `normal` / `acceptEdits` / `ask` / `plan` / `deny`,
  enforced in `ToolExecutor` (`ask` fails closed, `plan` is read-only).
- Anthropic prompt caching (opt-in `enablePromptCache`, agent default-on):
  `cache_control: ephemeral` on system + tools breakpoints.
- Structured context compaction: digest of files touched, tool outcomes,
  failures, and earlier goals replaces the old message-count stub.
- Untrusted-web wrapper on `WebFetch` + Browser `evaluate` (provenance label,
  fenced block, 20 KB cap).
- OSS hygiene: `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `CODE_OF_CONDUCT.md`, committed `package-lock.json`.

### Fixed

- Gemini stream `Part.functionCall` type error from SDK type drift (3 errors).
- Removed remaining marketing strings (`World-Class`, `Smarter Than Claude`,
  `200+ connectors`) from CLI, TUI, commands, and system prompt.

### Verified

- `tsc --noEmit` clean; **131/131 tests pass** (122 inherited + 9 new);
  `npm run build` + `node dist/cli.js --help` work.
- Dependency-free proof harness (`.openclaw/tmp/proof.mjs`): 17/17 checks pass
  executing the real `Grep`/`Glob`/wire-format code without `npm install`.

## [1.0.0] — 2026-10-08

- Native tool calling on all 6 providers (Anthropic, OpenAI, OpenRouter, Ollama,
  Gemini, Bedrock) with per-provider request-shape regression tests.
- `Grep` + `Glob` tools following the Claude Code contract; 122 tests passing.
- Docker multi-stage build (`tsc`, conditional `npm ci`, non-root user).
- `package.json` cleanup (no `postinstall`, no leaked local paths).
- See `docs/viclaw-p0-done.md` for the full P0 record.
