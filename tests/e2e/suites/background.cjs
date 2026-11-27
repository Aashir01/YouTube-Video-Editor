// Remove background: cut a person out (segmentation model) and key out a green screen; what is on the
// track below shows through in rendered frames; restore; a blurred original behind.
const fs = require('fs');
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media, mcpClient, pixel, OUT } = require('../lib.cjs');

const isBlue = ([r, g, b]) => b > 140 && r < 100 && b > g + 30; // the photo on the track below (#2B6AB1)
const isSkin = ([r, g, b]) => r > 150 && r > b + 25 && g > 90;
const rgb = (p) => `rgb(${p.join(',')})`;

(async () => {
  const pid = (await post('/api/projects', { name: 'Backgrounds', format: 'long' })).id;
  const th = await waitReady(pid, (await upload(pid, media('talkhead.mp4'))).id);
  const gs = await waitReady(pid, (await upload(pid, media('greenscreen.mp4'))).id);
  const photo = await waitReady(pid, (await upload(pid, media('photo.png'))).id);
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'bg', type: 'image', assetId: photo.id, start: 0, duration: 6 } },
    { op: 'addClip', trackId: 'B-roll', clip: { id: 'th', type: 'video', assetId: th.id, start: 0, duration: 3 } },
    { op: 'addClip', trackId: 'B-roll', clip: { id: 'gs', type: 'video', assetId: gs.id, start: 3, duration: 3 } },
  ]);
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  fs.mkdirSync(OUT, { recursive: true });
  const frameAt = async (t, name) => {
    const r = await call('preview_frames', { times: [t] });
    const f = path.join(OUT, `${name}.jpg`);
    fs.writeFileSync(f, Buffer.from(r.images[0].data, 'base64'));
    return f;
  };
  // spots: a corner of the picture (wall / green screen), and the face
  const TH_FACE = [0.46, 0.25];
  const GS_FACE = [0.47, 0.42];
  const CORNER = [0.04, 0.08];

  let f = await frameAt(1.5, 'talkhead-before');
  check(!isBlue(pixel(f, ...CORNER)), `before: the grey wall covers the photo (${rgb(pixel(f, ...CORNER))})`);

  // 1) Inspector: Remove background (person)
  const { page, shot, finish } = await launch('background');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="th"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    const s = window.cutroom.store.getState();
    s.select(['th']);
    s.setRightTab('inspector');
  });
  await page.getByRole('button', { name: 'Background', exact: true }).click();
  await page.getByRole('button', { name: 'Remove background' }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Background removed' }).first().waitFor({ timeout: 180000 });
  let p = await getProject(pid);
  let clip = clips(p).find((c) => c.id === 'th');
  const made = p.assets.find((a) => a.id === clip.assetId);
  check(made && made.file.endsWith('.webm') && made.meta.alpha && made.derived?.kind === 'background' && made.derived.from === th.id, `the clip now shows a video with transparency (${made?.name})`);
  check(Math.abs(clip.trimStart - 0) < 0.01 && Math.abs(made.derived.offset - 0) < 0.01, 'at the same moment');
  check(!made.proxy, 'and never gets a proxy (it would lose the transparency)');
  f = await frameAt(1.5, 'talkhead-after');
  check(isBlue(pixel(f, ...CORNER)), `the wall is gone: the photo below shows through (${rgb(pixel(f, ...CORNER))})`);
  check(isSkin(pixel(f, ...TH_FACE)), `the person stays (${rgb(pixel(f, ...TH_FACE))})`);
  await page.evaluate(() => window.cutroom.seek(1.5));
  await page.waitForTimeout(800);
  await shot('01-person-removed');

  // 2) green screen through the Director's tool (color found automatically)
  f = await frameAt(4.5, 'greenscreen-before');
  check(!isBlue(pixel(f, ...CORNER)), `before: the green screen covers the photo (${rgb(pixel(f, ...CORNER))})`);
  const r = await call('remove_background', { clipId: 'gs', mode: 'screen' });
  p = await getProject(pid);
  const keyed = p.assets.find((a) => a.id === clips(p).find((c) => c.id === 'gs').assetId);
  const found = [1, 3, 5].map((i) => parseInt((keyed?.derived?.note ?? '#000000').slice(i, i + 2), 16));
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 12);
  check(!r.isError && keyed?.derived?.kind === 'greenscreen' && near(found, [0x00, 0xb1, 0x40]), `remove_background finds the screen color by itself (${keyed?.derived?.note}, the screen is #00b140)`);
  f = await frameAt(4.5, 'greenscreen-after');
  const corner = pixel(f, ...CORNER);
  check(isBlue(corner), `the green is gone (${rgb(corner)})`);
  check(isSkin(pixel(f, ...GS_FACE)), `the person stays (${rgb(pixel(f, ...GS_FACE))})`);

  // 3) restore the original from the Inspector
  await page.getByRole('button', { name: 'Restore the original' }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Original' }).first().waitFor({ timeout: 30000 });
  p = await getProject(pid);
  clip = clips(p).find((c) => c.id === 'th');
  check(clip.assetId === th.id && Math.abs(clip.trimStart) < 0.01, 'Restore the original puts the original video back');

  // 4) "portrait mode": the person in front of a blurred copy of the original
  await call('remove_background', { clipId: 'th', mode: 'person', behind: 'blur' });
  p = await getProject(pid);
  const bottom = p.tracks[0];
  const under = bottom.clips[0];
  check(bottom.name === 'Background' && under?.assetId === th.id && under.grade?.blur > 0 && under.volume === 0, 'a blurred, silent copy of the original goes on a new bottom track');
  await shot('02-portrait-mode');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
