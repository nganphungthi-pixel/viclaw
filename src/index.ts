/**
 * Viclaw Master Index
 * Exports all systems for unified access
 */

// Agent
export { AgentLoop, createAgentLoop, ThinkingLevel } from "./agent/mod.js";
export { SubAgentManager } from "./agent/subagent.js";
export { learningEngine } from "./agent/learning.js";
export { taskAnalyzer, EnsembleRouter } from "./agent/router.js";

// Providers
export { createProvider, detectProvider, getDefaultConfig } from "./providers/mod.js";

// Tools
export { ToolExecutor, createToolExecutor } from "./tools/mod.js";

// Memory
export { MemorySystem, createMemorySystem, getMemorySystem } from "./memory/mod.js";
export { SQLiteMemory } from "./memory/sqlite.js";

// Skills
export { SkillManager, createBuiltInSkills } from "./skills/mod.js";
export { ALL_SKILLS, matchSkills, searchSkills as searchSkillRegistry } from "./skills/registry.js";

// Connectors
export { ALL_CONNECTORS, getConnectorsByCategory, searchConnectors, getConfiguredConnectors } from "./connectors/registry.js";

// Plugins
export { ALL_PLUGINS, getPluginsByCategory, searchPlugins, getEnabledPlugins } from "./plugins/registry.js";

// MCP
export { MCPManager, getMCPManager, createBuiltInMCPServers } from "./mcp/mod.js";
export { createServiceConnectors, SERVICE_REGISTRY } from "./mcp/connectors.js";

// Research
export { ResearchEngine, getResearchEngine } from "./research/mod.js";

// Reasoning
export { ReasoningEngine, getReasoningEngine } from "./reasoning/mod.js";

// Expertise
export { EXPERTISE_PATTERNS, matchExpertise, getExpertiseContext } from "./expertise/mod.js";

// Security
export { SecurityScanner, getSecurityScanner } from "./security/mod.js";

// Sandbox
export { SandboxManager, getSandboxManager, createSandboxManager } from "./sandbox/mod.js";

// Channels
export { ChannelManager, createChannelManager, createChannel } from "./channels/mod.js";

// Voice
export { VoiceManager, getVoiceManager } from "./voice/mod.js";

// Hooks
export { HookSystem, getHookSystem } from "./hooks/mod.js";

// Governance
export { CompanyGovernance, getCompanyGovernance } from "./governance/mod.js";

// Platform
export { detectPlatform, adaptCommand, getPlatformPath } from "./platform/mod.js";

// Gateway
export { GatewayServer } from "./gateway/server.js";

// Commands
export { CommandRegistry } from "./commands/mod.js";

// Config
export { ConfigManager } from "./config/mod.js";

// Session
export { SessionManager, generateSessionKey, parseSessionKey } from "./session/mod.js";

// Run State Machine
export { RunStateMachine, getRunStateMachine } from "./agent/run-state.js";

// Reply Dispatcher
export { ReplyDispatcher, acquireReplyOperation, releaseReplyOperation } from "./agent/reply-dispatcher.js";

// Block Streaming
export { BlockCoalescer, getBlockStreamingConfigForChannel } from "./agent/block-streaming.js";

// Security Audit
export { SecurityAuditor, getSecurityAuditor } from "./security/audit.js";

// Sandbox Backend
export { createSandboxBackend, registerSandboxBackend, listSandboxBackends, SandboxFsBridge, SandboxFsPathGuard } from "./sandbox/backend.js";

// Plugin API
export { registerPlugin, getPluginState, getAllPlugins, getPluginTools, runVoidHook, runModifyingHook, runClaimingHook } from "./plugins/api.js";
export { getEnabledPlugins as getEnabledApiPlugins } from "./plugins/api.js";
