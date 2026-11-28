import { describe, expect, it } from 'vitest';
import { applyOps } from './ops';
import { analyzeRetention, retentionText, visualChanges } from './retention';
import type { Project, Word } from './schema';
import { createProject } from './timeline';

/** A 60 s talking head: `say` lists [start, text] sentences, words 0.3 s long and 0.05 s apart. */
const talk = (say: [number, string][], opts: { duration?: number; format?: 'long' | 'short' } = {}) => {
  const p = createProject({ name: 'Talk', format: opts.format ?? 'long' });
  const duration = opts.duration ?? 60;
  p.assets.push({ id: 'cam', name: 'cam.mp4', kind: 'video', file: 'cam.mp4', createdAt: '', meta: { duration, width: 1920, height: 1080 } } as never);
  applyOps(p, [{ op: 'addClip', trackId: 'Main', clip: { id: 'v', type: 'video', assetId: 'cam', start: 0, duration } }]);
  const words: Word[] = [];
  for (const [t0, line] of say) {
    let t = t0;
    for (const w of line.split(' ')) {
      words.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.3) * 1000) / 1000 });
      t += 0.35;
    }
  }
  return { p, transcripts: { cam: words } };
};

const fill = (from: number, to: number, line = 'and this part keeps the story moving along nicely for everyone.') => {
  const out: [number, string][] = [];
  for (let t = from; t < to - 4; t += 4.6) out.push([t, line]);
  return out;
};

describe('retention coach', () => {
  it('scores a weak opening and fixes it', () => {
    const { p, transcripts } = talk([[2.4, 'So I was thinking about some stuff lately.'], ...fill(6, 58)]);
    const r = analyzeRetention(p, transcripts);
    const check = (id: string) => r.hook.checks.find((c) => c.id === id)!;
    expect(check('talk-now').ok).toBe(false);
    expect(check('hook-line').ok).toBe(false);
    expect(check('motion').ok).toBe(false);
    expect(check('on-screen').ok).toBe(false);
    expect(r.hook.score).toBeLessThan(4);

    // one click each: the slow start is cut, a punch-in and a title are added
    // (each fix is worked out on the current edit, so analyze again after each, as the tab does)
    for (const id of ['talk-now', 'motion', 'on-screen']) {
      const fix = analyzeRetention(p, transcripts).hook.checks.find((c) => c.id === id)!.fix!;
      expect(fix.kind).toBe('ops');
      if (fix.kind === 'ops') applyOps(p, fix.ops);
    }
    const after = analyzeRetention(p, transcripts);
    expect(after.hook.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual(['hook-line']);
    expect(after.hook.score).toBeGreaterThan(r.hook.score + 4);
    expect(after.score).toBeGreaterThan(r.score);
    expect(check('hook-line').fix?.kind).toBe('ask');
  });

  it('passes a strong opening', () => {
    const { p, transcripts } = talk([[0.3, 'Why do most channels never grow past a hundred subscribers?'], ...fill(4.5, 58)]);
    applyOps(p, [{ op: 'addClip', clip: { type: 'text', text: 'Why channels stall', start: 0, duration: 2 } as never }]);
    const r = analyzeRetention(p, transcripts);
    expect(r.hook.checks.filter((c) => !c.ok).map((c) => c.id)).toEqual([]);
    expect(r.hook.score).toBe(10);
  });

  it('finds long pauses, filler words and a silent ending, and cuts them in one step each', () => {
    const { p, transcripts } = talk([
      [0.2, 'Here is the secret to growing fast.'],
      [3, 'um the first thing is consistency.'],
      [20, 'After a long silence we continue uh talking.'],
      [24, 'And that is the end of it.'],
    ], { duration: 40 });
    const r = analyzeRetention(p, transcripts);
    const pause = r.issues.find((i) => i.kind === 'pause')!;
    expect(pause.title).toMatch(/^1\d\.\ds pause$/);
    expect(pause.severity).toBe('high');
    expect(r.issues.find((i) => i.kind === 'filler')?.title).toBe('2 filler words');
    const ending = r.issues.find((i) => i.id === 'ending')!;
    expect(ending.title).toMatch(/after the last word/);

    for (const pick of [(i: { id: string }) => i.id === 'ending', (i: { kind: string }) => i.kind === 'pause', (i: { kind: string }) => i.kind === 'filler']) {
      const fix = analyzeRetention(p, transcripts).issues.find(pick)?.fix;
      if (fix?.kind === 'ops') applyOps(p, fix.ops);
    }
    // the transcript follows the cuts on the timeline, so analyzing again finds nothing of these
    const after = analyzeRetention(p, transcripts);
    expect(after.issues.filter((i) => ['pause', 'filler'].includes(i.kind) || i.id === 'ending')).toEqual([]);
    expect(after.stats.duration).toBeLessThan(15);
  });

  it('flags the same shot held too long while talking, and punches in', () => {
    const { p, transcripts } = talk([[0.2, 'Here is why you need this today.'], ...fill(3, 58)]);
    applyOps(p, [{ op: 'updateClip', clipId: 'v', patch: { zooms: [{ at: 2, duration: 1, scale: 1.2, x: 0.5, y: 0.4, style: 'snap' }] } }]);
    const r = analyzeRetention(p, transcripts);
    const statics = r.issues.filter((i) => i.kind === 'static');
    expect(statics.length).toBeGreaterThan(0);
    expect(r.stats.longestShot).toBeGreaterThan(15);
    const all = r.bulk.find((b) => /Punch in on all/.test(b.label)) ?? statics[0]!.fix!;
    if (all.kind === 'ops') applyOps(p, all.ops);
    const after = analyzeRetention(p, transcripts);
    expect(after.stats.longestShot).toBeLessThan(r.stats.longestShot);
    expect(visualChanges(p).length).toBeGreaterThan(visualChanges(talk([]).p).length);
  });

  it('treats a vertical video as a Short: tighter limits and captions', () => {
    const { p, transcripts } = talk([[0.1, 'Stop doing this one thing right now.'], ...fill(3, 28)], { duration: 30, format: 'short' });
    const r = analyzeRetention(p, transcripts as Record<string, Word[]>);
    expect(r.short).toBe(true);
    const captions = r.hook.checks.find((c) => c.id === 'captions')!;
    expect(captions.ok).toBe(false);
    expect(captions.fix).toMatchObject({ kind: 'tool', tool: 'add_captions' });
    expect(r.issues.some((i) => i.kind === 'static')).toBe(true);
    expect(retentionText(r)).toMatch(/Retention score \d+\/100 \(Short/);
  });

  it('copes with a video without speech', () => {
    const p: Project = createProject({ name: 'Empty' });
    const r = analyzeRetention(p, {});
    expect(r.stats.words).toBe(0);
    expect(r.issues).toEqual([]);
  });
});
