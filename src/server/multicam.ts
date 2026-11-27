/**
 * Multicam: line up cameras and microphones of one recording by their sound, then cut between the
 * cameras like a live director: the close-up of whoever is talking (told by separate microphones,
 * or by mouth movement in each close-up), the wide shot when people talk over each other.
 */
import { align, binned, onsets } from '../shared/dsp';
import { matchMics, planCameraCuts, type CameraShot } from '../shared/multicam';
import { applyOp } from '../shared/ops';
import { uid } from '../shared/ids';
import { addTrack, placeClip, projectDuration } from '../shared/timeline';
import type { Asset, ClipInput, MulticamGroup, Project } from '../shared/schema';
import { analyzeTalking } from './media/faces';
import { audioLoudness, LOUDNESS_RATE } from './media/audio';
import { store } from './storage/projects';

export interface MulticamOptions {
  /** camera files; the first one is the reference clock */
  cameras: string[];
  /** separate microphone recordings (one per person for the most reliable switching) */
  microphones?: string[];
  /** 'speaker' cuts to whoever is talking; 'first' stays on the first camera (switch by hand later) */
  follow?: 'speaker' | 'first';
  /** the camera that shows everyone (found automatically when left out) */
  wide?: string;
  /** timeline time to place the edit (default: the end of the timeline) */
  at?: number;
  name?: string;
}

export interface MulticamPlan {
  group: MulticamGroup;
  at: number;
  cuts: { assetId: string; start: number; duration: number; trimStart: number }[];
  sounds: { assetId: string; start: number; duration: number; trimStart: number; track: string }[];
  summary: string;
  warnings: string[];
}

type Report = (progress: number, detail?: string) => void;

const BIN = 0.5;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const needAsset = (p: Project, id: string, kind: 'camera' | 'microphone'): Asset => {
  const a = p.assets.find((x) => x.id === id);
  if (!a) throw new Error(`Asset ${id} not found`);
  if (kind === 'camera' && a.kind !== 'video') throw new Error(`${a.name} is not a video: cameras must be video files`);
  if (kind === 'microphone' && a.kind !== 'audio' && a.kind !== 'video') throw new Error(`${a.name} has no sound`);
  if (!a.meta.duration) throw new Error(`${a.name} is still being analyzed; try again in a moment`);
  return a;
};

/** speech intervals on the shared clock, from a file's detected silences */
const speechOf = (a: Asset, offset: number): [number, number][] | undefined => {
  const silences = a.analysis?.silences;
  if (!silences) return undefined;
  const out: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of [...silences].sort((x, y) => x[0] - y[0])) {
    if (s > cursor) out.push([offset + cursor, offset + s]);
    cursor = Math.max(cursor, e);
  }
  const end = a.meta.duration ?? cursor;
  if (cursor < end) out.push([offset + cursor, offset + end]);
  return out;
};

export const planMulticam = async (p: Project, opts: MulticamOptions, signal?: AbortSignal, report: Report = () => undefined): Promise<MulticamPlan> => {
  const cameraIds = [...new Set(opts.cameras)];
  const micIds = [...new Set(opts.microphones ?? [])].filter((id) => !cameraIds.includes(id));
  if (cameraIds.length < 1 || cameraIds.length > 9) throw new Error('Pick 1 to 9 cameras');
  if (cameraIds.length + micIds.length < 2) throw new Error('Pick at least two recordings (cameras or microphones) to sync');
  const cams = cameraIds.map((id) => needAsset(p, id, 'camera'));
  const mics = micIds.map((id) => needAsset(p, id, 'microphone'));
  const sources = [...cams, ...mics];
  const warnings: string[] = [];
  const steps = sources.length + (opts.follow === 'first' ? 0 : cams.length);
  let done = 0;
  const step = (detail: string) => report(++done / (steps + 1), detail);

  // 1) sync by sound: loudness onsets of every file against the first camera
  const loud: Float32Array[] = [];
  for (const a of sources) {
    loud.push(await audioLoudness(store.mediaPath(p.id, a.file), signal));
    step(`listening to ${a.name}`);
  }
  const feats = loud.map((l) => onsets(l));
  const offsets = [0];
  const confidence = [Infinity];
  for (let i = 1; i < sources.length; i++) {
    const shortest = Math.min(cams[0]!.meta.duration!, sources[i]!.meta.duration!);
    const m = align(feats[0]!, feats[i]!, LOUDNESS_RATE, Math.min(10, shortest * 0.3));
    if (!m) throw new Error(`${sources[i]!.name} is too short to sync`);
    offsets.push(r3(m.offset));
    confidence.push(Math.round(m.confidence * 10) / 10);
    if (m.confidence < 6) warnings.push(`${sources[i]!.name} matched the others only weakly by sound (check its sync)`);
  }
  const camOff = offsets.slice(0, cams.length);
  const micOff = offsets.slice(cams.length);

  // 2) the program covers whatever any camera recorded
  const cover = cams.map((a, i) => ({ start: camOff[i]!, end: camOff[i]! + a.meta.duration! }));
  const t0 = Math.min(...cover.map((c) => c.start));
  const t1 = Math.max(...cover.map((c) => c.end));
  const bins = Math.max(1, Math.ceil((t1 - t0) / BIN - 1e-9));
  const available = (angle: number, b: number) => {
    const c = cover[angle];
    if (!c) return false;
    const s = t0 + b * BIN;
    const e = Math.min(t1, s + BIN);
    return c.start <= s + 0.001 && c.end >= e - 0.001;
  };
  let wide = opts.wide ? cameraIds.indexOf(opts.wide) : -1;
  if (opts.wide && wide < 0) throw new Error('The wide camera must be one of the cameras');

  // 3) who talks when
  let shots: CameraShot[] = [{ angle: wide >= 0 ? wide : 0, start: 0, end: r3(t1 - t0) }];
  let how = 'stays on one camera (switch cameras with 1–9 at the playhead)';
  if (opts.follow !== 'first' && cams.length > 1) {
    const people: number[] = [];
    const mouths: (Float64Array | null)[] = [];
    let detector = true;
    for (let i = 0; i < cams.length; i++) {
      const a = cams[i]!;
      const long = a.meta.duration! > 600;
      const talk = detector ? await analyzeTalking(store.mediaPath(p.id, a.file), { width: a.meta.width ?? 1920, height: a.meta.height ?? 1080 }, 0, a.meta.duration!, { fps: long ? 6 : 10, detectEvery: long ? 6 : 5, signal }) : null;
      step(`watching ${a.name}`);
      if (!talk) {
        detector = false;
        people.push(0);
        mouths.push(null);
        continue;
      }
      const frames = new Set(talk.samples.map((s) => s.t)).size;
      const seen = talk.tracks.filter((tr) => tr.faces.length >= Math.max(2, 0.3 * frames)).sort((x, y) => y.faces.length - x.faces.length);
      people.push(seen.length);
      const main = seen[0];
      mouths.push(main && seen.length === 1 ? energyBins(main.energy, camOff[i]! - t0, bins) : null);
    }
    if (wide < 0) {
      const most = people.reduce((best, n, i) => (n > (people[best] ?? 0) ? i : best), 0);
      if ((people[most] ?? 0) >= 2) wide = most;
    }
    const closeups = cams.map((_, i) => i).filter((i) => i !== wide && mouths[i]);
    let activity: ArrayLike<number>[] = [];
    let personAngle: number[] = [];
    if (mics.length >= 2) {
      // one microphone per person: the loudest one is talking
      // RMS level (not log energy): the other person's voice bleeding in stays far below the talker's
      activity = mics.map((_, k) => binned(Float32Array.from(loud[cams.length + k]!, (v) => Math.exp(v / 2)), LOUDNESS_RATE, BIN, bins, micOff[k]! - t0));
      const match = closeups.length ? matchMics(activity, closeups.map((i) => mouths[i]!)) : [];
      const spare = cams.map((_, i) => i).filter((i) => i !== wide);
      personAngle = activity.map((_, k) => (match[k] !== undefined && match[k]! >= 0 ? closeups[match[k]!]! : (spare[k] ?? -1)));
      how = `cuts between ${mics.length} speakers by their microphones`;
    } else if (closeups.length >= 2) {
      activity = closeups.map((i) => mouths[i]!);
      personAngle = closeups;
      how = `cuts between ${closeups.length} speakers by watching who talks`;
    } else {
      warnings.push(detector ? 'Could not find two close-ups of different people to cut between; it stays on one camera' : 'Face detection is not available on this computer, so it stays on one camera (add one microphone per person to cut by sound)');
    }
    if (personAngle.filter((a) => a >= 0).length >= 2) {
      // speech from the main microphone (or the first camera): mouths that move in silence don't count
      const program = mics[0] ?? cams[0]!;
      const spans = speechOf(program, (mics[0] ? micOff[0]! : camOff[0]!) - t0);
      const speech = spans ? Array.from({ length: bins }, (_, b) => spans.some(([s, e]) => Math.min(e, (b + 1) * BIN) - Math.max(s, b * BIN) >= BIN * 0.4)) : undefined;
      const anchors = spans?.map(([s]) => s) ?? [];
      shots = planCameraCuts({ activity, personAngle, wide: wide >= 0 ? wide : undefined, bin: BIN, bins, speech, available, anchors });
      shots[shots.length - 1]!.end = r3(t1 - t0);
    }
  }
  if (shots.length === 1) {
    // one shot: still honor when each camera was recording
    shots = planCameraCuts({ activity: [], personAngle: [], wide: shots[0]!.angle, bin: BIN, bins, available, maxShot: 0 });
    shots[shots.length - 1]!.end = r3(t1 - t0);
  }

  // 4) the edit: camera cuts (their own sound off) and one continuous sound per microphone
  const at = opts.at ?? projectDuration(p);
  const group: MulticamGroup = {
    id: uid('mc'),
    name: opts.name?.trim() || 'Multicam',
    angles: cams.map((a, i) => ({ assetId: a.id, offset: camOff[i]!, ...(i ? { confidence: confidence[i] } : {}) })),
    audio: mics.map((a, k) => ({ assetId: a.id, offset: micOff[k]!, confidence: confidence[cams.length + k] })),
    ...(wide >= 0 ? { wide } : {}),
  };
  const cuts = shots.map((s) => ({ assetId: cams[s.angle]!.id, start: r3(at + s.start), duration: r3(s.end - s.start), trimStart: Math.max(0, r3(t0 + s.start - camOff[s.angle]!)) }));
  const soundSources = mics.length ? mics.map((a, k) => ({ a, off: micOff[k]!, track: mics.length > 1 ? `Mic ${k + 1}` : 'Mic' })) : [{ a: cams[0]!, off: camOff[0]!, track: 'Camera sound' }];
  const sounds = soundSources.map(({ a, off, track }) => {
    const s = Math.max(t0, off);
    const e = Math.min(t1, off + a.meta.duration!);
    return { assetId: a.id, start: r3(at + s - t0), duration: r3(e - s), trimStart: r3(s - off), track };
  });

  const shift = (i: number) => `${sources[i]!.name} ${offsets[i]! >= 0 ? '+' : '−'}${Math.abs(offsets[i]!).toFixed(2)}s`;
  const summary = `Synced ${cams.length} camera${cams.length === 1 ? '' : 's'}${mics.length ? ` and ${mics.length} microphone${mics.length === 1 ? '' : 's'}` : ''} by sound (${sources.map((_, i) => i).slice(1).map(shift).join(', ')}); the edit ${how}: ${cuts.length} shot${cuts.length === 1 ? '' : 's'} over ${(t1 - t0).toFixed(1)}s.`;
  return { group, at, cuts, sounds, summary, warnings };
};

/** mouth-movement energy (source times) as bins on the program clock */
const energyBins = (energy: { t: number; e: number }[], shift: number, bins: number): Float64Array => {
  const sum = new Float64Array(bins);
  const cnt = new Float64Array(bins);
  for (const { t, e } of energy) {
    const b = Math.floor((t + shift) / BIN);
    if (b < 0 || b >= bins) continue;
    sum[b] += e;
    cnt[b]++;
  }
  return sum.map((v, b) => (cnt[b] ? v / cnt[b]! : NaN));
};

/** Put a planned multicam edit into a draft project. */
export const applyMulticam = (d: Project, plan: MulticamPlan) => {
  applyOp(d, { op: 'setMulticam', group: plan.group as unknown as Record<string, unknown> });
  const main = d.tracks.find((t) => t.kind === 'video');
  if (!main) throw new Error('The project has no video track');
  for (const c of plan.cuts) {
    placeClip(d, { id: '', type: 'video', assetId: c.assetId, start: c.start, duration: c.duration, trimStart: c.trimStart, volume: 0, multicam: plan.group.id } as ClipInput, { trackId: main.id });
  }
  const firstAudio = d.tracks.findIndex((t) => t.kind === 'audio');
  plan.sounds.forEach((s, k) => {
    const track = addTrack(d, { name: s.track, kind: 'audio', index: firstAudio < 0 ? undefined : firstAudio + k });
    placeClip(d, { id: '', type: 'audio', role: 'original', assetId: s.assetId, start: s.start, duration: s.duration, trimStart: s.trimStart } as ClipInput, { trackId: track.id });
  });
};
