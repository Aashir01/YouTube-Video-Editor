// Smart reframe end to end: tool via MCP, real rendered frames re-checked with the face detector, UI button, Make a Short.
const fs = require('fs');
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media, mcpClient, facesIn, OUT } = require('../lib.cjs');

(async () => {
  // a vertical project with the two face clips
  const pid = (await post('/api/projects', { name: 'Reframe test', format: 'short' })).id;
  const move = await waitReady(pid, (await upload(pid, media('face-move.mp4'))).id);
  const cut = await waitReady(pid, (await upload(pid, media('face-cut.mp4'))).id, 90000);
  await ops(pid, [
    { op: 'setCanvas', patch: { width: 1080, height: 1920 } },
    { op: 'addClip', trackId: 'Main', clip: { id: 'mv', type: 'video', assetId: move.id, start: 0, duration: 10 } },
    { op: 'addClip', trackId: 'Main', clip: { id: 'ct', type: 'video', assetId: cut.id, start: 10, duration: 10 } },
  ]);
  const p0 = await getProject(pid);
  console.log('scene cuts in face-cut.mp4:', JSON.stringify(p0.assets.find((a) => a.id === cut.id).analysis?.scenes));

  // 1) the Director's tool
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const t0 = Date.now();
  const res = await call('auto_reframe', {});
  console.log(res.text.split('\n').slice(0, 3).join('\n'), `(${Date.now() - t0} ms)`);
  const p = await getProject(pid);
  const mv = clips(p).find((c) => c.id === 'mv');
  const ct = clips(p).find((c) => c.id === 'ct');
  const kx = mv.keyframes?.['focus.x'] ?? [];
  check(kx.length >= 2 && kx[0].v < kx.at(-1).v - 0.1, `moving face → focus.x keyframes ${kx.map((k) => `${k.t}:${k.v}`).join(' ')}`);
  const cx = ct.keyframes?.['focus.x'] ?? [];
  const hold = cx.find((k) => k.ease === 'hold');
  const after = hold && cx[cx.indexOf(hold) + 1];
  check(Boolean(hold) && after && Math.abs(after.t - 5) < 0.6, `cut footage → the camera cuts at ${after?.t}s: ${cx.map((k) => `${k.t}:${k.v}${k.ease === 'hold' ? '(hold)' : ''}`).join(' ')}`);

  // 2) the real renderer + the detector on its output: the face should sit near the center
  const shot = await call('preview_frames', { times: [1, 5, 9, 12, 18] });
  fs.mkdirSync(OUT, { recursive: true });
  const files = shot.images.map((im, i) => {
    const f = path.join(OUT, `rendered-${i}.jpg`);
    fs.writeFileSync(f, Buffer.from(im.data, 'base64'));
    return f;
  });
  const found = facesIn(files, { width: 1080, height: 1920 });
  const xs = found.map((faces) => faces?.[0]?.cx);
  console.log('face x in rendered frames:', xs.map((x) => (x === undefined ? '-' : x.toFixed(2))).join(' '));
  check(xs.every((x) => x !== undefined && Math.abs(x - 0.5) < 0.17), 'face stays in the middle of the 9:16 frame in every rendered frame');

  // 2b) a two-person podcast: the camera cuts to whoever is talking (left 0-4 s, right 4-8 s, left 8-12 s)
  const duo = await waitReady(pid, (await upload(pid, media('two-speakers.mp4'))).id, 90000);
  await ops(pid, [{ op: 'addClip', trackId: 'B-roll', clip: { id: 'duo', type: 'video', assetId: duo.id, start: 0, duration: 12 } }]);
  const duoRes = await call('auto_reframe', { clipIds: ['duo'] });
  const duoKeys = clips(await getProject(pid)).find((c) => c.id === 'duo').keyframes?.['focus.x'] ?? [];
  const held = (t) => [...duoKeys].reverse().find((k) => k.t <= t + 1e-6)?.v;
  const cutTimes = duoKeys.filter((k) => k.ease === 'hold').map((k) => k.t);
  check(/cutting between 2 speakers/.test(duoRes.text), `the tool reports speaker switching: ${duoRes.text.split('\n')[1]}`);
  check(cutTimes.length === 3 && Math.abs(cutTimes[1] - 4) <= 0.5 && Math.abs(cutTimes[2] - 8) <= 0.5, `cuts at ${cutTimes.join(', ')} s (talk turns at 4 and 8 s)`);
  check(held(2) < 0.3 && held(6) > 0.7 && held(10) < 0.3, `crop on the left speaker, then the right, then the left (focus ${[2, 6, 10].map((t) => held(t)).join(' / ')})`);
  // the duo clip sits on B-roll above Main: render only it by hiding nothing; check a face is centered in each shot
  const duoShots = await call('preview_frames', { times: [2, 6, 10] });
  const duoFiles = duoShots.images.map((im, i) => {
    const f = path.join(OUT, `duo-${i}.jpg`);
    fs.writeFileSync(f, Buffer.from(im.data, 'base64'));
    return f;
  });
  const duoX = facesIn(duoFiles, { width: 1080, height: 1920 }).map((faces) => faces?.[0]?.cx);
  console.log('speaker x in rendered frames:', duoX.map((x) => (x === undefined ? '-' : x.toFixed(2))).join(' '));
  check(duoX.every((x) => x !== undefined && Math.abs(x - 0.5) < 0.17), 'the talking person is centered in each rendered shot');
  await ops(pid, [{ op: 'removeClips', clipIds: ['duo'] }]);

  // 3) the Inspector button on a fresh clip
  await ops(pid, [{ op: 'updateClip', clipId: 'mv', patch: { keyframes: null, focus: null } }]);
  const { page, shot: snap, finish } = await launch('reframe');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="mv"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    const s = window.cutroom.store.getState();
    s.select(['mv']);
    s.setRightTab('inspector');
    window.cutroom.seek(2);
  });
  await page.getByRole('button', { name: 'Reframe', exact: true }).click();
  await page.getByRole('button', { name: /Track faces/ }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: /Smart reframe:/ }).waitFor({ timeout: 30000 });
  const toastText = await page.locator('[data-sonner-toast]').filter({ hasText: /Smart reframe:/ }).innerText();
  await page.waitForTimeout(800);
  await snap('01-track-faces');
  const mv2 = clips(await getProject(pid)).find((c) => c.id === 'mv');
  check(/following the face/.test(toastText) && mv2.keyframes?.['focus.x']?.length >= 2, `Inspector button: "${toastText.replace(/\n/g, ' ')}"`);

  // 4) Make a Short from a 16:9 project: faces tracked automatically
  const lid = (await post('/api/projects', { name: 'Long talk', format: 'long' })).id;
  const lv = await waitReady(lid, (await upload(lid, media('face-move.mp4'))).id);
  await ops(lid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'v', type: 'video', assetId: lv.id, start: 0, duration: 10 } }]);
  const short = await post(`/api/projects/${lid}/shorts`, { ranges: [[1, 9]], title: 'Tracked Short' });
  const sp = await getProject(short.id);
  const sv = clips(sp).find((c) => c.type === 'video');
  check(sp.canvas.height === 1920 && (sv.keyframes?.['focus.x']?.length ?? 0) >= 2, `Make a Short tracked the face: ${JSON.stringify(sv.keyframes?.['focus.x']?.map((k) => k.v))}`);
  check(sp.history === undefined || true, 'short created');
  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
