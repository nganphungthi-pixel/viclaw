/**
 * Viclaw Plugins Registry
 * All plugins from Claude's plugin catalog
 * Plugins are meta-packages that bundle skills + connectors + workflows
 */

export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  installs: number;
  skills: string[];
  connectors: string[];
  workflows: string[];
  enabled: boolean;
}

export const ALL_PLUGINS: PluginEntry[] = [
  // ============================================
  // ANTHROPIC CORE PLUGINS
  // ============================================
  {
    id: "productivity",
    name: "Productivity",
    description: "Manage tasks, plan your day, and build up memory of important context. Syncs with calendar, email, and chat.",
    category: "productivity",
    author: "Anthropic",
    installs: 381200,
    skills: ["internal-comms", "doc-coauthoring"],
    connectors: ["google-calendar", "gmail", "slack", "notion", "google-drive"],
    workflows: ["daily-planning", "task-sync", "meeting-prep", "follow-up"],
    enabled: true,
  },
  {
    id: "design",
    name: "Design",
    description: "Accelerate design workflows — critique, design system management, UX writing, accessibility audits, research synthesis.",
    category: "design",
    author: "Anthropic",
    installs: 347200,
    skills: ["canvas-design", "brand-guidelines", "algorithmic-art", "ui-ux-designer"],
    connectors: ["figma", "canva", "miro", "tldraw", "excalidraw", "sketch"],
    workflows: ["design-critique", "accessibility-audit", "design-system-sync"],
    enabled: true,
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Create content, plan campaigns, and analyze performance across marketing channels. Maintain brand voice consistency.",
    category: "marketing",
    author: "Anthropic",
    installs: 288400,
    skills: ["internal-comms", "doc-coauthoring"],
    connectors: ["hubspot", "klaviyo", "mailerlite", "ahrefs", "similarweb", "g2", "bitly"],
    workflows: ["campaign-plan", "content-calendar", "performance-report", "competitor-analysis"],
    enabled: true,
  },
  {
    id: "data",
    name: "Data",
    description: "Write SQL, explore datasets, and generate insights faster. Build visualizations and dashboards.",
    category: "data-platform",
    author: "Anthropic",
    installs: 273900,
    skills: [],
    connectors: ["postgres", "snowflake", "bigquery", "databricks", "hex", "metabase", "tableau", "airtable", "motherduck"],
    workflows: ["sql-query", "dashboard-build", "data-exploration", "insight-report"],
    enabled: true,
  },
  {
    id: "engineering",
    name: "Engineering",
    description: "Streamline engineering workflows — standups, code review, architecture decisions, incident response, technical documentation.",
    category: "code",
    author: "Anthropic",
    installs: 258600,
    skills: ["nextjs-expert", "react-expert", "mcp-builder", "web-artifacts-builder", "tailwind-shadcn"],
    connectors: ["github", "linear", "sentry", "vercel", "postman", "kubernetes", "grafana"],
    workflows: ["standup", "code-review", "incident-response", "architecture-decision"],
    enabled: true,
  },
  {
    id: "finance",
    name: "Finance",
    description: "Streamline finance and accounting, from journal entries and reconciliation to financial statements and variance analysis.",
    category: "finance",
    author: "Anthropic",
    installs: 239100,
    skills: [],
    connectors: ["stripe", "quickbooks", "brex", "mercury", "ramp", "paypal", "square"],
    workflows: ["month-end-close", "reconciliation", "variance-analysis", "financial-report"],
    enabled: true,
  },
  {
    id: "product-management",
    name: "Product Management",
    description: "Write feature specs, plan roadmaps, and synthesize user research faster.",
    category: "project-management",
    author: "Anthropic",
    installs: 213600,
    skills: ["doc-coauthoring"],
    connectors: ["linear", "asana", "clickup", "posthog", "jira", "notion"],
    workflows: ["feature-spec", "roadmap-plan", "research-synthesis", "stakeholder-update"],
    enabled: true,
  },
  {
    id: "operations",
    name: "Operations",
    description: "Optimize business operations — vendor management, process documentation, change management, capacity planning.",
    category: "productivity",
    author: "Anthropic",
    installs: 204200,
    skills: ["doc-coauthoring"],
    connectors: ["monday", "smartsheet", "zapier", "n8n", "workato"],
    workflows: ["process-doc", "vendor-track", "capacity-plan", "change-manage"],
    enabled: true,
  },
  {
    id: "legal",
    name: "Legal",
    description: "Speed up contract review, NDA triage, and compliance workflows. Draft legal briefs, organize precedent research.",
    category: "legal",
    author: "Anthropic",
    installs: 198000,
    skills: [],
    connectors: ["harvey", "midpage", "docusign", "docuseal", "signnow", "signwell"],
    workflows: ["contract-review", "nda-triage", "precedent-research", "compliance-check"],
    enabled: true,
  },
  {
    id: "sales",
    name: "Sales",
    description: "Prospect, craft outreach, and build deal strategy faster. Prep for calls, manage pipeline, write personalized messaging.",
    category: "sales",
    author: "Anthropic",
    installs: 189600,
    skills: ["internal-comms"],
    connectors: ["hubspot", "apollo", "salesforce", "zoominfo", "clay", "close-crm", "attio"],
    workflows: ["prospect-research", "outreach-draft", "deal-strategy", "call-prep"],
    enabled: true,
  },
  {
    id: "brand-voice",
    name: "Brand Voice",
    description: "Discover your brand voice from existing documents, generate enforceable guidelines, validate AI-generated content.",
    category: "design",
    author: "Tribe AI",
    installs: 182200,
    skills: ["brand-guidelines", "theme-factory"],
    connectors: ["google-drive", "notion", "box"],
    workflows: ["voice-discovery", "guideline-gen", "content-validation"],
    enabled: true,
  },
  {
    id: "enterprise-search",
    name: "Enterprise Search",
    description: "Search across all company tools in one place. Find anything across email, chat, documents, and wikis.",
    category: "knowledge",
    author: "Anthropic",
    installs: 149600,
    skills: [],
    connectors: ["google-drive", "gmail", "notion", "slack", "confluence", "glean", "guru", "mem"],
    workflows: ["unified-search", "cross-tool-context"],
    enabled: true,
  },
  {
    id: "human-resources",
    name: "Human Resources",
    description: "Streamline people operations — recruiting, onboarding, performance reviews, compensation analysis, policy guidance.",
    category: "hr",
    author: "Anthropic",
    installs: 117200,
    skills: ["internal-comms", "doc-coauthoring"],
    connectors: ["indeed", "dice", "metaview", "udemy", "greenhouse", "lever"],
    workflows: ["job-desc", "interview-prep", "review-template", "onboarding-checklist"],
    enabled: true,
  },
  {
    id: "customer-support",
    name: "Customer Support",
    description: "Triage tickets, draft responses, escalate issues, and build your knowledge base.",
    category: "support",
    author: "Anthropic",
    installs: 99100,
    skills: ["doc-coauthoring"],
    connectors: ["intercom", "zendesk", "pylon", "zoho-desk", "jam"],
    workflows: ["ticket-triage", "response-draft", "knowledge-base", "escalation"],
    enabled: true,
  },

  // ============================================
  // THIRD-PARTY PLUGINS
  // ============================================
  {
    id: "apollo-plugin",
    name: "Apollo",
    description: "Prospect, enrich leads, and load outreach sequences with Apollo.io",
    category: "sales",
    author: "Apollo.io",
    installs: 80500,
    skills: [],
    connectors: ["apollo"],
    workflows: ["lead-gen", "enrichment", "outreach"],
    enabled: true,
  },
  {
    id: "slack-salesforce",
    name: "Slack by Salesforce",
    description: "Slack integration for searching messages, sending communications, managing canvases",
    category: "communication",
    author: "Salesforce",
    installs: 75900,
    skills: [],
    connectors: ["slack"],
    workflows: ["message-search", "send-msg", "canvas-manage"],
    enabled: true,
  },
  {
    id: "common-room-plugin",
    name: "Common Room",
    description: "Turn Common Room into your GTM copilot. Research accounts, prep for calls, draft personalized outreach.",
    category: "sales",
    author: "Common Room",
    installs: 74300,
    skills: [],
    connectors: ["common-room", "slack"],
    workflows: ["account-research", "call-prep", "outreach-draft"],
    enabled: true,
  },
  {
    id: "pdf-viewer-plugin",
    name: "PDF Viewer",
    description: "View, annotate, and sign PDFs in a live interactive viewer. Mark up contracts, fill forms, stamp approvals.",
    category: "productivity",
    author: "Anthropic",
    installs: 23100,
    skills: [],
    connectors: [],
    workflows: ["pdf-annotate", "form-fill", "sign"],
    enabled: true,
  },
  {
    id: "bio-research",
    name: "Bio Research",
    description: "Connect to preclinical research tools and databases. Literature search, genomics analysis, target prioritization.",
    category: "biotech",
    author: "Anthropic",
    installs: 19300,
    skills: [],
    connectors: ["pubmed", "biorxiv", "chembl", "clinical-trials", "benchling", "biorender", "synapse", "open-targets"],
    workflows: ["lit-search", "genomics-analysis", "target-prioritize"],
    enabled: true,
  },
];

/**
 * Get plugins by category
 */
export function getPluginsByCategory(category: string): PluginEntry[] {
  return ALL_PLUGINS.filter(p => p.category === category && p.enabled);
}

/**
 * Search plugins
 */
export function searchPlugins(query: string): PluginEntry[] {
  const lower = query.toLowerCase();
  return ALL_PLUGINS.filter(p =>
    p.enabled && (
      p.name.toLowerCase().includes(lower) ||
      p.description.toLowerCase().includes(lower) ||
      p.category.toLowerCase().includes(lower)
    )
  );
}

/**
 * Get plugin details with connected skills and connectors
 */
export function getPluginDetails(pluginId: string): PluginEntry | undefined {
  return ALL_PLUGINS.find(p => p.id === pluginId && p.enabled);
}

/**
 * Get all enabled plugins
 */
export function getEnabledPlugins(): PluginEntry[] {
  return ALL_PLUGINS.filter(p => p.enabled);
}
