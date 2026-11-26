import { CaptionStyleSchema, YouTubeSchema, type CaptionStyle, type Project } from '../shared/schema';
import { clearRange, mergeIntervals, placeClip, projectDuration, rippleDelete, round3, type Interval } from '../shared/timeline';
import { store } from './storage/projects';

export interface ShortOptions {
  /** title of the new project (default: "<name> — Short") */
  title?: string;
  /** horizontal crop focus (0-1) for full-frame footage, e.g. where the speaker is */
  focusX?: number;
}

const isMusicTrack = (p: Project, trackId: string) => {
  const t = p.tracks.find((x) => x.id === trackId);
  return Boolean(t && t.kind === 'audio' && t.clips.length > 0 && t.clips.every((c) => c.type === 'audio' && c.role === 'music'));
};

/**
 * Cut one or more time ranges of a video into a new vertical (9:16) project: everything
 * else is removed with the gaps closed (graphics, captions and voice stay in sync),
 * full-frame footage is reframed, music is trimmed to length and captions are ensured.
 */
export const createShort = async (projectId: string, ranges: Interval[], opts: ShortOptions = {}): Promise<Project> => {
  const src = await store.get(projectId);
  const total = projectDuration(src);
  const keep = mergeIntervals(
    ranges.map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))] as Interval).filter(([a, b]) => b - a >= 0.5),
    0.05,
  );
  if (keep.length === 0) throw new Error('Pick at least half a second of the video for the Short');
  const length = round3(keep.reduce((n, [a, b]) => n + (b - a), 0));
  if (length > 180) throw new Error(`That is ${Math.round(length)}s; YouTube Shorts can be at most 3 minutes`);
  const name = opts.title?.trim() || `${src.name} — Short`;

  return store.derive(projectId, name, (d) => {
    // captions are rebuilt as one clip at the end (cutting would leave fragments)
    const captionTrack = d.tracks.find((t) => t.kind === 'captions');
    let captionStyle: Partial<CaptionStyle> | undefined;
    for (const t of d.tracks) {
      const auto = t.clips.find((c) => c.type === 'captions' && c.mode === 'auto');
      if (auto && auto.type === 'captions') captionStyle ??= auto.style;
      t.clips = t.clips.filter((c) => !(c.type === 'captions' && c.mode === 'auto'));
    }

    // remove everything outside the kept ranges, last gap first so earlier times stay valid
    const gaps: Interval[] = [];
    let cursor = 0;
    for (const [a, b] of keep) {
      if (a > cursor) gaps.push([cursor, a]);
      cursor = b;
    }
    const end = Math.max(total, cursor);
    if (end > cursor) gaps.push([cursor, end + 1]);
    const synced = d.tracks.filter((t) => !isMusicTrack(d, t.id)).map((t) => t.id);
    for (const [a, b] of gaps.sort((x, y) => y[0] - x[0])) rippleDelete(d, a, b, synced);
    // music beds keep playing from the start and stop with the Short
    for (const t of d.tracks) if (!synced.includes(t.id)) clearRange(d, t, length, end + 1);

    // vertical canvas; full-frame pictures get cropped around the focus point
    d.canvas = { ...d.canvas, width: 1080, height: 1920 };
    d.brief.format = 'short';
    for (const t of d.tracks) {
      for (const c of t.clips) {
        if ((c.type === 'video' || c.type === 'image') && !c.box) {
          c.fit = 'cover';
          c.focus ??= { x: opts.focusX ?? 0.5, y: 0.4 };
        }
      }
    }

    // Shorts live on captions: add auto captions unless hand-made ones survived the cut
    if (!d.tracks.some((t) => t.clips.some((c) => c.type === 'captions'))) {
      const style = CaptionStyleSchema.parse({ ...(captionStyle ?? {}), preset: captionStyle?.preset ?? 'bold-pop', position: captionStyle?.position ?? 'bottom' });
      placeClip(d, { id: '', type: 'captions', mode: 'auto', start: 0, duration: length, style }, captionTrack ? { trackId: captionTrack.id, onConflict: 'overwrite' } : {});
    }

    d.markers = [];
    d.youtube = YouTubeSchema.parse({ title: name.slice(0, 100), hashtags: ['#shorts'], category: d.youtube.category, privacy: 'private' });
  });
};
