// Text-based editing: fillers, pauses, cut selected words, fix a word, search.
const path = require('path');
const { BASE, api, post, put, upload, waitReady, ops, getProject, check, launch, media } = require('../lib.cjs');

const W = (text, start, end) => ({ text, start, end });
const WORDS = [
  W('Hello', 0.2, 0.5), W('everyone,', 0.55, 1.0), W('um,', 1.1, 1.45), W('welcome', 1.5, 1.9), W('back.', 1.95, 2.3),
  W('Today', 3.8, 4.1), W('we', 4.15, 4.3), W('talk', 4.35, 4.6), W('about', 4.65, 4.9), W('uh', 5.0, 5.3), W('sleep.', 5.35, 5.8),
  W('It', 7.8, 7.95), W('matters', 8.0, 8.4), W('a', 8.45, 8.5), W('lot', 8.55, 8.8), W('for', 8.85, 9.0), W('your', 9.05, 9.2), W('health.', 9.25, 9.8),
];

const mainLength = (p) => p.tracks.find((t) => t.name === 'Main').clips.reduce((n, c) => n + c.duration, 0);

(async () => {
  const pid = (await post('/api/projects', { name: 'Transcript test', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  await put(`/api/projects/${pid}/assets/${video.id}/transcript`, { words: WORDS });
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 12 } }]);

  const { page, shot, finish } = await launch('transcript');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /^Text$/ }).click();
  await page.getByText('welcome', { exact: true }).waitFor({ timeout: 10000 });
  await shot('01-transcript');

  // search
  await page.getByPlaceholder(/Find in transcript/).fill('sleep');
  await page.waitForTimeout(200);
  check((await page.locator('text=/^1$/').count()) > 0, 'search shows 1 match');
  await page.getByPlaceholder(/Find in transcript/).fill('');

  // remove fillers
  let p = await getProject(pid);
  const len0 = mainLength(p);
  await page.getByRole('button', { name: /Fillers \(2\)/ }).click();
  await page.waitForTimeout(1000);
  p = await getProject(pid);
  const len1 = mainLength(p);
  check(Math.abs(len0 - len1 - 0.65) < 0.02, `fillers removed: ${len0.toFixed(2)}s -> ${len1.toFixed(2)}s`);
  check(!(await page.locator('span', { hasText: /^um,$/ }).count()), 'um is gone from the transcript');

  // tighten pauses (two long pauses)
  const pauseBtn = page.getByRole('button', { name: /Pauses \(\d+\)/ });
  const pauseCount = Number((await pauseBtn.textContent()).match(/\((\d+)\)/)[1]);
  await pauseBtn.click();
  await page.waitForTimeout(1000);
  p = await getProject(pid);
  const len2 = mainLength(p);
  check(pauseCount === 2 && len1 - len2 > 2.4, `${pauseCount} pauses tightened: ${len1.toFixed(2)}s -> ${len2.toFixed(2)}s`);

  // select "a lot for your" by dragging, then cut it with the Cut button
  const from = page.locator('p span', { hasText: /^a$/ }).first();
  const to = page.locator('p span', { hasText: /^your$/ }).first();
  const fb = await from.boundingBox();
  const tb = await to.boundingBox();
  await page.mouse.move(fb.x + 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  check((await page.getByText('4 words', { exact: false }).count()) > 0, 'selection bar shows 4 words');
  await shot('02-selection');
  await page.getByRole('button', { name: /^Cut$/ }).click();
  await page.waitForTimeout(1000);
  p = await getProject(pid);
  const len3 = mainLength(p);
  check(len2 - len3 > 0.6, `cut selected words: ${len2.toFixed(2)}s -> ${len3.toFixed(2)}s`);
  check(!(await page.locator('span', { hasText: /^your$/ }).count()), '"your" no longer in the transcript');

  // fix a word: "sleep." -> "sleep!"
  await page.locator('span', { hasText: /^sleep\.$/ }).dblclick();
  const input = page.locator('input.field').last();
  await input.fill('sleep!');
  await input.press('Enter');
  await page.waitForTimeout(800);
  const tr = await api(`/api/projects/${pid}/assets/${video.id}/transcript`);
  check(tr.some((w) => w.text === 'sleep!'), 'fixed word saved to the source transcript');
  await shot('03-after-edits');

  // undo brings the cut words back
  await page.locator('body').click({ position: { x: 800, y: 300 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  check((await page.locator('span', { hasText: /^your$/ }).count()) > 0, 'undo restores the cut words');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
