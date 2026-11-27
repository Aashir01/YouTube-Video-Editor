// Footage: stabilize shaky footage (measured with the app's tracker), apply a .cube color look,
// find the beats of music and cut pictures to them; restore the original.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media, mcpClient, pixel, OUT, ROOT, DATA } = require('../lib.cjs');

const shake = (files) => {
  const raw = execFileSync(process.execPath, ['--import', 'tsx', path.join(__dirname, '..', 'measure-shake.ts'), ...files], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(raw.split('RESULT')[1]);
};
// a 3D LUT that swaps red and blue (exact at any size: it is linear)
const swapLut = (file) => {
  const rows = ['TITLE "Swap red and blue"', 'LUT_3D_SIZE 2'];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
  fs.writeFileSync(file, rows.join('\n') + '\n');
};

(async () => {
  const pid = (await post('/api/projects', { name: 'Fixes and looks', format: 'long' })).id;
  const shaky = await waitReady(pid, (await upload(pid, media('shaky.mp4'))).id);
  const th = await waitReady(pid, (await upload(pid, media('talkhead.mp4'))).id);
  const gs = await waitReady(pid, (await upload(pid, media('greenscreen.mp4'))).id);
  const music = await waitReady(pid, (await upload(pid, media('beat.m4a'))).id);
  const photo = await waitReady(pid, (await upload(pid, media('photo.png'))).id);
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'shaky', type: 'video', assetId: shaky.id, start: 0, duration: 4 } },
    { op: 'addClip', trackId: 'Main', clip: { id: 'th', type: 'video', assetId: th.id, start: 4, duration: 3 } },
    { op: 'addClip', trackId: 'Main', clip: { id: 'gs', type: 'video', assetId: gs.id, start: 7, duration: 3 } },
    { op: 'addClip', trackId: 'Music', clip: { id: 'music', type: 'audio', role: 'music', assetId: music.id, start: 0, duration: 12 } },
    ...[
      [0.4, 2.1],
      [2.7, 1.3],
      [4.1, 2.6],
      [6.9, 1.1],
    ].map(([start, duration], i) => ({ op: 'addClip', trackId: 'B-roll', clip: { id: `p${i}`, type: 'image', assetId: photo.id, start, duration, box: { x: 0.7, y: 0.05, w: 0.25, h: 0.25 } } })),
  ]);
  const { page, shot, finish } = await launch('footage');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="shaky"]').waitFor({ timeout: 20000 });
  const inspect = (id) =>
    page.evaluate((x) => {
      const s = window.cutroom.store.getState();
      s.select([x]);
      s.setRightTab('inspector');
    }, id);
  // the Footage section keeps its open/closed state across clips: open it only when closed
  const openFootage = async () => {
    if (!(await page.getByRole('button', { name: 'Stabilize' }).isVisible())) await page.getByRole('button', { name: 'Footage', exact: true }).click();
  };
  const toast = (text) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first().waitFor({ timeout: 180000 });
  const mediaFile = (p, id) => path.join(DATA, 'projects', pid, 'media', p.assets.find((a) => a.id === id).file);

  // 1) stabilize from the Inspector
  await inspect('shaky');
  await openFootage();
  await page.getByRole('button', { name: 'Stabilize' }).click();
  await toast(/^Stabilized: /);
  let p = await getProject(pid);
  const steady = p.assets.find((a) => a.id === clips(p).find((c) => c.id === 'shaky').assetId);
  check(steady?.derived?.kind === 'stabilized' && /medium/.test(steady.derived.note ?? ''), `the clip shows a stabilized copy (${steady?.derived?.note})`);
  const [before, after] = shake([mediaFile(p, shaky.id), mediaFile(p, steady.id)]);
  check(after < before * 0.4, `the shake drops from ${before}px to ${after}px per frame`);

  // 2) a .cube color look from the Inspector (imported right there)
  const lutFile = path.join(OUT, 'swap-red-blue.cube');
  fs.mkdirSync(OUT, { recursive: true });
  swapLut(lutFile);
  await inspect('th');
  await openFootage();
  await page.locator('input[type="file"][accept=".cube"]').setInputFiles(lutFile);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'swap-red-blue.cube' }) }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Apply the look' }).click();
  await toast(/^Color look: Swap red and blue/);
  p = await getProject(pid);
  const graded = p.assets.find((a) => a.id === clips(p).find((c) => c.id === 'th').assetId);
  check(graded?.derived?.kind === 'lut' && graded.derived.note === 'Swap red and blue', `the clip shows the graded copy ("${graded?.derived?.note}")`);
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const frame = async (t, name) => {
    const r = await call('preview_frames', { times: [t] });
    const f = path.join(OUT, `${name}.jpg`);
    fs.writeFileSync(f, Buffer.from(r.images[0].data, 'base64'));
    return f;
  };
  const face = pixel(await frame(5.5, 'look'), 0.46, 0.25);
  check(face[2] > face[0] + 30, `the face's red and blue are swapped (rgb(${face.join(',')}))`);

  // 3) at half strength through the Director's tool: green (0,177,64) -> halfway to (64,177,0)
  const lutAsset = p.assets.find((a) => a.file.endsWith('.cube'));
  const half = await call('apply_lut', { clipId: 'gs', lutAssetId: lutAsset.id, intensity: 0.5 });
  const corner = pixel(await frame(8.5, 'half'), 0.04, 0.08);
  check(!half.isError && Math.abs(corner[0] - 32) < 14 && Math.abs(corner[2] - 32) < 14 && corner[1] > 150, `at 50% the look is half applied (rgb(${corner.join(',')}))`);

  // 4) beats: find them on the music clip, see them on the timeline
  await inspect('music');
  await page.getByRole('button', { name: 'Find the beats' }).click();
  await page.getByText(/120 BPM · \d+ beats/).waitFor({ timeout: 60000 });
  p = await getProject(pid);
  const a = p.assets.find((x) => x.id === music.id);
  const offGrid = Math.max(...a.analysis.beats.slice(1, -1).map((t) => Math.abs(((t - 0.25 + 0.25) % 0.5) - 0.25)));
  check(Math.abs(a.analysis.tempo - 120) < 2 && offGrid < 0.03, `120 BPM found, beats on the kicks (worst ${Math.round(offGrid * 1000)} ms off)`);
  const ticks = Number(await page.locator('[data-clip-id="music"] [data-beats]').getAttribute('data-beats'));
  check(ticks >= 20, `the music clip shows its beats (${ticks})`);

  // 5) cut the pictures to the beat: select them, right-click, Cut to the beat
  await page.evaluate(() => window.cutroom.store.getState().select(['p0', 'p1', 'p2', 'p3']));
  await page.locator('[data-clip-id="p1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Cut 4 clips to the beat' }).click();
  await toast(/^Cut to the beat: /);
  p = await getProject(pid);
  const pics = clips(p).filter((c) => /^p\d$/.test(c.id)).sort((x, y) => x.start - y.start);
  const onBeat = (t) => Math.abs(((t - 0.25) / 0.5) - Math.round((t - 0.25) / 0.5)) * 0.5;
  check(pics.every((c) => onBeat(c.start) < 0.03 && onBeat(c.start + c.duration) < 0.03), `every picture starts and ends on a beat (${pics.map((c) => `${c.start}+${c.duration}`).join(', ')})`);
  check(pics.every((c, i) => i === 0 || Math.abs(c.start - (pics[i - 1].start + pics[i - 1].duration)) < 0.001), 'back to back');
  await shot('01-on-the-beat');

  // 6) the Director: two beats per picture
  const r = await call('cut_to_beat', { clipIds: ['p0', 'p1', 'p2', 'p3'], every: 2 });
  p = await getProject(pid);
  const twice = clips(p).filter((c) => /^p\d$/.test(c.id));
  check(!r.isError && twice.every((c) => Math.abs(c.duration - 1) < 0.03), `cut_to_beat with every: 2 makes each picture two beats long (${twice.map((c) => c.duration).join(', ')})`);

  // 7) restore the stabilized clip's original
  await inspect('shaky');
  await openFootage();
  await page.getByRole('button', { name: 'Restore the original' }).click();
  await toast(/^Original: /);
  p = await getProject(pid);
  check(clips(p).find((c) => c.id === 'shaky').assetId === shaky.id, 'Restore the original puts the shaky original back');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
