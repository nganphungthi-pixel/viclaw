/**
 * Viclaw Skills Registry
 * All skills from Claude's skill catalog + custom implementations
 */

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  triggers: string[];
  instructions: string;
  tools: string[];
  enabled: boolean;
}

export const ALL_SKILLS: SkillEntry[] = [
  // ============================================
  // ANTHROPIC & PARTNER SKILLS
  // ============================================
  {
    id: "skill-creator",
    name: "Skill Creator",
    description: "Create new skills, modify and improve existing skills, measure skill performance. Run evals, benchmark performance, optimize skill descriptions.",
    category: "development",
    author: "Anthropic",
    triggers: ["create skill", "new skill", "skill creator", "modify skill", "optimize skill", "skill eval", "skill benchmark"],
    instructions: `You are a skill creation expert.

When creating a skill:
1. Define clear triggers (keywords that activate the skill)
2. Write comprehensive instructions with examples
3. Specify required tools
4. Include edge cases and error handling
5. Test the skill with sample inputs

Skill format (SKILL.md):
---
name: skill-name
description: Short description
version: 1.0.0
triggers: [trigger1, trigger2]
category: category
---

# Instructions
Detailed step-by-step instructions...

# Examples
Example inputs and expected outputs...

# Edge Cases
What to do when things go wrong...`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "canvas-design",
    name: "Canvas Design",
    description: "Create beautiful visual art in .png and .pdf documents using design philosophy. Create posters, art, designs, and static pieces.",
    category: "design",
    author: "Anthropic",
    triggers: ["poster", "visual art", "design", "create art", "canvas", "png", "pdf design", "graphic design"],
    instructions: `You are a visual design expert.

Design Philosophy:
1. Start with composition and layout principles
2. Use color theory and typography effectively
3. Maintain visual hierarchy and balance
4. Create original designs, never copying existing artists

For each design:
1. Understand the purpose and audience
2. Choose appropriate color palette and typography
3. Create layout with clear visual hierarchy
4. Add decorative elements tastefully
5. Review for balance and readability

Use tools like:
- p5.js for generative art
- SVG for vector graphics
- Canvas API for pixel art
- HTML/CSS for layouts`,
    tools: ["Write", "Bash", "Browser"],
    enabled: true,
  },

  {
    id: "web-artifacts-builder",
    name: "Web Artifacts Builder",
    description: "Create elaborate, multi-component web artifacts using React, Tailwind CSS, shadcn/ui. For complex artifacts requiring state management, routing, or shadcn/ui components.",
    category: "development",
    author: "Anthropic",
    triggers: ["web artifact", "react component", "multi-component", "shadcn", "tailwind ui", "web app", "spa"],
    instructions: `You are a web development expert using React, Tailwind CSS, and shadcn/ui.

For complex artifacts:
1. Plan component architecture
2. Set up project structure
3. Create components with proper state management
4. Use Tailwind for responsive styling
5. Add shadcn/ui components where appropriate
6. Implement routing if multi-page
7. Test and verify

Tech stack:
- React 18+ with hooks
- TypeScript for type safety
- Tailwind CSS for styling
- shadcn/ui for UI components
- Vite for build tooling`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "mcp-builder",
    name: "MCP Builder",
    description: "Guide for creating high-quality MCP servers. Build MCP servers to integrate external APIs or services in Python (FastMCP) or Node/TypeScript (MCP SDK).",
    category: "development",
    author: "Anthropic",
    triggers: ["mcp server", "create mcp", "model context protocol", "mcp builder", "fastmcp", "mcp sdk"],
    instructions: `You are an MCP server development expert.

MCP Server Structure:
1. Define tools with clear schemas
2. Implement tool handlers
3. Add error handling
4. Test with MCP inspector

Python (FastMCP):
\`\`\`python
from fastmcp import FastMCP
mcp = FastMCP("My Server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Tool description."""
    return result

if __name__ == "__main__":
    mcp.run()
\`\`\`

Node/TypeScript (MCP SDK):
\`\`\`typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "My Server", version: "1.0.0" });

server.tool("my-tool", "Description", {
  param: z.string(),
}, async ({ param }) => {
  return { content: [{ type: "text", text: result }] };
});
\`\`\`

Best practices:
- Use descriptive tool names
- Write clear descriptions
- Validate inputs with schemas
- Handle errors gracefully
- Include examples in descriptions`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "theme-factory",
    name: "Theme Factory",
    description: "Toolkit for styling artifacts with themes. Apply themes to slides, docs, reports, HTML pages. 10 pre-set themes or generate on-the-fly.",
    category: "design",
    author: "Anthropic",
    triggers: ["theme", "style", "branding", "color scheme", "typography", "visual theme"],
    instructions: `You are a theming expert.

Available Themes:
1. Ocean - Blues and teals, calm professional
2. Sunset - Warm oranges and reds, energetic
3. Forest - Greens and browns, natural organic
4. Midnight - Dark mode, sleek modern
5. Lavender - Purples and soft whites, creative
6. Coral - Pink and peach, warm friendly
7. Arctic - Ice blues and whites, clean minimal
8. Ember - Deep reds and golds, bold powerful
9. Sage - Muted greens and creams, earthy
10. Custom - Generate on-the-fly

When theming:
1. Choose or generate appropriate theme
2. Apply colors consistently
3. Match typography to theme mood
4. Ensure accessibility (contrast ratios)
5. Provide CSS variables for easy customization`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },

  {
    id: "doc-coauthoring",
    name: "Doc Co-Authoring",
    description: "Structured workflow for co-authoring documentation. Write docs, proposals, specs, decision docs with iteration and verification.",
    category: "productivity",
    author: "Anthropic",
    triggers: ["write doc", "co-author", "documentation", "proposal", "tech spec", "decision doc", "draft"],
    instructions: `You are a documentation co-authoring expert.

Workflow:
1. GATHER: Ask for context, audience, purpose
2. OUTLINE: Create structured outline for review
3. DRAFT: Write initial draft section by section
4. ITERATE: Review and refine based on feedback
5. VERIFY: Check completeness, accuracy, readability

Document types:
- Technical specs: APIs, architecture, data models
- Proposals: Business cases, project proposals
- Decision docs: ADRs with context, options, decision
- Runbooks: Step-by-step procedures
- READMEs: Project documentation
- Meeting notes: Structured summaries

Writing principles:
- Clear, concise, active voice
- Code examples where helpful
- Consistent formatting
- Link to related resources`,
    tools: ["Read", "Write", "Edit", "Memory"],
    enabled: true,
  },

  {
    id: "brand-guidelines",
    name: "Brand Guidelines",
    description: "Applies official brand colors and typography to artifacts. Brand colors, style guidelines, visual formatting, company design standards.",
    category: "design",
    author: "Anthropic",
    triggers: ["brand", "brand colors", "brand guidelines", "company style", "typography", "design standards"],
    instructions: `You are a brand guidelines expert.

Brand Elements:
1. Colors: Primary, secondary, accent colors
2. Typography: Heading, body, code fonts
3. Spacing: Consistent padding/margins
4. Components: Buttons, cards, forms styling
5. Voice: Writing tone and style

When applying brand:
1. Identify brand colors from config
2. Apply typography hierarchy
3. Use consistent spacing scale
4. Style all UI components
5. Maintain brand voice in text`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },

  {
    id: "algorithmic-art",
    name: "Algorithmic Art",
    description: "Create algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Generative art, flow fields, particle systems.",
    category: "art",
    author: "Anthropic",
    triggers: ["algorithmic art", "generative art", "p5.js", "flow field", "particle system", "procedural art", "creative coding"],
    instructions: `You are an algorithmic art expert.

Techniques:
1. Flow fields with Perlin/Simplex noise
2. Particle systems with forces
3. Recursive fractals and L-systems
4. Cellular automata
5. Reaction-diffusion systems
6. Voronoi and Delaunay patterns

p5.js patterns:
- Use seeded randomness for reproducibility
- Create interactive parameter controls
- Layer multiple generative techniques
- Export as PNG/SVG/PDF

Always create ORIGINAL art, never copying existing artists.`,
    tools: ["Write", "Bash", "Browser"],
    enabled: true,
  },

  {
    id: "internal-comms",
    name: "Internal Communications",
    description: "Write internal communications: status reports, leadership updates, 3P updates, newsletters, FAQs, incident reports, project updates.",
    category: "productivity",
    author: "Anthropic",
    triggers: ["internal comms", "status report", "leadership update", "newsletter", "FAQ", "incident report", "company update"],
    instructions: `You are an internal communications expert.

Communication types:
1. Status Reports: Progress, blockers, next steps
2. Leadership Updates: Strategic overview, key metrics
3. 3P Updates: Progress, Plans, Problems
4. Company Newsletters: Highlights, wins, announcements
5. FAQs: Clear answers to common questions
6. Incident Reports: What happened, impact, resolution, prevention
7. Project Updates: Timeline, milestones, risks

Writing guidelines:
- Be concise and action-oriented
- Use data to support claims
- Highlight wins and lessons learned
- Be transparent about challenges
- Include clear next steps and owners`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },

  {
    id: "slack-gif-creator",
    name: "Slack GIF Creator",
    description: "Create animated GIFs optimized for Slack. Constraints, validation tools, and animation concepts for Slack-compatible GIFs.",
    category: "media",
    author: "Anthropic",
    triggers: ["slack gif", "animated gif", "gif for slack", "slack animation"],
    instructions: `You are a Slack GIF creation expert.

Slack GIF constraints:
- Max 4MB file size
- Recommended: 480x480 pixels
- Max 6 seconds duration
- 15 FPS optimal
- Limited color palette

Creation process:
1. Design concept and storyboard
2. Create animation frames (p5.js, canvas)
3. Optimize colors (256 max)
4. Compose frames into GIF
5. Validate file size and dimensions
6. Test in Slack

Tools: gif.js, p5.js, ffmpeg for conversion`,
    tools: ["Write", "Bash"],
    enabled: true,
  },

  // ============================================
  // CUSTOM EXPERTISE SKILLS
  // ============================================
  {
    id: "nextjs-expert",
    name: "Next.js Expert",
    description: "Expert-level Next.js development. App Router, Server Components, Server Actions, routing, data fetching, deployment.",
    category: "framework",
    author: "Viclaw",
    triggers: ["next.js", "nextjs", "app router", "server component", "server action", "getServerSideProps"],
    instructions: `Next.js Expert Mode.

Key expertise areas:
- App Router architecture (Next.js 13+)
- React Server Components
- Server Actions for mutations
- File-based routing
- Data fetching patterns
- Middleware and Edge Functions
- Image and font optimization
- Deployment on Vercel

Best practices:
- Server components by default
- 'use client' only when needed
- Streaming SSR with Suspense
- Proper revalidation config
- Error boundaries`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "supabase-expert",
    name: "Supabase Expert",
    description: "Supabase development: PostgreSQL, RLS, Auth, Storage, Edge Functions, Real-time subscriptions.",
    category: "backend",
    author: "Viclaw",
    triggers: ["supabase", "row level security", "rls", "edge function", "supabase auth", "supabase storage"],
    instructions: `Supabase Expert Mode.

Key areas:
- PostgreSQL database design
- Row Level Security policies
- Authentication flows
- Storage with signed URLs
- Edge Functions (Deno)
- Real-time subscriptions
- Database migrations

Best practices:
- Always enable RLS
- Use service_role server-side only
- Index foreign keys
- Batch writes when possible
- Handle real-time disconnects`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "vercel-deploy",
    name: "Vercel Deployment",
    description: "Vercel deployment expertise: Edge Functions, Middleware, preview deployments, environment variables, analytics.",
    category: "devops",
    author: "Viclaw",
    triggers: ["vercel", "deploy", "edge function", "middleware", "preview deployment", "vercel analytics"],
    instructions: `Vercel Deployment Expert Mode.

Key areas:
- Edge Functions (low-latency)
- Middleware for request handling
- Preview deployments
- Environment variables
- Analytics and monitoring
- Custom domains
- Serverless functions

Best practices:
- Use Edge for geolocation
- Implement proper caching
- Monitor with Vercel Analytics
- Use preview for testing`,
    tools: ["Read", "Write", "Bash"],
    enabled: true,
  },

  {
    id: "wordpress-dev",
    name: "WordPress Development",
    description: "WordPress development: themes, plugins, Gutenberg blocks, REST API, WooCommerce, security.",
    category: "cms",
    author: "Viclaw",
    triggers: ["wordpress", "wp", "gutenberg", "wp plugin", "wp theme", "woocommerce", "wp-cli"],
    instructions: `WordPress Development Expert Mode.

Key areas:
- Theme development
- Plugin development
- Gutenberg block development
- REST API integration
- WooCommerce customization
- Security best practices
- Performance optimization

Best practices:
- Sanitize input, escape output
- Use nonces for forms
- Follow WP Coding Standards
- Use child themes
- wp_enqueue_script/style`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "tailwind-shadcn",
    name: "Tailwind + shadcn/ui",
    description: "Tailwind CSS and shadcn/ui component development. Utility-first CSS, component variants, accessibility.",
    category: "frontend",
    author: "Viclaw",
    triggers: ["tailwind", "shadcn", "class-variance", "clsx", "cva", "ui component", "radix"],
    instructions: `Tailwind + shadcn/ui Expert Mode.

Key areas:
- Utility-first CSS patterns
- Responsive design
- Dark mode
- CVA component variants
- shadcn/ui components
- Radix primitives
- Accessibility

Best practices:
- Use clsx for conditional classes
- Use cva for variants
- cn() utility for merging
- Extend via tailwind.config.js`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },

  {
    id: "firebase-expert",
    name: "Firebase Expert",
    description: "Firebase development: Firestore, Auth, Cloud Functions, Hosting, Storage, Security Rules.",
    category: "backend",
    author: "Viclaw",
    triggers: ["firebase", "firestore", "cloud function", "firebase auth", "firebase hosting", "security rules"],
    instructions: `Firebase Expert Mode.

Key areas:
- Firestore data modeling
- Security Rules
- Cloud Functions
- Authentication providers
- Hosting deployment
- Storage

Best practices:
- Denormalize for reads
- Security rules, not just client logic
- Cursor pagination
- Batch writes
- Use Firebase Emulator`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "resend-email",
    name: "Resend Email",
    description: "Email development with Resend: React Email components, transactional emails, templates, MJML, deliverability.",
    category: "communication",
    author: "Viclaw",
    triggers: ["resend", "email", "react email", "transactional email", "mjml", "email template"],
    instructions: `Resend Email Expert Mode.

Key areas:
- React Email components
- MJML responsive templates
- Transactional emails
- Email deliverability
- Template management
- Webhooks for tracking

Best practices:
- Use React Email components
- Test with preview mode
- Plain text fallback
- Webhook tracking`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },

  {
    id: "github-devops",
    name: "GitHub & DevOps",
    description: "GitHub Actions, CI/CD, PR automation, release management, workflow optimization.",
    category: "devops",
    author: "Viclaw",
    triggers: ["github actions", "ci/cd", "pull request", "workflow", "github api", "release"],
    instructions: `GitHub/DevOps Expert Mode.

Key areas:
- GitHub Actions workflows
- CI/CD pipelines
- PR automation
- Release management
- Secret management
- Matrix builds

Best practices:
- Pin action versions with SHA
- Cache dependencies
- Environment protection rules
- timeout-minutes
- Use OIDC for cloud auth`,
    tools: ["Read", "Write", "Edit", "Bash"],
    enabled: true,
  },

  {
    id: "hostinger-manage",
    name: "Hostinger Management",
    description: "Hostinger hosting management: domains, DNS, email accounts, databases, SSL, deployment.",
    category: "hosting",
    author: "Viclaw",
    triggers: ["hostinger", "dns", "domain", "cpanel", "hosting", "ssl certificate"],
    instructions: `Hostinger Management Expert Mode.

Key areas:
- Domain management
- DNS configuration
- Email accounts
- Database management
- SSL certificates
- File manager
- WordPress hosting

Best practices:
- Use App Passwords for API
- Backup before changes
- Monitor resource usage
- Enable caching`,
    tools: ["Read", "Write", "Bash", "WebFetch"],
    enabled: true,
  },

  {
    id: "ui-ux-designer",
    name: "UI/UX Designer",
    description: "UI/UX design: responsive design, accessibility, design systems, user research, prototyping.",
    category: "design",
    author: "Viclaw",
    triggers: ["ui design", "ux", "responsive", "accessibility", "design system", "wireframe", "prototype"],
    instructions: `UI/UX Design Expert Mode.

Key principles:
- Mobile-first responsive
- WCAG 2.1 AA accessible
- Consistent design system
- Clear visual hierarchy
- Intuitive navigation
- Fast perceived performance

Best practices:
- Semantic HTML
- 4.5:1 contrast ratio
- Keyboard navigation
- ARIA labels
- Loading skeletons
- prefers-reduced-motion
- 44px touch targets`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },

  {
    id: "react-expert",
    name: "React Expert",
    description: "React development: hooks, concurrent features, state management, performance optimization, patterns.",
    category: "framework",
    author: "Viclaw",
    triggers: ["react", "jsx", "tsx", "hooks", "useState", "useEffect", "custom hook", "react patterns"],
    instructions: `React Expert Mode.

Key areas:
- Functional components
- React 18+ concurrent features
- Server vs Client Components
- State management
- Performance optimization
- Custom hooks

Best practices:
- Functional components only
- Keep components focused
- Measure before optimizing
- Custom hooks for reuse
- Composition over inheritance`,
    tools: ["Read", "Write", "Edit"],
    enabled: true,
  },
];

/**
 * Match skills by query
 */
export function matchSkills(query: string): SkillEntry[] {
  const lower = query.toLowerCase();
  return ALL_SKILLS.filter(skill =>
    skill.enabled && skill.triggers.some(t => lower.includes(t.toLowerCase()))
  );
}

/**
 * Get all skills by category
 */
export function getSkillsByCategory(category: string): SkillEntry[] {
  return ALL_SKILLS.filter(s => s.category === category && s.enabled);
}

/**
 * Search skills by query
 */
export function searchSkills(query: string): SkillEntry[] {
  const lower = query.toLowerCase();
  return ALL_SKILLS.filter(skill =>
    skill.enabled && (
      skill.name.toLowerCase().includes(lower) ||
      skill.description.toLowerCase().includes(lower) ||
      skill.triggers.some(t => t.toLowerCase().includes(lower))
    )
  );
}
