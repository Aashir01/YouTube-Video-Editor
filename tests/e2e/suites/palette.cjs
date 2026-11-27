// Command palette, shortcuts sheet, slash briefs, undo history, save state.
const path = require('path');
const { BASE, post, upload, waitReady, ops, getProject, clips, check, launch, media } = require('../lib.cjs');

(async () => {
  const pid = (await post('/api/projects', { name: 'Palette test', format: 'long' })).id;
  const video = await waitReady(pid, (await upload(pid, media('talk.mp4'))).id);
  await ops(pid, [
    { op: 'addClip', trackId: 'Main', clip: { id: 'vid', type: 'video', assetId: video.id, start: 0, duration: 10 } },
    { op: 'addClip', trackId: 'Graphics', clip: { id: 'hello', type: 'text', text: 'Hello palette', start: 6, duration: 2 } },
  ]);

  const { page, shot, finish } = await launch('palette');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => {
    const s = window.cutroom.state();
    return { time: s.time, selection: s.selection };
  });

  // go to a time
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(/Type a command/);
  await input.waitFor();
  await shot('01-palette-empty');
  await input.fill('3.5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check(Math.abs((await state()).time - 3.5) < 0.05, `palette "3.5" -> playhead ${(await state()).time}`);

  // run a command: split at the playhead
  await page.keyboard.press('Control+k');
  await input.fill('split');
  await page.waitForTimeout(150);
  await shot('02-palette-split');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  let p = await getProject(pid);
  check(p.tracks.find((t) => t.name === 'Main').clips.length === 2, 'palette "split" split the clip at 3.5s');

  // find a clip by its text
  await page.keyboard.press('Control+k');
  await input.fill('hello pal');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const st = await state();
  check(st.selection[0] === 'hello' && Math.abs(st.time - 6) < 0.05, `palette found the clip: selection ${st.selection}, playhead ${st.time.toFixed(2)}`);

  // shortcuts sheet with "?"
  await page.locator('body').click({ position: { x: 5, y: 450 } });
  await page.keyboard.press('Shift+?');
  await page.getByText('Keyboard shortcuts', { exact: true }).waitFor({ timeout: 5000 });
  await shot('03-shortcuts');
  check(true, 'shortcuts sheet opens with ?');
  await page.keyboard.press('Escape');

  // save state appears after an edit
  await page.keyboard.press('m');
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 });
  check(true, 'save state shows "Saved" after an edit');

  // undo history: two steps back (marker, split)
  await page.getByRole('button', { name: 'Undo history' }).click();
  await page.waitForTimeout(200);
  await shot('04-history');
  await page.getByRole('button', { name: /Split clip/ }).click();
  await page.waitForTimeout(1500);
  p = await getProject(pid);
  check(p.markers.length === 0 && p.tracks.find((t) => t.name === 'Main').clips.length === 1, 'history menu undid back to before the split');

  // slash briefs in the composer
  await page.getByRole('button', { name: /^Director/ }).click();
  const composer = page.getByPlaceholder(/Describe what you want/);
  await composer.click();
  await composer.fill('/cap');
  await page.waitForTimeout(200);
  await shot('05-slash');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const v = await composer.inputValue();
  check(v.startsWith('Add stylish captions'), `"/cap" + Enter expands to the captions brief`);

  // the draft survives a reload
  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-clip-id="vid"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  const v2 = await page.getByPlaceholder(/Describe what you want/).inputValue();
  check(v2.startsWith('Add stylish captions'), 'composer draft restored after reload');

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
