/**
 * Multi-Search Engine Research System
 * Google, Brave, Bing, Yahoo, DuckDuckGo, Tavily, GitHub Search
 * With research subagent planning capability
 */

import { EventEmitter } from "node:events";

export type SearchEngine = "google" | "brave" | "bing" | "yahoo" | "duckduckgo" | "tavily" | "github" | "exa";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: SearchEngine;
  score?: number;
}

export interface ResearchPlan {
  query: string;
  engines: SearchEngine[];
  maxResults: number;
  depth: "shallow" | "medium" | "deep";
  followLinks: boolean;
}

export interface ResearchReport {
  query: string;
  summary: string;
  findings: string[];
  sources: SearchResult[];
  engines: SearchEngine[];
  duration: number;
}

export class ResearchEngine extends EventEmitter {
  private tavilyApiKey?: string;
  private braveApiKey?: string;
  private exaApiKey?: string;
  private serperApiKey?: string; // Google via Serper

  constructor() {
    super();
    this.tavilyApiKey = process.env.TAVILY_API_KEY;
    this.braveApiKey = process.env.BRAVE_API_KEY;
    this.exaApiKey = process.env.EXA_API_KEY;
    this.serperApiKey = process.env.SERPER_API_KEY;
  }

  /**
   * Create research plan
   */
  createPlan(query: string, depth: "shallow" | "medium" | "deep" = "medium"): ResearchPlan {
    const engines: SearchEngine[] = ["duckduckgo"]; // Always free

    if (this.braveApiKey) engines.push("brave");
    if (this.tavilyApiKey) engines.push("tavily");
    if (this.exaApiKey) engines.push("exa");
    if (this.serperApiKey) engines.push("google");

    engines.push("bing", "yahoo", "github");

    return {
      query,
      engines: [...new Set(engines)],
      maxResults: depth === "shallow" ? 10 : depth === "medium" ? 25 : 50,
      depth,
      followLinks: depth !== "shallow",
    };
  }

  /**
   * Execute research across multiple engines
   */
  async research(plan: ResearchPlan): Promise<ResearchReport> {
    const startTime = Date.now();
    const allResults: SearchResult[] = [];

    this.emit("research:start", plan);

    for (const engine of plan.engines) {
      try {
        this.emit("research:engine", { engine, status: "searching" });
        const results = await this.searchEngine(engine, plan.query, Math.ceil(plan.maxResults / plan.engines.length));
        allResults.push(...results);
        this.emit("research:engine", { engine, status: "done", count: results.length });
      } catch (error) {
        this.emit("research:engine", { engine, status: "error", error });
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = allResults.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Fetch content from top links if followLinks enabled
    let findings: string[] = [];
    if (plan.followLinks && unique.length > 0) {
      const topLinks = unique.slice(0, 5);
      for (const link of topLinks) {
        try {
          const content = await this.fetchContent(link.url);
          if (content) {
            findings.push(`[${link.title}](${link.url})\n${content.slice(0, 500)}`);
          }
        } catch {
          // Skip failed fetches
        }
      }
    }

    // Generate summary
    const summary = this.generateSummary(plan.query, unique, findings);

    const report: ResearchReport = {
      query: plan.query,
      summary,
      findings,
      sources: unique.slice(0, plan.maxResults),
      engines: plan.engines,
      duration: Date.now() - startTime,
    };

    this.emit("research:done", report);
    return report;
  }

  /**
   * Quick research (one-shot)
   */
  async quickResearch(query: string): Promise<ResearchReport> {
    const plan = this.createPlan(query, "shallow");
    return this.research(plan);
  }

  /**
   * Deep research (all engines, follow links)
   */
  async deepResearch(query: string): Promise<ResearchReport> {
    const plan = this.createPlan(query, "deep");
    return this.research(plan);
  }

  // ============================================
  // SEARCH ENGINE IMPLEMENTATIONS
  // ============================================

  private async searchEngine(engine: SearchEngine, query: string, limit: number): Promise<SearchResult[]> {
    switch (engine) {
      case "duckduckgo":
        return this.searchDuckDuckGo(query, limit);
      case "brave":
        return this.searchBrave(query, limit);
      case "google":
        return this.searchGoogle(query, limit);
      case "bing":
        return this.searchBing(query, limit);
      case "yahoo":
        return this.searchYahoo(query, limit);
      case "tavily":
        return this.searchTavily(query, limit);
      case "github":
        return this.searchGitHub(query, limit);
      case "exa":
        return this.searchExa(query, limit);
      default:
        return [];
    }
  }

  private async searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    // DuckDuckGo HTML scraping (no API key needed)
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Viclaw/1.0" },
    });

    const html = await response.text();
    const results: SearchResult[] = [];

    // Simple extraction from HTML
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*<\/a>)*[^<]*)<\/a>/gi;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
      results.push({
        title: match[2].replace(/<[^>]*>/g, "").trim(),
        url: match[1],
        snippet: match[3].replace(/<[^>]*>/g, "").trim(),
        engine: "duckduckgo",
      });
    }

    return results;
  }

  private async searchBrave(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.braveApiKey) return [];

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": this.braveApiKey,
      },
    });

    const data = await response.json() as {
      web?: { results?: Array<{ title: string; url: string; description: string }>; };
    };

    return (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      engine: "brave" as SearchEngine,
    }));
  }

  private async searchGoogle(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.serperApiKey) return [];

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": this.serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: limit }),
    });

    const data = await response.json() as {
      organic?: Array<{ title: string; link: string; snippet: string }>;
    };

    return (data.organic || []).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      engine: "google" as SearchEngine,
    }));
  }

  private async searchBing(query: string, limit: number): Promise<SearchResult[]> {
    const key = process.env.BING_API_KEY;
    if (!key) return [];

    const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${limit}`, {
      headers: { "Ocp-Apim-Subscription-Key": key },
    });

    const data = await response.json() as {
      webPages?: { value?: Array<{ name: string; url: string; snippet: string }>; };
    };

    return (data.webPages?.value || []).map(r => ({
      title: r.name,
      url: r.url,
      snippet: r.snippet,
      engine: "bing" as SearchEngine,
    }));
  }

  private async searchYahoo(query: string, limit: number): Promise<SearchResult[]> {
    // Yahoo uses Bing API underneath, fallback to DuckDuckGo
    return this.searchDuckDuckGo(query, limit);
  }

  private async searchTavily(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.tavilyApiKey) return [];

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.tavilyApiKey,
        query,
        max_results: limit,
        search_depth: "advanced",
      }),
    });

    const data = await response.json() as {
      results?: Array<{ title: string; url: string; content: string; score?: number }>;
    };

    return (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      engine: "tavily" as SearchEngine,
      score: r.score,
    }));
  }

  private async searchGitHub(query: string, limit: number): Promise<SearchResult[]> {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`, {
      headers,
    });

    const data = await response.json() as {
      items?: Array<{ name: string; html_url: string; description: string; }>;
    };

    return (data.items || []).map(r => ({
      title: r.name,
      url: r.html_url,
      snippet: r.description || "",
      engine: "github" as SearchEngine,
    }));
  }

  private async searchExa(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.exaApiKey) return [];

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.exaApiKey,
      },
      body: JSON.stringify({
        query,
        numResults: limit,
        useAutoprompt: true,
      }),
    });

    const data = await response.json() as {
      results?: Array<{ title: string; url: string; text: string }>;
    };

    return (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.text.slice(0, 300),
      engine: "exa" as SearchEngine,
    }));
  }

  private async fetchContent(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Viclaw/1.0" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;

      const html = await response.text();
      // Extract text from HTML (simple)
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
    } catch {
      return null;
    }
  }

  private generateSummary(query: string, results: SearchResult[], findings: string[]): string {
    let summary = `# Research Report: ${query}\n\n`;
    summary += `**Sources:** ${results.length} | **Engines:** ${results.map(r => r.engine).filter((v, i, a) => a.indexOf(v) === i).join(", ")}\n\n`;

    if (findings.length > 0) {
      summary += `## Key Findings\n\n`;
      findings.slice(0, 5).forEach(f => {
        summary += `${f}\n\n---\n\n`;
      });
    }

    summary += `## Sources\n\n`;
    results.slice(0, 10).forEach((r, i) => {
      summary += `${i + 1}. [${r.title}](${r.url}) - ${r.snippet.slice(0, 150)}...\n`;
    });

    return summary;
  }
}

// Global research engine
let researchInstance: ResearchEngine | null = null;

export function getResearchEngine(): ResearchEngine {
  if (!researchInstance) {
    researchInstance = new ResearchEngine();
  }
  return researchInstance;
}
