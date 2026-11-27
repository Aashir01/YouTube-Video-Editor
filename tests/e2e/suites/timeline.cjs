// Timeline pro features: filmstrip, marquee, copy/paste, nudge, markers, edit points, range ops, ripple trim, envelope, shuttle.
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media } = require('../lib.cjs');

(async () => {
  const pid = (await post('/api/projects', { name: 'Timeline test', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  const voice = await waitReady(pid, (await upload(pid, media('voice.m4a'))).id);
  check(Boolean(video.filmstrip?.file), `filmstrip generated: ${JSON.stringify(video.filmstrip)}`);
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 10 } },
    { op: 'addClip', trackId: 'Voiceover', clip: { id: 'vo', type: 'audio', role: 'voiceover', assetId: voice.id, start: 0, duration: 6 } },
    { op: 'addClip', trackId: 'Graphics', clip: { id: 'txt', type: 'text', text: 'Copy me', start: 1, duration: 2 } },
  ]);

  const { page, shot, finish } = await launch('timeline');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const seekTo = async (t) => {
    await page.evaluate((t) => window.cutroom.seek(t), t);
    await page.waitForTimeout(250);
  };
  const time = () => page.evaluate(() => window.cutroom.state().time);

  // filmstrip tiles render from the sprite
  const tiles = await page.locator('[data-clip-id="vid"] div[style*="strip.jpg"]').count();
  check(tiles > 3, `filmstrip tiles on the clip: ${tiles}`);

  // marquee over the Graphics + Voiceover lanes selects the text and the voice clip
  const gfx = await page.locator('[data-track-name="Graphics"]').boundingBox();
  const vo = await page.locator('[data-track-name="Voiceover"]').boundingBox();
  const txtBox = await page.locator('[data-clip-id="txt"]').boundingBox();
  await page.mouse.move(txtBox.x + txtBox.width + 30, gfx.y + 4);
  await page.mouse.down();
  await page.mouse.move(txtBox.x - 10, vo.y + vo.height - 4, { steps: 10 });
  await shot('01-marquee');
  await page.mouse.up();
  await page.waitForTimeout(200);
  const selCount = await page.evaluate(() => window.cutroom.state().selection.length);
  check(selCount === 2, `marquee selected ${selCount} clips`);

  // copy / paste the text clip at 12s (past the end of the video)
  await page.keyboard.press('Escape');
  await page.locator('[data-clip-id="txt"]').click();
  await page.keyboard.press('Control+c');
  await seekTo(12);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(900);
  let p = await getProject(pid);
  const pasted = clips(p).filter((c) => c.type === 'text');
  check(pasted.length === 2 && pasted.some((c) => Math.abs(c.start - 12) < 0.01), `pasted text at 12s: ${pasted.map((c) => c.start)}`);

  // nudge the original text by one frame
  await page.locator('[data-clip-id="txt"]').click();
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(900);
  p = await getProject(pid);
  const nudged = clips(p).find((c) => c.id === 'txt');
  check(Math.abs(nudged.start - (1 + 1 / 30)) < 0.002, `nudged by a frame: ${nudged.start}`);

  // marker at 3s, then edit-point navigation
  await page.keyboard.press('Escape');
  await seekTo(3);
  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  p = await getProject(pid);
  check(p.markers.length === 1 && Math.abs(p.markers[0].time - 3) < 0.05, `marker added at ${p.markers[0]?.time}`);
  await seekTo(0.5);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const t1 = await time();
  check(Math.abs(t1 - (1 + 1 / 30)) < 0.05, `↓ jumps to the next edit point (${t1})`);

  // envelope: drag the voice clip's volume line up, then its fade-in handle right
  await page.locator('[data-clip-id="vo"]').click({ position: { x: 40, y: 8 } });
  await page.waitForTimeout(300);
  const voBox = await page.locator('[data-clip-id="vo"]').boundingBox();
  const line = page.locator('[data-clip-id="vo"] div[title^="Volume"]');
  const lb = await line.boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width / 2, voBox.y + 6, { steps: 6 });
  await shot('02-volume-drag');
  await page.mouse.up();
  await page.waitForTimeout(700);
  const fadeHandle = page.locator('[data-clip-id="vo"] div[title^="Fade in"]');
  const fb = await fadeHandle.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb.x + 60, fb.y + fb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  p = await getProject(pid);
  const voClip = clips(p).find((c) => c.id === 'vo');
  check(voClip.volume > 1.3, `volume dragged up: ${voClip.volume}`);
  check(voClip.fadeIn > 0.3, `fade-in dragged: ${voClip.fadeIn}s`);

  // ripple trim the start of the video at 1s (Q)
  await page.keyboard.press('Escape');
  await seekTo(1);
  const before = (await getProject(pid)).tracks.find((t) => t.name === 'Main').clips[0];
  await page.keyboard.press('q');
  await page.waitForTimeout(900);
  p = await getProject(pid);
  const v1 = p.tracks.find((t) => t.name === 'Main').clips[0];
  check(Math.abs(v1.trimStart - 1) < 0.01 && v1.start === 0 && Math.abs(v1.duration - (before.duration - 1)) < 0.01, `Q ripple-trims: trimStart ${v1.trimStart}, duration ${before.duration} -> ${v1.duration}`);

  // in/out range 2s-4s, then delete it
  await seekTo(2);
  await page.keyboard.press('i');
  await seekTo(4);
  await page.keyboard.press('o');
  await page.waitForTimeout(300);
  await shot('03-range');
  const dur0 = (await getProject(pid)).tracks.find((t) => t.name === 'Main').clips.reduce((n, c) => n + c.duration, 0);
  await page.getByRole('button', { name: 'Delete range' }).click();
  await page.waitForTimeout(900);
  p = await getProject(pid);
  const dur1 = p.tracks.find((t) => t.name === 'Main').clips.reduce((n, c) => n + c.duration, 0);
  check(Math.abs(dur0 - dur1 - 2) < 0.01, `range delete removed 2s from Main (${dur0} -> ${dur1})`);

  // J/K/L shuttle
  await seekTo(0);
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  await page.keyboard.press('l');
  await page.waitForTimeout(200);
  const rate = await page.evaluate(() => window.cutroom.state().playbackRate);
  await page.keyboard.press('k');
  await page.waitForTimeout(200);
  const rateAfter = await page.evaluate(() => window.cutroom.state().playbackRate);
  check(rate === 2 && rateAfter === 1, `shuttle L,L -> ${rate}×, K -> ${rateAfter}×`);

  // compact tracks
  const h0 = (await page.locator('[data-track-name="Main"]').boundingBox()).height;
  await page.getByRole('button', { name: 'Track height' }).click();
  await page.getByRole('menuitem', { name: /Compact tracks/ }).click();
  await page.waitForTimeout(300);
  const h1 = (await page.locator('[data-track-name="Main"]').boundingBox()).height;
  check(h1 < h0, `compact tracks: ${h0}px -> ${h1}px`);
  await shot('04-final');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
