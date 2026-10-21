import { z } from 'zod';
import { CaptionStyleSchema, TRACK_KINDS, TRANSITION_TYPES, type ClipInput, type Project } from '../../../shared/schema';
import { applyOps, type EditOp } from '../../../shared/ops';
import { computeKeepSegments, formatTime, projectDuration, requireTrack, segmentsToClips, timelineWords, type Interval } from '../../../shared/timeline';
import { getTemplate, parseTemplateProps } from '../../../shared/templates';
import { store } from '../../storage/projects';
import { detectSilence } from '../../media/ffmpeg';
import { defineTool, j } from '../types';
import { getProject, mutate, timelineReadout } from './helpers';

const Transition = z.object({ type: z.enum(TRANSITION_TYPES), duration: z.number().min(0.05).max(3).default(0.4) });

const CLIP_REFERENCE = `Clip fields (times in seconds, positions 0-1 of the canvas, sizes in design px where 1u = 1px at 1080p):
- all: type, start, duration, name?, transitionIn/transitionOut {type: ${TRANSITION_TYPES.join('|')}, duration}
- video: assetId, trimStart (source offset), speed, volume (0-2), muted, fit cover|contain|fill, zooms [{at (s from clip start), duration, scale, x, y, style smooth|snap|slow-push}], kenBurns {fromScale,toScale,fromX,fromY,toX,toY,easing}, box {x,y,w,h} (picture-in-picture), radius, shadow, opacity, rotation, flipX, grade {preset none|cinematic|warm|cool|vibrant|muted|bw|vintage|teal-orange|punchy, brightness, contrast, saturation, hue, vignette, blur}, audioFadeIn, audioFadeOut
- image: assetId, fit, kenBurns, blurredBackdrop, box, radius, shadow, opacity, grade
- audio: assetId, role voiceover|music|sfx|original, trimStart, speed, volume, fadeIn, fadeOut, duck (lower under speech), loop
- text: text (wrap words in *asterisks* to highlight), x, y (center anchor), style {font, size, weight, color, align, uppercase, background, padding, radius, strokeColor, strokeWidth, shadow, highlightColor, maxWidth}, animationIn/animationOut none|fade|rise|pop|slide-left|slide-right|typewriter|words|letters|blur-in|scale-down
- scene: template, props (see list_templates) — prefer add_scene
- code: use write_code_scene; captions: use add_captions
Tracks can be referenced by id or name: Main, B-roll, Graphics, Captions, Voiceover, Music, SFX.`;

const OpItem = z.object({
  op: z.enum(['addClip', 'updateClip', 'removeClips', 'moveClip', 'trimClip', 'splitClip', 'rippleDelete', 'shiftClips', 'closeGaps', 'addTrack', 'updateTrack', 'removeTrack', 'reorderTrack', 'setAudioMix']),
  clip: z.record(z.string(), z.unknown()).optional().describe('addClip: the clip object'),
  clipId: z.string().optional(),
  clipIds: z.array(z.string()).optional(),
  trackId: z.string().optional().describe('Track id or name'),
  trackIds: z.array(z.string()).optional(),
  patch: z.record(z.string(), z.unknown()).optional().describe('updateClip/updateTrack/setAudioMix: fields to change (nested objects are merged; null deletes a field)'),
  start: z.number().optional(),
  end: z.number().optional(),
  at: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  delta: z.number().optional(),
  name: z.string().optional(),
  kind: z.enum(TRACK_KINDS).optional(),
  index: z.number().int().optional(),
  onConflict: z.enum(['error', 'new-track', 'overwrite', 'allow']).optional(),
  ripple: z.boolean().optional(),
});

const resolveTrackIds = (p: Project, ids?: string[]) => ids?.map((t) => requireTrack(p, t).id);

const toEditOp = (p: Project, o: z.infer<typeof OpItem>): EditOp => {
  const need = <T>(v: T | undefined, field: string): T => {
    if (v === undefined) throw new Error(`${o.op} needs "${field}"`);
    return v;
  };
  const trackId = o.trackId ? requireTrack(p, o.trackId).id : undefined;
  switch (o.op) {
    case 'addClip':
      return { op: 'addClip', clip: { id: '', ...(need(o.clip, 'clip') as object) } as ClipInput, trackId, onConflict: o.onConflict };
    case 'updateClip':
      return { op: 'updateClip', clipId: need(o.clipId, 'clipId'), patch: need(o.patch, 'patch') };
    case 'removeClips':
      return { op: 'removeClips', clipIds: o.clipIds ?? [need(o.clipId, 'clipIds')], ripple: o.ripple };
    case 'moveClip':
      return { op: 'moveClip', clipId: need(o.clipId, 'clipId'), start: o.start, trackId, onConflict: o.onConflict };
    case 'trimClip':
      return { op: 'trimClip', clipId: need(o.clipId, 'clipId'), start: o.start, end: o.end };
    case 'splitClip':
      return { op: 'splitClip', clipId: need(o.clipId, 'clipId'), at: need(o.at, 'at') };
    case 'rippleDelete':
      return { op: 'rippleDelete', from: need(o.from, 'from'), to: need(o.to, 'to'), trackIds: resolveTrackIds(p, o.trackIds) };
    case 'shiftClips':
      return { op: 'shiftClips', from: need(o.from, 'from'), delta: need(o.delta, 'delta'), trackIds: resolveTrackIds(p, o.trackIds) };
    case 'closeGaps':
      return { op: 'closeGaps', trackId: need(trackId, 'trackId') };
    case 'addTrack':
      return { op: 'addTrack', name: need(o.name, 'name'), kind: need(o.kind, 'kind'), index: o.index };
    case 'updateTrack':
      return { op: 'updateTrack', trackId: need(trackId, 'trackId'), patch: need(o.patch, 'patch') as never };
    case 'removeTrack':
      return { op: 'removeTrack', trackId: need(trackId, 'trackId') };
    case 'reorderTrack':
      return { op: 'reorderTrack', trackId: need(trackId, 'trackId'), index: need(o.index, 'index') };
    case 'setAudioMix':
      return { op: 'setAudioMix', patch: need(o.patch, 'patch') };
  }
};

export const applyEdits = defineTool({
  name: 'apply_edits',
  category: 'edit',
  description: `Apply a batch of timeline edits atomically (all succeed or none). Ops: addClip {clip, trackId?, onConflict?}, updateClip {clipId, patch}, removeClips {clipIds, ripple?}, moveClip {clipId, start?, trackId?, onConflict?}, trimClip {clipId, start?, end?} (timeline edges), splitClip {clipId, at}, rippleDelete {from, to, trackIds?}, shiftClips {from, delta, trackIds?}, closeGaps {trackId}, addTrack {name, kind}, updateTrack {trackId, patch: {name, muted, hidden, locked}}, removeTrack, reorderTrack {trackId, index}, setAudioMix {patch: {duckLevel, normalize, loudnessTarget}}. onConflict: error (default) | new-track | overwrite | allow (crossfade overlap).\n${CLIP_REFERENCE}`,
  schema: z.object({ label: z.string().describe('Short description for undo history'), ops: z.array(OpItem).min(1).max(80) }),
  execute: async (input, ctx) => {
    let results: unknown[] = [];
    let failedAt = -1;
    const p = await mutate(ctx, input.label, (d) => {
      const ops = input.ops.map((o, i) => {
        try {
          return toEditOp(d, o);
        } catch (err) {
          failedAt = i;
          throw err;
        }
      });
      results = [];
      for (const [i, op] of ops.entries()) {
        try {
          results.push(...applyOps(d, [op]));
        } catch (err) {
          failedAt = i;
          throw err;
        }
      }
    }).catch((err: Error) => {
      throw new Error(`Op #${failedAt} (${input.ops[failedAt]?.op}) failed: ${err.message}. No changes were applied.`);
    });
    return { text: `Applied ${input.ops.length} edit(s). Results: ${j(results)}\n${timelineReadout(p)}`, summary: input.label };
  },
});

export const addMedia = defineTool({
  name: 'add_media',
  category: 'edit',
  description:
    'Place a video, image or audio asset on the timeline with smart defaults: images get a subtle Ken Burns move, b-roll video is muted, music beds loop + duck under speech + fade, voice clips go to Voiceover. track: "main" (primary picture), "broll" (cutaway over footage, muted), "graphics", "pip" (picture-in-picture box, bottom-right), or a track id/name. Start defaults to the end of the target track.',
  schema: z.object({
    assetId: z.string(),
    track: z.string().optional(),
    start: z.number().min(0).optional(),
    duration: z.number().positive().optional(),
    trimStart: z.number().min(0).optional(),
    role: z.enum(['voiceover', 'music', 'sfx', 'original']).optional(),
    volume: z.number().min(0).max(2).optional(),
    muted: z.boolean().optional(),
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    kenBurns: z.boolean().optional(),
    transitionIn: Transition.optional(),
    transitionOut: Transition.optional(),
    onConflict: z.enum(['error', 'new-track', 'overwrite', 'allow']).optional(),
  }),
  execute: async (input, ctx) => {
    let placed: unknown;
    const p = await mutate(ctx, 'Add media', (d) => {
      const a = d.assets.find((x) => x.id === input.assetId);
      if (!a) throw new Error(`Asset ${input.assetId} not found`);
      if (a.status !== 'ready') throw new Error(`Asset ${a.name} is still ${a.status}${a.error ? `: ${a.error}` : ''}`);
      const trackKey = (input.track ?? '').toLowerCase();
      const trackFor = (fallback: string) => (input.track && !['main', 'broll', 'b-roll', 'graphics', 'pip'].includes(trackKey) ? requireTrack(d, input.track).id : requireTrack(d, fallback).id);
      const endOf = (trackId: string) => d.tracks.find((t) => t.id === trackId)!.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      let clip: ClipInput;
      let trackId: string;
      if (a.kind === 'audio' || (input.role && a.kind === 'video' && trackKey !== 'main')) {
        const role = input.role ?? (a.origin === 'tts' ? 'voiceover' : a.tags.includes('sfx') ? 'sfx' : a.tags.includes('music') || a.origin === 'library' ? 'music' : a.meta.duration && a.meta.duration < 8 ? 'sfx' : 'music');
        trackId = trackFor(role === 'voiceover' || role === 'original' ? 'Voiceover' : role === 'sfx' ? 'SFX' : 'Music');
        const isBed = role === 'music';
        const total = projectDuration(d);
        const start = input.start ?? (isBed ? 0 : endOf(trackId));
        const duration = input.duration ?? (isBed && total > 0 ? Math.max(1, total - start) : Math.max(0.1, (a.meta.duration ?? 5) - (input.trimStart ?? 0)));
        clip = {
          id: '',
          type: 'audio',
          assetId: a.id,
          role,
          start,
          duration,
          trimStart: input.trimStart ?? 0,
          volume: input.volume ?? (isBed ? 0.55 : role === 'sfx' ? 0.6 : 1),
          duck: isBed,
          loop: isBed && duration > (a.meta.duration ?? 0) - (input.trimStart ?? 0),
          fadeIn: isBed ? 1 : 0,
          fadeOut: isBed ? 2 : 0,
        };
      } else if (a.kind === 'video' || a.kind === 'image') {
        const isBroll = trackKey === 'broll' || trackKey === 'b-roll';
        const isPip = trackKey === 'pip';
        trackId = trackFor(isBroll || isPip ? 'B-roll' : trackKey === 'graphics' ? 'Graphics' : 'Main');
        const start = input.start ?? endOf(trackId);
        const portraitAsset = (a.meta.height ?? 1) > (a.meta.width ?? 1) * 1.1;
        const portraitCanvas = d.canvas.height > d.canvas.width;
        const box = isPip ? { x: portraitCanvas ? 0.52 : 0.66, y: portraitCanvas ? 0.56 : 0.62, w: portraitCanvas ? 0.42 : 0.3, h: portraitCanvas ? 0.24 : 0.3 } : undefined;
        if (a.kind === 'video') {
          const duration = input.duration ?? Math.max(0.2, (a.meta.duration ?? 5) - (input.trimStart ?? 0));
          clip = {
            id: '',
            type: 'video',
            assetId: a.id,
            start,
            duration,
            trimStart: input.trimStart ?? 0,
            muted: input.muted ?? (isBroll || a.origin === 'stock' || !a.meta.hasAudio),
            volume: input.volume ?? 1,
            fit: input.fit ?? 'cover',
            box,
            radius: isPip ? 24 : 0,
            shadow: isPip,
            transitionIn: input.transitionIn,
            transitionOut: input.transitionOut,
          };
        } else {
          const duration = input.duration ?? 4;
          const flip = Math.round(start * 10) % 2 === 0;
          clip = {
            id: '',
            type: 'image',
            assetId: a.id,
            start,
            duration,
            fit: input.fit ?? (portraitAsset !== portraitCanvas ? 'contain' : 'cover'),
            blurredBackdrop: portraitAsset !== portraitCanvas,
            kenBurns: input.kenBurns === false ? undefined : flip ? { fromScale: 1, toScale: 1.12, fromX: 0.45, fromY: 0.5, toX: 0.55, toY: 0.45 } : { fromScale: 1.12, toScale: 1, fromX: 0.55, fromY: 0.45, toX: 0.45, toY: 0.5 },
            box,
            radius: isPip ? 24 : 0,
            shadow: isPip,
            transitionIn: input.transitionIn,
            transitionOut: input.transitionOut,
          };
        }
      } else throw new Error(`${a.name} is a ${a.kind}; only video, image and audio assets can be placed`);
      placed = applyOps(d, [{ op: 'addClip', clip, trackId, onConflict: input.onConflict ?? 'error' }])[0];
    });
    return { text: `Placed: ${j(placed)}\n${timelineReadout(p)}`, summary: 'Media placed' };
  },
});

export const addScene = defineTool({
  name: 'add_scene',
  category: 'edit',
  description:
    'Add a motion-graphics template scene. Full-screen templates go on Main by default, overlay templates (lower-third, callout, subscribe-cta, progress-bar, emoji-burst) on Graphics. Props are validated against the template schema (see list_templates). Start defaults to the end of the target track; duration defaults to the template default.',
  schema: z.object({
    template: z.string(),
    props: z.record(z.string(), z.unknown()).default({}),
    start: z.number().min(0).optional(),
    duration: z.number().positive().optional(),
    track: z.string().optional().describe('Track id or name'),
    transitionIn: Transition.optional(),
    transitionOut: Transition.optional(),
    onConflict: z.enum(['error', 'new-track', 'overwrite', 'allow']).optional(),
  }),
  execute: async (input, ctx) => {
    const t = getTemplate(input.template);
    if (!t) return { text: `Unknown template "${input.template}". Use list_templates.`, isError: true };
    const props = parseTemplateProps(t.id, input.props);
    let res: unknown;
    const p = await mutate(ctx, `Add ${t.name}`, (d) => {
      const trackId = requireTrack(d, input.track ?? (t.overlay ? 'Graphics' : 'Main')).id;
      const track = d.tracks.find((x) => x.id === trackId)!;
      const start = input.start ?? (t.overlay ? 0 : track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
      res = applyOps(d, [{ op: 'addClip', trackId, onConflict: input.onConflict, clip: { id: '', type: 'scene', template: t.id, props, start, duration: input.duration ?? t.defaultDuration, transitionIn: input.transitionIn, transitionOut: input.transitionOut } }])[0];
    });
    return { text: `Added ${t.name}: ${j(res)}\n${timelineReadout(p)}`, summary: t.name };
  },
});

export const addCaptions = defineTool({
  name: 'add_captions',
  category: 'edit',
  description:
    'Add (or restyle) captions covering the whole video on the Captions track. Auto mode derives words live from the transcripts of footage and voiceover clips, so captions stay in sync after any edit. Presets: bold-pop, highlight-box, karaoke, clean, boxed, neon, typewriter, minimal. Load the captions-audio skill for guidance.',
  schema: z.object({
    style: CaptionStyleSchema.partial().default({}),
    trackIds: z.array(z.string()).optional().describe('Only caption speech from these tracks (default: all)'),
  }),
  execute: async (input, ctx) => {
    let words = 0;
    const p = await mutate(ctx, 'Add captions', (d) => {
      const track = d.tracks.find((t) => t.kind === 'captions') ?? (applyOps(d, [{ op: 'addTrack', name: 'Captions', kind: 'captions' }]), d.tracks.find((t) => t.kind === 'captions')!);
      const existing = track.clips.find((c) => c.type === 'captions');
      const dur = Math.max(1, projectDuration(d));
      const style = { ...(existing && existing.type === 'captions' ? existing.style : {}), ...input.style };
      track.clips = track.clips.filter((c) => c.type !== 'captions');
      applyOps(d, [{ op: 'addClip', trackId: track.id, clip: { id: existing?.id ?? '', type: 'captions', mode: 'auto', start: 0, duration: dur, style, sourceTrackIds: resolveTrackIds(d, input.trackIds) } }]);
    });
    const transcripts = await store.transcriptsFor(p);
    words = timelineWords(p, transcripts).length;
    return {
      text: `Captions set (${input.style.preset ?? 'existing/default'} style) — ${words} words currently captioned.${words === 0 ? ' WARNING: no transcribed speech on the timeline yet; transcribe footage or generate voiceover, captions will appear automatically.' : ''}`,
      summary: `${words} words`,
    };
  },
});

export const autoCut = defineTool({
  name: 'auto_cut',
  category: 'edit',
  description:
    'Jump-cut editor for talking footage: removes pauses longer than minPause and filler words (um/uh), plus any bad takes you specify (removeRanges in source seconds, removeWords as [fromWordIndex, toWordIndex] from get_transcript, or removePhrases), and lays the kept segments back-to-back on the timeline with alternating punch-in zooms that hide the cuts. Uses the transcript when available (best), otherwise silence detection. keepRanges limits the cut to chosen source spans (e.g. to extract a Short).',
  schema: z.object({
    assetId: z.string(),
    track: z.string().default('Main'),
    startAt: z.number().min(0).optional().describe('Timeline position (default: end of the track)'),
    minPause: z.number().min(0.15).max(3).default(0.45),
    removeFillers: z.boolean().default(true),
    removeRanges: z.array(z.tuple([z.number(), z.number()])).default([]),
    removeWords: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
    removePhrases: z.array(z.string()).default([]),
    keepRanges: z.array(z.tuple([z.number(), z.number()])).optional(),
    jumpCutZoom: z.boolean().default(true),
    zoomScale: z.number().min(1).max(1.6).default(1.12),
    focusX: z.number().min(0).max(1).default(0.5),
    focusY: z.number().min(0).max(1).default(0.42),
    replaceExisting: z.boolean().default(true).describe('Remove clips of this asset already on the track first'),
  }),
  execute: async (input, ctx) => {
    const p0 = await getProject(ctx);
    const a = p0.assets.find((x) => x.id === input.assetId);
    if (!a) return { text: `Asset ${input.assetId} not found`, isError: true };
    if (a.kind !== 'video' && a.kind !== 'audio') return { text: `${a.name} is not audio/video`, isError: true };
    const duration = a.meta.duration ?? 0;
    const words = (await store.readTranscript(ctx.projectId, a.id)) ?? [];
    let silences: Interval[] | undefined;
    if (!words.length) {
      ctx.progress('No transcript — detecting silences…');
      silences = a.analysis.silences ?? (await detectSilence(store.mediaPath(ctx.projectId, a.file), -35, 0.3));
    }
    const remove: Interval[] = [...input.removeRanges];
    for (const [f, t] of input.removeWords) {
      const wf = words[f];
      const wt = words[t];
      if (wf && wt) remove.push([Math.max(0, wf.start - 0.02), wt.end + 0.02]);
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, '').split(/\s+/).filter(Boolean);
    const normWords = words.map((w) => norm(w.text).join(''));
    const notFound: string[] = [];
    for (const phrase of input.removePhrases) {
      const q = norm(phrase);
      let hit = false;
      for (let i = 0; i + q.length <= normWords.length; i++) {
        if (q.every((t, k) => normWords[i + k] === t)) {
          remove.push([Math.max(0, words[i]!.start - 0.02), words[i + q.length - 1]!.end + 0.02]);
          hit = true;
        }
      }
      if (!hit) notFound.push(phrase);
    }
    if (input.keepRanges?.length) {
      const sorted = [...input.keepRanges].sort((x, y) => x[0] - y[0]);
      let cursor = 0;
      for (const [s, e] of sorted) {
        if (s > cursor) remove.push([cursor, s]);
        cursor = Math.max(cursor, e);
      }
      if (cursor < duration) remove.push([cursor, duration]);
    }
    const segments = computeKeepSegments(words, duration, { minPause: input.minPause, removeFillers: input.removeFillers, removeRanges: remove }, silences);
    if (!segments.length) return { text: 'Nothing left after cutting — check removeRanges/keepRanges.', isError: true };
    const kept = segments.reduce((n, [s, e]) => n + (e - s), 0);
    let startAt = 0;
    const p = await mutate(ctx, `Auto-cut ${a.name}`, (d) => {
      const track = requireTrack(d, input.track);
      if (input.replaceExisting) track.clips = track.clips.filter((c) => !('assetId' in c && c.assetId === a.id));
      startAt = input.startAt ?? track.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      const clips = segmentsToClips(segments, { assetId: a.id, startAt, jumpCutZoom: input.jumpCutZoom && a.kind === 'video', zoomScale: input.zoomScale, focusX: input.focusX, focusY: input.focusY });
      for (const c of clips) {
        if (a.kind === 'audio') applyOps(d, [{ op: 'addClip', trackId: track.id, onConflict: 'overwrite', clip: { id: '', type: 'audio', role: 'original', assetId: a.id, start: c.start, duration: c.duration, trimStart: c.trimStart } }]);
        else applyOps(d, [{ op: 'addClip', trackId: track.id, onConflict: 'overwrite', clip: c }]);
      }
    });
    const fillers = words.filter((w) => /^(um+|uh+|uhm|erm|er|ah+|hmm+|mm+|mhm)$/i.test(w.text.replace(/[^\p{L}]/gu, ''))).length;
    return {
      text: `Cut ${a.name}: ${formatTime(duration)} → ${formatTime(kept)} (${Math.round((1 - kept / Math.max(0.01, duration)) * 100)}% removed) in ${segments.length} segments starting at ${formatTime(startAt)}. Method: ${words.length ? 'transcript' : 'silence detection'}${input.removeFillers && words.length ? `, ${fillers} filler word(s) found` : ''}.${notFound.length ? ` Phrases not found: ${notFound.join(' | ')}` : ''}\nFirst segments (source s): ${segments
        .slice(0, 6)
        .map(([s, e]) => `${s.toFixed(2)}–${e.toFixed(2)}`)
        .join(', ')}${segments.length > 6 ? ' …' : ''}\n${timelineReadout(p)}`,
      summary: `${formatTime(duration, false)} → ${formatTime(kept, false)}`,
    };
  },
});

