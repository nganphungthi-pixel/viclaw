/**
 * viclaw Gateway - WebSocket Server
 * Provides remote access to the AI agent via WebSocket
 * Also serves Web UI when enabled
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { createReadStream, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import { createAgentLoop, AgentResult, StreamCallback } from '../agent/mod.js';
import { createMemorySystem } from '../memory/mod.js';
import { createToolExecutor } from '../tools/mod.js';
import { createProvider } from '../providers/mod.js';

export interface GatewayConfig {
  port: number;
  host: string;
  maxConnections: number;
  sessionTimeout: number;
  serveWebUI?: boolean;
  publicDir?: string;
  /**
   * Shared-secret auth for WebSocket `request` messages. Set via the
   * `GATEWAY_TOKEN` env var (or explicitly here). When set, every `request`
   * must carry the token in `message.auth`; without it the request is refused.
   * There is no user model — this is a single shared secret, enough to stop
   * network-neighbor abuse of an exposed gateway.
   */
  token?: string;
}

const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: parseInt(process.env.GATEWAY_PORT || '8080'),
  host: process.env.GATEWAY_HOST || 'localhost',
  maxConnections: 10,
  sessionTimeout: 3600000,
  serveWebUI: false,
  publicDir: join(process.cwd(), 'public'),
  token: process.env.GATEWAY_TOKEN || undefined,
};

interface WSMessage {
  type: 'request' | 'response' | 'stream' | 'error' | 'ping' | 'pong' | 'close';
  id: string;
  sessionId?: string;
  payload?: unknown;
  /** Shared secret — required on `request` when the gateway sets a token. */
  auth?: string;
}

interface Session {
  id: string;
  ws: WebSocket;
  agent: ReturnType<typeof createAgentLoop>;
  createdAt: number;
  lastActivity: number;
}

export class GatewayServer {
  private config: GatewayConfig;
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private sessions: Map<string, Session> = new Map();

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    const host = this.config.host;
    const exposed = host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
    if (exposed && !this.config.token) {
      // Fail loud, not silent: an agent that runs shell commands must never
      // listen on a reachable interface without a token.
      console.warn(
        '[viclaw] WARNING: gateway binds a non-loopback interface ' +
        `(${host}) with no GATEWAY_TOKEN set. Any host that can reach this ` +
        'port can run agent commands. Set GATEWAY_TOKEN to silence this.'
      );
    }
  }

  /** True when the message carries a valid token, or no token is configured. */
  isAuthorized(message: WSMessage): boolean {
    if (!this.config.token) return true;
    return message.auth === this.config.token;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.config.serveWebUI) {
        // HTTP + WebSocket
        this.httpServer = createServer((req, res) => this.handleHTTP(req, res));

        this.httpServer.on('upgrade', (req, socket, head) => {
          if (this.wss) {
            this.wss.handleUpgrade(req, socket, head, (ws) => {
              this.wss!.emit('connection', ws, req);
            });
          }
        });

        this.wss = new WebSocketServer({ noServer: true });
        this.httpServer.listen(this.config.port, this.config.host, () => {
          console.log(`🔥 VICLAW Gateway | Web: http://${this.config.host}:${this.config.port} | WS: ws://${this.config.host}:${this.config.port}`);
          resolve();
        });
      } else {
        // WebSocket only
        this.wss = new WebSocketServer({
          port: this.config.port,
          host: this.config.host,
          maxPayload: 10 * 1024 * 1024,
        });

        this.wss.on('listening', () => {
          console.log(`🔥 VICLAW Gateway | WS: ws://${this.config.host}:${this.config.port}`);
          resolve();
        });

        this.wss.on('error', reject);
      }

      if (this.wss) {
        this.wss.on('connection', (ws, req) => {
          console.log(`🔌 New connection from ${req?.socket?.remoteAddress}`);
          this.handleConnection(ws);
        });
      }
    });
  }

  private handleHTTP(req: IncomingMessage, res: ServerResponse): void {
    // Liveness probe for Docker HEALTHCHECK and orchestrators. Answered
    // before the Web UI gate so health checks work with serveWebUI off too.
    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: this.sessions.size }));
      return;
    }

    if (!this.config.serveWebUI || !this.config.publicDir) {
      res.writeHead(404); res.end('Not Found');
      return;
    }

    let filePath = req.url === '/' ? '/index.html' : req.url || '/index.html';
    filePath = resolve(this.config.publicDir, filePath.replace(/^\//, ''));

    if (!filePath.startsWith(this.config.publicDir!)) {
      res.writeHead(403); res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath)) {
      res.writeHead(404); res.end('Not Found');
      return;
    }

    const ext = extname(filePath);
    const mimes: Record<string, string> = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    };

    res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  }

  private handleConnection(ws: WebSocket): void {
    let sessionId: string | null = null;

    ws.on('pong', () => {});

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;

        if (message.type === 'ping') {
          this.send(ws, { type: 'pong', id: message.id });
          return;
        }

        if (message.type === 'close') {
          ws.close();
          return;
        }

        if (message.type === 'request') {
          if (!this.isAuthorized(message)) {
            this.sendError(ws, 'Unauthorized: missing or invalid auth token', message.id);
            return;
          }
          await this.handleRequest(ws, message, (id) => { sessionId = id; });
        }
      } catch (error) {
        this.sendError(ws, `Parse error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('close', () => {
      if (sessionId) this.sessions.delete(sessionId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  }

  private async handleRequest(ws: WebSocket, message: WSMessage, setSessionId: (id: string) => void): Promise<void> {
    const payload = message.payload as { prompt?: string; options?: Record<string, unknown> } | undefined;

    if (!payload?.prompt) {
      this.sendError(ws, 'Missing prompt in request payload', message.id);
      return;
    }

    const existingId = message.sessionId;
    let session: Session;

    if (existingId && this.sessions.has(existingId)) {
      session = this.sessions.get(existingId)!;
      session.lastActivity = Date.now();
    } else {
      const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memory = createMemorySystem();
      const tools = createToolExecutor();

      session = {
        id,
        ws,
        agent: createAgentLoop({ maxIterations: 30, stream: true }, createProvider(), memory, tools),
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      this.sessions.set(id, session);
      setSessionId(id);
    }

    try {
      const callback: StreamCallback = {
        onContent: (content) => {
          this.send(ws, { type: 'stream', id: message.id, sessionId: session.id, payload: { type: 'content', content } });
        },
        onToolCall: (toolCall) => {
          this.send(ws, { type: 'stream', id: message.id, sessionId: session.id, payload: { type: 'tool_call', tool: toolCall.name } });
        },
        onToolResult: (result) => {
          this.send(ws, { type: 'stream', id: message.id, sessionId: session.id, payload: { type: 'tool_result', result: result.content } });
        },
        onDone: (result) => {
          this.send(ws, { type: 'response', id: message.id, sessionId: session.id, payload: result });
        },
        onError: (error) => {
          this.sendError(ws, error.message, message.id, session.id);
        },
      };

      await session.agent.runAgentStream(payload.prompt, callback);
    } catch (error) {
      this.sendError(ws, `Agent error: ${error instanceof Error ? error.message : String(error)}`, message.id, session.id);
    }
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string, id?: string, sessionId?: string): void {
    this.send(ws, { type: 'error', id: id || '', sessionId, payload: { error } });
  }

  async stop(): Promise<void> {
    for (const [, session] of this.sessions) {
      session.ws.close();
    }
    this.sessions.clear();

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getActiveSessions(): number {
    return this.sessions.size;
  }
}
