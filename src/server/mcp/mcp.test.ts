import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-mcp-test-'));
process.env.DIRECTOR_DATA_DIR = tmp;
process.env.DIRECTOR_NO_WARMUP = '1';

let close: () => Promise<void>;
let url: string;

beforeAll(async () => {
  const { startServer } = await import('../main');
  const s = await startServer({ quiet: true, port: 0 });
  close = s.close;
  url = `http://127.0.0.1:${s.port}`;
});

afterAll(async () => {
  await close?.();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('MCP server (Streamable HTTP)', () => {
  it('lists tools, creates a project and edits it like an external agent would', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    expect(client.getInstructions()).toContain('Director Studio');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ['create_project', 'import_file', 'apply_edits', 'add_scene', 'write_code_scene', 'render_video', 'auto_cut', 'generate_voiceover']) expect(names).toContain(n);
    // chat-only tools are not exported
    expect(names).not.toContain('ask_user');
    expect(names).not.toContain('delegate');
    const created = await client.callTool({ name: 'create_project', arguments: { name: 'MCP made this', topic: 'Volcanoes', format: 'short' } });
    expect((created.content as { text: string }[])[0]!.text).toContain('1080x1920');
    const scene = await client.callTool({ name: 'add_scene', arguments: { template: 'title-card', props: { title: 'Volcanoes' }, duration: 3 } });
    expect(scene.isError).toBeFalsy();
    const bad = await client.callTool({ name: 'add_scene', arguments: { template: 'nope' } });
    expect(bad.isError).toBe(true);
    const proj = await client.callTool({ name: 'get_project', arguments: {} });
    const text = (proj.content as { text: string }[])[0]!.text;
    expect(text).toContain('scene:title-card');
    expect(text).toContain('1080x1920');
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain('produce_video');
    await client.close();
  });

  it('connects to external MCP servers and exposes their tools to the agent', async () => {
    const { getSavedSettings, saveSettings } = await import('../config');
    const { mcpManager } = await import('./client');
    const { allTools } = await import('../agent/session');
    saveSettings({ ...getSavedSettings(), mcpServers: { self: { url: `${url}/mcp` } } });
    await mcpManager.sync();
    const st = mcpManager.status().find((x) => x.name === 'self')!;
    expect(st.status).toBe('connected');
    const tool = allTools().find((t) => t.name === 'mcp__self__list_projects')!;
    expect(tool).toBeTruthy();
    const out = await tool.execute({}, { signal: new AbortController().signal } as never);
    expect(typeof out === 'string' ? out : out.text).toContain('MCP made this');
    await mcpManager.closeAll();
  });

  it('serves the REST API alongside', async () => {
    const r = await fetch(`${url}/api/projects`);
    const list = (await r.json()) as { name: string }[];
    expect(list.some((p) => p.name === 'MCP made this')).toBe(true);
  });
});
