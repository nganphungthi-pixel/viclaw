# Baseline — re-measured 2026-10-10 (P0-0)

Method: fresh `git clone` of `nganphungthi-pixel/viclaw` at `8906c35`
(+1 unpushed-line fix to providers/mod.ts found during measuring, pushed as
`3b5f17e` before locking), `npm ci` (609 packages), Node v24.15.0, Windows.
Per Master Prompt rule 4, fresh numbers below override §4 where they differ.

## Headline table

| Metric | §4 claim | Fresh (this file) | Verdict |
|---|---|---|---|
| Tests | 161/161, 10 files | 161/161, 10 files | CONFIRMED |
| Typecheck (`tsc --noEmit`) | clean | clean | CONFIRMED |
| Build (`tsc -p tsconfig.build.json`) | clean | clean | CONFIRMED |
| Coverage lines (overall) | 21.8% | **22.64%** | superseded (fresh) |
| Coverage: mandates | 97.6% | 97.62% | CONFIRMED |
| Coverage: scheduler | 90.4% | 90.35% | CONFIRMED |
| Coverage: search-tools | 92.7% | 92.69% | CONFIRMED |
| Coverage: providers/messages | 99% | 99.33% | CONFIRMED |
| Coverage: sandbox | ~10% | **22.9% dir** (backend 0%, mod 33.7%) | superseded (fresh) |
| ESLint problems | 330 (256 err / 74 warn) | **330 (256 err / 74 warn)** | CONFIRMED exactly |
| `no-explicit-any` hits | 62 `any` uses | **74 rule hits** | superseded (fresh; §4 likely counted differently) |
| npm audit | 15 (5 crit / 1 high / 9 mod) | **15 (5 crit / 1 high / 9 mod)** | CONFIRMED exactly |
| connectors/registry.ts | 2692 lines | **2667 lines** (direct count) | superseded (fresh) |
| providers/mod.ts | 1444 lines | **1252 lines** (direct count) | superseded (fresh) |
| cli.ts | 1256 lines | **1111 lines** (direct count, wiring present) | superseded (fresh) |
| tools/mod.ts | 1069 lines | **929 lines** (direct count) | superseded (fresh) |

File sizes are direct line counts. (The coverage table prints larger
"uncovered" ranges, e.g. cli.ts 1–1256; cause unverified — v8/source-map
artifact suspected. Direct counts are authoritative here.)

## Zero-coverage modules (confirmed from coverage table)

channels, commands, config, connectors, expertise, governance, hooks, mcp,
platform, plugins, reasoning, research, session, skills, tui, voice (all 0%),
plus scripts/, docs/assets, cli.ts, index.ts. Partial: agent 27.77%,
gateway 31.97%, memory 39.97%, providers 62.84%, security 54.12%, tools 69.39%.

## Deltas and surprises found while measuring

1. **`src/memory/vector.ts` EXISTS (187 lines, 0% covered)** although the P0
   report claims it was deleted. Either re-added later or deleted elsewhere —
   UNVERIFIED which. It is a stub-grade store; P1-5/P3 must implement or delete it.
2. **One committed-but-unpushed fix found by diffing:** Ollama default model
   change lived only in the working tree. Pushed as `3b5f17e` during this task.
   Lesson recorded: verify remote file content, not just push output.
3. Top lint rules: `no-unused-vars` 118, `no-undef` 92 (suspicious in TS —
   likely needs `no-undef: off` for TS files; P1-1 to judge), `no-explicit-any`
   74, `no-unsafe-function-type` 23. Only 3 problems auto-fixable.
4. `npm ci --no-audit` in CI means the 15 advisories never gate anything.
5. CI has no lint, no prettier check, no audit, no coverage ratchet, and
   actions float on tags (`checkout@v7`, `setup-node@v7`, `upload-artifact@v4`).

## Ratchet locked in this task

- Coverage thresholds (vitest): lines **21.5**, statements **21.5**, branches
  **71.0**, functions **41.7**. Set at the observed cross-matrix FLOOR, not
  the local 22.64 — first attempt at exact local values failed all 6 CI jobs
  because V8 coverage varies per OS/Node (21.8–22.64 lines observed). Lesson:
  same-machine exact ratchets are broken by design; floors only.
- Lint + audit jobs added to CI and EXPECTED RED (that is the point: the red
  is now visible instead of absent).
- `npm run check` = typecheck + lint + test + build (single entry point).
- Actions pinned by SHA (verified resolvable, see workflow comments).
