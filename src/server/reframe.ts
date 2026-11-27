/**
 * Smart reframe: find faces in a clip's footage and point its crop at the main subject.
 * Used by the `auto_reframe` tool (Director, editor button, MCP) and by Make a Short.
 */
import type { ImageClip, Project, VideoClip } from '../shared/schema';
import { coverGeometry, panRange, planReframe, planSpeakerReframe, type FaceSample, type ReframePlan, type TalkTrack } from '../shared/reframe';
import { getAsset } from '../shared/timeline';
import { updateClip } from '../shared/ops';
import { analyzeTalking, detectFaces } from './media/faces';
import { store } from './storage/projects';

export interface ReframeResult {
  clipId: string;
  /** updateClip patch to apply, when there is something to change */
  patch?: Record<string, unknown>;
  summary: string;
  plan?: ReframePlan;
}

type Framed = VideoClip | ImageClip;
const isFramed = (c: { type: string }): c is Framed => c.type === 'video' || c.type === 'image';

/** Work out a smart crop for one clip. Reads the footage; does not change the project. */
export const planClipReframe = async (p: Project, clip: Framed, signal?: AbortSignal): Promise<ReframeResult> => {
  const asset = getAsset(p, clip.assetId);
  const mw = asset?.meta.width;
  const mh = asset?.meta.height;
  if (!asset || !mw || !mh) return { clipId: clip.id, summary: 'the media is missing or its size is unknown' };
  const frameW = clip.box ? clip.box.w * p.canvas.width : p.canvas.width;
  const frameH = clip.box ? clip.box.h * p.canvas.height : p.canvas.height;
  const g = coverGeometry(mw, mh, frameW, frameH, clip.scale ?? 1);
  if (panRange(g.kx, g.scale) < 0.02 && panRange(g.ky, g.scale) < 0.02) {
    return { clipId: clip.id, summary: 'the whole picture already fits the frame (reframing matters for a different aspect, e.g. 9:16, or when zoomed in)' };
  }
  const file = store.mediaPath(p.id, asset.file);
  let samples: FaceSample[] | null;
  let tracks: TalkTrack[] = [];
  let speech: [number, number][] | undefined;
  if (clip.type === 'video') {
    const from = clip.trimStart;
    const to = clip.trimStart + clip.duration * clip.speed;
    const toClip = (t: number) => Math.max(0, (t - clip.trimStart) / clip.speed);
    // faces plus how much each mouth moves (to tell who is talking); lighter sampling for long clips
    const long = to - from > 600;
    const raw = await analyzeTalking(file, { width: mw, height: mh }, from, to, { fps: long ? 6 : 10, detectEvery: long ? 6 : 5, signal });
    samples = raw?.samples.map((s) => ({ t: toClip(s.t), faces: s.faces })) ?? null;
    tracks = raw?.tracks.map((tr) => ({ id: tr.id, faces: tr.faces.map((f) => ({ t: toClip(f.t), face: f.face })), energy: tr.energy.map((e) => ({ t: toClip(e.t), e: e.e })) })) ?? [];
    // speech = everything that is not a detected silence
    const silences = asset.analysis?.silences;
    if (silences) {
      const spans: [number, number][] = [];
      let cursor = from;
      for (const [a, b] of [...silences].sort((x, y) => x[0] - y[0])) {
        if (b <= from || a >= to) continue;
        if (a > cursor) spans.push([cursor, Math.min(a, to)]);
        cursor = Math.max(cursor, b);
      }
      if (cursor < to) spans.push([cursor, to]);
      speech = spans.map(([a, b]) => [toClip(a), toClip(b)]);
    }
  } else {
    samples = (await detectFaces(file, { width: mw, height: mh }, 0, undefined, { signal }))?.map((s) => ({ t: 0, faces: s.faces })) ?? null;
  }
  if (!samples) return { clipId: clip.id, summary: 'face detection is not available on this computer (optional onnxruntime-node is not installed)' };
  const cuts = clip.type === 'video' ? (asset.analysis?.scenes ?? []).map((s) => (s - clip.trimStart) / clip.speed).filter((t) => t > 0 && t < clip.duration) : [];
  // two or more people: cut to whoever talks (or frame them together); otherwise follow the main face
  const plan = planSpeakerReframe(tracks, g, clip.duration, { cuts, speech }) ?? planReframe(samples, g, clip.duration, { cuts });
  if (!plan?.focus) return { clipId: clip.id, plan: plan ?? undefined, summary: `no clear face (${plan?.found ?? 0} of ${plan?.total ?? 0} frames), kept the crop` };

  const patch: Record<string, unknown> = { fit: 'cover', focus: plan.focus };
  const kf: Record<string, unknown> = {};
  for (const ch of ['focus.x', 'focus.y'] as const) {
    const list = plan.keyframes?.[ch];
    if (list) kf[ch] = list;
    else if (clip.keyframes?.[ch]) kf[ch] = null; // a static plan replaces an old animation
  }
  if (Object.keys(kf).length) patch.keyframes = kf;
  const who = plan.people > 1 ? `the main speaker (${plan.people} people in shot)` : 'the face';
  const summary =
    plan.mode === 'speakers'
      ? plan.moves
        ? `cutting between ${plan.people} speakers as they talk: ${plan.moves} cut${plan.moves === 1 ? '' : 's'}`
        : `${plan.people} people, one does the talking: kept the crop on them`
      : plan.mode === 'group'
        ? `framed the ${plan.people} people together (they fit in the frame)`
        : plan.keyframes
          ? `following ${who}: ${plan.moves} camera move${plan.moves === 1 ? '' : 's'}`
          : `locked the crop on ${who}`;
  return { clipId: clip.id, patch, plan, summary };
};

/** Clips smart reframe applies to by default: full-frame pictures on visible, unlocked tracks. */
export const defaultReframeTargets = (p: Project): Framed[] =>
  p.tracks.filter((t) => !t.hidden && !t.locked).flatMap((t) => t.clips.filter(isFramed).filter((c) => !c.box));

/** Plan smart crops for clips (default: every full-frame picture) one after another. */
export const planReframes = async (p: Project, clipIds?: string[], signal?: AbortSignal): Promise<ReframeResult[]> => {
  const all = p.tracks.flatMap((t) => t.clips);
  const targets = clipIds ? clipIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Framed => Boolean(c && isFramed(c))) : defaultReframeTargets(p);
  const results: ReframeResult[] = [];
  for (const c of targets) {
    if (signal?.aborted) break;
    results.push(await planClipReframe(p, c, signal).catch((err) => ({ clipId: c.id, summary: `failed: ${err instanceof Error ? err.message : String(err)}` })));
  }
  return results;
};

/** Apply planned crops to a project draft. */
export const applyReframes = (draft: Project, results: ReframeResult[]): number => {
  let n = 0;
  for (const r of results) {
    if (!r.patch) continue;
    try {
      updateClip(draft, r.clipId, r.patch);
      n++;
    } catch {
      /* the clip changed meanwhile: skip it */
    }
  }
  return n;
};
