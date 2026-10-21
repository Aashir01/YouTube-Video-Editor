import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResponse, ChatModel } from '../ai/llm';

// isolated data dir for this test run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'director-agent-test-'));
process.env.DIRECTOR_DATA_DIR = tmp;

type Script = (req: ChatRequest, call: number) => Partial<ChatResponse>;

const scripted: { steps: Script[]; calls: ChatRequest[] } = { steps: [], calls: [] };

const mockModel: ChatModel = {
  providerId: 'mock',
  providerType: 'openai-compatible',
  model: 'mock-1',
  label: 'Mock · mock-1',
  vision: true,
  chat: async (req) => {
    const i = scripted.calls.length;
    scripted.calls.push(structuredClone({ ...req, signal: undefined, onText: undefined }));
    const step = scripted.steps[i];
    if (!step) return { text: 'Done.', toolCalls: [], stop: 'end', usage: { input: 10, output: 5 } };
    const r = step(req, i);
    if (r.text) req.onText?.(r.text);
    return { text: r.text ?? '', toolCalls: r.toolCalls ?? [], stop: r.stop ?? ((r.toolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'end'), usage: { input: 100, output: 20 } };
  },
};

vi.mock('../ai/llm', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, resolveModel: () => mockModel };
});

let store: typeof import('../storage/projects').store;
let getSession: typeof import('./session').getSession;
let bus: typeof import('../events').bus;

beforeAll(async () => {
  ({ store } = await import('../storage/projects'));
  ({ getSession } = await import('./session'));
  ({ bus } = await import('../events'));
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const waitFor = async (cond: () => boolean, ms = 10000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const call = (name: string, input: Record<string, unknown>, id = `call_${name}_${Math.random().toString(36).slice(2, 7)}`) => ({ id, name, input });

describe('Director agent loop', () => {
  it('runs a full brief → plan → ask → edit → review cycle', async () => {
    const project = await store.create({ name: 'Agent test' });
    const session = getSession(project.id);
    const events: string[] = [];
    const off = bus.subscribe(project.id, (e) => e.type === 'agent' && events.push(e.event.kind));
    scripted.calls = [];
    scripted.steps = [
      () => ({
        text: 'Let me set up a plan.',
        toolCalls: [
          call('update_plan', { items: [{ title: 'Brief', status: 'in_progress' }, { title: 'Build scenes', status: 'pending' }] }),
          call('set_brief', { topic: 'Why sleep matters', format: 'long', targetDurationSec: 20 }),
        ],
      }),
      () => ({
        toolCalls: [call('ask_user', { title: 'Quick questions', questions: [{ question: 'Who is the audience?', kind: 'choice', options: [{ label: 'Students' }, { label: 'Parents' }] }] })],
      }),
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        expect(last.role).toBe('tool');
        if (last.role === 'tool') expect(last.results[0]!.content).toContain('Students');
        return {
          text: 'Building the scenes now.',
          toolCalls: [
            call('apply_edits', {
              label: 'Opening scenes',
              ops: [
                { op: 'addClip', trackId: 'Main', clip: { type: 'scene', template: 'title-card', start: 0, duration: 4, props: { title: 'Why *Sleep* Matters' } } },
                { op: 'addClip', trackId: 'Main', clip: { type: 'scene', template: 'big-number', start: 4, duration: 4, props: { value: 35, suffix: '%', label: 'sleep too little' } } },
              ],
            }),
            call('add_captions', { style: { preset: 'bold-pop' } }),
          ],
        };
      },
      () => ({ toolCalls: [call('add_scene', { template: 'bullet-list', props: { heading: 'Tips' } })] }),
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        // invalid props are reported back to the model instead of crashing
        if (last.role === 'tool') expect(last.results[0]!.isError).toBe(true);
        return { toolCalls: [call('add_scene', { template: 'bullet-list', props: { heading: 'Tips', items: ['Same wake time', 'No screens'] }, duration: 5 })] };
      },
      () => ({ toolCalls: [call('check_timeline', {}), call('get_project', {})] }),
      () => ({ text: 'Your 13-second draft is ready.' }),
    ];
    await session.send('Make a short video about sleep');
    await waitFor(() => session.snapshot().messages.some((m) => m.role === 'question' && m.status === 'open'));
    const q = session.snapshot().messages.find((m) => m.role === 'question')!;
    expect(session.snapshot().state.status).toBe('waiting');
    if (q.role !== 'question') throw new Error('expected question');
    session.answer(q.id, [{ questionId: q.payload.questions[0]!.id, value: 'Students' }]);
    await waitFor(() => !session.busy && session.snapshot().messages.some((m) => m.role === 'assistant' && m.text.includes('draft is ready')));
    off();

    const p = await store.get(project.id);
    const main = p.tracks.find((t) => t.name === 'Main')!;
    expect(main.clips.map((c) => (c.type === 'scene' ? c.template : c.type))).toEqual(['title-card', 'big-number', 'bullet-list']);
    expect(p.tracks.find((t) => t.kind === 'captions')!.clips.length).toBe(1);
    expect(p.brief.topic).toBe('Why sleep matters');
    const snap = session.snapshot();
    expect(snap.plan.map((i) => i.title)).toEqual(['Brief', 'Build scenes']);
    const tools = snap.messages.filter((m) => m.role === 'tool');
    expect(tools.length).toBe(9);
    expect(tools.filter((m) => m.role === 'tool' && m.status === 'error').length).toBe(1);
    expect(events).toContain('text-delta');
    expect(events).toContain('plan');
    // the first user turn carries the studio state; history is persisted to disk
    expect(scripted.calls[0]!.messages[0]!.role).toBe('user');
    const firstUser = scripted.calls[0]!.messages[0]!;
    if (firstUser.role === 'user' && firstUser.content[0]!.type === 'text') expect(firstUser.content[0]!.text).toContain('<studio_state');
    await new Promise((r) => setTimeout(r, 600));
    const saved = JSON.parse(fs.readFileSync(path.join(store.dir(project.id), 'chat.json'), 'utf8'));
    expect(saved.llm.length).toBeGreaterThan(10);
  });

  it('delegates to a sub-agent with a restricted toolset', async () => {
    const project = await store.create({ name: 'Delegation test' });
    const session = getSession(project.id);
    scripted.calls = [];
    scripted.steps = [
      () => ({ toolCalls: [call('delegate', { agent: 'reviewer', task: 'Review the whole timeline and report issues.' })] }),
      (req) => {
        // sub-agent request: only reviewer tools are offered
        expect(req.tools.map((t) => t.name).sort()).toEqual(['check_timeline', 'get_project', 'get_timeline', 'get_transcript', 'inspect_assets', 'load_skill', 'preview_frames', 'view_media'].sort());
        return { toolCalls: [call('check_timeline', {})] };
      },
      () => ({ text: 'REPORT: timeline is empty; add content.' }),
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        expect(last.role).toBe('tool');
        if (last.role === 'tool') expect(last.results[0]!.content).toContain('REPORT: timeline is empty');
        return { text: 'The reviewer says the timeline is empty.' };
      },
    ];
    await session.send('Review my video');
    await waitFor(() => !session.busy && session.snapshot().messages.some((m) => m.role === 'assistant' && m.text.includes('reviewer says')));
    const sub = session.snapshot().messages.filter((m) => m.agent === 'reviewer');
    expect(sub.length).toBeGreaterThan(0);
  });

  it('stops cleanly while waiting for the user', async () => {
    const project = await store.create({ name: 'Stop test' });
    const session = getSession(project.id);
    scripted.calls = [];
    scripted.steps = [() => ({ toolCalls: [call('ask_user', { questions: [{ question: 'Topic?', kind: 'text' }] })] })];
    await session.send('Hi');
    await waitFor(() => session.snapshot().state.status === 'waiting');
    session.stop();
    await waitFor(() => !session.busy);
    const q = session.snapshot().messages.find((m) => m.role === 'question');
    expect(q && q.role === 'question' && q.status).toBe('cancelled');
    expect(session.snapshot().messages.some((m) => m.role === 'system' && m.text === 'Stopped.')).toBe(true);
  });

  it('answers an open question with a typed message', async () => {
    const project = await store.create({ name: 'Typed answer test' });
    const session = getSession(project.id);
    scripted.calls = [];
    scripted.steps = [
      () => ({ toolCalls: [call('ask_user', { questions: [{ question: 'Topic?', kind: 'text' }] })] }),
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        if (last.role === 'tool') expect(last.results[0]!.content).toContain('Black holes');
        return { text: 'Great topic.' };
      },
    ];
    await session.send('Make me a video');
    await waitFor(() => session.snapshot().state.status === 'waiting');
    await session.send('Black holes');
    await waitFor(() => !session.busy && session.snapshot().messages.some((m) => m.role === 'assistant' && m.text === 'Great topic.'));
  });
});
