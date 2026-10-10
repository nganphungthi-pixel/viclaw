# Contributing to Viclaw

## Setup

Requires Node.js 22+ and Git.

```bash
git clone https://github.com/nganphungthi-pixel/viclaw.git
cd viclaw
npm ci            # reproducible install (package-lock.json is committed)
npm run typecheck # must be clean
npm test          # 131 tests, must all pass
```

## Ground rules

1. **English only.** No non-English text in code, docs, or messages. CI-class
   check: scan for non-Latin scripts before every PR.
2. **No placeholders.** Never commit `TODO`, `YOUR_LINK_HERE`, or `{{...}}` in
   user-facing surfaces. If a value is unknown, omit the feature, don't fake it.
3. **Provider changes need request-shape tests.** `tests/provider-request-shape.test.ts`
   exists because tool declaration silently broke once. Any change to an outgoing
   payload must add or update an exact-payload assertion there.
4. **Security changes need regression tests.** Path checks, SSRF guards,
   permission modes, and gateway auth all have tests in `tests/` — extend them.
5. **No marketing inflation.** Claims need proof in-repo (eval numbers, badges
   pointing at real workflows). Unverifiable superlatives get reverted.
6. **Small diffs.** One concern per PR, with before/after test output pasted in.

## Definition of done

- `npm run typecheck` clean, `npm test` green, `npm run build` works.
- New behavior covered by a test that fails without the fix.
- `CHANGELOG.md` entry under Unreleased.

## Releases

Versioned with semver. Tag `vX.Y.Z`, attach `CHANGELOG.md` excerpt to the
GitHub release. `npm publish` ships `dist/`, `public/`, `README.md`, `LICENSE`
(see the `files` field in `package.json`).
