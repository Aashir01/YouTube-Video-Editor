import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * `director mcp` — MCP over stdio for Claude Desktop / Claude Code / Cursor.
 * If Director Studio is already running, requests are bridged to it (so the
 * open editor updates live). Otherwise the studio starts in-process.
 */
export const runStdio = async (port = Number(process.env.PORT ?? 3333)) => {
  // stdout carries the protocol: route all logging to stderr
  console.log = console.error;
  console.info = console.error;
  const base = `http://127.0.0.1:${port}`;
  let running = false;
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    running = r.ok && ((await r.json()) as { name?: string }).name === 'Director Studio';
  } catch {
    running = false;
  }

  if (running) {
    console.error(`[director-mcp] bridging to the running studio at ${base}`);
    const upstream = new Client({ name: 'director-stdio-bridge', version: '1.0.0' });
    await upstream.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const server = new Server({ name: 'director-studio', version: '1.0.0' }, { capabilities: { tools: {}, prompts: {} }, instructions: upstream.getInstructions() });
    server.setRequestHandler(ListToolsRequestSchema, async (req) => upstream.listTools(req.params));
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => upstream.callTool(req.params, undefined, { signal: extra.signal, timeout: 60 * 60_000, resetTimeoutOnProgress: true }));
    server.setRequestHandler(ListPromptsRequestSchema, async (req) => upstream.listPrompts(req.params));
    server.setRequestHandler(GetPromptRequestSchema, async (req) => upstream.getPrompt(req.params));
    await server.connect(new StdioServerTransport());
    return;
  }

  console.error('[director-mcp] starting Director Studio in-process');
  const { startServer } = await import('../main');
  const started = await startServer({ quiet: true, port });
  console.error(`[director-mcp] editor UI: ${started.url}`);
  const { createMcpServer } = await import('./server');
  const server = createMcpServer({});
  await server.connect(new StdioServerTransport());
};
