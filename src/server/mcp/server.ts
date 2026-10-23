import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatTime, projectDuration } from '../../shared/timeline';
import { store } from '../storage/projects';
import { BUILTIN_TOOLS } from '../agent/tools';
import { mcpToolContext } from '../agent/session';
import { DIRECTOR_PROMPT } from '../agent/prompts';
import { normalizeOutput, toolJsonSchema } from '../agent/types';
import { skillIndex } from '../agent/skills';
import { getServerOrigin } from '../render/render';

/** Per-connection state for MCP clients (which project they're working on). */
export interface McpSessionState {
  projectId?: string;
}

const EXPORTED = () => BUILTIN_TOOLS.filter((t) => !t.uiOnly);

const PROJECT_TOOLS = [
  {
    name: 'list_projects',
    description: 'List Cutroom projects (most recent first).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_project',
    description: 'Create a new video project and make it the current project for this session. format "long" = 16:9 YouTube video, "short" = 9:16 YouTube Short.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, topic: { type: 'string' }, format: { type: 'string', enum: ['long', 'short'] }, mode: { type: 'string', enum: ['edit', 'generate', 'hybrid'] } },
      required: ['name'],
    },
  },
  {
    name: 'select_project',
    description: 'Make an existing project the current project for this session.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  },
  {
    name: 'import_file',
    description: 'Import a local file (absolute path on this machine: video, audio, image, document) into the current project as an asset. The file is copied.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, projectId: { type: 'string' } }, required: ['path'] },
  },
];

export const createMcpServer = (state: McpSessionState): Server => {
  const server = new Server(
    { name: 'director-studio', version: '1.0.0' },
    {
      capabilities: { tools: {}, prompts: {} },
      instructions:
        'Cutroom is an agentic YouTube video editor. Create or select a project first (create_project / select_project), add media with import_file, then use the editing, generation, motion-graphics, review and render tools. Every change appears live in the Cutroom editor UI. Load expert playbooks with load_skill before scripting, editing footage, designing graphics or writing code scenes.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...PROJECT_TOOLS,
      ...EXPORTED().map((t) => {
        const schema = toolJsonSchema(t) as { type: string; properties?: Record<string, unknown>; required?: string[] };
        return {
          name: t.name,
          description: t.description,
          inputSchema: { ...schema, type: 'object', properties: { ...(schema.properties ?? {}), projectId: { type: 'string', description: 'Project id (defaults to the current project of this session)' } } },
          annotations: t.readOnly ? { readOnlyHint: true } : undefined,
        };
      }),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });
    try {
      if (name === 'list_projects') {
        const list = await store.list();
        return text(list.length ? list.map((p) => `${p.id} "${p.name}" ${p.width}x${p.height} ${formatTime(p.duration)} updated ${p.updatedAt}`).join('\n') : 'No projects yet.');
      }
      if (name === 'create_project') {
        const p = await store.create({ name: String(args.name ?? 'Untitled video'), topic: String(args.topic ?? ''), format: args.format === 'short' ? 'short' : 'long', mode: (args.mode as 'edit') ?? 'hybrid' });
        state.projectId = p.id;
        return text(`Created project ${p.id} (${p.canvas.width}x${p.canvas.height}). Open it in the editor: ${getServerOrigin()}/?project=${p.id}`);
      }
      if (name === 'select_project') {
        const id = String(args.projectId);
        const p = await store.get(id);
        state.projectId = p.id;
        return text(`Current project: ${p.id} "${p.name}" (${formatTime(projectDuration(p))}).`);
      }
      const projectId = (args.projectId as string | undefined) ?? state.projectId ?? (await store.list())[0]?.id;
      if (!projectId) return text('No project yet. Call create_project first.', true);
      state.projectId = projectId;
      if (name === 'import_file') {
        const { registerAsset } = await import('../media/ingest');
        const path = await import('node:path');
        const a = await registerAsset(projectId, { sourcePath: String(args.path), originalName: path.basename(String(args.path)), copy: true, origin: 'upload', wait: true, updateSource: 'mcp' });
        return text(`Imported ${a.id} (${a.kind}, ${a.status}${a.meta.duration ? `, ${formatTime(a.meta.duration)}` : ''}).`);
      }
      const tool = EXPORTED().find((t) => t.name === name);
      if (!tool) return text(`Unknown tool ${name}`, true);
      const { projectId: _ignored, ...rest } = args;
      void _ignored;
      const parsed = tool.schema ? tool.schema.safeParse(rest) : { success: true as const, data: rest };
      if (!parsed.success) return text(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, true);
      const out = normalizeOutput(await tool.execute(parsed.data, mcpToolContext(projectId, extra.signal)));
      return {
        content: [{ type: 'text' as const, text: out.text }, ...(out.images ?? []).map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mime }))],
        isError: Boolean(out.isError),
      };
    } catch (err) {
      return text(`Error: ${(err as Error).message}`, true);
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      { name: 'produce_video', description: 'Produce a complete YouTube video from a topic with Cutroom', arguments: [{ name: 'topic', required: true }, { name: 'format', description: 'long or short' }, { name: 'length', description: 'target length, e.g. "8 minutes"' }] },
      { name: 'edit_footage', description: 'Edit raw footage into a polished YouTube video', arguments: [{ name: 'files', description: 'absolute paths of the footage, comma separated', required: true }, { name: 'notes' }] },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const a = req.params.arguments ?? {};
    const playbook = DIRECTOR_PROMPT.replace('{{SKILLS}}', skillIndex()).replace('{{TEMPLATES}}', 'see list_templates');
    const task =
      req.params.name === 'edit_footage'
        ? `Edit this footage into a polished YouTube video: ${a.files}. Notes: ${a.notes ?? 'none'}. Create a project, import the files with import_file, then follow the talking-head recipe (load_skill recipe-talking-head).`
        : `Produce a YouTube ${a.format === 'short' ? 'Short (9:16)' : 'video (16:9)'} about: ${a.topic}${a.length ? `, about ${a.length} long` : ''}. Create a project, then follow the faceless explainer recipe (load_skill recipe-faceless-explainer). Ask me before spending on voiceover.`;
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `You are driving Cutroom through its MCP tools. Follow this operating manual (the ask_user/update_plan/delegate tools are not available over MCP — ask me directly in chat):\n\n${playbook}\n\n---\n${task}` } }] };
  });

  return server;
};
