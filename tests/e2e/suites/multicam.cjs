// Multicam: sync three cameras and a mic by sound, cut to whoever talks, switch cameras by hand.
const fs = require('fs');
const path = require('path');
const { BASE, post, upload, waitReady, getProject, clips, check, launch, media, mcpClient, pixel, OUT } = require('../lib.cjs');

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// the scene: the left person talks 0-4 s and 8-12 s, the right one 4-8 s
const CORNER = { white: 'wide', red: 'left', blue: 'right' };
const cornerOf = ([r, g, b]) => (r > 200 && g > 200 && b > 200 ? 'white' : r > 170 && g < 90 && b < 90 ? 'red' : b > 170 && r < 90 && g < 90 ? 'blue' : `rgb(${r},${g},${b})`);

(async () => {
  const pid = (await post('/api/projects', { name: 'Podcast', format: 'long' })).id;
  const ids = {};
  for (const name of ['mc-wide.mp4', 'mc-left.mp4', 'mc-right.mp4', 'mc-mic.m4a']) ids[name] = (await waitReady(pid, (await upload(pid, media(name))).id)).id;
  const cams = [ids['mc-wide.mp4'], ids['mc-left.mp4'], ids['mc-right.mp4']];

  const { page, shot, finish } = await launch('multicam');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.getByRole('button', { name: /^Media/ }).first().click();

  // 1) the dialog: pick the cameras in order and the mic, then sync
  await page.getByRole('button', { name: 'Multicam', exact: true }).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['mc-wide.mp4', 'mc-left.mp4', 'mc-right.mp4', 'mc-mic.m4a']) await dialog.getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }).click();
  check((await dialog.getByRole('button', { pressed: true }).count()) === 4, 'four recordings picked (camera order shown)');
  await shot('01-dialog');
  await dialog.getByRole('button', { name: 'Sync and create' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 120000 });

  // 2) synced by sound: the close-ups started 1.5 s and 0.7 s later, the mic 1 s earlier
  let p = await getProject(pid);
  const g = p.multicam[0];
  const off = (id) => g.angles.find((a) => a.assetId === id)?.offset ?? g.audio.find((a) => a.assetId === id)?.offset;
  check(g && near(off(ids['mc-left.mp4']), 1.5, 0.02) && near(off(ids['mc-right.mp4']), 0.7, 0.02) && near(off(ids['mc-mic.m4a']), -1, 0.02), `synced by sound: left +${off(ids['mc-left.mp4'])}s, right +${off(ids['mc-right.mp4'])}s, mic ${off(ids['mc-mic.m4a'])}s`);
  check(g.wide === 0, 'the camera with both people is found as the wide shot');

  // 3) the cut follows whoever talks; before the left camera rolled, the wide shot stands in
  const cuts = () => clips(p).filter((c) => c.type === 'video' && c.multicam === g.id).sort((a, b) => a.start - b.start);
  const camAt = (t) => {
    const c = cuts().find((x) => t >= x.start && t < x.start + x.duration);
    return c ? ['wide', 'left', 'right'][cams.indexOf(c.assetId)] : 'none';
  };
  const plan = [0.5, 3, 6, 10].map(camAt);
  check(plan.join(',') === 'wide,left,right,left', `cuts to whoever talks: ${cuts().map((c) => `${['wide', 'left', 'right'][cams.indexOf(c.assetId)]}@${c.start}`).join(' ')}`);
  const toRight = cuts().find((c) => c.assetId === ids['mc-right.mp4']);
  check(toRight && near(toRight.start, 4, 0.7) && near(toRight.start + toRight.duration, 8, 0.7), `the cut lands where the turn changes (${toRight?.start}–${(toRight?.start + toRight?.duration).toFixed(2)}s)`);
  const left = cuts().find((c) => c.assetId === ids['mc-left.mp4']);
  check(near(left.trimStart, left.start - 1.5, 0.02), 'each cut shows the same moment of its camera');
  check(cuts().every((c) => c.volume === 0), "the cameras' own sound is off");
  const mic = clips(p).find((c) => c.type === 'audio' && c.assetId === ids['mc-mic.m4a']);
  check(mic && mic.track === 'Mic' && near(mic.start, 0, 0.01) && near(mic.trimStart, 1, 0.02) && near(mic.duration, 12, 0.05), `the mic plays continuously on its own track (${mic?.track}, from ${mic?.trimStart}s)`);

  // 4) rendered frames show the right camera
  const call = await mcpClient();
  await call('select_project', { projectId: pid });
  const frames = await call('preview_frames', { times: [0.5, 3, 6, 10] });
  fs.mkdirSync(OUT, { recursive: true });
  const seen = frames.images.map((im, i) => {
    const f = path.join(OUT, `frame-${i}.jpg`);
    fs.writeFileSync(f, Buffer.from(im.data, 'base64'));
    return CORNER[cornerOf(pixel(f, 0.015, 0.02))] ?? cornerOf(pixel(f, 0.015, 0.02));
  });
  check(seen.join(',') === 'wide,left,right,left', `rendered frames show ${seen.join(', ')}`);
  await shot('02-cut');

  // 5) live switching: press 2 at 6 s to cut to the left camera from there
  await page.evaluate(() => window.cutroom.seek(6));
  await page.keyboard.press('2');
  await page.waitForTimeout(600);
  p = await getProject(pid);
  check(camAt(5) === 'right' && camAt(6.5) === 'left', 'pressing 2 cuts to camera 2 at the playhead');
  check(await page.getByText(/Cam 2 · mc-left\.mp4/).first().isVisible(), 'timeline cuts are labeled with their camera');

  // 6) right-click a cut to switch it; the Inspector does the same
  const last = cuts().at(-1);
  await page.locator(`[data-clip-id="${last.id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Camera 1: mc-wide\.mp4 \(wide\)/ }).click();
  await page.waitForTimeout(600);
  p = await getProject(pid);
  const switched = cuts().find((c) => c.id === last.id);
  check(switched.assetId === ids['mc-wide.mp4'] && near(switched.trimStart, switched.start, 0.02), 'the clip menu switches a cut, keeping the moment');
  await page.locator(`[data-clip-id="${last.id}"]`).click();
  await page.evaluate(() => window.cutroom.store.getState().setRightTab('inspector'));
  // camera 3 stopped at 11.5 s, so it cannot take this cut (8–12 s): the app says so
  await page.getByRole('button', { name: 'Camera 3', exact: true }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Camera 3 was not recording during this part' }).first().waitFor({ timeout: 10000 });
  check(true, 'a camera that was not recording is refused with a clear message');
  await page.getByRole('button', { name: 'Camera 2', exact: true }).click();
  await page.waitForTimeout(600);
  p = await getProject(pid);
  check(cuts().find((c) => c.id === last.id)?.assetId === ids['mc-left.mp4'], 'and the Inspector switches cameras too');
  await shot('03-inspector');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  p = await getProject(pid);
  check(cuts().find((c) => c.id === last.id)?.assetId === ids['mc-wide.mp4'], 'one undo step per switch');

  // 7) the Director's tools: create_multicam staying on one camera, then switchAngle in apply_edits
  const pid2 = (await post('/api/projects', { name: 'Podcast 2', format: 'long' })).id;
  const ids2 = [];
  for (const name of ['mc-left.mp4', 'mc-wide.mp4']) ids2.push((await waitReady(pid2, (await upload(pid2, media(name))).id)).id);
  await call('select_project', { projectId: pid2 });
  const made = await call('create_multicam', { cameras: ids2, follow: 'first' });
  const p2 = await getProject(pid2);
  const cuts2 = clips(p2).filter((c) => c.type === 'video' && c.multicam).sort((a, b) => a.start - b.start);
  check(!made.isError && /Synced 2 cameras by sound/.test(made.text) && /mc-wide\.mp4 −1\.50s/.test(made.text), `create_multicam syncs (the wide camera is 1.5 s before the left one): ${made.text.split('\n')[0].slice(0, 120)}`);
  check(cuts2.length === 2 && cuts2[0].assetId === ids2[1] && cuts2[1].assetId === ids2[0], 'staying on camera 1, the other camera covers the part camera 1 missed');
  const sw = await call('apply_edits', { label: 'Wide', ops: [{ op: 'switchAngle', clipId: cuts2[1].id, angle: 1, at: cuts2[1].start + 3 }] });
  const after2 = clips(await getProject(pid2)).filter((c) => c.type === 'video' && c.multicam);
  check(!sw.isError && after2.length === 3 && after2.filter((c) => c.assetId === ids2[1]).length === 2, 'switchAngle in apply_edits cuts and switches');

  // 8) one microphone per person (listed in the "wrong" order): the loud mic decides, matched to its close-up
  const pid3 = (await post('/api/projects', { name: 'Podcast 3', format: 'long' })).id;
  const ids3 = {};
  for (const name of ['mc-wide.mp4', 'mc-left.mp4', 'mc-right.mp4', 'mc-mic-right.m4a', 'mc-mic-left.m4a']) ids3[name] = (await waitReady(pid3, (await upload(pid3, media(name))).id)).id;
  const cams3 = [ids3['mc-wide.mp4'], ids3['mc-left.mp4'], ids3['mc-right.mp4']];
  const r3 = await post(`/api/projects/${pid3}/multicam`, { cameras: cams3, microphones: [ids3['mc-mic-right.m4a'], ids3['mc-mic-left.m4a']] });
  const p3 = await getProject(pid3);
  const cuts3 = clips(p3).filter((c) => c.type === 'video' && c.multicam).sort((a, b) => a.start - b.start);
  const at3 = (t) => ['wide', 'left', 'right'][cams3.indexOf(cuts3.find((c) => t >= c.start && t < c.start + c.duration)?.assetId)];
  check(/by their microphones/.test(r3.summary) && [0.5, 3, 6, 10].map(at3).join(',') === 'wide,left,right,left', `with a mic per person it cuts by sound: ${cuts3.map((c) => `${['wide', 'left', 'right'][cams3.indexOf(c.assetId)]}@${c.start}`).join(' ')}`);
  const tracks3 = clips(p3).filter((c) => c.type === 'audio').map((c) => c.track).sort();
  check(tracks3.join(',') === 'Mic 1,Mic 2', `each mic gets its own track (${tracks3.join(', ')})`);

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
