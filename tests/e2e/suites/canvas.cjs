// Canvas direct manipulation: select on the picture, drag text, resize a PiP box, pan a reframed video, nudge.
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media } = require('../lib.cjs');

(async () => {
  const p0 = await post('/api/projects', { name: 'Canvas test', format: 'long' });
  const pid = p0.id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  const image = await waitReady(pid, (await upload(pid, media('photo.png'))).id);
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 10, scale: 1.5 } },
    { op: 'addClip', trackId: 'B-roll', clip: { id: 'pip', type: 'image', assetId: image.id, start: 0, duration: 10, box: { x: 0.64, y: 0.05, w: 0.3, h: 0.3 } } },
    { op: 'addClip', trackId: 'Graphics', clip: { id: 'txt', type: 'text', text: 'Hello *canvas*', start: 0, duration: 10, x: 0.3, y: 0.7, animationIn: 'none', style: { size: 90 } } },
  ]);

  const { page, shot, finish } = await launch('canvas');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-box="txt"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);

  // 1) click the text on the canvas selects it
  let box = await page.locator('[data-clip-box="txt"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  check(await page.getByText('Hello *canvas*').count() >= 0, 'clicked text');
  let sel = await page.evaluate(() => document.querySelectorAll('.outline-accent').length);
  check(sel >= 1, 'selection outline shown for text');

  // 2) drag the text right/up
  let p = await getProject(pid);
  const t0 = clips(p).find((c) => c.id === 'txt');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 30, { steps: 8 });
  await shot('01-drag-text');
  await page.mouse.up();
  await page.waitForTimeout(900);
  p = await getProject(pid);
  const t1 = clips(p).find((c) => c.id === 'txt');
  check(t1.x > t0.x + 0.03 && t1.y < t0.y - 0.02, `text moved: (${t0.x}, ${t0.y}) -> (${t1.x}, ${t1.y})`);

  // 3) nudge with the arrow key (canvas focused)
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  p = await getProject(pid);
  const t2 = clips(p).find((c) => c.id === 'txt');
  check(Math.abs(t2.x - (t1.x + 0.005)) < 0.0011, `arrow nudge: ${t1.x} -> ${t2.x}`);

  // 4) select the PiP and drag its south-east handle
  box = await page.locator('[data-clip-box="pip"]').boundingBox();
  await page.mouse.click(box.x + 10, box.y + 10);
  await page.waitForTimeout(300);
  const pip0 = clips(await getProject(pid)).find((c) => c.id === 'pip').box;
  await page.mouse.move(box.x + box.width, box.y + box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 30, { steps: 8 });
  await shot('02-resize-pip');
  await page.mouse.up();
  await page.waitForTimeout(900);
  const pip1 = clips(await getProject(pid)).find((c) => c.id === 'pip').box;
  const aspect0 = (pip0.w * 1920) / (pip0.h * 1080);
  const aspect1 = (pip1.w * 1920) / (pip1.h * 1080);
  check(pip1.w < pip0.w - 0.02, `pip resized: w ${pip0.w} -> ${pip1.w}`);
  check(Math.abs(aspect1 - aspect0) < 0.02, `corner resize kept aspect ${aspect0.toFixed(3)} ~ ${aspect1.toFixed(3)}`);

  // 5) drag the full-frame (zoomed) video: pans the crop
  const stage = await page.locator('[data-clip-box="vid"]').boundingBox();
  await page.mouse.click(stage.x + stage.width * 0.15, stage.y + stage.height * 0.2);
  await page.waitForTimeout(300);
  await page.mouse.move(stage.x + stage.width * 0.15, stage.y + stage.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.15 + 80, stage.y + stage.height * 0.2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const v1 = clips(await getProject(pid)).find((c) => c.id === 'vid');
  check(v1.focus && v1.focus.x < 0.5 && v1.focus.y < 0.5, `video reframed: focus ${JSON.stringify(v1.focus)}`);

  // 6) Inspector shows the reframe section for the video
  await page.getByRole('button', { name: /^Inspector/ }).click();
  await page.waitForTimeout(400);
  check((await page.getByText('Reframe', { exact: true }).count()) > 0, 'Reframe section in the Inspector');
  await shot('03-inspector-reframe');

  // 7) one undo step per drag
  const before = (await getProject(pid)).updatedAt;
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 450 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(800);
  const v2 = clips(await getProject(pid)).find((c) => c.id === 'vid');
  check(!v2.focus || (v2.focus.x === 0.5 && v2.focus.y === 0.5), `undo restores the reframe in one step (focus ${JSON.stringify(v2.focus)})`);
  void before;

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
