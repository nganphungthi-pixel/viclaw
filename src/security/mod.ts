/**
 * Bug Bounty & Security Scanning Patterns
 * Inspired by claude-bug-bounty and security best practices
 * 20 vulnerability classes with autonomous hunting patterns
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export interface VulnResult {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  file: string;
  line: number;
  code: string;
  recommendation: string;
  cweId?: string;
}

export interface ScanReport {
  timestamp: number;
  filesScanned: number;
  totalVulns: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  vulns: VulnResult[];
  duration: number;
}

// ============================================
// VULNERABILITY SCANNERS
// ============================================

export class SecurityScanner {
  private vulns: VulnResult[] = [];
  private filesScanned = 0;

  async scanDirectory(dirPath: string, extensions?: string[]): Promise<ScanReport> {
    const startTime = Date.now();
    this.vulns = [];
    this.filesScanned = 0;

    const files = this.getFiles(dirPath, extensions || [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb"]);

    for (const file of files) {
      await this.scanFile(file);
    }

    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const vuln of this.vulns) {
      bySeverity[vuln.severity] = (bySeverity[vuln.severity] || 0) + 1;
      byCategory[vuln.category] = (byCategory[vuln.category] || 0) + 1;
    }

    return {
      timestamp: Date.now(),
      filesScanned: this.filesScanned,
      totalVulns: this.vulns.length,
      bySeverity,
      byCategory,
      vulns: this.vulns,
      duration: Date.now() - startTime,
    };
  }

  private getFiles(dirPath: string, extensions: string[]): string[] {
    const files: string[] = [];

    const scan = (path: string) => {
      const entries = readdirSync(path);
      for (const entry of entries) {
        const fullPath = join(path, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules, .git, dist, build
          if (["node_modules", ".git", "dist", "build", ".next", ".venv", "vendor"].includes(entry)) {
            continue;
          }
          scan(fullPath);
        } else if (extensions.includes(extname(entry))) {
          files.push(fullPath);
        }
      }
    };

    scan(dirPath);
    return files;
  }

  private async scanFile(filePath: string): Promise<void> {
    try {
      const content = readFileSync(filePath, "utf-8");
      this.filesScanned++;

      // Run all vulnerability scanners
      this.scanSQLInjection(filePath, content);
      this.scanXSS(filePath, content);
      this.scanCommandInjection(filePath, content);
      this.scanPathTraversal(filePath, content);
      this.scanSSRF(filePath, content);
      this.scanHardcodedSecrets(filePath, content);
      this.scanInsecureCrypto(filePath, content);
      this.scanPrototypePollution(filePath, content);
      this.scanDeserialization(filePath, content);
      this.scanOpenRedirect(filePath, content);
      this.scanCSRF(filePath, content);
      this.scanIDOR(filePath, content);
      this.scanRateLimiting(filePath, content);
      this.scanCORS(filePath, content);
      this.scanHeaders(filePath, content);
      this.scanDependencyRisks(filePath, content);
      this.scanErrorHandling(filePath, content);
      this.scanInputValidation(filePath, content);
      this.scanAccessControl(filePath, content);
      this.scanDataExposure(filePath, content);
    } catch {
      // Skip unreadable files
    }
  }

  // ============================================
  // 20 VULNERABILITY CLASS SCANNERS
  // ============================================

  private scanSQLInjection(file: string, content: string): void {
    const patterns = [
      { regex: /query\s*\(\s*["'`].*\$\{/, title: "SQL Injection via string interpolation", cwe: "CWE-89" },
      { regex: /execute\s*\(\s*["'].*%s/, title: "SQL Injection via string formatting", cwe: "CWE-89" },
      { regex: /f["']SELECT.*\{/, title: "SQL Injection via f-string", cwe: "CWE-89" },
      // Classic concatenation: query("SELECT ... " + userId). The keyword
      // anchor keeps plain string + string joins (e.g. log lines) out.
      { regex: /(query|execute)\s*\(\s*["'`](SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+/, title: "SQL Injection via string concatenation", cwe: "CWE-89" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "critical",
            category: "SQL Injection",
            title,
            description: "User input directly interpolated into SQL query",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use parameterized queries or ORM with prepared statements",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanXSS(file: string, content: string): void {
    const patterns = [
      { regex: /innerHTML\s*=/, title: "Cross-Site Scripting (XSS) via innerHTML", cwe: "CWE-79" },
      { regex: /document\.write\s*\(/, title: "XSS via document.write", cwe: "CWE-79" },
      { regex: /dangerouslySetInnerHTML/, title: "React XSS via dangerouslySetInnerHTML", cwe: "CWE-79" },
      { regex: /v-html\s*=/, title: "Vue.js XSS via v-html", cwe: "CWE-79" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "high",
            category: "XSS",
            title,
            description: "Unsanitized HTML rendering",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use textContent or sanitize with DOMPurify before rendering",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanCommandInjection(file: string, content: string): void {
    const patterns = [
      { regex: /exec\s*\(\s*["'].*\$\{/, title: "Command Injection via string interpolation", cwe: "CWE-78" },
      { regex: /spawn\s*\(\s*["'].*\$\{/, title: "Command Injection via spawn", cwe: "CWE-78" },
      { regex: /child_process.*exec/, title: "Unsafe child_process.exec usage", cwe: "CWE-78" },
      { regex: /os\.system\s*\(/, title: "Python os.system command injection", cwe: "CWE-78" },
      { regex: /subprocess.*shell\s*=\s*True/, title: "Python subprocess shell=True injection", cwe: "CWE-78" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        // Parentheses are load-bearing here: without them, && binds tighter
        // than || and EVERY line containing "+" is flagged critical (observed:
        // 320 false positives on our own codebase). Only flag when the
        // dangerous sink pattern matched AND string building is present.
        if (regex.test(line) && (line.includes("${") || line.includes("+") || line.includes("' +"))) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "critical",
            category: "Command Injection",
            title,
            description: "User input may be executed as system command",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use execFile/spawn with array arguments, never shell interpolate",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanPathTraversal(file: string, content: string): void {
    const patterns = [
      { regex: /readFile\s*\(\s*req/, title: "Path Traversal via user input", cwe: "CWE-22" },
      { regex: /createReadStream\s*\(.*req/, title: "Path Traversal via stream", cwe: "CWE-22" },
      { regex: /sendFile\s*\(.*req/, title: "Path Traversal via sendFile", cwe: "CWE-22" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line) && !line.includes("path.resolve") && !line.includes("path.join")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "high",
            category: "Path Traversal",
            title,
            description: "File path from user input without sanitization",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use path.resolve with allowlist validation",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanSSRF(file: string, content: string): void {
    const patterns = [
      { regex: /fetch\s*\(\s*req\./, title: "SSRF via user-provided URL", cwe: "CWE-918" },
      { regex: /axios\.(get|post)\s*\(.*req\./, title: "SSRF via axios with user input", cwe: "CWE-918" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line) && !line.includes("validateURL") && !line.includes("allowedDomains")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "high",
            category: "SSRF",
            title,
            description: "HTTP request to user-controlled URL",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Validate URL against allowlist and block internal IPs",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanHardcodedSecrets(file: string, content: string): void {
    const patterns = [
      { regex: /API_KEY\s*=\s*["'][^"'${}]+["']/, title: "Hardcoded API key", cwe: "CWE-798" },
      { regex: /SECRET\s*=\s*["'][^"'${}]+["']/, title: "Hardcoded secret", cwe: "CWE-798" },
      { regex: /PASSWORD\s*=\s*["'][^"'${}]+["']/, title: "Hardcoded password", cwe: "CWE-259" },
      { regex: /TOKEN\s*=\s*["'][^"'${}]+["']/, title: "Hardcoded token", cwe: "CWE-798" },
      { regex: /-----BEGIN .* PRIVATE KEY-----/, title: "Embedded private key", cwe: "CWE-321" },
      { regex: /AKIA[0-9A-Z]{16}/, title: "AWS Access Key ID", cwe: "CWE-798" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line) && !line.includes("process.env") && !line.includes("#") && !line.includes("example")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "critical",
            category: "Hardcoded Secret",
            title,
            description: "Credential embedded in source code",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Move to environment variables or secret manager",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanInsecureCrypto(file: string, content: string): void {
    const patterns = [
      { regex: /crypto\.createHash\s*\(\s*["']md5["']/, title: "Weak hash: MD5", cwe: "CWE-328" },
      { regex: /crypto\.createHash\s*\(\s*["']sha1["']/, title: "Weak hash: SHA1", cwe: "CWE-328" },
      { regex: /DES|RC4|Blowfish/, title: "Weak cipher algorithm", cwe: "CWE-327" },
      { regex: /Math\.random\s*\(/, title: "Insecure randomness", cwe: "CWE-330" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "medium",
            category: "Insecure Cryptography",
            title,
            description: "Weak or insecure cryptographic function",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use SHA-256+, AES, or crypto.randomBytes",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanPrototypePollution(file: string, content: string): void {
    const patterns = [
      { regex: /Object\.assign\s*\(\s*\{\}/, title: "Prototype pollution via Object.assign", cwe: "CWE-1321" },
      { regex: /merge\s*\(.*,.*req/, title: "Prototype pollution via merge", cwe: "CWE-1321" },
      { regex: /__proto__/, title: "Direct __proto__ access", cwe: "CWE-1321" },
      { regex: /constructor\.prototype/, title: "Constructor prototype access", cwe: "CWE-1321" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "high",
            category: "Prototype Pollution",
            title,
            description: "Potential prototype pollution vulnerability",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use Object.create(null) or validate input keys",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanDeserialization(file: string, content: string): void {
    const patterns = [
      { regex: /JSON\.parse\s*\(.*req\./, title: "Insecure deserialization", cwe: "CWE-502" },
      { regex: /eval\s*\(/, title: "Code injection via eval", cwe: "CWE-95" },
      { regex: /Function\s*\(/, title: "Dynamic function creation", cwe: "CWE-95" },
      { regex: /new Function\s*\(/, title: "Unsafe Function constructor", cwe: "CWE-95" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "critical",
            category: "Deserialization",
            title,
            description: "Unsafe code execution from untrusted input",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Avoid eval/Function, use safe parsing libraries",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanOpenRedirect(file: string, content: string): void {
    const patterns = [
      { regex: /res\.redirect\s*\(.*req\./, title: "Open redirect via user input", cwe: "CWE-601" },
      { regex: /window\.location\s*=.*query/, title: "Client-side open redirect", cwe: "CWE-601" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "medium",
            category: "Open Redirect",
            title,
            description: "Redirect to user-controlled URL",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Validate redirect URL against allowlist",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanCSRF(file: string, content: string): void {
    const patterns = [
      { regex: /app\.post\s*\(|app\.put\s*\(|app\.delete\s*\(/, title: "Missing CSRF protection", cwe: "CWE-352" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line) && !content.includes("csurf") && !content.includes("csrf") && !content.includes("sameSite")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "medium",
            category: "CSRF",
            title,
            description: "State-changing endpoint without CSRF protection",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Add CSRF tokens or SameSite cookie attribute",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanIDOR(file: string, content: string): void {
    const patterns = [
      { regex: /\/api\/.*\/:id/, title: "Potential IDOR: direct object reference", cwe: "CWE-639" },
      { regex: /findById\s*\(.*req\.params/, title: "IDOR: no authorization check", cwe: "CWE-639" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line) && !content.includes("authorize") && !content.includes("checkOwnership")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "high",
            category: "IDOR",
            title,
            description: "Direct object reference without authorization",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Add ownership check before accessing resource",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanRateLimiting(file: string, content: string): void {
    if (content.includes("app.use") && content.includes("post") && !content.includes("rateLimit") && !content.includes("express-rate-limit")) {
      this.vulns.push({
        id: crypto.randomUUID(),
        severity: "low",
        category: "Rate Limiting",
        title: "No rate limiting detected",
        description: "Application endpoints lack rate limiting",
        file,
        line: 0,
        code: "No rate limit middleware found",
        recommendation: "Add express-rate-limit or similar middleware",
        cweId: "CWE-770",
      });
    }
  }

  private scanCORS(file: string, content: string): void {
    const patterns = [
      { regex: /cors\s*\(\s*\{\s*origin\s*:\s*["']\*/, title: "Wildcard CORS", cwe: "CWE-942" },
      { regex: /Access-Control-Allow-Origin.*\*/, title: "Wildcard CORS header", cwe: "CWE-942" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "medium",
            category: "CORS",
            title,
            description: "Wildcard CORS allows any origin",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Restrict CORS to specific origins",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanHeaders(file: string, content: string): void {
    if (content.includes("express") && !content.includes("helmet") && !content.includes("X-Frame-Options") && !content.includes("Content-Security-Policy")) {
      this.vulns.push({
        id: crypto.randomUUID(),
        severity: "info",
        category: "Security Headers",
        title: "Missing security headers",
        description: "Application doesn't set recommended security headers",
        file,
        line: 0,
        code: "No helmet or security headers found",
        recommendation: "Add helmet middleware or manual headers",
        cweId: "CWE-693",
      });
    }
  }

  private scanDependencyRisks(file: string, content: string): void {
    if (extname(file) === "package.json") {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        // Check for known risky patterns
        if (deps["lodash"] && !deps["lodash-es"]) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "info",
            category: "Dependency",
            title: "Use lodash-es for tree-shaking",
            description: "Full lodash package increases bundle size",
            file,
            line: 0,
            code: "lodash in dependencies",
            recommendation: "Use individual lodash functions or lodash-es",
          });
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  private scanErrorHandling(file: string, content: string): void {
    const patterns = [
      { regex: /catch\s*\(\s*\)\s*\{/, title: "Empty catch block", cwe: "CWE-390" },
      { regex: /catch\s*\(.*\)\s*\{\s*\/\/.*\s*\}/, title: "Swallowed error", cwe: "CWE-390" },
      { regex: /\.catch\s*\(\s*\(\)\s*=>\s*\{.*\}\s*\)/, title: "Empty promise catch", cwe: "CWE-390" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "low",
            category: "Error Handling",
            title,
            description: "Error is caught but not handled",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Log errors or implement retry logic",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanInputValidation(file: string, content: string): void {
    // Check if endpoints exist without validation libraries
    if ((content.includes("app.post") || content.includes("app.put")) && !content.includes("zod") && !content.includes("joi") && !content.includes("yup") && !content.includes("class-validator")) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (line.includes("app.post") || line.includes("app.put") || line.includes("app.delete")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "medium",
            category: "Input Validation",
            title: "Input without validation",
            description: "Endpoint accepts input without validation",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Add Zod, Joi, or similar validation schema",
            cweId: "CWE-20",
          });
        }
      });
    }
  }

  private scanAccessControl(file: string, content: string): void {
    const patterns = [
      { regex: /admin|superuser|root/, title: "Hardcoded admin check", cwe: "CWE-285" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line) && (line.includes("===") || line.includes("==")) && !line.includes("env") && !line.includes("config")) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "high",
            category: "Access Control",
            title,
            description: "Hardcoded role or user check",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Use RBAC/ABAC with database-driven permissions",
            cweId: cwe,
          });
        }
      });
    }
  }

  private scanDataExposure(file: string, content: string): void {
    const patterns = [
      { regex: /res\.json\s*\(.*user/, title: "User data exposure", cwe: "CWE-200" },
      { regex: /console\.log\s*\(.*password/, title: "Password logging", cwe: "CWE-532" },
    ];

    for (const { regex, title, cwe } of patterns) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          this.vulns.push({
            id: crypto.randomUUID(),
            severity: "medium",
            category: "Data Exposure",
            title,
            description: "Sensitive data may be exposed",
            file,
            line: idx + 1,
            code: line.trim(),
            recommendation: "Filter sensitive fields before logging/sending",
            cweId: cwe,
          });
        }
      });
    }
  }
}

// Global scanner instance
let scannerInstance: SecurityScanner | null = null;

export function getSecurityScanner(): SecurityScanner {
  if (!scannerInstance) {
    scannerInstance = new SecurityScanner();
  }
  return scannerInstance;
}
