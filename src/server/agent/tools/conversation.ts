import { z } from 'zod';
import { uid } from '../../../shared/ids';
import { getSkill, listSkills } from '../skills';
import { defineTool } from '../types';

export const SUBAGENTS = ['researcher', 'scriptwriter', 'motion_designer', 'reviewer'] as const;

export const askUser = defineTool({
  name: 'ask_user',
  category: 'conversation',
  uiOnly: true,
  description:
    'Ask the user one to four questions in a structured card (buttons, checkboxes, text fields or a file drop zone) and wait for the answers. Use it to collect the video brief (topic, audience, goal, tone, format, length, style), to request attachments (kind "files": footage, logo, images, documents, data), or to get approval on big creative decisions (script outline, style direction). Offer 2–4 concrete options with a recommended one first; the user can always type their own answer. Do not ask about things you can decide yourself.',
  schema: z.object({
    title: z.string().optional().describe('Short heading for the card'),
    questions: z
      .array(
        z.object({
          question: z.string(),
          header: z.string().optional().describe('1-2 word label'),
          kind: z.enum(['choice', 'multi', 'text', 'files']).describe('choice = pick one, multi = pick several, text = free text, files = upload attachments'),
          options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
          placeholder: z.string().optional(),
          accept: z.array(z.enum(['video', 'audio', 'image', 'document'])).optional().describe('For kind=files'),
        }),
      )
      .min(1)
      .max(4),
  }),
  execute: async (input, ctx) => {
    const payload = {
      title: input.title,
      questions: input.questions.map((q) => ({ ...q, id: uid('q', 6), allowOther: q.kind === 'choice' || q.kind === 'multi' })),
    };
    const answers = await ctx.ask(payload);
    const lines = payload.questions.map((q) => {
      const a = answers.find((x) => x.questionId === q.id);
      if (!a) return `Q: ${q.question}\nA: (no answer)`;
      const val = Array.isArray(a.value) ? a.value.join(', ') : a.value;
      const files = a.assetIds?.length ? `\nAttached assets: ${a.assetIds.join(', ')}` : '';
      return `Q: ${q.question}\nA: ${val || '(empty)'}${files}`;
    });
    return { text: lines.join('\n\n'), summary: 'User answered' };
  },
});

export const updatePlan = defineTool({
  name: 'update_plan',
  category: 'conversation',
  uiOnly: true,
  description:
    'Create or update the visible production checklist (shown to the user above the chat). Send the FULL list every time with statuses. Keep exactly one item in_progress while working. Use for any task with 3+ steps; mark items done as soon as they are finished.',
  schema: z.object({
    items: z.array(z.object({ title: z.string(), status: z.enum(['pending', 'in_progress', 'done', 'skipped']) })).min(1).max(20),
  }),
  execute: async (input, ctx) => {
    ctx.updatePlan(input.items.map((it, i) => ({ id: `p${i}`, title: it.title, status: it.status })));
    const done = input.items.filter((i) => i.status === 'done').length;
    return { text: `Plan updated (${done}/${input.items.length} done).`, summary: `${done}/${input.items.length} done` };
  },
});

export const loadSkill = defineTool({
  name: 'load_skill',
  category: 'conversation',
  readOnly: true,
  description: 'Load a skill (expert playbook) by name. Load the relevant skill BEFORE doing that kind of work (scripting, editing footage, motion graphics, code scenes, captions/audio, thumbnails/SEO, Shorts).',
  schema: z.object({ name: z.string() }),
  execute: async ({ name }) => {
    const s = getSkill(name);
    if (!s) return { text: `Unknown skill "${name}". Available: ${listSkills().map((x) => x.name).join(', ')}`, isError: true };
    return { text: s.body, summary: s.name };
  },
});

export const delegate = defineTool({
  name: 'delegate',
  category: 'conversation',
  uiOnly: true,
  readOnly: true,
  description:
    'Hand a self-contained task to a specialist sub-agent and get its report back. Multiple delegate calls in the same turn run in parallel. Sub-agents: researcher (web + document research with sources), scriptwriter (writes the script into the project with write_script), motion_designer (builds graphics/custom code scenes for a time range), reviewer (watches frames and reports problems; does not edit). Give complete context in `task`: what, why, time ranges, constraints, expected output.',
  schema: z.object({ agent: z.enum(SUBAGENTS), task: z.string().min(10) }),
  execute: async ({ agent, task }, ctx) => {
    const report = await ctx.runSubagent(agent, task);
    return { text: report, summary: `${agent} finished` };
  },
});
