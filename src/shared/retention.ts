/**
 * Retention coach: what makes viewers leave, found from the edit itself (no AI, so it is instant,
 * free and works offline). The hook is scored on what holds people in the first seconds, and dead
 * spots are flagged through the whole video: long pauses, the same shot for too long, filler
 * words, a slow start and a silent ending. Most come with a fix as ordinary edit operations, so a
 * fix is one undo step like any other edit.
 */
import type { EditOp } from './ops';
import type { Project, VideoClip, Word } from './schema';
import { clipEnd, DEFAULT_FILLERS, isFiller, projectDuration, round3, sourceToTimeline, timelineWordsDetailed, type TimelineWord } from './timeline';

export type RetentionFix =
  | { kind: 'ops'; label: string; ops: EditOp[] }
  | { kind: 'tool'; label: string; tool: string; input: Record<string, unknown> }
  | { kind: 'ask'; label: string; prompt: string };

export interface HookCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** how much it counts towards the hook score (out of 10 together) */
  weight: number;
  fix?: RetentionFix;
}

export interface RetentionIssue {
  id: string;
  kind: 'pause' | 'static' | 'filler' | 'ending' | 'slow';
  severity: 'high' | 'medium' | 'low';
  at: number;
  end: number;
  title: string;
  detail: string;
  fix?: RetentionFix;
}

export interface RetentionReport {
  /** 0-100 */
  score: number;
  hook: { score: number; window: number; checks: HookCheck[] };
  issues: RetentionIssue[];
  /** fixes that do several issues of one kind at once */
  bulk: RetentionFix[];
  stats: { duration: number; words: number; wpm: number; changesPerMinute: number; pauses: number; fillers: number; longestShot: number };
  short: boolean;
}

const HOOK_CUES = /\b(you|your|why|how|what|secret|mistake|stop|never|nobody|best|worst|truth|actually|need|don'?t|ever|biggest|only|wrong|free|fast|easy|today)\b|\?|\d/i;
const CTA = /\b(subscribe|comment|like|follow|link|next video|watch this|check out|let me know|share)\b/i;
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Tracks a ripple cut should move together: everything but music beds (cutting music causes jumps). */
export const syncedTrackIds = (p: Project) =>
  p.tracks.filter((t) => !(t.kind === 'audio' && t.clips.length > 0 && t.clips.every((c) => c.type === 'audio' && c.role === 'music'))).map((t) => t.id);

/** Cuts as one undo step: last first, so earlier times stay valid. */
const cuts = (p: Project, ranges: [number, number][]): EditOp[] => {
  const trackIds = syncedTrackIds(p);
  return ranges
    .filter(([a, b]) => b - a > 0.05)
    .sort((x, y) => y[0] - x[0])
    .map(([from, to]) => ({ op: 'rippleDelete' as const, from: round3(from), to: round3(to), trackIds }));
};

/** Moments where the picture changes: clip starts on visible tracks, punch-in zooms, scene cuts inside footage. */
export const visualChanges = (p: Project): number[] => {
  const out: number[] = [];
  for (const t of p.tracks) {
    if (t.hidden || t.kind === 'audio' || t.kind === 'captions') continue;
    for (const c of t.clips) {
      out.push(c.start, clipEnd(c));
      if (c.type === 'video') {
        for (const z of c.zooms) out.push(c.start + z.at, c.start + z.at + z.duration);
        const scenes = p.assets.find((a) => a.id === c.assetId)?.analysis?.scenes ?? [];
        for (const s of scenes) {
          const at = sourceToTimeline(c, s);
          if (at > c.start && at < clipEnd(c)) out.push(at);
        }
      }
      for (const channel of Object.values(c.keyframes ?? {})) for (const k of channel) out.push(c.start + k.t);
    }
  }
  return [...new Set(out.map(round3))].sort((a, b) => a - b);
};

/** The talking footage on screen at time t (to punch in on). */
const footageAt = (p: Project, t: number, words: TimelineWord[]): VideoClip | undefined => {
  const speaking = new Set(words.map((w) => w.clipId));
  const clips = p.tracks.filter((tr) => !tr.hidden && tr.kind !== 'audio').flatMap((tr) => tr.clips.filter((c): c is VideoClip => c.type === 'video' && c.start <= t && clipEnd(c) > t));
  return clips.find((c) => speaking.has(c.id)) ?? clips[0];
};

/** The clip's zooms plus a snap punch-in at timeline time `at`. */
const withZoom = (clip: VideoClip, zooms: VideoClip['zooms'], at: number, length = 2.5): VideoClip['zooms'] => [
  ...zooms,
  { at: round3(Math.max(0, at - clip.start)), duration: round3(Math.max(0.1, Math.min(length, clipEnd(clip) - at))), scale: 1.18, x: 0.5, y: 0.4, style: 'snap' },
];

const zoomFix = (clip: VideoClip, at: number, label: string, length = 2.5): RetentionFix => ({ kind: 'ops', label, ops: [{ op: 'updateClip', clipId: clip.id, patch: { zooms: withZoom(clip, clip.zooms, at, length) } }] });

export const analyzeRetention = (p: Project, transcripts: Record<string, Word[]>): RetentionReport => {
  const duration = projectDuration(p);
  const short = p.canvas.height > p.canvas.width;
  const words = timelineWordsDetailed(p, transcripts);
  const changes = visualChanges(p);
  const window = short ? 5 : 15;
  const checks: HookCheck[] = [];
  const issues: RetentionIssue[] = [];
  const bulk: RetentionFix[] = [];

  // ---- the hook ------------------------------------------------------------
  const first = words[0];
  const firstSentenceWords: TimelineWord[] = [];
  for (const w of words) {
    firstSentenceWords.push(w);
    if (/[.!?…]["')\]]?$/.test(w.text) || firstSentenceWords.length >= 25) break;
  }
  const firstLine = firstSentenceWords.map((w) => w.text).join(' ');

  if (words.length) {
    const late = first!.start > 0.8;
    checks.push({
      id: 'talk-now',
      label: 'Talks from the first second',
      ok: !late,
      weight: 2.5,
      detail: late ? `${first!.start.toFixed(1)}s before the first word: viewers swipe away in that time` : `The first word comes at ${first!.start.toFixed(1)}s`,
      ...(late ? { fix: { kind: 'ops', label: 'Cut the slow start', ops: cuts(p, [[0, first!.start - 0.15]]) } } : {}),
    });
    const hooky = HOOK_CUES.test(firstLine);
    checks.push({
      id: 'hook-line',
      label: 'Opens on a hook line',
      ok: hooky,
      weight: 2.5,
      detail: hooky ? `“${firstLine.slice(0, 90)}”` : `“${firstLine.slice(0, 90)}” promises nothing yet: open with the payoff, a question or a bold claim`,
      ...(hooky ? {} : { fix: { kind: 'ask', label: 'Ask the Director for a stronger hook', prompt: `The opening line of this video is "${firstLine}". It doesn't hook viewers. Find the most gripping line in the transcript (a bold claim, a question, the payoff) and restructure the first ${window} seconds so the video opens on it, then keep the edit tight.` } }),
    });
    const inWindow = words.filter((w) => w.start < window);
    const span = Math.min(window, (inWindow.at(-1)?.end ?? 0) - (inWindow[0]?.start ?? 0));
    const wpm = span > 1 ? (inWindow.length / span) * 60 : 0;
    const brisk = wpm >= (short ? 150 : 130);
    const hookPauses: [number, number][] = [];
    for (let i = 1; i < inWindow.length; i++) if (inWindow[i]!.start - inWindow[i - 1]!.end > 0.4) hookPauses.push([inWindow[i - 1]!.end + 0.1, inWindow[i]!.start - 0.1]);
    checks.push({
      id: 'pace',
      label: 'Brisk pace at the start',
      ok: brisk || hookPauses.length === 0,
      weight: 1.5,
      detail: `${Math.round(wpm)} words a minute in the first ${window}s${hookPauses.length ? `, ${hookPauses.length} pause${hookPauses.length === 1 ? '' : 's'}` : ''}`,
      ...(!brisk && hookPauses.length ? { fix: { kind: 'ops', label: `Tighten ${hookPauses.length} pause${hookPauses.length === 1 ? '' : 's'}`, ops: cuts(p, hookPauses) } } : {}),
    });
  }
  const moving = changes.some((t) => t > 0.05 && t <= (short ? 3 : 6));
  const main = words.length ? footageAt(p, Math.min(1.5, duration / 2), words) : undefined;
  checks.push({
    id: 'motion',
    label: `Something changes in the first ${short ? 3 : 6}s`,
    ok: moving,
    weight: 1.5,
    detail: moving ? 'A cut, zoom or graphic keeps the eye busy' : 'The first shot just sits there',
    ...(!moving && main ? { fix: zoomFix(main, Math.max(main.start, 1.2), 'Punch in at 1s', 2) } : {}),
  });
  const titled = p.tracks.some((t) => !t.hidden && t.clips.some((c) => (c.type === 'text' || c.type === 'scene') && c.start < 2));
  const hasCaptions = p.tracks.some((t) => t.clips.some((c) => c.type === 'captions'));
  const hookText = firstSentenceWords.slice(0, 8).map((w) => w.text).join(' ').replace(/[,.;:]+$/, '');
  checks.push({
    id: 'on-screen',
    label: 'Words on screen from the start',
    ok: titled || hasCaptions,
    weight: 1,
    detail: titled ? 'A title opens the video' : hasCaptions ? 'Captions are on' : 'Most people watch muted at first: show the hook in words',
    ...(!titled && !hasCaptions && hookText
      ? { fix: { kind: 'ops', label: 'Add the hook as a title', ops: [{ op: 'addClip', clip: { type: 'text', text: hookText, start: 0, duration: Math.min(3, Math.max(1.5, duration)) } as never }] } }
      : {}),
  });
  if (short)
    checks.push({
      id: 'captions',
      label: 'Captions on',
      ok: hasCaptions,
      weight: 1,
      detail: hasCaptions ? 'Captions follow the words' : 'Shorts without captions lose the muted viewers',
      ...(!hasCaptions && words.length ? { fix: { kind: 'tool', label: 'Add captions', tool: 'add_captions', input: { style: { preset: 'bold-pop' } } } } : {}),
    });
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const hookScore = total ? Math.round((checks.reduce((n, c) => n + (c.ok ? c.weight : 0), 0) / total) * 100) / 10 : 0;

  // ---- dead spots ----------------------------------------------------------
  const pauses: [number, number][] = [];
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1]!;
    const b = words[i]!;
    const gap = b.start - a.end;
    if (gap < 1 || b.start < window) continue;
    pauses.push([a.end + 0.12, b.start - 0.12]);
    issues.push({
      id: `pause-${round3(a.end)}`,
      kind: 'pause',
      severity: gap >= 2 ? 'high' : 'medium',
      at: round3(a.end),
      end: round3(b.start),
      title: `${gap.toFixed(1)}s pause`,
      detail: `Nothing is said between “${a.text}” and “${b.text}”`,
      fix: { kind: 'ops', label: 'Cut the pause', ops: cuts(p, [[a.end + 0.12, b.start - 0.12]]) },
    });
  }
  if (pauses.length > 1) bulk.push({ kind: 'ops', label: `Cut all ${pauses.length} pauses`, ops: cuts(p, pauses) });

  const fillers = words.filter((w) => isFiller(w.text, DEFAULT_FILLERS));
  if (fillers.length) {
    const ranges = fillers.map((w) => [w.start - 0.03, w.end + 0.03] as [number, number]);
    issues.push({
      id: 'fillers',
      kind: 'filler',
      severity: fillers.length / Math.max(1, duration / 60) > 4 ? 'high' : 'low',
      at: fillers[0]!.start,
      end: fillers.at(-1)!.end,
      title: `${fillers.length} filler word${fillers.length === 1 ? '' : 's'}`,
      detail: [...new Set(fillers.map((w) => w.text.toLowerCase().replace(/[^\p{L}]/gu, '')))].slice(0, 5).join(', '),
      fix: { kind: 'ops', label: `Remove ${fillers.length === 1 ? 'it' : `all ${fillers.length}`}`, ops: cuts(p, ranges) },
    });
  }

  // the same shot too long, while someone talks
  const limit = short ? 5 : 15;
  const marks = [0, ...changes.filter((t) => t > 0 && t < duration), duration];
  let longestShot = 0;
  const zoomOps: EditOp[] = [];
  const zoomed = new Map<string, VideoClip>();
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1]!;
    const b = marks[i]!;
    longestShot = Math.max(longestShot, b - a);
    if (b - a <= limit || b <= window * 0.5) continue;
    const talking = words.some((w) => w.start >= a && w.end <= b);
    if (!talking) continue;
    const mid = a + (b - a) / 2;
    const clip = footageAt(p, mid, words);
    const issue: RetentionIssue = {
      id: `static-${round3(a)}`,
      kind: 'static',
      severity: b - a > limit * 2 ? 'high' : 'medium',
      at: round3(a),
      end: round3(b),
      title: `Same shot for ${Math.round(b - a)}s`,
      detail: `${fmt(a)}–${fmt(b)}: add b-roll, a graphic or a punch-in to reset attention`,
    };
    if (clip) {
      // one punch-in per `limit` seconds of the stretch (on the part of the footage it covers)
      const from = Math.max(a, clip.start);
      const to = Math.min(b, clipEnd(clip));
      const n = Math.max(1, Math.min(12, Math.floor((to - from) / limit)));
      const times = Array.from({ length: n }, (_, k) => from + ((k + 1) * (to - from)) / (n + 1) - 1);
      const own = times.reduce((z, at) => withZoom(clip, z, at), clip.zooms);
      issue.fix = { kind: 'ops', label: n === 1 ? 'Punch in here' : `Punch in ${n} times`, ops: [{ op: 'updateClip', clipId: clip.id, patch: { zooms: own } }] };
      const cur = zoomed.get(clip.id) ?? clip;
      zoomed.set(clip.id, { ...cur, zooms: times.reduce((z, at) => withZoom(clip, z, at), cur.zooms) });
    }
    issues.push(issue);
  }
  for (const [id, c] of zoomed) zoomOps.push({ op: 'updateClip', clipId: id, patch: { zooms: c.zooms } });
  const statics = issues.filter((i) => i.kind === 'static' && i.fix).length;
  if (statics > 1) bulk.push({ kind: 'ops', label: `Punch in on all ${statics} long shots`, ops: zoomOps });

  // a slow middle: a minute-long stretch well below the video's own pace
  const wpmAll = words.length > 1 ? (words.length / Math.max(1, words.at(-1)!.end - words[0]!.start)) * 60 : 0;
  if (!short && words.length > 60) {
    const step = 30;
    for (let t = window; t + 60 <= duration; t += step) {
      const n = words.filter((w) => w.start >= t && w.start < t + 60).length;
      if (n > 0 && n < wpmAll * 0.6)
        issues.push({
          id: `slow-${t}`,
          kind: 'slow',
          severity: 'low',
          at: t,
          end: t + 60,
          title: 'Slow stretch',
          detail: `${n} words in this minute against ${Math.round(wpmAll)} on average: tighten it or add visuals`,
          fix: { kind: 'ask', label: 'Ask the Director to tighten it', prompt: `The stretch ${fmt(t)}–${fmt(t + 60)} of this video is slow (${n} words in a minute, the video averages ${Math.round(wpmAll)}). Tighten it: cut what drags, and add b-roll or graphics where it stays on one shot.` },
        });
    }
  }

  // the ending: silence after the last word, and whether it points somewhere
  const last = words.at(-1);
  if (last && duration - last.end > 1.5) {
    issues.push({
      id: 'ending',
      kind: 'ending',
      severity: 'medium',
      at: round3(last.end),
      end: round3(duration),
      title: `${(duration - last.end).toFixed(1)}s after the last word`,
      detail: 'Viewers leave when the talking stops; end close to the last line (or on an end screen)',
      fix: { kind: 'ops', label: 'Trim the end', ops: cuts(p, [[last.end + 0.6, duration + 1]]) },
    });
  }
  if (!short && last && !CTA.test(words.filter((w) => w.start > duration - 30).map((w) => w.text).join(' ')))
    issues.push({
      id: 'cta',
      kind: 'ending',
      severity: 'low',
      at: Math.max(0, round3(duration - 20)),
      end: round3(duration),
      title: 'No next step at the end',
      detail: 'Point viewers to another video or ask a question for the comments: it keeps the session going',
      fix: { kind: 'ask', label: 'Ask the Director for an ending', prompt: 'The end of this video has no call to action. Add a short end screen or closing line that points viewers to another video or asks a question for the comments.' },
    });

  issues.sort((a, b) => a.at - b.at);
  const minutes = Math.max(1 / 6, duration / 60);
  const penalty = issues.reduce((n, i) => n + (i.severity === 'high' ? 6 : i.severity === 'medium' ? 3 : 1), 0);
  const score = Math.max(0, Math.min(100, Math.round(hookScore * 5 + 50 - penalty / Math.sqrt(minutes))));
  return {
    score,
    hook: { score: hookScore, window, checks },
    issues,
    bulk,
    stats: {
      duration: round3(duration),
      words: words.length,
      wpm: Math.round(wpmAll),
      changesPerMinute: Math.round((changes.filter((t) => t > 0).length / minutes) * 10) / 10,
      pauses: pauses.length,
      fillers: fillers.length,
      longestShot: round3(longestShot),
    },
    short,
  };
};

/** A plain-text report for the Director and MCP clients. */
export const retentionText = (r: RetentionReport) => {
  const lines = [
    `Retention score ${r.score}/100 (${r.short ? 'Short' : 'long video'}, ${Math.round(r.stats.duration)}s, ${r.stats.wpm} wpm, ${r.stats.changesPerMinute} visual changes a minute, longest shot ${Math.round(r.stats.longestShot)}s).`,
    `Hook (first ${r.hook.window}s): ${r.hook.score}/10`,
    ...r.hook.checks.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`),
    r.issues.length ? `Dead spots (${r.issues.length}):` : 'No dead spots found.',
    ...r.issues.map((i) => `  [${i.severity}] ${fmt(i.at)}–${fmt(i.end)} ${i.title}: ${i.detail}`),
  ];
  return lines.join('\n');
};
