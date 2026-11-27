// Motion tracking: blur every face, make a label follow a face, make a blur box track what is under it, add a blur box.
const fs = require('fs');
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media, mcpClient, facesIn, OUT } = require('../lib.cjs');

// in face-move.mp4 the face starts at x≈0.214 (y≈0.366) and moves right by ≈0.0573 of the width per second
const faceX = (t) => 0.214 + 0.0573 * t;
const valueAt = (keys, t) => {
  if (!keys?.length) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t); // tracked paths are linear
  }
  return keys[keys.length - 1].v;
};

(async () => {
  const pid = (await post('/api/projects', { name: 'Tracking test', format: 'long' })).id;
  const v = await waitReady(pid, (await upload(pid, media('face-move.mp4'))).id);
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: v.id, start: 0, duration: 10 } }]);
  const call = await mcpClient();
  await call('select_project', { projectId: pid });

  const { page, shot, finish } = await launch('tracking');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  const inspect = (id) =>
    page.evaluate((x) => {
      const s = window.cutroom.store.getState();
      s.select([x]);
      s.setRightTab('inspector');
    }, id);
  const toastWith = async (re) => {
    const t = page.locator('[data-sonner-toast]').filter({ hasText: re });
    await t.first().waitFor({ timeout: 60000 });
    return t.first().innerText();
  };

  // what the face detector sees in rendered frames before anything is blurred
  const renderFaces = async (name) => {
    const r = await call('preview_frames', { times: [1, 5, 9] });
    fs.mkdirSync(OUT, { recursive: true });
    const files = r.images.map((im, i) => {
      const f = path.join(OUT, `${name}-${i}.jpg`);
      fs.writeFileSync(f, Buffer.from(im.data, 'base64'));
      return f;
    });
    return facesIn(files, { width: 1920, height: 1080 }).map((faces) => Math.max(0, ...(faces ?? []).map((f) => f.score)));
  };
  const sharp = await renderFaces('sharp');

  // 1) Blur faces from the Inspector (Privacy section)
  await inspect('vid');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await page.getByRole('button', { name: /^Blur faces/ }).click();
  const blurToast = await toastWith(/Blur faces:/);
  let p = await getProject(pid);
  const blurs = clips(p).filter((c) => c.type === 'blur');
  const bx = blurs[0]?.keyframes?.['box.x'] ?? [];
  check(/blurred 1 face/.test(blurToast) && blurs.length === 1 && blurs[0].track === 'Blur', `one face blurred on a Blur track: "${blurToast.replace(/\n/g, ' ')}"`);
  check(bx.length >= 2 && bx.at(-1).v - bx[0].v > 0.3, `the blur follows the face (box.x ${bx[0]?.v} → ${bx.at(-1)?.v})`);
  await page.waitForTimeout(500);
  await shot('01-blur-faces');
  const blurred = await renderFaces('blurred');
  // a blurred face can still read as a face-shaped blob; it must lose the detector's confidence
  check(sharp.every((s) => s > 0.85) && blurred.every((s) => s < 0.8), `rendered faces lose the detector's confidence: sharp ${sharp.map((s) => s.toFixed(2)).join('/')} → blurred ${blurred.map((s) => s.toFixed(2)).join('/')}`);
  check(bx.length <= 12, `the blur path is a handful of keyframes, not one per frame (${bx.length})`);
  await ops(pid, [{ op: 'removeClips', clipIds: blurs.map((c) => c.id) }]);

  // 2) a name label above the head follows the face (Inspector → Motion tracking)
  await ops(pid, [{ op: 'addClip', trackId: 'Graphics', clip: { id: 'label', type: 'text', text: 'Astronaut', start: 0, duration: 10, x: 0.214, y: 0.22, animationIn: 'none', animationOut: 'none', style: { size: 60 } } }]);
  await page.waitForTimeout(400);
  await inspect('label');
  await page.getByRole('button', { name: 'Motion tracking', exact: true }).click();
  await page.getByRole('button', { name: /Follow a face/ }).click();
  const followToast = await toastWith(/Motion tracking:/);
  p = await getProject(pid);
  const lx = clips(p).find((c) => c.id === 'label').keyframes?.x;
  const err = [1, 4, 8].map((t) => Math.abs(valueAt(lx, t) - faceX(t)));
  check(/following the face/.test(followToast) && err.every((e) => e < 0.03), `the label stays above the face (errors ${err.map((e) => e.toFixed(3)).join(', ')})`);
  await page.evaluate(() => window.cutroom.seek(7));
  await page.waitForTimeout(500);
  await shot('02-label-follows');

  // 3) a blur box placed over the face at its first frame tracks what is under it
  await ops(pid, [
    { op: 'removeClips', clipIds: ['label'] },
    { op: 'addClip', clip: { id: 'plate', type: 'blur', start: 0, duration: 10, box: { x: 0.18, y: 0.28, w: 0.07, h: 0.17 } } },
  ]);
  const under = await call('track_motion', { clipId: 'plate', target: 'under' });
  p = await getProject(pid);
  const plate = clips(p).find((c) => c.id === 'plate');
  const centers = [2, 5, 8].map((t) => valueAt(plate.keyframes?.['box.x'], t) + 0.035);
  check(/what is under it/.test(under.text) && centers.every((c, i) => Math.abs(c - faceX([2, 5, 8][i])) < 0.03), `the box tracks what is under it (centers ${centers.map((c) => c.toFixed(3)).join(', ')})`);

  // 4) the Graphics panel adds a blur box on the Blur track, and it can be dragged on the canvas
  await page.evaluate(() => window.cutroom.seek(2));
  await shot('03a-before-graphics');
  await page.getByRole('button', { name: 'Graphics', exact: true }).click();
  await page.getByRole('button', { name: /Blur box/ }).click();
  await page.waitForTimeout(900);
  p = await getProject(pid);
  const added = clips(p).find((c) => c.type === 'blur' && c.id !== 'plate');
  check(added && added.track === 'Blur' && Math.abs(added.start - 2) < 0.05, `Blur box card adds a blur at the playhead on the Blur track (${added?.track} @ ${added?.start})`);
  const box = await page.locator(`[data-clip-box="${added.id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const moved = clips(await getProject(pid)).find((c) => c.id === added.id);
  check(moved.box.x > added.box.x + 0.02, `blur box dragged on the canvas (x ${added.box.x} → ${moved.box.x})`);
  await shot('03-blur-box');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
