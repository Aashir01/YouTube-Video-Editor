import { z } from 'zod';
import { defineTool } from '../types';
import { translateSubtitles } from '../../subtitles';
import { createDub } from '../../dub';
import { LANGUAGES, language } from '../../../shared/subtitles';

const CODES = LANGUAGES.map((l) => `${l.code} (${l.name})`).join(', ');

export const translateSubtitlesTool = defineTool({
  name: 'translate_subtitles',
  category: 'publish',
  description: `Subtitles in other languages: translate the captions sentence by sentence (and the YouTube title and description) with the studio AI. Only sentences not translated yet are sent, so it is cheap to run again after edits. Every render then also writes one SRT per language, a YouTube upload adds them as caption tracks with the translated title/description, and a captions clip shows a language when its "language" field is set (updateClip patch {language: "es"}). Language codes: ${CODES}.`,
  schema: z.object({
    languages: z.array(z.string()).min(1).max(20).describe('Language codes, e.g. ["es", "pt", "hi"]'),
    metadata: z.boolean().optional().describe('Also translate the YouTube title and description (default true)'),
  }),
  execute: async (input, ctx) => {
    const r = await translateSubtitles(ctx.projectId, input.languages, { metadata: input.metadata, signal: ctx.signal });
    const names = input.languages.map((l) => language(l).name).join(', ');
    return {
      text: `Subtitles are ready in ${names}: ${r.translated} sentence${r.translated === 1 ? '' : 's'} translated now${r.missing ? `, ${r.missing} left out by the AI (they show in the original language; run it again to fill them in)` : ''}. Languages so far: ${r.state.languages.join(', ')}.`,
      summary: `subtitles: ${r.state.languages.join(', ')}`,
    };
  },
});

export const createDubTool = defineTool({
  name: 'create_dub',
  category: 'publish',
  description:
    'Make a dubbed version of the video in another language as a NEW project: the subtitles are translated, each line is voiced (the configured voice engine) at the moment the original was said, the original speech is lowered (or muted) and the captions show the translation; the YouTube title and description are translated too. The current project is not changed. Costs voice-engine credits: confirm with the user first.',
  schema: z.object({
    language: z.string().describe('Language code, e.g. "es"'),
    voice: z.string().optional().describe('Voice id for the configured engine (see list_voices)'),
    original: z.enum(['duck', 'mute']).optional().describe('The original speech: lowered under the dub (default) or silent'),
  }),
  execute: async (input, ctx) => {
    const r = await createDub(ctx.projectId, input.language, { voice: input.voice, original: input.original, signal: ctx.signal });
    return {
      text: `Created the dubbed version "${r.project.name}" (${r.lines} voiced lines with ${r.engine}${r.cut ? `; ${r.cut} line${r.cut === 1 ? ' was' : 's were'} too long for their moment and got cut short` : ''}) as a separate project ${r.project.id}. Tell the user they can open it from the project list or at /?project=${r.project.id}. You are still editing the original project.`,
      summary: `${language(input.language).name} dub`,
    };
  },
});
