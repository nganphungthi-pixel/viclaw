# P0-1 research: scrubbing the child-process environment

Question: how should Viclaw scope and scrub the environment of spawned shell
commands so a prompt-injected `env` (or equivalent) cannot exfiltrate secrets?

## Sources (all opened 2026-10-10)

| # | URL | Tier | Key claim used |
|---|---|---|---|
| 1 | https://nodejs.org/api/child_process.html | 1 (official docs) | `env` option defaults to `process.env`; `exec()` doc warns "Never pass unsanitized user input"; Windows env keys are case-insensitive (first lexicographic match wins); prefer spawn without shell |
| 2 | https://genai.owasp.org/llm-top-10/ | 1 (standard) | 2025 list confirms LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency as the exact three risks P0-1 addresses |
| 3 | https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/exec_env.rs | 1 (reference source) | Codex builds child env from a `ShellEnvironmentPolicy` + `env_clear()` (nothing inherited by default); injects only session/thread/profile IDs; strips managed proxy env on escalation; Windows wrapper allowlists specific vars case-insensitively; inherited profile values treated as untrusted |
| 4 | https://github.com/sst/opencode/blob/5d2dc888/packages/opencode/src/tool/bash.ts + https://opencode.ai/docs/permissions/ | 1 (reference source + docs) | opencode tree-sitter-parses commands for permission checks BUT still spawns with `{...process.env, ...pluginEnv}` — full inherit; contrast case: permission-first without scrubbing |
| 5 | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md + sandboxConfig.ts | 1 (reference source + docs) | Per-variable `--env` propagation into Docker sandbox; SANDBOX_MOUNTS for paths; sandbox-exec/docker/podman/runsc backends |
| 6 | https://oddguan.com/blog/comment-and-control-prompt-injection-credential-theft-claude-code-gemini-cli-github-copilot/ | 2 (researcher blog, cross-vendor, bounties paid) | `ps auxeww` / `/proc/*/environ` reads parent/MCP processes that kept full env even when the child bash env was filtered (Copilot `UU()` bypass); exfil via allowed channels (comments, git push); Anthropic's fix (blocking `ps`) left the pattern alive |
| 7 | https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-ci-prompt-injection-202608/ | 2 (industry research, Black Hat 2026) | CVE-2026-54316 (Claude Code, side-channel exfil), CVE-2026-12537 (Gemini CLI, CVSS 10.0, RCE before sandbox init + sibling environ read); GuardFall: 10/11 surveyed agents vulnerable to guard-vs-shell text mismatch; treat every env var visible to a CI agent as exposed |
| 8 | https://permissionprotocol.com/agent-incident-tracker/microsoft-claude-code-github-actions-prompt-injection-secrets + https://securebulletin.com/... (same incident) | 2 (incident tracker + press on Microsoft disclosure) | Read tool reached `/proc/self/environ` with no gate while Bash was sandboxed — asymmetric controls fail; truncate-to-evade-secret-scanning; fix in Claude Code 2.1.128 |

## Conflicts

- Codex scrubs-by-default vs opencode inherits-by-default: both ship, but only the scrub model survives the incidents in sources 6–8. Prefer Codex.
- Gemini relies on container boundary for env secrecy; Viclaw's Docker sandbox exists but is opt-in (P0-7 makes it default). Until then, in-process scrubbing is the only layer — say so in SECURITY.md.

## Decision

Build child env from an explicit allow-list (PATH, HOME, LANG, TERM, TMPDIR,
SYSTEMROOT/ComSpec/PATHEXT on Windows, plus user `envPassthrough`), never
`{...process.env}`. Redact values of any variable matching
`*KEY/*TOKEN/*SECRET/*PASSWORD/*PRIVATE*` (case-insensitive) from tool stdout
before it returns to the model, and never log raw child env. Windows:
normalize key case collisions (Node keeps first lexicographic match — an
attacker-controlled `Path` vs `PATH` split can smuggle values).

## Rejected alternatives

- Pure permission-gating without scrubbing (opencode model): rejected — sources
  6–8 show filtered children still leak via parent environ reads and allowed
  exfil channels.
- Full env + output scanning only: rejected — truncation defeats pattern
  scanning (source 8); control must be at exposure, not at output.

## Remaining risks

- Inherited profile/config values going stale (Codex explicitly handles this;
  copy the pattern).
- `env -i` style debugging by the model will show a sparse env — document it
  so it is not reported as a bug.
- Scrubbing is necessary but not sufficient: P0-6 (injection layers) and P0-7
  (sandbox default) must still land; record residual risk honestly.
