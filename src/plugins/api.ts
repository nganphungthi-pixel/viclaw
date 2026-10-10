/**
 * Viclaw Plugin API
 * 30+ registration methods, event system, plugin manifest, lifecycle management
 */

import { EventEmitter } from "node:events";
import { z } from "zod";

// ============================================
// PLUGIN MANIFEST
// ============================================

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  configSchema?: Record<string, unknown>;
  channels?: string[];
  providers?: string[];
  skills?: string[];
  contracts?: {
    tools?: string[];
    speechProviders?: string[];
  };
  modelSupport?: {
    modelPrefixes?: string[];
  };
}

export type PluginStatus = "enabled" | "disabled" | "error" | "loading";

export interface PluginLoadFailure {
  pluginId: string;
  failurePhase: "validation" | "load" | "register";
  error: string;
}

// ============================================
// PLUGIN API - 30+ REGISTRATION METHODS
// ============================================

export interface PluginAPI {
  // Tools
  registerTool(tool: any): void;
  registerToolFactory(factory: (ctx: PluginToolContext) => any): void;

  // Hooks
  registerHook(hook: PluginHook): void;

  // HTTP
  registerHttpRoute(method: string, path: string, handler: Function): void;

  // Channels
  registerChannel(channel: any): void;

  // Gateway
  registerGatewayMethod(name: string, handler: Function): void;

  // CLI
  registerCli(command: string, handler: Function): void;

  // Providers
  registerProvider(name: string, provider: any): void;

  // Speech
  registerSpeechProvider(name: string, provider: any): void;

  // Voice
  registerRealtimeVoiceProvider(name: string, provider: any): void;

  // Media
  registerMediaUnderstandingProvider(name: string, provider: any): void;
  registerImageGenerationProvider(name: string, provider: any): void;

  // Memory
  registerMemoryPromptSection(section: string, content: string): void;
  registerMemoryCorpusSupplement(key: string, content: string): void;
  registerMemoryEmbeddingProvider(name: string, provider: any): void;
  registerMemoryFlushPlanResolver(resolver: Function): void;

  // Commands
  registerCommand(name: string, handler: Function): void;

  // Context
  registerContextEngine(name: string, engine: any): void;

  // Services
  registerService(name: string, service: any): void;

  // Skills
  registerSkill(skillId: string, skill: any): void;

  // Events
  on(event: string, handler: Function): void;
  emit(event: string, ...args: unknown[]): void;

  // Config
  getConfig(): Record<string, unknown>;
  writeConfig(patch: Record<string, unknown>): void;

  // System
  enqueueSystemEvent(event: string, payload: Record<string, unknown>): void;
  requestHeartbeatNow(): void;

  // Media Utilities
  loadWebMedia(url: string): Promise<Buffer>;
  detectMime(buffer: Buffer): Promise<string>;

  // TTS
  textToSpeech(text: string, voice?: string): Promise<Buffer>;

  // Web Search
  webSearch(query: string, limit?: number): Promise<unknown[]>;

  // Events from agent
  onAgentEvent(event: string, handler: Function): void;
  onSessionTranscriptUpdate(handler: Function): void;

  // Model Auth
  getApiKeyForModel(model: string): string | undefined;

  // Plugin Info
  getPluginId(): string;
  getPluginManifest(): PluginManifest;

  // Logging
  log(level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void;
}

// ============================================
// PLUGIN TOOL CONTEXT
// ============================================

export interface PluginToolContext {
  sessionId: string;
  sessionKey: string;
  workspaceDir: string;
  agentDir: string;
  agentId: string;
  senderId: string;
  senderIsOwner: boolean;
  messageChannel: string;
  sandboxed: boolean;
  config: Record<string, unknown>;
}

// ============================================
// PLUGIN HOOK
// ============================================

export interface PluginHook {
  name: string;
  mode: "void" | "modifying" | "claiming";
  handler: (ctx: PluginHookContext) => Promise<void | unknown>;
  priority?: number;
  owner?: string;
}

export interface PluginHookContext {
  sessionId: string;
  channel: string;
  body: string;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================
// PLUGIN REGISTRY - Process-Global Singleton
// ============================================

const PLUGIN_REGISTRY_STATE = Symbol.for("viclaw.plugin.registry");

interface RegistryState {
  plugins: Map<string, PluginRegistration>;
  tools: any[];
  hooks: PluginHook[];
  channels: any[];
  providers: Map<string, any>;
  speechProviders: Map<string, any>;
  voiceProviders: Map<string, any>;
  mediaProviders: Map<string, any>;
  imageProviders: Map<string, any>;
  memorySections: Map<string, string>;
  memoryCorpus: Map<string, string>;
  memoryEmbeddingProviders: Map<string, any>;
  memoryFlushResolvers: Function[];
  commands: Map<string, Function>;
  contextEngines: Map<string, any>;
  services: Map<string, any>;
  skills: Map<string, any>;
  httpRoutes: Array<{ method: string; path: string; handler: Function; owner?: string }>;
  gatewayMethods: Map<string, Function>;
  cliCommands: Map<string, Function>;
  eventListeners: Map<string, Function[]>;
  loadFailures: PluginLoadFailure[];
  version: number;
}

function createInitialState(): RegistryState {
  return {
    plugins: new Map(),
    tools: [],
    hooks: [],
    channels: [],
    providers: new Map(),
    speechProviders: new Map(),
    voiceProviders: new Map(),
    mediaProviders: new Map(),
    imageProviders: new Map(),
    memorySections: new Map(),
    memoryCorpus: new Map(),
    memoryEmbeddingProviders: new Map(),
    memoryFlushResolvers: [],
    commands: new Map(),
    contextEngines: new Map(),
    services: new Map(),
    skills: new Map(),
    httpRoutes: [],
    gatewayMethods: new Map(),
    cliCommands: new Map(),
    eventListeners: new Map(),
    loadFailures: [],
    version: 1,
  };
}

function getState(): RegistryState {
  const globalObj = globalThis as any;
  if (!globalObj[PLUGIN_REGISTRY_STATE]) {
    globalObj[PLUGIN_REGISTRY_STATE] = createInitialState();
  }
  return globalObj[PLUGIN_REGISTRY_STATE];
}

// ============================================
// PLUGIN REGISTRATION
// ============================================

export interface PluginRegistration {
  manifest: PluginManifest;
  status: PluginStatus;
  registeredAt: number;
  config: Record<string, unknown>;
  api: PluginAPI;
}

export function registerPlugin(
  manifest: PluginManifest,
  registerFn: (api: PluginAPI) => void | Promise<void>,
  config: Record<string, unknown> = {}
): PluginRegistration {
  const state = getState();
  const existing = state.plugins.get(manifest.id);

  if (existing) {
    state.plugins.delete(manifest.id);
  }

  const api = createPluginAPI(manifest.id, manifest, config);

  const registration: PluginRegistration = {
    manifest,
    status: "loading",
    registeredAt: Date.now(),
    config,
    api,
  };

  try {
    // Validation phase
    validateManifest(manifest);

    // Register phase
    const result = registerFn(api);
    if (result instanceof Promise) {
      result.catch((error) => {
        registration.status = "error";
        state.loadFailures.push({
          pluginId: manifest.id,
          failurePhase: "register",
          error: error.message,
        });
      });
    }

    registration.status = "enabled";
    state.plugins.set(manifest.id, registration);
    state.version++;

    return registration;
  } catch (error) {
    registration.status = "error";
    state.loadFailures.push({
      pluginId: manifest.id,
      failurePhase: error instanceof Error && error.message.includes("validation") ? "validation" : "register",
      error: error instanceof Error ? error.message : String(error),
    });
    state.plugins.set(manifest.id, registration);
    throw error;
  }
}

function validateManifest(manifest: PluginManifest): void {
  if (!manifest.id || !manifest.id.match(/^[a-z0-9-]+$/)) {
    throw new Error(`validation: Invalid plugin ID "${manifest.id}". Must be lowercase alphanumeric with hyphens.`);
  }
  if (!manifest.name) {
    throw new Error(`validation: Plugin "${manifest.id}" missing name`);
  }
  if (!manifest.version || !manifest.version.match(/^\d+\.\d+\.\d+$/)) {
    throw new Error(`validation: Plugin "${manifest.id}" has invalid version "${manifest.version}". Must be semver.`);
  }
}

// ============================================
// PLUGIN API IMPLEMENTATION
// ============================================

function createPluginAPI(
  pluginId: string,
  manifest: PluginManifest,
  config: Record<string, unknown>
): PluginAPI {
  const state = getState();
  const emitter = new EventEmitter();

  const api: PluginAPI = {
    // Tools
    registerTool(tool: any): void {
      state.tools.push({ ...tool, owner: pluginId });
    },

    registerToolFactory(factory: (ctx: PluginToolContext) => any): void {
      state.tools.push({ factory, owner: pluginId });
    },

    // Hooks
    registerHook(hook: PluginHook): void {
      state.hooks.push({ ...hook, owner: pluginId });
    },

    // HTTP
    registerHttpRoute(method: string, path: string, handler: Function): void {
      state.httpRoutes.push({ method, path, handler, owner: pluginId });
    },

    // Channels
    registerChannel(channel: any): void {
      state.channels.push({ ...channel, owner: pluginId });
    },

    // Gateway
    registerGatewayMethod(name: string, handler: Function): void {
      state.gatewayMethods.set(`${pluginId}:${name}`, handler);
    },

    // CLI
    registerCli(command: string, handler: Function): void {
      state.cliCommands.set(`${pluginId}:${command}`, handler);
    },

    // Providers
    registerProvider(name: string, provider: any): void {
      state.providers.set(`${pluginId}:${name}`, provider);
    },

    // Speech
    registerSpeechProvider(name: string, provider: any): void {
      state.speechProviders.set(`${pluginId}:${name}`, provider);
    },

    // Voice
    registerRealtimeVoiceProvider(name: string, provider: any): void {
      state.voiceProviders.set(`${pluginId}:${name}`, provider);
    },

    // Media
    registerMediaUnderstandingProvider(name: string, provider: any): void {
      state.mediaProviders.set(`${pluginId}:${name}`, provider);
    },
    registerImageGenerationProvider(name: string, provider: any): void {
      state.imageProviders.set(`${pluginId}:${name}`, provider);
    },

    // Memory
    registerMemoryPromptSection(section: string, content: string): void {
      state.memorySections.set(`${pluginId}:${section}`, content);
    },
    registerMemoryCorpusSupplement(key: string, content: string): void {
      state.memoryCorpus.set(`${pluginId}:${key}`, content);
    },
    registerMemoryEmbeddingProvider(name: string, provider: any): void {
      state.memoryEmbeddingProviders.set(`${pluginId}:${name}`, provider);
    },
    registerMemoryFlushPlanResolver(resolver: Function): void {
      state.memoryFlushResolvers.push(resolver);
    },

    // Commands
    registerCommand(name: string, handler: Function): void {
      state.commands.set(`${pluginId}:${name}`, handler);
    },

    // Context
    registerContextEngine(name: string, engine: any): void {
      state.contextEngines.set(`${pluginId}:${name}`, engine);
    },

    // Services
    registerService(name: string, service: any): void {
      state.services.set(`${pluginId}:${name}`, service);
    },

    // Skills
    registerSkill(skillId: string, skill: any): void {
      state.skills.set(`${pluginId}:${skillId}`, skill);
    },

    // Events
    on(event: string, handler: Function): void {
      const listeners = state.eventListeners.get(event) || [];
      listeners.push(handler);
      state.eventListeners.set(event, listeners);
    },
    emit(event: string, ...args: unknown[]): void {
      emitter.emit(event, ...args);
      const listeners = state.eventListeners.get(event) || [];
      for (const handler of listeners) {
        try {
          handler(...args);
        } catch (error) {
          console.error(`[Plugin ${pluginId}] Event handler error for ${event}:`, error);
        }
      }
    },

    // Config
    getConfig(): Record<string, unknown> {
      return { ...config };
    },
    writeConfig(patch: Record<string, unknown>): void {
      Object.assign(config, patch);
    },

    // System
    enqueueSystemEvent(event: string, payload: Record<string, unknown>): void {
      api.emit("system:event", { event, payload, timestamp: Date.now() });
    },
    requestHeartbeatNow(): void {
      api.emit("system:heartbeat");
    },

    // Media
    async loadWebMedia(url: string): Promise<Buffer> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load media from ${url}: ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async detectMime(buffer: Buffer): Promise<string> {
      // Simple magic byte detection
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
      if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
      if (buffer[0] === 0x47) return "image/gif";
      if (buffer.toString("utf-8", 0, 4) === "%PDF") return "application/pdf";
      return "application/octet-stream";
    },

    // TTS
    async textToSpeech(text: string, voice?: string): Promise<Buffer> {
      // Stub - would connect to actual TTS provider
      return Buffer.from("");
    },

    // Web Search
    async webSearch(query: string, limit?: number): Promise<unknown[]> {
      // Stub - would connect to actual search provider
      return [];
    },

    // Agent Events
    onAgentEvent(event: string, handler: Function): void {
      api.on(`agent:${event}`, handler);
    },
    onSessionTranscriptUpdate(handler: Function): void {
      api.on("session:transcript:update", handler);
    },

    // Model Auth
    getApiKeyForModel(model: string): string | undefined {
      const prefix = model.split("-")[0];
      const envKey = process.env[`${prefix.toUpperCase()}_API_KEY`];
      return envKey || process.env.OPENAI_API_KEY;
    },

    // Plugin Info
    getPluginId(): string {
      return pluginId;
    },
    getPluginManifest(): PluginManifest {
      return { ...manifest };
    },

    // Logging
    log(level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void {
      const timestamp = new Date().toISOString();
      const entry = { timestamp, pluginId, level, message, ...(meta || {}) };

      switch (level) {
        case "debug":
          console.debug(`[DEBUG][${pluginId}] ${message}`, meta || "");
          break;
        case "info":
          console.info(`[INFO][${pluginId}] ${message}`, meta || "");
          break;
        case "warn":
          console.warn(`[WARN][${pluginId}] ${message}`, meta || "");
          break;
        case "error":
          console.error(`[ERROR][${pluginId}] ${message}`, meta || "");
          break;
      }

      api.emit("plugin:log", entry);
    },
  };

  return api;
}

// ============================================
// PLUGIN DISCOVERY & LOADING
// ============================================

export interface PluginDiscoveryResult {
  discovered: number;
  loaded: number;
  failed: number;
  failures: PluginLoadFailure[];
}

export async function discoverAndLoadPlugins(
  pluginDirs: string[] = []
): Promise<PluginDiscoveryResult> {
  const state = getState();
  const result: PluginDiscoveryResult = {
    discovered: 0,
    loaded: 0,
    failed: 0,
    failures: [],
  };

  // Built-in plugins (registered at startup)
  result.discovered = state.plugins.size;
  result.loaded = Array.from(state.plugins.values()).filter(p => p.status === "enabled").length;
  result.failures = [...state.loadFailures];
  result.failed = result.failures.length;

  return result;
}

// ============================================
// HOOK EXECUTION - 3 MODES
// ============================================

export async function runVoidHook(
  hookName: string,
  ctx: PluginHookContext,
  failMode: "open" | "closed" = "open"
): Promise<void> {
  const state = getState();
  const hooks = state.hooks
    .filter(h => h.name === hookName && h.mode === "void")
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  // Void hooks run in parallel
  const results = await Promise.allSettled(
    hooks.map(h => h.handler({ ...ctx }))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      if (failMode === "closed") {
        throw result.reason;
      }
      console.error(`[Hook ${hookName}] Handler ${i} failed:`, result.reason);
    }
  }
}

export async function runModifyingHook<T>(
  hookName: string,
  ctx: PluginHookContext,
  initialValue: T,
  failMode: "open" | "closed" = "open"
): Promise<T> {
  const state = getState();
  const hooks = state.hooks
    .filter(h => h.name === hookName && h.mode === "modifying")
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  let value = initialValue;

  // Modifying hooks run sequentially, results merged
  for (const hook of hooks) {
    try {
      const result = await hook.handler({ ...ctx, value });
      if (result !== undefined && result !== null) {
        value = { ...value, ...result } as T;
      }
    } catch (error) {
      if (failMode === "closed") {
        throw error;
      }
      console.error(`[Hook ${hookName}] Handler failed:`, error);
    }
  }

  return value;
}

export async function runClaimingHook<T>(
  hookName: string,
  ctx: PluginHookContext,
  failMode: "open" | "closed" = "open"
): Promise<{ handled: boolean; result?: T; handler?: string }> {
  const state = getState();
  const hooks = state.hooks
    .filter(h => h.name === hookName && h.mode === "claiming")
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  // Claiming hooks run sequentially, first { handled: true } wins
  for (const hook of hooks) {
    try {
      const result = await hook.handler({ ...ctx });
      if (result && typeof result === "object" && (result as any).handled) {
        return { handled: true, result: result as T, handler: hook.owner || hook.name };
      }
    } catch (error) {
      if (failMode === "closed") {
        throw error;
      }
      console.error(`[Hook ${hookName}] Handler failed:`, error);
    }
  }

  return { handled: false };
}

// ============================================
// LRU CACHE FOR PLUGIN REGISTRY
// ============================================

interface LRUCacheEntry {
  key: string;
  value: unknown;
  hash: string;
  timestamp: number;
}

class PluginLRUCache {
  private entries: LRUCacheEntry[] = [];
  private maxSize: number;

  constructor(maxSize: number = 128) {
    this.maxSize = maxSize;
  }

  get(key: string): unknown | undefined {
    const idx = this.entries.findIndex(e => e.key === key);
    if (idx === -1) return undefined;

    const entry = this.entries[idx];
    // Move to front (most recently used)
    this.entries.splice(idx, 1);
    this.entries.unshift(entry);
    return entry.value;
  }

  set(key: string, value: unknown, hash: string): void {
    // Remove existing
    const idx = this.entries.findIndex(e => e.key === key);
    if (idx !== -1) {
      this.entries.splice(idx, 1);
    }

    // Add to front
    this.entries.unshift({ key, value, hash, timestamp: Date.now() });

    // Evict oldest if over limit
    while (this.entries.length > this.maxSize) {
      this.entries.pop();
    }
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}

// Global plugin registry cache
const pluginRegistryCache = new PluginLRUCache(128);

export function getPluginCache(): PluginLRUCache {
  return pluginRegistryCache;
}

// ============================================
// EXPORTS
// ============================================

export function getPluginState(): RegistryState {
  return getState();
}

export function getAllPlugins(): PluginRegistration[] {
  return Array.from(getState().plugins.values());
}

export function getEnabledPlugins(): PluginRegistration[] {
  return Array.from(getState().plugins.values()).filter(p => p.status === "enabled");
}

export function getPluginById(id: string): PluginRegistration | undefined {
  return getState().plugins.get(id);
}

export function getPluginTools(): any[] {
  return getState().tools;
}

export function getPluginHooks(name?: string): PluginHook[] {
  const state = getState();
  return name ? state.hooks.filter(h => h.name === name) : state.hooks;
}

export function getPluginCommands(): Map<string, Function> {
  return getState().commands;
}

export function getPluginMemorySections(): Map<string, string> {
  return getState().memorySections;
}

export function getPluginMemoryCorpus(): Map<string, string> {
  return getState().memoryCorpus;
}
