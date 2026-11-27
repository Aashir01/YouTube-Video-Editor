// Shorts from a range, audio-only and range exports, home recipes/search.
const fs = require('fs');
const path = require('path');
const { BASE, api, post, put, upload, waitReady, ops, getProject, clips, check, launch, media, DATA } = require('../lib.cjs');

const waitFor = async (fn, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
};

(async () => {
  const pid = (await post('/api/projects', { name: 'Shorts source', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  const music = await waitReady(pid, (await upload(pid, media('voice.m4a'))).id);
  const photo = await waitReady(pid, (await upload(pid, media('photo.png'))).id);
  await put(`/api/projects/${pid}/assets/${video.id}/transcript`, { words: [{ text: 'Hello', start: 2.1, end: 2.5 }, { text: 'shorts', start: 2.6, end: 3 }, { text: 'world', start: 12.2, end: 12.6 }] });
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 20 } },
    { op: 'addClip', trackId: 'Graphics', clip: { id: 'g1', type: 'text', text: 'Kept title', start: 3, duration: 2 } },
    { op: 'addClip', trackId: 'Graphics', clip: { id: 'g2', type: 'text', text: 'Dropped title', start: 9, duration: 2 } },
    { op: 'addClip', trackId: 'Music', clip: { id: 'mus', type: 'audio', role: 'music', assetId: music.id, start: 0, duration: 20, loop: true, duck: true } },
  ]);
  void photo; // unused asset: must not be carried into the Short

  // --- API: two ranges -> a 9:16 project
  const r = await post(`/api/projects/${pid}/shorts`, { ranges: [[2, 8], [12, 15]], title: 'Best bits' });
  const sp = await getProject(r.id);
  check(sp.canvas.width === 1080 && sp.canvas.height === 1920, `Short is 9:16 (${sp.canvas.width}x${sp.canvas.height})`);
  check(Math.abs(r.duration - 9) < 0.05, `Short length = 6s + 3s (${r.duration})`);
  const sc = clips(sp);
  check(sc.some((c) => c.text === 'Kept title') && !sc.some((c) => c.text === 'Dropped title'), 'graphics inside the ranges kept, others removed');
  check(sc.some((c) => c.type === 'captions' && c.mode === 'auto'), 'auto captions added');
  const v = sc.filter((c) => c.type === 'video');
  check(v.length === 2 && v.every((c) => c.fit === 'cover' && c.focus), `footage reframed (${v.length} clips with focus)`);
  check(v[0].trimStart === 2 && Math.abs(v[1].trimStart - 12) < 0.01 && Math.abs(v[1].start - 6) < 0.01, `source sync kept: trimStart ${v.map((c) => c.trimStart)}`);
  const mus = sc.find((c) => c.type === 'audio' && c.role === 'music');
  check(mus && mus.start === 0 && Math.abs(mus.start + mus.duration - 9) < 0.05, `music plays from 0 and stops with the Short (${mus?.start}-${mus ? mus.start + mus.duration : '?'})`);
  check(sp.assets.length === 2 && !sp.assets.some((a) => a.id === photo.id), `only used assets carried over (${sp.assets.length})`);
  const srcFile = path.join(DATA, 'projects', pid, 'media', video.file);
  const dstFile = path.join(DATA, 'projects', r.id, 'media', video.file);
  check(fs.statSync(srcFile).ino === fs.statSync(dstFile).ino, 'media is hard-linked, not copied');
  check(sp.youtube.hashtags.includes('#shorts') && sp.youtube.title === 'Best bits', 'Shorts metadata set');

  // --- UI: range -> Make a Short -> Open
  const { page, shot, finish } = await launch('shorts');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.cutroom.seek(4));
  await page.keyboard.press('i');
  await page.evaluate(() => window.cutroom.seek(10));
  await page.keyboard.press('o');
  await page.getByRole('button', { name: 'Make a Short' }).click();
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 30000 });
  await shot('01-short-toast');
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForURL((u) => !u.toString().includes(pid), { timeout: 15000 });
  await page.locator('[data-clip-box]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await shot('02-short-opened');
  const opened = await page.evaluate(() => window.cutroom.state().project);
  check(opened.canvas.height === 1920 && Math.abs(opened.tracks.find((t) => t.name === 'Main').clips[0].duration - 6) < 0.05, 'UI-made Short opened in the editor (6s, vertical)');

  // --- exports on the source: audio-only and a range
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.cutroom.store.setState({ range: [5, 8] }));
  await page.getByRole('button', { name: /^Export$/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Audio · MP3/ }).click();
  await dialog.getByRole('button', { name: /Whole video/ }).click();
  await dialog.getByRole('button', { name: /^Render \d/ }).click();
  const audioDone = await waitFor(async () => (await getProject(pid)).renders.find((x) => x.kind === 'audio' && x.status === 'done'));
  check(audioDone && /\.(mp3|m4a)$/.test(audioDone.file) && Math.abs(audioDone.durationSec - 20) < 0.5, `audio export: ${audioDone?.file} ${audioDone?.durationSec}s`);
  await dialog.getByRole('button', { name: /Video · MP4/ }).click();
  await dialog.getByRole('button', { name: /In–out/ }).click();
  await dialog.locator('select').first().selectOption('draft');
  await dialog.getByRole('button', { name: /^Render \d/ }).click();
  const rangeDone = await waitFor(async () => (await getProject(pid)).renders.find((x) => x.kind === 'video' && x.status === 'done'));
  check(rangeDone && Math.abs(rangeDone.durationSec - 3) < 0.25, `range export length ${rangeDone?.durationSec}s (range 5-8s)`);
  await shot('03-exports');
  await page.keyboard.press('Escape');

  // --- home: recipe fills the brief with the topic placeholder selected; search filters
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Faceless explainer/ }).click();
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => {
    const el = document.querySelector('textarea');
    return el.value.slice(el.selectionStart, el.selectionEnd);
  });
  check(sel === '___', 'recipe fills the brief and selects the topic placeholder');
  await shot('04-home-recipe');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
