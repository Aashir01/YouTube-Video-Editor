import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer, type McpSessionState } from './server';
import { mcpManager } from './client';

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  state: McpSessionState;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

// drop idle sessions after 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600_000;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff) {
    void s.transport.close().catch(() => undefined);
    sessions.delete(id);
  }
}, 10 * 60_000).unref();

/** Streamable HTTP MCP endpoint at /mcp (Claude Code: `claude mcp add --transport http director http://localhost:3333/mcp`). */
export const installMcpRoutes = (app: Hono): void => {
  app.get('/api/mcp/status', (c) => c.json({ sessions: sessions.size, external: mcpManager.status() }));
  app.post('/api/mcp/reload', async (c) => {
    await mcpManager.sync();
    return c.json({ external: mcpManager.status() });
  });

  app.all('/mcp', async (c) => {
    // Only local clients (the server binds to 127.0.0.1 by default); reject cross-site browser requests
    const origin = c.req.header('origin');
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return c.json({ error: 'Forbidden origin' }, 403);
    const sid = c.req.header('mcp-session-id');
    if (sid) {
      const s = sessions.get(sid);
      if (!s) return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }, 404);
      s.lastSeen = Date.now();
      return s.transport.handleRequest(c.req.raw);
    }
    const state: McpSessionState = {};
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => void sessions.set(id, { transport, state, lastSeen: Date.now() }),
      onsessionclosed: (id) => void sessions.delete(id),
    });
    const server = createMcpServer(state);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
};
