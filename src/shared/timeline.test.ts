import { describe, expect, it } from 'vitest';
import { AssetSchema, type Project, type Word } from './schema';
import {
  captionWords,
  clipEnd,
  computeKeepSegments,
  createProject,
  duckGain,
  findClip,
  lintProject,
  paginateWords,
  placeClip,
  projectDuration,
  reconcileFollowers,
  requireTrack,
  rippleDelete,
  segmentsToClips,
  speechIntervals,
  splitClip,
  summarizeProject,
  timelineWords,
  trimClip,
} from './timeline';

const withVideoAsset = (p: Project, id = 'asset_a', duration = 60): Project => {
  p.assets.push(
    AssetSchema.parse({
      id,
      name: `${id}.mp4`,
      kind: 'video',
      file: `${id}.mp4`,
      createdAt: new Date().toISOString(),
      meta: { duration, width: 1920, height: 1080, hasAudio: true, hasVideo: true },
    }),
  );
  return p;
};

const words = (spec: [string, number, number][]): Word[] => spec.map(([text, start, end]) => ({ text, start, end }));

describe('project creation', () => {
  it('creates long and short formats with default tracks', () => {
    const long = createProject({ name: 'A' });
    expect(long.canvas).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect(long.tracks.map((t) => t.name)).toEqual(['Main', 'B-roll', 'Graphics', 'Captions', 'Voiceover', 'Music', 'SFX']);
    const short = createProject({ name: 'B', format: 'short' });
    expect(short.canvas).toMatchObject({ width: 1080, height: 1920 });
  });
});

describe('placement and editing', () => {
  it('places clips on default tracks and rejects overlaps', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    const { track } = placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 5 });
    expect(track.name).toBe('Main');
    expect(() => placeClip(p, { id: 'c2', type: 'video', assetId: 'asset_a', start: 4, duration: 5 })).toThrow(/overlaps/);
    placeClip(p, { id: 'c2', type: 'video', assetId: 'asset_a', start: 4, duration: 5 }, { onConflict: 'new-track' });
    expect(findClip(p, 'c2')!.track.name).not.toBe('Main');
    expect(projectDuration(p)).toBe(9);
  });

  it('overwrite trims what is underneath and keeps media in sync', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 10, trimStart: 2 });
    placeClip(p, { id: 'g', type: 'scene', template: 'title-card', start: 3, duration: 2 }, { trackId: 'Main', onConflict: 'overwrite' });
    const main = requireTrack(p, 'Main');
    expect(main.clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 3],
      [3, 2],
      [5, 5],
    ]);
    const tail = main.clips[2]!;
    expect(tail.type === 'video' && tail.trimStart).toBe(7);
  });

  it('clamps clips that run past the source media', () => {
    const p = withVideoAsset(createProject({ name: 't' }), 'asset_a', 8);
    const { clip } = placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 20, trimStart: 2 });
    expect(clip.duration).toBe(6);
  });

  it('splits clips at the right source offset and partitions zooms', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, {
      id: 'c1',
      type: 'video',
      assetId: 'asset_a',
      start: 10,
      duration: 10,
      trimStart: 5,
      speed: 2,
      zooms: [
        { at: 1, duration: 2 },
        { at: 7, duration: 2 },
      ],
    });
    const [l, r] = splitClip(p, 'c1', 14);
    const left = findClip(p, l)!.clip;
    const right = findClip(p, r)!.clip;
    expect(left.duration).toBe(4);
    expect(right.start).toBe(14);
    expect(right.type === 'video' && right.trimStart).toBe(13);
    expect(left.type === 'video' && left.zooms.length).toBe(1);
    expect(right.type === 'video' && right.zooms[0]!.at).toBe(3);
  });

  it('trims edges and refuses to extend before the source start', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 5, duration: 10, trimStart: 1 });
    const t = trimClip(p, 'c1', { start: 6, end: 12 });
    expect(t.type === 'video' && t.trimStart).toBe(2);
    expect(t.duration).toBe(6);
    expect(() => trimClip(p, 'c1', { start: 3 })).toThrow(/before the start/);
  });

  it('ripple deletes a range across tracks', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 10 });
    placeClip(p, { id: 't1', type: 'text', text: 'Later', start: 8, duration: 2 });
    rippleDelete(p, 2, 5);
    const main = requireTrack(p, 'Main');
    expect(main.clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 2],
      [2, 5],
    ]);
    expect(findClip(p, 't1')!.clip.start).toBe(5);
    expect(projectDuration(p)).toBe(7);
  });

  it('keeps follower clips (auto captions, looping music) attached to the end', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 10 });
    placeClip(p, { id: 'cap', type: 'captions', start: 0, duration: 10 });
    const prev = structuredClone(p);
    findClip(p, 'c1')!.clip.duration = 20;
    reconcileFollowers(p, prev);
    expect(findClip(p, 'cap')!.clip.duration).toBe(20);
  });
});

describe('transcripts, captions and ducking', () => {
  it('maps source words onto the timeline through cuts and speed', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 2, trimStart: 1 });
    placeClip(p, { id: 'c2', type: 'video', assetId: 'asset_a', start: 2, duration: 1, trimStart: 10, speed: 2 });
    const tr = {
      asset_a: words([
        ['zero', 0.1, 0.5],
        ['one', 1.0, 1.4],
        ['two', 2.0, 2.5],
        ['skip', 5, 6],
        ['ten', 10.0, 10.8],
      ]),
    };
    const w = timelineWords(p, tr);
    expect(w.map((x) => x.text)).toEqual(['one', 'two', 'ten']);
    expect(w[2]).toMatchObject({ start: 2, end: 2.4 });
    placeClip(p, { id: 'cap', type: 'captions', start: 0, duration: 3 });
    const cap = findClip(p, 'cap')!.clip;
    expect(cap.type === 'captions' && captionWords(p, cap, tr).length).toBe(3);
  });

  it('paginates words into short caption pages', () => {
    const pages = paginateWords(
      words([
        ['This', 0, 0.2],
        ['is', 0.2, 0.3],
        ['a', 0.3, 0.4],
        ['test.', 0.4, 0.8],
        ['Next', 2.0, 2.3],
        ['sentence', 2.3, 2.8],
      ]),
      { maxWords: 3 },
    );
    expect(pages.map((pg) => pg.words.map((w) => w.text).join(' '))).toEqual(['This is a', 'test.', 'Next sentence']);
    expect(pages[0]!.end).toBeLessThanOrEqual(pages[1]!.start);
  });

  it('ducks music under speech with smooth ramps', () => {
    const p = withVideoAsset(createProject({ name: 't' }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 0, duration: 10 });
    const speech = speechIntervals(p, { asset_a: words([['hi', 2, 3], ['there', 3.2, 4]]) });
    expect(speech).toEqual([[2, 4]]);
    expect(duckGain(0, speech, 0.2)).toBe(1);
    expect(duckGain(3, speech, 0.2)).toBe(0.2);
    const ramp = duckGain(1.85, speech, 0.2, 0.3);
    expect(ramp).toBeGreaterThan(0.2);
    expect(ramp).toBeLessThan(1);
    expect(duckGain(6, speech, 0.2)).toBe(1);
  });
});

describe('jump-cut editing', () => {
  const take = words([
    ['Hello', 0.5, 0.9],
    ['everyone', 0.95, 1.5],
    ['um', 2.4, 2.7],
    ['today', 4.0, 4.4],
    ['we', 4.45, 4.6],
    ['build', 4.65, 5.0],
  ]);

  it('removes long pauses and fillers', () => {
    const seg = computeKeepSegments(take, 8);
    expect(seg.length).toBe(2);
    expect(seg[0]![0]).toBeCloseTo(0.42, 2);
    expect(seg[0]![1]).toBeCloseTo(1.64, 2);
    expect(seg[1]![0]).toBeCloseTo(3.92, 2);
    const total = seg.reduce((n, [s, e]) => n + (e - s), 0);
    expect(total).toBeLessThan(3);
  });

  it('falls back to silence detection without a transcript', () => {
    const seg = computeKeepSegments([], 10, {}, [
      [0, 1],
      [4, 6],
      [9.8, 10],
    ]);
    // leading silence is dropped entirely; speech resumes with a short pre-roll
    expect(seg.length).toBe(2);
    expect(seg[0]![0]).toBeCloseTo(0.92);
    expect(seg[1]![0]).toBeCloseTo(5.92);
  });

  it('honours explicit removal ranges (bad takes)', () => {
    const seg = computeKeepSegments(take, 8, { removeRanges: [[3.9, 4.62]] });
    expect(seg.some(([s, e]) => s < 4.2 && e > 4.2)).toBe(false);
  });

  it('builds back-to-back clips with alternating punch-ins', () => {
    const clips = segmentsToClips(
      [
        [0, 2],
        [3, 5],
        [6, 9],
      ],
      { assetId: 'asset_a', startAt: 0, jumpCutZoom: true, zoomScale: 1.15, focusX: 0.5, focusY: 0.4 },
    );
    expect(clips.map((c) => [c.start, clipEnd(c)])).toEqual([
      [0, 2],
      [2, 4],
      [4, 7],
    ]);
    expect(clips[1]!.zooms[0]!.scale).toBe(1.15);
    expect(clips[0]!.zooms.length).toBe(0);
  });
});

describe('lint and summary', () => {
  it('flags gaps and undocked music', () => {
    const p = withVideoAsset(createProject({ name: 'Lint' }));
    p.assets.push(AssetSchema.parse({ id: 'asset_m', name: 'm.mp3', kind: 'audio', file: 'm.mp3', createdAt: '', meta: { duration: 100 } }));
    placeClip(p, { id: 'c1', type: 'video', assetId: 'asset_a', start: 1, duration: 3 });
    placeClip(p, { id: 'm1', type: 'audio', role: 'music', assetId: 'asset_m', start: 0, duration: 4 });
    const w = lintProject(p);
    expect(w.some((x) => x.includes('Gap'))).toBe(true);
    expect(w.some((x) => x.includes('duck'))).toBe(true);
    const s = summarizeProject(p);
    expect(s).toContain('asset_a');
    expect(s).toContain('c1 video');
  });
});
