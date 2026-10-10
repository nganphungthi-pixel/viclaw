/**
 * MCP (Model Context Protocol) Integration
 * Actual MCP server connections and tool execution
 */

import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import { ToolResult } from "../tools/mod.js";
import { buildChildEnv, isSecretName } from "../security/env.js";

// ============================================
// MCP TYPES
// ============================================

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Extra env names passed through to the server (operator responsibility). */
  envPassthrough?: string[];
  timeout?: number;
}

export interface MCPToolCall {
  toolName: string;
  input: Record<string, unknown>;
  toolCallId: string;
}

export interface MCPServerState {
  name: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  tools: MCPToolDefinition[];
  error?: string;
}

// ============================================
// MCP CLIENT
// ============================================

export class MCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private state: MCPServerState;
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
    this.state = {
      name: config.name,
      status: "disconnected",
      tools: [],
    };
  }

  async connect(): Promise<void> {
    this.state.status = "connecting";

    try {
      for (const name of this.config.envPassthrough ?? []) {
        if (isSecretName(name)) {
          console.warn(`[viclaw] WARNING: MCP server "${this.config.name}" passes through secret-looking variable "${name}".`);
        }
      }
      // P0-1: MCP servers are third-party code the model talks to — they get
      // the scrubbed base env plus only operator-configured values.
      this.process = spawn(this.config.command, this.config.args, {
        env: { ...buildChildEnv({ passthrough: this.config.envPassthrough }), ...this.config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";

      this.process.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch {
            // Skip non-JSON lines
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        console.error(`[${this.config.name}]`, data.toString());
      });

      this.process.on("close", (code: number | null) => {
        this.state.status = "disconnected";
        this.emit("disconnected", code);
      });

      this.process.on("error", (error: Error) => {
        this.state.status = "error";
        this.state.error = error.message;
        this.emit("error", error);
      });

      // Initialize MCP session
      await this.sendRequest("initialize", { protocolVersion: "2024-11-05", capabilities: {} });

      // List available tools
      const toolsResponse = await this.sendRequest("tools/list", {});
      this.state.tools = toolsResponse.tools || [];
      this.state.status = "connected";

      this.emit("connected", this.state);
    } catch (error) {
      this.state.status = "error";
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit("error", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.state.status = "disconnected";
  }

  async callTool(toolName: string, input: Record<string, unknown>, toolCallId: string): Promise<ToolResult> {
    try {
      const result = await this.sendRequest("tools/call", {
        name: toolName,
        arguments: input,
      });

      return {
        toolCallId,
        content: typeof result.content === "string" ? result.content : JSON.stringify(result.content),
        isError: result.isError || false,
      };
    } catch (error) {
      return {
        toolCallId,
        content: `MCP tool error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pendingRequests.set(id, { resolve, reject });

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.process?.stdin?.write(JSON.stringify(message) + "\n");

      // Timeout
      setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, this.config.timeout || 30000);
    });
  }

  private handleMessage(message: any): void {
    if (message.id && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message || "MCP error"));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  getState(): MCPServerState {
    return { ...this.state };
  }

  getTools(): MCPToolDefinition[] {
    return this.state.tools;
  }
}

// ============================================
// MCP MANAGER
// ============================================

export class MCPManager {
  private servers: Map<string, MCPClient> = new Map();

  async registerServer(config: MCPServerConfig): Promise<MCPClient> {
    const client = new MCPClient(config);
    this.servers.set(config.name, client);

    client.on("connected", (state: MCPServerState) => {
      console.log(`✅ MCP server connected: ${state.name} (${state.tools.length} tools)`);
    });

    client.on("error", (error: Error) => {
      console.error(`❌ MCP server error: ${config.name}`, error.message);
    });

    return client;
  }

  async connectAll(): Promise<void> {
    for (const client of this.servers.values()) {
      try {
        await client.connect();
      } catch (error) {
        console.error(`Failed to connect MCP server:`, error);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.servers.values()) {
      await client.disconnect();
    }
    this.servers.clear();
  }

  getServer(name: string): MCPClient | undefined {
    return this.servers.get(name);
  }

  getAllTools(): Array<{ server: string; tool: MCPToolDefinition }> {
    const allTools: Array<{ server: string; tool: MCPToolDefinition }> = [];

    for (const [name, client] of this.servers) {
      for (const tool of client.getTools()) {
        allTools.push({ server: name, tool });
      }
    }

    return allTools;
  }

  async callTool(server: string, toolName: string, input: Record<string, unknown>, toolCallId: string): Promise<ToolResult> {
    const client = this.servers.get(server);
    if (!client) {
      return {
        toolCallId,
        content: `MCP server not found: ${server}`,
        isError: true,
      };
    }
    return client.callTool(toolName, input, toolCallId);
  }

  getStats(): { servers: number; tools: number; connected: number } {
    let tools = 0;
    let connected = 0;

    for (const client of this.servers.values()) {
      const state = client.getState();
      tools += state.tools.length;
      if (state.status === "connected") connected++;
    }

    return {
      servers: this.servers.size,
      tools,
      connected,
    };
  }
}

// ============================================
// BUILT-IN MCP SERVERS
// ============================================

export function createBuiltInMCPServers(): MCPServerConfig[] {
  const servers: MCPServerConfig[] = [];

  // File system MCP server
  if (process.env.ENABLE_FS_MCP) {
    servers.push({
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
      timeout: 30000,
    });
  }

  // Git MCP server
  if (process.env.ENABLE_GIT_MCP) {
    servers.push({
      name: "git",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-git"],
      timeout: 30000,
    });
  }

  // GitHub MCP server
  if (process.env.GITHUB_TOKEN && process.env.ENABLE_GITHUB_MCP) {
    servers.push({
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN },
      timeout: 30000,
    });
  }

  // Postgres MCP server
  if (process.env.DATABASE_URL && process.env.ENABLE_POSTGRES_MCP) {
    servers.push({
      name: "postgres",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", process.env.DATABASE_URL],
      timeout: 30000,
    });
  }

  // Puppeteer MCP server (browser automation)
  if (process.env.ENABLE_PUPPETEER_MCP) {
    servers.push({
      name: "puppeteer",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      timeout: 60000,
    });
  }

  return servers;
}

// Global MCP manager instance
let mcpManagerInstance: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManagerInstance) {
    mcpManagerInstance = new MCPManager();
  }
  return mcpManagerInstance;
}
