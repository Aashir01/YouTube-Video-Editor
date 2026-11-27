// Keyframes: ◆ buttons, auto-key from fields and canvas drags, timeline diamonds, easing menu, presets, agent ops.
const fs = require('fs');
const path = require('path');
const { BASE, api, post, upload, waitReady, ops, getProject, clips, check, launch, media, mcpClient, pixel, OUT } = require('../lib.cjs');



(async () => {
  const pid = (await post('/api/projects', { name: 'Keyframes test', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  const image = await waitReady(pid, (await upload(pid, media('photo.png'))).id);
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 10 } },
    { op: 'addClip', trackId: 'B-roll', clip: { id: 'pip', type: 'image', assetId: image.id, start: 0, duration: 8, box: { x: 0.64, y: 0.05, w: 0.3, h: 0.3 } } },
    { op: 'addClip', trackId: 'Graphics', clip: { id: 'txt', type: 'text', text: 'Hello keyframes', start: 0, duration: 8, x: 0.3, y: 0.7, animationIn: 'none', animationOut: 'none' } },
  ]);
  const clipOf = async (id) => clips(await getProject(pid)).find((c) => c.id === id);

  const { page, shot, finish } = await launch('keyframes');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-box="pip"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const seek = async (t) => {
    await page.evaluate((x) => window.cutroom.seek(x), t);
    await page.waitForTimeout(450);
  };
  const pipLeft = async () => {
    const frame = await page.locator('[data-clip-box="vid"]').boundingBox();
    const b = await page.locator('[data-clip-box="pip"]').boundingBox();
    return (b.x - frame.x) / frame.width;
  };

  // 1) ◆ next to X starts an animation at the playhead
  await page.evaluate(() => {
    const s = window.cutroom.store.getState();
    s.select(['pip']);
    s.setRightTab('inspector');
  });
  await seek(1);
  await page.locator('[data-kf-button="box.x"]').click();
  await page.waitForTimeout(700);
  let c = await clipOf('pip');
  check(c.keyframes?.['box.x']?.length === 1 && Math.abs(c.keyframes['box.x'][0].t - 1) < 0.01 && Math.abs(c.keyframes['box.x'][0].v - 0.64) < 1e-3, `◆ added a keyframe at 1s: ${JSON.stringify(c.keyframes)}`);

  // 2) typing a value elsewhere in time auto-keys
  await seek(3);
  const xInput = page.locator('label:has([data-kf-button="box.x"]) input');
  await xInput.fill('0.2');
  await xInput.press('Enter');
  await page.waitForTimeout(900);
  c = await clipOf('pip');
  const k = c.keyframes['box.x'];
  check(k.length === 2 && Math.abs(k[1].t - 3) < 0.01 && Math.abs(k[1].v - 0.2) < 1e-3 && c.box.x === 0.64, `typed value became a keyframe at 3s (static x kept ${c.box.x})`);
  check((await page.locator('[data-kf-button="box.x"]').getAttribute('aria-pressed')) === 'true', '◆ shows filled on a keyframe');

  // 3) the picture really moves: half-way at 2s (ease-in-out is symmetric)
  await seek(2);
  const mid = await pipLeft();
  check(Math.abs(mid - 0.42) < 0.015, `PiP half-way at 2s: left ${mid.toFixed(3)} (expect 0.420)`);
  await seek(5);
  check(Math.abs((await pipLeft()) - 0.2) < 0.015, 'PiP holds the last keyframe after it');
  await shot('01-inspector');

  // 4) timeline diamonds: two, drag the second one 1s later
  const diamonds = page.locator('[data-clip-id="pip"] [data-kf-time]');
  check((await diamonds.count()) === 2, `two diamonds on the clip (${await diamonds.count()})`);
  const blk = await page.locator('[data-clip-id="pip"]').boundingBox();
  const pps = blk.width / 8;
  const d2 = await diamonds.nth(1).boundingBox();
  await page.mouse.move(d2.x + d2.width / 2, d2.y + d2.height / 2);
  await page.mouse.down();
  await page.mouse.move(d2.x + d2.width / 2 + pps, d2.y + d2.height / 2, { steps: 6 });
  await shot('02-drag-diamond');
  await page.mouse.up();
  await page.waitForTimeout(900);
  c = await clipOf('pip');
  check(Math.abs(c.keyframes['box.x'][1].t - 4) < 0.05, `diamond dragged to ${c.keyframes['box.x'][1].t}s (expect ~4)`);

  // 5) right-click the first diamond: easing
  await diamonds.nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Linear' }).waitFor({ timeout: 3000 });
  await shot('03-easing-menu');
  await page.getByRole('menuitem', { name: 'Linear' }).click();
  await page.waitForTimeout(900);
  c = await clipOf('pip');
  check(c.keyframes['box.x'][0].ease === 'linear', `easing set from the timeline menu (${c.keyframes['box.x'][0].ease})`);

  // 6) dragging the animated PiP on the canvas auto-keys at the playhead; one undo removes it
  await seek(6);
  const pb = await page.locator('[data-clip-box="pip"]').boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width / 2 + 80, pb.y + pb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  c = await clipOf('pip');
  const k3 = c.keyframes['box.x'];
  check(k3.length === 3 && Math.abs(k3[2].t - 6) < 0.01 && k3[2].v > 0.25 && c.box.x === 0.64, `canvas drag added a keyframe at 6s (v ${k3[2]?.v}), static x unchanged`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1300);
  c = await clipOf('pip');
  check(c.keyframes['box.x'].length === 2, 'one Ctrl+Z undoes the canvas keyframe');

  // 7) preset on the text: Fade in, and the rendered opacity follows the ease-out curve
  await page.evaluate(() => window.cutroom.store.getState().select(['txt']));
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Animation/ }).click();
  await page.getByRole('button', { name: 'Fade in', exact: true }).click();
  await page.waitForTimeout(900);
  c = await clipOf('txt');
  check(JSON.stringify(c.keyframes?.opacity) === JSON.stringify([{ t: 0, v: 0, ease: 'ease-out' }, { t: 0.5, v: 1 }]), `Fade in preset: ${JSON.stringify(c.keyframes?.opacity)}`);
  await seek(0.25);
  const op = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-clip-box="txt"]').parentElement.parentElement).opacity));
  check(Math.abs(op - 0.875) < 0.04, `text opacity at 0.25s = ${op.toFixed(3)} (ease-out → 0.875)`);
  await shot('04-text-preset');

  // 8) the Director's edit tool (through MCP, the same tools external agents get)
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const pushed = await call('apply_edits', {
    label: 'Push in',
    ops: [
      { op: 'setKeyframe', clipId: 'vid', time: 0, values: { scale: 1 }, ease: 'linear' },
      { op: 'setKeyframe', clipId: 'vid', time: 5, values: { scale: 1.3 } },
    ],
  });
  c = await clipOf('vid');
  check(c.keyframes?.scale?.length === 2 && c.keyframes.scale[1].v === 1.3, 'agent apply_edits set keyframes');
  const bad = await call('apply_edits', { label: 'x', ops: [{ op: 'setKeyframe', clipId: 'txt', time: 0, values: { volume: 1 } }] });
  check(bad.isError && /Animatable: x, y/.test(bad.text), `wrong channel explains what is animatable: ${bad.text.slice(0, 150)}`);
  check(/animated scale×2/.test(pushed.text), 'the edit result tells the Director what is animated');
  const tl = await call('get_timeline', { types: ['video'] });
  check(/"keyframes"/.test(tl.text), 'get_timeline shows the keyframes themselves');

  // 9) the real renderer animates too: the PiP is at 0.64 at 1 s and at 0.2 at 4 s
  const rendered = await call('preview_frames', { times: [1, 4] });
  const files = rendered.images.map((im, i) => {
    const f = path.join(OUT, `rendered-${i}.jpg`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(f, Buffer.from(im.data, 'base64'));
    return f;
  });
  const pipBlue = (rgb) => Math.abs(rgb[0] - 43) + Math.abs(rgb[1] - 106) + Math.abs(rgb[2] - 177) < 60;
  check(
    files.length === 2 && pipBlue(pixel(files[0], 0.79, 0.2)) && !pipBlue(pixel(files[0], 0.35, 0.2)) && pipBlue(pixel(files[1], 0.35, 0.2)) && !pipBlue(pixel(files[1], 0.79, 0.2)),
    'rendered frames: the picture-in-picture moved from 0.64 (1 s) to 0.2 (4 s)',
  );

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
