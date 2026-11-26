import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutroom-shorts-test-'));
process.env.DIRECTOR_DATA_DIR = tmp;
process.env.DIRECTOR_NO_WARMUP = '1';

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('createShort', () => {
  it('cuts ranges into a vertical project, keeping graphics in sync and music to length', async () => {
    const { store } = await import('./storage/projects');
    const { createShort } = await import('./shorts');
    const { applyOps } = await import('../shared/ops');
    const src = await store.create({ name: 'Long video' });
    await store.update(src.id, 'setup', (d) => {
      applyOps(d, [
        { op: 'addClip', trackId: 'Main', clip: { id: 'a', type: 'scene', template: 'title-card', start: 0, duration: 10, props: { title: 'A' } } },
        { op: 'addClip', trackId: 'Main', clip: { id: 'b', type: 'scene', template: 'title-card', start: 10, duration: 10, props: { title: 'B' } } },
        { op: 'addClip', trackId: 'Graphics', clip: { id: 't1', type: 'text', text: 'keep', start: 3, duration: 1 } },
        { op: 'addClip', trackId: 'Graphics', clip: { id: 't2', type: 'text', text: 'drop', start: 8, duration: 1 } },
      ]);
    });

    const short = await createShort(src.id, [
      [2, 5],
      [12, 14],
    ]);
    expect(short.canvas).toMatchObject({ width: 1080, height: 1920 });
    expect(short.brief.format).toBe('short');
    const main = short.tracks.find((t) => t.name === 'Main')!;
    expect(main.clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 3],
      [3, 2],
    ]);
    const texts = short.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text');
    expect(texts.map((c) => (c.type === 'text' ? [c.text, c.start] : null))).toEqual([['keep', 1]]);
    expect(short.tracks.flatMap((t) => t.clips).some((c) => c.type === 'captions' && c.mode === 'auto' && c.duration === 5)).toBe(true);
    expect(short.youtube.hashtags).toContain('#shorts');
    // the source is untouched
    expect((await store.get(src.id)).canvas.width).toBe(1920);
  });

  it('rejects empty or overlong selections', async () => {
    const { store } = await import('./storage/projects');
    const { createShort } = await import('./shorts');
    const src = await store.create({ name: 'Empty' });
    await expect(createShort(src.id, [[1, 1.2]])).rejects.toThrow(/half a second/);
  });
});
