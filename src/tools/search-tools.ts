/**
 * Code navigation tools: Glob and Grep.
 *
 * These follow the de facto tool contract established by Claude Code
 * (https://code.claude.com/docs/en/tools-reference) because that is the shape
 * models are best at using:
 *
 *   Grep: `output_mode` defaults to `files_with_matches` (list first, read
 *         second), supports `head_limit` + `offset` pagination, returns
 *         *errors* rather than silence on bad input, and respects .gitignore.
 *   Glob: `pattern` + `path`, results sorted newest-first, capped at 100 with
 *         an explicit truncation flag. Deliberately does NOT respect .gitignore.
 *
 * Dependency-free and cross-platform. Tested in tests/search-tools.test.ts.
 */

import { z } from "zod";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { join, relative, resolve, sep, extname, dirname } from "node:path";

import type { Tool, ToolContext, ToolResult } from "./mod.js";

// ============================================
// SHARED CONFIGURATION
// ============================================

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", ".cache", ".next", ".nuxt", ".turbo",
  ".output", "dist", "build", "out", "coverage", "__pycache__", ".venv", "venv",
  ".idea", ".vscode",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".mp3", ".mp4", ".wav", ".ogg", ".avi", ".mov", ".mkv", ".webm",
  ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".o", ".a",
  ".wasm", ".woff", ".woff2", ".ttf", ".eot",
]);

/** ripgrep-style `--type` filters, so `type: "ts"` works like the standard. */
const TYPE_FILTERS: Record<string, string[]> = {
  js: [".js", ".jsx", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  tsx: [".tsx"],
  jsx: [".jsx"],
  py: [".py", ".pyi"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh"],
  cs: [".cs"],
  rb: [".rb"],
  php: [".php"],
  swift: [".swift"],
  kotlin: [".kt", ".kts"],
  shell: [".sh", ".bash", ".zsh"],
  html: [".html", ".htm"],
  css: [".css", ".scss", ".sass", ".less"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
  md: [".md", ".markdown"],
  sql: [".sql"],
  toml: [".toml"],
  xml: [".xml"],
};

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file
const GLOB_RESULT_CAP = 100;
const GREP_RESULT_CAP = 250;

function isProbablyBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function containsNullByte(value: string): boolean {
  return value.includes("\u0000");
}

function readFileHead(filePath: string, maxBytes = DEFAULT_MAX_FILE_BYTES): string {
  const fd = openSync(filePath, "r");
  try {
    const size = statSync(filePath).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, 0);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// ============================================
// .gitignore SUPPORT (Grep respects it; Glob deliberately does not)
// ============================================

interface IgnoreRule {
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
}

function parseGitignore(contents: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    let pattern = line;
    let negated = false;
    let directoryOnly = false;

    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    if (pattern.endsWith("/")) {
      directoryOnly = true;
      pattern = pattern.slice(0, -1);
    }

    const anchored = pattern.includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);

    rules.push({ pattern, negated, directoryOnly, anchored });
  }

  return rules;
}

function ruleMatches(rule: IgnoreRule, relPath: string, isDir: boolean): boolean {
  if (rule.directoryOnly && !isDir) return false;

  const target = relPath.split(sep).join("/");
  const matcher = globToRegExp(rule.anchored ? rule.pattern : `**/${rule.pattern}`);

  // A rule matching a directory covers everything beneath it.
  if (matcher.test(target)) return true;

  const segments = target.split("/");
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    if (matcher.test(prefix)) return true;
  }
  return false;
}

class GitignoreFilter {
  private rules: IgnoreRule[] = [];

  static load(root: string): GitignoreFilter {
    const filter = new GitignoreFilter();
    try {
      const file = join(root, ".gitignore");
      if (existsSync(file)) {
        filter.rules = parseGitignore(readFileSync(file, "utf8"));
      }
    } catch {
      // No .gitignore, or unreadable: ignore everything.
    }
    return filter;
  }

  isIgnored(relPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (ruleMatches(rule, relPath, isDir)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }
}

// ============================================
// GLOB PATTERN -> REGEXP
// ============================================

/**
 * Translate a glob into a RegExp anchored to the whole path.
 * Supports `**`, `*`, `?`, `{a,b}` and `[abc]` / `[!abc]`.
 */
export function globToRegExp(pattern: string): RegExp {
  let regex = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          regex += "(?:[^/]+/)*";
          i += 3;
          continue;
        }
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i += 1;
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      i += 1;
      continue;
    }

    if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        regex += "\\[";
        i += 1;
        continue;
      }
      let cls = pattern.slice(i + 1, end);
      if (cls.startsWith("!")) cls = "^" + cls.slice(1);
      regex += "[" + cls + "]";
      i = end + 1;
      continue;
    }

    if (char === "{") {
      const end = pattern.indexOf("}", i + 1);
      if (end === -1) {
        regex += "\\{";
        i += 1;
        continue;
      }
      const alternatives = pattern
        .slice(i + 1, end)
        .split(",")
        .map((alt) => alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      regex += "(?:" + alternatives.join("|") + ")";
      i = end + 1;
      continue;
    }

    regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }

  return new RegExp("^" + regex + "$");
}

/**
 * Build a matcher for the `glob` file filter.
 *
 * ripgrep semantics: a pattern without a slash matches the file *name* anywhere
 * in the tree (so a plain star-plus-.md pattern matches docs/readme.md). A
 * pattern containing a slash is anchored to the search root.
 */
function fileGlobMatcher(pattern: string): RegExp {
  return globToRegExp(pattern.includes("/") ? pattern : `**/${pattern}`);
}

// ============================================
// FILE WALKING
// ============================================

interface WalkedFile {
  absolute: string;
  relative: string;
  mtime: number;
}

function walkFiles(root: string, options: { respectGitignore: boolean; maxFiles?: number }): WalkedFile[] {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const ignore = options.respectGitignore ? GitignoreFilter.load(root) : null;
  const out: WalkedFile[] = [];
  const stack: string[] = [root];

  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop() as string;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = join(dir, entry.name);
      const rel = relative(root, full);

      if (ignore?.isIgnored(rel, entry.isDirectory())) continue;

      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        let mtime = 0;
        try {
          mtime = statSync(full).mtimeMs;
        } catch {
          continue;
        }
        out.push({ absolute: full, relative: rel.split(sep).join("/"), mtime });
      }
    }
  }

  return out;
}

// ============================================
// GLOB TOOL
// ============================================

const GlobInputSchema = z.object({
  pattern: z.string().describe("Glob pattern. Supports **, *, ?, {a,b} and [abc]."),
  path: z.string().optional().describe("Directory to search in. Omit for the working directory."),
  limit: z.number().int().positive().max(2000).optional().describe("Maximum files to return. Defaults to 100."),
});

type GlobInput = z.infer<typeof GlobInputSchema>;

export class GlobTool implements Tool {
  name = "Glob";
  description =
    "Find files by glob pattern. Returns file paths sorted most recently modified first, capped at 100 by default. " +
    "Use this to locate candidate files, then Read the ones that matter.";
  inputSchema = GlobInputSchema;

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const parsed = GlobInputSchema.parse(input) as GlobInput;
    const toolCallId = context?.toolCallId || "";

    // Per the standard: an explicit error beats silently matching nothing.
    if (containsNullByte(parsed.pattern) || containsNullByte(parsed.path || "")) {
      return { toolCallId, content: "Error: pattern and path must not contain null bytes.", isError: true };
    }

    const root = resolve(context?.workingDirectory || process.cwd(), parsed.path || ".");
    const limit = parsed.limit || GLOB_RESULT_CAP;

    if (!existsSync(root)) {
      return { toolCallId, content: `Error: path not found: ${root}`, isError: true };
    }

    try {
      const matcher = globToRegExp(parsed.pattern);
      const files = walkFiles(root, { respectGitignore: false });

      const matched: WalkedFile[] = [];
      for (const file of files) {
        if (matcher.test(file.relative) || matcher.test(file.absolute.split(sep).join("/"))) {
          matched.push(file);
        }
      }

      matched.sort((a, b) => b.mtime - a.mtime);

      if (matched.length === 0) {
        return { toolCallId, content: `No files matched pattern "${parsed.pattern}" under ${root}` };
      }

      const visible = matched.slice(0, limit);
      const truncated = matched.length > limit;

      const header = truncated
        ? `Truncated: showing ${visible.length} of ${matched.length} matches. Narrow the pattern to see more.\n`
        : "";

      return {
        toolCallId,
        content: header + visible.map((f) => f.relative).join("\n"),
      };
    } catch (error) {
      return {
        toolCallId,
        content: `Glob error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }
}

// ============================================
// GREP TOOL
// ============================================

const GrepInputSchema = z.object({
  pattern: z.string().describe("The regular expression to search for in file contents."),
  path: z.string().optional().describe("File or directory to search in. Defaults to the working directory."),
  glob: z.string().optional().describe("Only search files matching this glob, e.g. *.ts or src/**/*.{ts,tsx}."),
  type: z.string().optional().describe("File type filter, e.g. ts, py, rust, go, java, md, json."),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe("files_with_matches: just file paths (default). content: matching lines with file:line. count: matches per file plus a total."),
  case_insensitive: z.boolean().optional().describe("Case-insensitive matching."),
  "-i": z.boolean().optional().describe("Alias for case_insensitive."),
  multiline: z.boolean().optional().describe("Allow the pattern to match across line breaks."),
  head_limit: z.number().int().positive().max(5000).optional().describe("Maximum output entries."),
  offset: z.number().int().min(0).optional().describe("Skip the first N entries, for pagination."),
  context: z.number().int().min(0).max(10).optional().describe("Lines before AND after each match."),
  "-C": z.number().int().min(0).max(10).optional().describe("Alias for context."),
  "-B": z.number().int().min(0).max(10).optional().describe("Lines before each match."),
  "-A": z.number().int().min(0).max(10).optional().describe("Lines after each match."),
});

type GrepInput = z.infer<typeof GrepInputSchema>;

interface GrepMatch {
  file: string;
  line: number;
  text: string;
  before: Array<{ line: number; text: string }>;
  after: Array<{ line: number; text: string }>;
}

export class GrepTool implements Tool {
  name = "Grep";
  description =
    "Search file contents with a regular expression. Prefer this over reading whole files. " +
    "Use output_mode=\"files_with_matches\" to find which files matter, then Read them.";
  inputSchema = GrepInputSchema;

  async execute(input: unknown, context?: ToolContext): Promise<ToolResult> {
    const parsed = GrepInputSchema.parse(input) as GrepInput;
    const toolCallId = context?.toolCallId || "";

    const root = resolve(context?.workingDirectory || process.cwd(), parsed.path || ".");
    const limit = parsed.head_limit || GREP_RESULT_CAP;
    const offset = parsed.offset || 0;
    const mode = parsed.output_mode || "files_with_matches";

    if (containsNullByte(parsed.pattern) || containsNullByte(parsed.path || "")) {
      return { toolCallId, content: "Error: pattern and path must not contain null bytes.", isError: true };
    }

    if (!existsSync(root)) {
      return { toolCallId, content: `Error: path not found: ${root}`, isError: true };
    }

    // Errors, not silence: a bad regex must surface the diagnostic, otherwise
    // the model concludes "no matches" and gives up.
    const ignoreCase = parsed.case_insensitive ?? parsed["-i"] ?? false;
    let flags = parsed.multiline ? "su" : "su";
    if (ignoreCase) flags += "i";

    let regex: RegExp;
    try {
      regex = new RegExp(parsed.pattern, flags);
    } catch (error) {
      return {
        toolCallId,
        content: `Error: invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    let fileMatcher: RegExp | null = null;
    if (parsed.glob) {
      try {
        fileMatcher = fileGlobMatcher(parsed.glob);
      } catch (error) {
        return {
          toolCallId,
          content: `Error: invalid glob "${parsed.glob}": ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    }

    const typeExtensions = parsed.type ? TYPE_FILTERS[parsed.type.toLowerCase()] : null;
    if (parsed.type && !typeExtensions) {
      return {
        toolCallId,
        content: `Error: unknown type "${parsed.type}". Known types: ${Object.keys(TYPE_FILTERS).join(", ")}`,
        isError: true,
      };
    }

    const beforeCount = parsed["-B"] ?? parsed.context ?? 0;
    const afterCount = parsed["-A"] ?? parsed.context ?? 0;

    try {
      const files = walkFiles(root, { respectGitignore: true });

      const matches: GrepMatch[] = [];
      const fileHits: Array<{ file: string; count: number }> = [];
      let totalMatches = 0;

      for (const file of files) {
        if (isProbablyBinary(file.absolute)) continue;
        if (typeExtensions && !typeExtensions.includes(extname(file.absolute).toLowerCase())) continue;

        if (fileMatcher && !fileMatcher.test(file.relative) && !fileMatcher.test(file.absolute.split(sep).join("/"))) {
          continue;
        }

        let content: string;
        try {
          content = readFileHead(file.absolute);
        } catch {
          continue;
        }
        if (content.includes("\u0000")) continue;

        const lines = content.split("\n");
        let countInFile = 0;

        for (let index = 0; index < lines.length; index++) {
          const line = lines[index];
          if (!regex.test(line)) continue;

          countInFile++;
          totalMatches++;

          if (mode === "content") {
            const before = lines
              .slice(Math.max(0, index - beforeCount), index)
              .map((text, i) => ({ line: index - beforeCount + i + 1, text }));
            const after = lines
              .slice(index + 1, index + 1 + afterCount)
              .map((text, i) => ({ line: index + 2 + i, text }));

            matches.push({ file: file.relative, line: index + 1, text: line, before, after });
          }
        }

        if (countInFile > 0) {
          fileHits.push({ file: file.relative, count: countInFile });
        }
      }

      return {
        toolCallId,
        content: this.render(mode, fileHits, matches, totalMatches, limit, offset),
      };
    } catch (error) {
      return {
        toolCallId,
        content: `Grep error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private render(
    mode: "content" | "files_with_matches" | "count",
    fileHits: Array<{ file: string; count: number }>,
    matches: GrepMatch[],
    totalMatches: number,
    limit: number,
    offset: number
  ): string {
    // Pagination: an out-of-range offset must say so, not imply "no matches".
    const describe = (total: number): string | null => {
      if (total === 0) return "No matches found.";
      if (offset >= total) return `No entries at this offset. There are ${total} entries; use offset < ${total}.`;
      return null;
    };

    if (mode === "files_with_matches") {
      const message = describe(fileHits.length);
      if (message) return message;
      const page = fileHits.slice(offset, offset + limit).map((f) => f.file);
      const remaining = fileHits.length - offset - page.length;
      const header = remaining > 0 ? `Showing ${page.length} of ${fileHits.length} files (offset ${offset}):\n` : "";
      return header + page.join("\n");
    }

    if (mode === "count") {
      const message = describe(fileHits.length);
      if (message) return message;
      const page = fileHits.slice(offset, offset + limit);
      const rows = page.map((f) => `${f.file}: ${f.count}`);
      // The total covers every match, even when the listing is truncated.
      rows.push(`total: ${totalMatches}`);
      const remaining = fileHits.length - offset - page.length;
      const header = remaining > 0 ? `Showing ${page.length} of ${fileHits.length} files (offset ${offset}):\n` : "";
      return header + rows.join("\n");
    }

    const message = describe(matches.length);
    if (message) return message;
    const page = matches.slice(offset, offset + limit);

    const lines: string[] = [];
    for (const match of page) {
      for (const before of match.before) {
        lines.push(`${match.file}:${before.line}-${before.text}`);
      }
      lines.push(`${match.file}:${match.line}:${match.text}`);
      for (const after of match.after) {
        lines.push(`${match.file}:${after.line}-${after.text}`);
      }
    }

    const remaining = matches.length - offset - page.length;
    const header = remaining > 0 ? `Showing ${page.length} of ${matches.length} matches (offset ${offset}):\n` : "";
    return header + lines.join("\n");
  }
}
