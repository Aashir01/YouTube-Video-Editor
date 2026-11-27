/**
 * Find Shorts: the AI reads the timeline transcript and picks the moments that work on their own
 * as Shorts (shared/moments.ts holds the prompt and the parsing). The result is kept next to the
 * project, so the Shorts tab, the Director and MCP clients all see the same list.
 */
import { complete } from './ai/llm';
import { aiQueue } from './jobs';
import { bus } from './events';
import { store } from './storage/projects';
import { createShort } from './shorts';
import { projectDuration, timelineWords } from '../shared/timeline';
import {
  MOMENTS_SYSTEM,
  momentsPrompt,
  parseMomentsReply,
  resolveMoments,
  toSentences,
  transcriptWindows,
  wordsSignature,
  type MomentOptions,
  type MomentsState,
  type RawMoment,
} from '../shared/moments';
import type { Project } from '../shared/schema';

const FILE = 'moments.json';

export const readMoments = (projectId: string) => store.readSideFile<MomentsState>(projectId, FILE);

const save = async (projectId: string, state: MomentsState) => {
  await store.writeSideFile(projectId, FILE, state);
  bus.emit(projectId, { type: 'moments', state });
};

const timelineSentences = async (p: Project) => {
  const words = timelineWords(p, await store.transcriptsFor(p));
  return { words, sentences: toSentences(words) };
};

/** Run up to `limit` tasks at a time, in order. */
const pool = async <T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

export const findMoments = async (projectId: string, opts: Partial<MomentOptions> = {}, signal?: AbortSignal): Promise<MomentsState> => {
  const p = await store.get(projectId);
  const { words, sentences } = await timelineSentences(p);
  if (words.length < 15) throw new Error('Finding Shorts needs the transcript of the video: transcribe the footage on the timeline first');
  const options: MomentOptions = {
    count: Math.round(Math.min(12, Math.max(1, opts.count ?? 5))),
    minSec: Math.max(5, opts.minSec ?? 20),
    maxSec: Math.min(180, Math.max(10, opts.maxSec ?? 60)),
    focus: opts.focus?.trim().slice(0, 300) || undefined,
  };
  if (options.minSec >= options.maxSec) options.minSec = Math.max(5, options.maxSec / 2);
  const total = projectDuration(p);
  if (total < options.minSec) throw new Error(`The video is only ${Math.round(total)}s long: there is nothing to cut a ${options.minSec}s Short from`);

  const windows = transcriptWindows(sentences);
  const raw: RawMoment[] = await aiQueue.add(projectId, 'Finding Shorts', async (report) => {
    let done = 0;
    const replies = await pool(windows, 3, async (w) => {
      const span = w[w.length - 1]!.end - w[0]!.start;
      const count = windows.length === 1 ? options.count + 2 : Math.max(2, Math.ceil((options.count * span) / Math.max(1, total)) + 1);
      const text = await complete({ system: MOMENTS_SYSTEM, prompt: momentsPrompt(w, { ...options, count }, p.name), kind: 'main', maxTokens: 2500, signal });
      report(++done / windows.length, `${done}/${windows.length}`);
      return parseMomentsReply(text);
    });
    return replies.flat();
  });

  const moments = resolveMoments(raw, sentences, options);
  if (!moments.length) throw new Error(raw.length ? 'The AI suggested moments that do not fit the length limits; try other lengths' : 'The AI did not suggest any moments; try again or with another model');
  const state: MomentsState = { createdAt: new Date().toISOString(), signature: wordsSignature(words), options, moments };
  await save(projectId, state);
  return state;
};

/** Is the saved list still about the current edit? */
export const momentsAreCurrent = async (projectId: string, state: MomentsState) => {
  const { words } = await timelineSentences(await store.get(projectId));
  return wordsSignature(words) === state.signature;
};

/** Cut one found moment into a new 9:16 Short project (reframed and captioned) and remember it. */
export const shortFromMoment = async (projectId: string, momentId: string) => {
  const state = await readMoments(projectId);
  const moment = state?.moments.find((m) => m.id === momentId);
  if (!state || !moment) throw new Error('That moment was not found; find Shorts again');
  if (!(await momentsAreCurrent(projectId, state))) throw new Error('The video was edited since these moments were found; find Shorts again so the times match');
  const short = await createShort(projectId, [[moment.start, moment.end]], { title: moment.title });
  const fresh = (await readMoments(projectId)) ?? state;
  const m = fresh.moments.find((x) => x.id === momentId);
  if (m) m.shortId = short.id;
  await save(projectId, fresh);
  return { id: short.id, name: short.name, duration: projectDuration(short) };
};
