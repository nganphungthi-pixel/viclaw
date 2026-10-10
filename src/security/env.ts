/**
 * Child-process environment policy (P0-1).
 *
 * Research: docs/research/p0-1-env-scrub.md. Model: an explicit allow-list
 * (Codex ShellEnvironmentPolicy + env_clear()), not a deny-list, not a
 * full inherit. Rationale, with evidence:
 * - Node's spawn defaults env to process.env (nodejs.org/api/child_process)
 *   so every secret in the parent is visible to env, ps auxeww, and
 *   /proc/PID/environ readers unless we replace it. (Written this way
 *   because a literal glob star-slash inside a block comment would
 *   terminate the comment early.)
 * - opencode still spawns with {...process.env} (their bash.ts), and the
 *   Comment-and-Control incidents (CVE-2026-12537, CVE-2026-54316) show
 *   filtered children still leak via unfiltered parents/siblings. Scrubbing
 *   must apply to EVERY spawn site, not just the Bash tool.
 * - Windows env keys are case-insensitive (first lexicographic match wins per
 *   Node docs), so dedupe accordingly, or Path vs PATH smuggles values.
 *
 * What this does NOT cover (documented residual, needs P0-7 + file policy):
 * reading secret FILES (cat ~/.env) is a path-policy problem, not an env
 * problem. See the P0-1 report.
 *
 * NOTE: this file is ASCII-only by policy. A past revision contained a
 * mangled em-dash that broke the TypeScript scanner; non-ASCII has no place
 * in a security module. Keep it that way.
 */

export interface ChildEnvOptions {
  /** Extra variable names the operator explicitly allows (their responsibility). */
  passthrough?: string[];
  /** Source environment (defaults to process.env; injectable for tests). */
  source?: Record<string, string | undefined>;
}

/**
 * Variables a child process needs to start and behave sanely. Identity-ish
 * values (USER, LOGNAME) are included deliberately: they are not secrets and
 * tools like git/npm misbehave without them. Everything else, including
 * *KEY/*TOKEN/*SECRET, is dropped unless explicitly passed through.
 */
const ALLOW_LIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LANGUAGE",
  "TERM",
  "TERMINFO",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "CLICOLOR",
  // Windows: required for child processes to start at all.
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "OS",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

/** Names that look like they hold secrets (case-insensitive). */
const SECRET_NAME = /(^|_)(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIALS?|AUTH_TOKEN|SESSION_TOKEN|COOKIE)($|_)/i;

/** Minimum secret-value length worth redacting (avoids nuking "1"/"true"). */
const MIN_SECRET_LEN = 8;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/**
 * Build the child environment. Pure function of (source, passthrough) so it
 * is fully testable on every OS, including Windows CI without sh.
 *
 * @param ignoreCase emulate Windows case-insensitive keys (defaults to the
 * current platform). On collision the first entry wins, mirroring Node.
 */
export function buildChildEnv(
  options: ChildEnvOptions = {},
  ignoreCase = process.platform === "win32"
): Record<string, string> {
  const source = options.source ?? (process.env as Record<string, string | undefined>);
  const extra = new Set((options.passthrough ?? []).map((k) => (ignoreCase ? k.toUpperCase() : k)));
  const allowed = new Set(ALLOW_LIST.map((k) => (ignoreCase ? k.toUpperCase() : k)));
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lookup = ignoreCase ? key.toUpperCase() : key;
    if (seen.has(lookup)) continue;
    seen.add(lookup);
    if (allowed.has(lookup) || extra.has(lookup)) {
      out[key] = value;
    }
  }
  return out;
}

/** Collect secret-looking VALUES from an environment (for redaction). */
export function collectSecretValues(
  source: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): string[] {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value.length < MIN_SECRET_LEN) continue;
    if (isSecretName(key)) values.add(value);
  }
  // Longest first: avoids a short value masking part of a longer one.
  return [...values].sort((a, b) => b.length - a.length);
}

export const REDACTED = "[REDACTED]";

/**
 * Replace every known secret value in text. Exact-match only (no fuzzy
 * patterns), so legitimate output is never mangled: only the actual secret
 * strings disappear. Returns the input unchanged when there is nothing to hide.
 */
export function redactSecrets(text: string, secretValues: string[] = collectSecretValues()): string {
  let out = text;
  let changed = false;
  for (const value of secretValues) {
    if (!value || value.length < MIN_SECRET_LEN) continue;
    if (out.includes(value)) {
      out = out.split(value).join(REDACTED);
      changed = true;
    }
  }
  return changed ? out : text;
}
