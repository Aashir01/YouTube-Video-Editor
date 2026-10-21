import { z } from 'zod';
import { uid } from '../../../shared/ids';
import { clipEnd, formatTime } from '../../../shared/timeline';
import { applyOp } from '../../../shared/ops';
import { registerAsset } from '../../media/ingest';
import { listVoices, pickTtsEngine, synthesizeSpeech, type TtsEngineId } from '../../services/tts';
import { defineTool, j } from '../types';
import { getProject, mutate } from './helpers';

const PAID_TTS: TtsEngineId[] = ['elevenlabs', 'openai', 'gemini'];

export const writeScript = defineTool({
  name: 'write_script',
  category: 'script',
  description:
    'Save the video script as ordered sections (replaces the script by default, or appends). Each section = one beat: exact narration + visual plan. The script is shown to the user in the Script panel and drives generate_voiceover. Load the youtube-scriptwriting skill first.',
  schema: z.object({
    title: z.string().optional(),
    hook: z.string().optional().describe('The opening hook line (also the first section)'),
    sections: z
      .array(
        z.object({
          id: z.string().optional().describe('Keep the existing id when revising a section'),
          title: z.string(),
          narration: z.string().describe('Exact words to speak'),
          visuals: z.string().describe('Visual plan: templates/props, b-roll search terms, footage moments'),
          onScreenText: z.string().optional(),
        }),
      )
      .min(1),
    callToAction: z.string().optional(),
    notes: z.string().optional(),
    mode: z.enum(['replace', 'append']).default('replace'),
  }),
  execute: async (input, ctx) => {
    const p = await mutate(ctx, 'Write script', (d) => {
      const existing = input.mode === 'append' ? d.script.sections : [];
      const sections = input.sections.map((s) => {
        const prev = d.script.sections.find((x) => x.id === s.id);
        const changed = !prev || prev.narration !== s.narration;
        return {
          id: s.id ?? uid('sec', 6),
          title: s.title,
          narration: s.narration,
          visuals: s.visuals,
          onScreenText: s.onScreenText,
          voiceAssetId: changed ? undefined : prev?.voiceAssetId,
          durationSec: changed ? undefined : prev?.durationSec,
          status: changed ? ('draft' as const) : prev!.status,
        };
      });
      applyOp(d, {
        op: 'setScript',
        script: {
          title: input.title ?? d.script.title,
          hook: input.hook ?? d.script.hook,
          sections: [...existing, ...sections],
          callToAction: input.callToAction ?? d.script.callToAction,
          notes: input.notes ?? d.script.notes,
        },
      });
    });
    const words = p.script.sections.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
    return {
      text: `Script saved: ${p.script.sections.length} sections, ${words} words (≈ ${formatTime(words / 2.5, false)} of narration at 150 wpm).\n${p.script.sections.map((s) => `- ${s.id} "${s.title}" (${s.narration.split(/\s+/).length} words)`).join('\n')}`,
      summary: `${p.script.sections.length} sections, ~${Math.round(words / 2.5)}s`,
    };
  },
});

export const listVoicesTool = defineTool({
  name: 'list_voices',
  category: 'script',
  readOnly: true,
  description: 'List the available voiceover engines and their voices (ids, names, descriptions).',
  schema: z.object({ engine: z.enum(['elevenlabs', 'openai', 'gemini', 'kokoro', 'system']).optional() }),
  execute: async (input, ctx) => {
    const all = await listVoices(ctx.settings);
    const list = all.filter((e) => !input.engine || e.engine === input.engine);
    if (!list.length) return { text: 'No voice engine is available. Ask the user to add an ElevenLabs/OpenAI/Gemini key or enable the local Kokoro voice in Settings.', isError: true };
    return {
      text: list.map((e) => `${e.label} [engine=${e.engine}] default=${e.default || '(system)'}\n${e.voices.slice(0, 40).map((v) => `  - ${v.id}: ${v.name}${v.gender ? ` (${v.gender}${v.accent ? `, ${v.accent}` : ''})` : ''}${v.description ? ` — ${v.description}` : ''}`).join('\n')}`).join('\n\n'),
      summary: list.map((e) => e.engine).join(', '),
    };
  },
});

export const generateVoiceover = defineTool({
  name: 'generate_voiceover',
  category: 'generate',
  description:
    'Generate AI voiceover with word-level timings and (by default) place it on the Voiceover track. Either pass `text` for one clip, or omit it to voice the script sections (all, or `sectionIds`) in order. Returns each section\'s exact start/end on the timeline — use those times to place visuals. Regenerating a section replaces its previous voice clip.',
  schema: z.object({
    text: z.string().optional(),
    sectionIds: z.array(z.string()).optional(),
    engine: z.enum(['elevenlabs', 'openai', 'gemini', 'kokoro', 'system']).optional(),
    voice: z.string().optional().describe('Voice id from list_voices'),
    style: z.string().optional().describe('Delivery direction, e.g. "energetic and warm", "calm documentary"'),
    speed: z.number().min(0.7).max(1.3).optional(),
    place: z.boolean().default(true),
    startAt: z.number().min(0).optional().describe('Timeline position for the first clip (default: end of the Voiceover track)'),
    gap: z.number().min(0).max(3).default(0.3).describe('Pause between sections (seconds)'),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const engine = await pickTtsEngine(ctx.settings, input.engine);
    if (!engine) return { text: 'No voice engine available. Add an ElevenLabs, OpenAI or Gemini key, or enable local Kokoro in Settings → Voice.', isError: true };
    const jobs: { sectionId?: string; title: string; text: string }[] = input.text
      ? [{ title: 'Voiceover', text: input.text }]
      : p.script.sections.filter((s) => !input.sectionIds || input.sectionIds.includes(s.id)).map((s) => ({ sectionId: s.id, title: s.title, text: s.narration }));
    if (!jobs.length || jobs.every((x) => !x.text.trim())) return { text: 'Nothing to voice: write the script first (write_script) or pass text.', isError: true };
    const chars = jobs.reduce((n, x) => n + x.text.length, 0);
    if (PAID_TTS.includes(engine.id)) {
      const ok = await ctx.approve(`Generate ${jobs.length} voiceover clip(s) — ${chars.toLocaleString()} characters with ${engine.label}`, engine.id === 'elevenlabs' ? `≈ ${Math.ceil(chars / 1000)}k ElevenLabs credits` : undefined);
      if (!ok) return { text: 'The user declined the voiceover generation. Ask how they want to proceed (different engine, edited script, or their own recording).', isError: true };
    }
    const voiceTrack = p.tracks.find((t) => t.name === 'Voiceover') ?? p.tracks.find((t) => t.kind === 'audio');
    let cursor = input.startAt ?? (voiceTrack ? voiceTrack.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0) : 0);
    const rows: Record<string, unknown>[] = [];
    for (const [i, job] of jobs.entries()) {
      ctx.progress(`Voicing ${i + 1}/${jobs.length}: ${job.title}`);
      const speech = await synthesizeSpeech(job.text, ctx.settings, { engine: engine.id, voice: input.voice, style: input.style, speed: input.speed });
      const asset = await registerAsset(ctx.projectId, {
        sourcePath: speech.file,
        originalName: `VO ${String(i + 1).padStart(2, '0')} ${job.title}`.replace(/[^\w\- ]+/g, '').slice(0, 60) + (speech.file.endsWith('.wav') ? '.wav' : '.mp3'),
        origin: 'tts',
        voice: { engine: speech.engine, voice: speech.voice, text: job.text },
        words: speech.words,
        wait: true,
        description: `Voiceover: "${job.text.slice(0, 120)}"`,
        updateSource: ctx.source,
      });
      let clipId: string | undefined;
      let start = cursor;
      await mutate(ctx, `Voiceover: ${job.title}`, (d) => {
        if (input.place) {
          const sec = job.sectionId ? d.script.sections.find((s) => s.id === job.sectionId) : undefined;
          // replace a previous take of the same section
          if (sec?.voiceAssetId) {
            for (const t of d.tracks) {
              const old = t.clips.find((c) => c.type === 'audio' && c.assetId === sec.voiceAssetId);
              if (old && input.startAt === undefined && i === 0) start = old.start;
              t.clips = t.clips.filter((c) => !(c.type === 'audio' && c.assetId === sec.voiceAssetId));
            }
          }
          const r = applyOp(d, { op: 'addClip', clip: { id: '', type: 'audio', role: 'voiceover', assetId: asset.id, start, duration: Math.max(0.2, speech.duration) }, onConflict: 'new-track' }) as { clipId: string };
          clipId = r.clipId;
        }
        if (job.sectionId) {
          const sec = d.script.sections.find((s) => s.id === job.sectionId);
          if (sec) {
            sec.voiceAssetId = asset.id;
            sec.durationSec = Math.round(speech.duration * 100) / 100;
            sec.status = input.place ? 'placed' : 'voiced';
          }
        }
      });
      rows.push({ section: job.sectionId ?? null, title: job.title, assetId: asset.id, clipId, start: input.place ? Math.round(start * 100) / 100 : null, end: input.place ? Math.round((start + speech.duration) * 100) / 100 : null, duration: Math.round(speech.duration * 100) / 100, timing: speech.alignment });
      cursor = start + speech.duration + input.gap;
    }
    return { text: `Voiceover ready (${engine.label}, voice ${input.voice ?? 'default'}):\n${j(rows)}\nTotal narration ends at ${formatTime(cursor - input.gap)}.`, summary: `${rows.length} clip(s), ends ${formatTime(cursor - input.gap, false)}` };
  },
});
