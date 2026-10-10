/**
 * Glob / Grep tool tests.
 *
 * These cover the behavior contract that makes code-search tools useful to a
 * model: list-then-read, mtime sorting, hard caps with explicit truncation
 * flags, pagination that reports out-of-range offsets instead of implying "no
 * matches", and errors instead of silence on bad input.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GlobTool, GrepTool, globToRegExp } from "../src/tools/search-tools.js";
import type { ToolContext } from "../src/tools/mod.js";

let root: string;

function ctx(): ToolContext {
  return {
    toolCallId: "test-1",
    workingDirectory: root,
    permissions: new Set(),
    config: {},
  };
}

function writeFile(rel: string, content: string, mtimeSeconds = 1_600_000_000): void {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  utimesSync(full, mtimeSeconds, mtimeSeconds);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "viclaw-search-"));

  // Older file
  writeFile("src/older.ts", "const alpha = 1;\nconst beta = 2;\n", 1_600_000_000);
  // Newer file
  writeFile("src/newer.ts", "const alpha = 10;\nconst gamma = 30;\n", 1_700_000_000);
  writeFile("src/nested/deep.ts", "const alpha = 100;\n", 1_710_000_000);
  writeFile("docs/readme.md", "# Docs\nalpha appears here too\n", 1_720_000_000);
  writeFile("package.json", '{"name":"x"}\n', 1_650_000_000);
  writeFile("notes.txt", "alpha in txt\n", 1_660_000_000);

  // Should be ignored by Grep (gitignored), found by Glob
  writeFile(".gitignore", "secret.txt\nignored/\n");
  writeFile("secret.txt", "alpha should be ignored\n");
  writeFile("ignored/hidden.ts", "alpha ignored too\n");

  // Binary-ish content
  writeFile("data.bin", "alpha\u0000binary\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("globToRegExp", () => {
  it("matches ** across directories", () => {
    const re = globToRegExp("**/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/nested/deep.ts")).toBe(true);
    expect(re.test("a.ts")).toBe(true);
    expect(re.test("a.md")).toBe(false);
  });

  it("matches * within a single segment", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/nested/a.ts")).toBe(false);
  });

  it("matches ? for one character", () => {
    const re = globToRegExp("a?.ts");
    expect(re.test("ab.ts")).toBe(true);
    expect(re.test("abc.ts")).toBe(false);
  });

  it("matches {a,b} alternation", () => {
    const re = globToRegExp("*.{ts,md}");
    expect(re.test("x.ts")).toBe(true);
    expect(re.test("x.md")).toBe(true);
    expect(re.test("x.js")).toBe(false);
  });

  it("matches [abc] classes", () => {
    const re = globToRegExp("[ab].ts");
    expect(re.test("a.ts")).toBe(true);
    expect(re.test("c.ts")).toBe(false);
  });
});

describe("GlobTool", () => {
  const tool = new GlobTool();

  it("finds files matching a pattern", async () => {
    const result = await tool.execute({ pattern: "**/*.ts" }, ctx());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("src/older.ts");
    expect(result.content).toContain("src/nested/deep.ts");
  });

  it("sorts results newest first", async () => {
    const result = await tool.execute({ pattern: "**/*.ts" }, ctx());
    const lines = result.content.split("\n").filter(Boolean);
    expect(lines[0]).toBe("src/nested/deep.ts"); // newest mtime
  });

  it("does not respect .gitignore (asymmetric with Grep)", async () => {
    const result = await tool.execute({ pattern: "**/*.ts" }, ctx());
    expect(result.content).toContain("ignored/hidden.ts");
  });

  it("returns an explicit message when nothing matches", async () => {
    const result = await tool.execute({ pattern: "**/*.nomatch" }, ctx());
    expect(result.content).toContain("No files matched");
  });

  it("caps results and flags truncation", async () => {
    const result = await tool.execute({ pattern: "**/*", limit: 2 }, ctx());
    expect(result.content).toContain("Truncated");
    expect(result.content).toContain("of");
  });

  it("errors on a non-existent path rather than returning nothing", async () => {
    const result = await tool.execute({ pattern: "**/*", path: "does-not-exist" }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("rejects null bytes explicitly", async () => {
    const result = await tool.execute({ pattern: "a\u0000b" }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("null bytes");
  });
});

describe("GrepTool", () => {
  const tool = new GrepTool();

  it("defaults to files_with_matches (list first, read second)", async () => {
    const result = await tool.execute({ pattern: "alpha" }, ctx());
    expect(result.content).toContain("src/older.ts");
    expect(result.content).toContain("docs/readme.md");
    // default mode returns paths only, no line content
    expect(result.content).not.toContain("const alpha");
  });

  it("returns matching lines in content mode", async () => {
    const result = await tool.execute({ pattern: "alpha", output_mode: "content" }, ctx());
    expect(result.content).toContain("src/older.ts:1:const alpha = 1;");
    expect(result.content).toContain("src/newer.ts:1:const alpha = 10;");
  });

  it("returns counts plus a total in count mode", async () => {
    const result = await tool.execute({ pattern: "alpha", output_mode: "count" }, ctx());
    expect(result.content).toMatch(/src\/older\.ts: 1/);
    expect(result.content).toContain("total:");
  });

  it("respects .gitignore for Grep", async () => {
    const result = await tool.execute({ pattern: "alpha", output_mode: "content" }, ctx());
    expect(result.content).not.toContain("secret.txt");
    expect(result.content).not.toContain("ignored/hidden.ts");
  });

  it("filters by glob", async () => {
    const result = await tool.execute({ pattern: "alpha", glob: "*.md", output_mode: "content" }, ctx());
    expect(result.content).toContain("docs/readme.md");
    expect(result.content).not.toContain("src/older.ts");
  });

  it("filters by type", async () => {
    const result = await tool.execute({ pattern: "alpha", type: "ts", output_mode: "files_with_matches" }, ctx());
    expect(result.content).toContain("src/older.ts");
    expect(result.content).not.toContain("docs/readme.md");
  });

  it("errors on an unknown type instead of silently matching nothing", async () => {
    const result = await tool.execute({ pattern: "alpha", type: "notalang" }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("unknown type");
  });

  it("supports case-insensitive matching", async () => {
    const result = await tool.execute({ pattern: "ALPHA", output_mode: "content", case_insensitive: true }, ctx());
    expect(result.content).toContain("src/older.ts");
  });

  it("is case-sensitive by default", async () => {
    const result = await tool.execute({ pattern: "ALPHA", output_mode: "content" }, ctx());
    expect(result.content).toContain("No matches found");
  });

  it("returns the regex diagnostic on an invalid pattern (errors, not silence)", async () => {
    const result = await tool.execute({ pattern: "([unclosed" }, ctx());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("invalid regular expression");
  });

  it("paginates with head_limit and offset", async () => {
    const first = await tool.execute({ pattern: "alpha", output_mode: "files_with_matches", head_limit: 2 }, ctx());
    expect(first.content).toContain("of");
  });

  it("reports an out-of-range offset rather than implying no matches", async () => {
    const result = await tool.execute({ pattern: "alpha", output_mode: "files_with_matches", offset: 9999 }, ctx());
    expect(result.content).toContain("No entries at this offset");
    expect(result.content).not.toBe("No matches found.");
  });

  it("adds context lines when asked", async () => {
    const result = await tool.execute({
      pattern: "beta",
      output_mode: "content",
      glob: "*.ts",
      context: 1,
    }, ctx());
    // beta is on line 2 of older.ts, so line 1 should appear as context
    expect(result.content).toContain("src/older.ts:1-const alpha = 1;");
  });

  it("skips binary files", async () => {
    const result = await tool.execute({ pattern: "alpha", glob: "*.bin", output_mode: "content" }, ctx());
    expect(result.content).toContain("No matches found");
  });

  it("returns an explicit message when nothing matches", async () => {
    const result = await tool.execute({ pattern: "zzzzz_not_present_zzzzz" }, ctx());
    expect(result.content).toBe("No matches found.");
  });
});
