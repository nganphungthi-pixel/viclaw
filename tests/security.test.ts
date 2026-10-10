/**
 * Security Scanner Tests
 */
import { describe, it, expect } from 'vitest';
import { SecurityScanner } from '../src/security/mod.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

describe('SecurityScanner', () => {
  it('should scan directory and return report', async () => {
    const scanner = new SecurityScanner();
    const report = await scanner.scanDirectory('src');
    expect(report.filesScanned).toBeGreaterThan(0);
    expect(report.vulns).toBeDefined();
    expect(report.bySeverity).toBeDefined();
  });

  it('should detect SQL injection patterns', async () => {
    const testDir = join(tmpdir(), 'viclaw-sql-test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'test.ts'), `
      query("SELECT * FROM users WHERE id = " + userId);
    `);

    const scanner = new SecurityScanner();
    const report = await scanner.scanDirectory(testDir);

    expect(report.totalVulns).toBeGreaterThan(0);
  });

  it('should detect hardcoded secrets', async () => {
    const testDir = join(tmpdir(), 'viclaw-secret-test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'config.ts'), `
      const API_KEY = "sk-test-1234567890abcdef";
      const PASSWORD = "supersecret123";
    `);

    const scanner = new SecurityScanner();
    const report = await scanner.scanDirectory(testDir);

    const secretVulns = report.vulns.filter(v => v.category === 'Hardcoded Secret');
    expect(secretVulns.length).toBeGreaterThan(0);
  });

  it('should detect XSS patterns', async () => {
    const testDir = join(tmpdir(), 'viclaw-xss-test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'app.tsx'), `
      element.innerHTML = userInput;
      return <div dangerouslySetInnerHTML={{ __html: content }} />;
    `);

    const scanner = new SecurityScanner();
    const report = await scanner.scanDirectory(testDir);

    const xssVulns = report.vulns.filter(v => v.category === 'XSS');
    expect(xssVulns.length).toBeGreaterThan(0);
  });

  it('REGRESSION: must not flag every line containing "+" as command injection', async () => {
    const testDir = join(tmpdir(), 'viclaw-plus-test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'math.ts'), `
      const sum = a + b;
      const msg = "total: " + sum;
    `);

    const scanner = new SecurityScanner();
    const report = await scanner.scanDirectory(testDir);

    const cmdVulns = report.vulns.filter(v => v.category === 'Command Injection');
    expect(cmdVulns).toHaveLength(0);
  });

  it('should handle empty directory', async () => {
    const testDir = join(tmpdir(), 'viclaw-empty-test');
    mkdirSync(testDir, { recursive: true });

    const scanner = new SecurityScanner();
    const report = await scanner.scanDirectory(testDir, ['.ts']);

    expect(report.filesScanned).toBe(0);
    expect(report.totalVulns).toBe(0);
  });
});

describe('Path sandbox (isWithinDir)', () => {
  it('blocks sibling-prefix bypass: /app-evil must not pass /app', async () => {
    const { isWithinDir } = await import('../src/tools/mod.js');
    expect(isWithinDir('/app-evil/secret', '/app')).toBe(false);
    expect(isWithinDir('/app/sub/file', '/app')).toBe(true);
    expect(isWithinDir('/app', '/app')).toBe(true);
    expect(isWithinDir('/a/blocked2', '/a/blocked')).toBe(false);
    expect(isWithinDir('/a/blocked/x', '/a/blocked')).toBe(true);
  });
});

describe('SSRF guard (isBlockedFetchTarget)', () => {
  it('blocks cloud metadata endpoints, allows normal + localhost URLs', async () => {
    const { isBlockedFetchTarget } = await import('../src/tools/mod.js');
    expect(isBlockedFetchTarget('http://169.254.169.254/latest/meta-data/')).toBe(true);
    expect(isBlockedFetchTarget('http://100.100.100.200/')).toBe(true);
    expect(isBlockedFetchTarget('http://metadata.google.internal/x')).toBe(true);
    expect(isBlockedFetchTarget('https://api.example.com/data')).toBe(false);
    expect(isBlockedFetchTarget('http://localhost:3000/health')).toBe(false);
    expect(isBlockedFetchTarget('not a url')).toBe(false);
  });
});

describe('Gateway auth', () => {
  it('refuses requests without a token when one is configured', async () => {
    const { GatewayServer } = await import('../src/gateway/server.js');
    const server = new GatewayServer({ token: 'secret-1', port: 0 });
    expect(server.isAuthorized({ type: 'request', id: 'a' })).toBe(false);
    expect(server.isAuthorized({ type: 'request', id: 'a', auth: 'wrong' })).toBe(false);
    expect(server.isAuthorized({ type: 'request', id: 'a', auth: 'secret-1' })).toBe(true);
  });

  it('allows everything when no token is configured (localhost dev)', async () => {
    const { GatewayServer } = await import('../src/gateway/server.js');
    const server = new GatewayServer({ port: 0 });
    expect(server.isAuthorized({ type: 'request', id: 'a' })).toBe(true);
  });
});
