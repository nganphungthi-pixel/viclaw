/**
 * P0-1 env scrubbing tests.
 *
 * Two layers, matching the two failure modes from the Comment-and-Control
 * incidents (CVE-2026-12537, CVE-2026-54316):
 *  1. Unit: buildChildEnv/redactSecrets are pure and run on EVERY platform,
 *     including windows-latest (no sh needed) — this is the Windows
 *     coverage, not a skip.
 *  2. Live hostile: the REAL BashTool executes attacker-style commands with
 *     fake keys set. Unix-only (Windows has no sh; that is P0-8's scope, and
 *     the unit layer above is what guards Windows today).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  buildChildEnv,
  collectSecretValues,
  redactSecrets,
  isSecretName,
  REDACTED,
} from '../src/security/env.js';

const PROBE_KEY = 'VICLAW_PROBE_SECRET_KEY';
const PROBE_VAL = 'sk-probe-fake-secret-value-0123456789';

afterEach(() => {
  delete process.env[PROBE_KEY];
});

describe('isSecretName', () => {
  it('matches secret-like names, not ordinary ones', () => {
    expect(isSecretName('ANTHROPIC_API_KEY')).toBe(true);
    expect(isSecretName('GITHUB_TOKEN')).toBe(true);
    expect(isSecretName('MY_SECRET')).toBe(true);
    expect(isSecretName('DB_PASSWORD')).toBe(true);
    expect(isSecretName('PATH')).toBe(false);
    expect(isSecretName('HOME')).toBe(false);
    expect(isSecretName('LANG')).toBe(false);
  });
});

describe('buildChildEnv', () => {
  it('keeps the allow-list and drops everything else, including secrets', () => {
    const env = buildChildEnv({
      source: {
        PATH: '/usr/bin',
        HOME: '/home/u',
        LANG: 'C.UTF-8',
        [PROBE_KEY]: PROBE_VAL,
        CUSTOM_THING: 'x',
      },
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(env[PROBE_KEY]).toBeUndefined();
    expect(env.CUSTOM_THING).toBeUndefined();
  });

  it('honors explicit passthrough (operator responsibility)', () => {
    const env = buildChildEnv({
      source: { CUSTOM_THING: 'x', [PROBE_KEY]: PROBE_VAL },
      passthrough: ['CUSTOM_THING'],
    });
    expect(env.CUSTOM_THING).toBe('x');
    expect(env[PROBE_KEY]).toBeUndefined();
  });

  it('dedupes case-insensitively in Windows mode, first wins (Node semantics)', () => {
    const env = buildChildEnv(
      { source: { Path: '/first', PATH: '/second', SystemRoot: 'C:\\Windows' } },
      true
    );
    expect(env.Path).toBe('/first');
    expect(env.PATH).toBeUndefined();
    expect(env.SystemRoot).toBe('C:\\Windows');
  });

  it('keeps Windows child-startup vars', () => {
    const env = buildChildEnv(
      { source: { SYSTEMROOT: 'C:\\Windows', COMSPEC: 'cmd.exe', FOO: '1' } },
      true
    );
    expect(env.SYSTEMROOT).toBe('C:\\Windows');
    expect(env.COMSPEC).toBe('cmd.exe');
    expect(env.FOO).toBeUndefined();
  });
});

describe('redactSecrets', () => {
  it('replaces known values longest-first and leaves other text alone', () => {
    const out = redactSecrets('key=sk-probe-fake-secret-value-0123456789 ok', [PROBE_VAL]);
    expect(out).toBe(`key=${REDACTED} ok`);
    expect(redactSecrets('nothing secret here', [PROBE_VAL])).toBe('nothing secret here');
  });

  it('ignores short values and empty lists', () => {
    expect(redactSecrets('flag is 1', ['1'])).toBe('flag is 1');
    expect(redactSecrets('plain', [])).toBe('plain');
  });

  it('collects secret values from secret-named vars only', () => {
    const values = collectSecretValues({ A_KEY: PROBE_VAL, PLAIN: PROBE_VAL, SHORT_KEY: 'x' });
    expect(values).toContain(PROBE_VAL);
    expect(values).toHaveLength(1);
  });
});

describe('passthrough foot-gun warning', () => {
  it('warns once for secret-like passthrough names, stays quiet otherwise', async () => {
    const { ToolExecutor } = await import('../src/tools/mod.js');
    const warned: string[] = [];
    const orig = console.warn;
    console.warn = (msg: unknown) => {
      warned.push(String(msg));
    };
    try {
      const executor = new ToolExecutor({
        allowedPaths: [tmpdir()],
        blockedPaths: [],
        allowedCommands: [],
        blockedCommands: [],
        timeout: 30000,
        sandbox: false,
        envPassthrough: ['ANTHROPIC_API_KEY', 'MY_ENDPOINT'],
      });
      expect(executor).toBeDefined();
    } finally {
      console.warn = orig;
    }
    expect(warned.some((m) => m.includes('ANTHROPIC_API_KEY'))).toBe(true);
    expect(warned.some((m) => m.includes('MY_ENDPOINT'))).toBe(false);
  });
});

describe('BashTool hostile env exfiltration (live)', () => {
  const isWin = process.platform === 'win32';

  it.each([
    ['env', {}],
    ['printenv', {}],
    ['echo $VICLAW_PROBE_SECRET_KEY', {}],
    ['node -e "console.log(process.env.VICLAW_PROBE_SECRET_KEY)"', {}],
    ['cat /proc/self/environ', {}],
  ])('does not leak secrets via %s', async (command) => {
    if (isWin) {
      // No sh on Windows: the scrubbing itself is proven by the
      // platform-independent buildChildEnv tests above (they run on
      // windows-latest). Live shell exfil needs P0-8's shell adapter.
      return;
    }
    process.env[PROBE_KEY] = PROBE_VAL;
    const { ToolExecutor } = await import('../src/tools/mod.js');
    const executor = new ToolExecutor({
      allowedPaths: [tmpdir()],
      blockedPaths: [],
      allowedCommands: [],
      blockedCommands: [],
      timeout: 30000,
      sandbox: false,
    });
    try {
      const result = await executor.executeTool('Bash', { command }, 'hostile-1');
      expect(result.content).not.toContain(PROBE_VAL);
    } finally {
      delete process.env[PROBE_KEY];
    }
  });

  it('child still gets a working environment (PATH/HOME present)', async () => {
    if (isWin) return; // same sh limitation as above
    const { ToolExecutor } = await import('../src/tools/mod.js');
    const executor = new ToolExecutor({
      allowedPaths: [tmpdir()],
      blockedPaths: [],
      allowedCommands: [],
      blockedCommands: [],
      timeout: 30000,
      sandbox: false,
    });
    const result = await executor.executeTool('Bash', { command: 'echo "home=$HOME path_len=${#PATH}"' }, 'hostile-2');
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/home=\S+/);
  });
});
