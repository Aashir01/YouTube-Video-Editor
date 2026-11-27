// Recording (fake mic/camera) and speech enhancement.
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media } = require('../lib.cjs');

const waitFor = async (fn, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
};

(async () => {
  const pid = (await post('/api/projects', { name: 'Record test', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 10 } }]);

  const { page, shot, finish } = await launch('record');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.cutroom.seek(2));

  // --- voiceover from the Audio panel
  await page.getByRole('button', { name: /^Audio$/ }).click();
  await page.getByRole('button', { name: /Record your voice/ }).click();
  const startBtn = page.getByRole('button', { name: /Start recording/ });
  await startBtn.waitFor();
  await page.waitForFunction(() => !document.querySelector('button.btn-primary[disabled]') || ![...document.querySelectorAll('button')].find((b) => /Start recording/.test(b.textContent) && b.disabled), null, { timeout: 15000 });
  await shot('01-voice-setup');
  await startBtn.click();
  await page.getByText(/REC 0:0/).waitFor({ timeout: 10000 });
  await page.waitForTimeout(2600);
  await shot('02-voice-recording');
  await page.getByRole('button', { name: /^Stop$/ }).click();
  await page.getByRole('button', { name: /Use this take/ }).waitFor({ timeout: 10000 });
  await shot('03-voice-review');
  await page.getByRole('button', { name: /Use this take/ }).click();
  const vo = await waitFor(async () => clips(await getProject(pid)).find((c) => c.type === 'audio' && c.role === 'voiceover'), 60000);
  check(Boolean(vo), `voice take placed on ${vo?.track} at ${vo?.start}s, ${vo?.duration}s long`);
  check(vo && Math.abs(vo.start - 2) < 0.05 && vo.duration > 1.5 && vo.duration < 5, 'voice take starts at the playhead with the recorded length');
  let p = await getProject(pid);
  const rec = p.assets.find((a) => a.name.startsWith('Voiceover recording'));
  check(rec && rec.meta.duration > 1.5, `recording has a real duration after remux: ${rec?.meta.duration}s (${rec?.file})`);

  // --- camera from the Media panel's record menu (Main is busy -> picture-in-picture on B-roll)
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 20000 }).catch(async () => {
    await shot('debug-dialog-still-open');
    console.log('dialog did not close');
  });
  await page.getByRole('button', { name: /^Media/ }).first().click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('menuitem', { name: /Record camera/ }).click();
  await page.getByRole('button', { name: /Start recording/ }).waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Start recording/ }).click();
  await page.getByText(/REC 0:0/).waitFor({ timeout: 10000 });
  await page.waitForTimeout(2200);
  await shot('04-camera-recording');
  await page.getByRole('button', { name: /^Stop$/ }).click();
  await page.getByRole('button', { name: /Use this take/ }).click();
  const cam = await waitFor(async () => clips(await getProject(pid)).find((c) => c.type === 'video' && c.id !== 'vid'), 60000);
  check(cam && cam.track === 'B-roll' && cam.box, `camera take became a PiP on ${cam?.track} ${JSON.stringify(cam?.box)}`);

  // --- enhance speech on the footage from the asset menu
  await page.waitForTimeout(500);
  const card = page.locator('div.group', { hasText: 'talk.mp4' }).first();
  await card.hover();
  await card.getByRole('button', { name: 'Asset menu' }).click();
  await page.getByRole('menuitem', { name: /Enhance speech/ }).click();
  const enhanced = await waitFor(async () => (await getProject(pid)).assets.find((a) => a.name.includes('(enhanced)') && a.status === 'ready'), 90000);
  check(Boolean(enhanced), `enhanced asset created: ${enhanced?.name}`);
  await page.waitForTimeout(1000);
  p = await getProject(pid);
  const main = clips(p).find((c) => c.id === 'vid');
  check(enhanced && main.assetId === enhanced.id, 'Main clip switched to the enhanced footage');
  check(enhanced && Math.abs(enhanced.meta.duration - video.meta.duration) < 0.15, `same length as the original (${enhanced?.meta.duration} vs ${video.meta.duration})`);
  await shot('05-after');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
