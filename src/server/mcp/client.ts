import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getSettings, type McpServerConfig } from '../config';
import type { AgentTool, ToolOutput } from '../agent/types';

interface Connection {
  key: string;
  client?: Client;
  tools: AgentTool[];
  status: 'connecting' | 'connected' | 'error' | 'disabled';
  error?: string;
}

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Connects to external MCP servers configured in Settings (same shape as Claude
 * Desktop's "mcpServers") and exposes their tools to the Director agent as
 * mcp__<server>__<tool>.
 */
class McpManager {
  private conns = new Map<string, Connection>();
  private syncing: Promise<void> | null = null;

  tools(): AgentTool[] {
    return [...this.conns.values()].flatMap((c) => (c.status === 'connected' ? c.tools : []));
  }

  status() {
    return [...this.conns.entries()].map(([name, c]) => ({ name, status: c.status, error: c.error, tools: c.tools.map((t) => t.name) }));
  }

  sync(): Promise<void> {
    const run = async () => {
      const servers = getSettings().mcpServers;
      for (const [name, conn] of this.conns) {
        const cfg = servers[name];
        if (!cfg || JSON.stringify(cfg) !== conn.key) {
          await conn.client?.close().catch(() => undefined);
          this.conns.delete(name);
        }
      }
      await Promise.all(Object.entries(servers).filter(([name]) => !this.conns.has(name)).map(([name, cfg]) => this.connect(name, cfg)));
    };
    this.syncing = (this.syncing ?? Promise.resolve()).then(run, run);
    return this.syncing;
  }

  private async connect(name: string, cfg: McpServerConfig) {
    const conn: Connection = { key: JSON.stringify(cfg), tools: [], status: 'connecting' };
    this.conns.set(name, conn);
    if (cfg.disabled) {
      conn.status = 'disabled';
      return;
    }
    try {
      const client = new Client({ name: 'director-studio', version: '1.0.0' });
      const transport =
        'command' in cfg
          ? new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) }, stderr: 'ignore' })
          : new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers ?? {} } });
      await client.connect(transport, { timeout: 30_000 });
      const { tools } = await client.listTools(undefined, { timeout: 30_000 });
      conn.client = client;
      conn.tools = tools.map((t) => {
        const toolName = `mcp__${safeName(name)}__${safeName(t.name)}`.slice(0, 64);
        const tool: AgentTool = {
          name: toolName,
          description: `[MCP server "${name}"] ${t.description ?? t.name}`.slice(0, 1024),
          category: 'external',
          jsonSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
          readOnly: Boolean(t.annotations?.readOnlyHint),
          execute: async (input: Record<string, unknown>, ctx): Promise<ToolOutput> => {
            const res = await client.callTool({ name: t.name, arguments: input }, undefined, { signal: ctx.signal, timeout: 10 * 60_000 });
            const content = (res.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string; resource?: { text?: string; uri?: string } }[];
            const text = content
              .map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? (c.resource?.text ?? c.resource?.uri ?? '') : c.type === 'image' ? '[image]' : `[${c.type}]`))
              .filter(Boolean)
              .join('\n');
            const images = content.filter((c) => c.type === 'image' && c.data).map((c) => ({ mime: c.mimeType ?? 'image/png', data: c.data! }));
            return { text: text || (res.structuredContent ? JSON.stringify(res.structuredContent) : '(no content)'), images: images.length ? images : undefined, isError: Boolean(res.isError), summary: `${name}: ${t.name}` };
          },
        };
        return tool;
      });
      conn.status = 'connected';
      console.log(`[mcp] connected to "${name}" (${conn.tools.length} tools)`);
    } catch (err) {
      conn.status = 'error';
      conn.error = (err as Error).message;
      console.warn(`[mcp] could not connect to "${name}": ${conn.error}`);
    }
  }

  async closeAll() {
    for (const c of this.conns.values()) await c.client?.close().catch(() => undefined);
    this.conns.clear();
  }
}

export const mcpManager = new McpManager();
