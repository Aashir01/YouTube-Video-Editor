// Proxies: light editing copies of heavy footage, played in the editor (exports keep the originals).
const fs = require('fs');
const { BASE, api, post, put, upload, waitReady, waitFor, ops, getProject, check, launch, media } = require('../lib.cjs');

(async () => {
  const pid = (await post('/api/projects', { name: 'Proxies test', format: 'long' })).id;
  const proxyOf = (id) => waitFor(async () => (await getProject(pid)).assets.find((a) => a.id === id && a.proxy), 120000, 1000);

  // 1) 1440p footage gets a 540p proxy on its own
  const big = await waitReady(pid, (await upload(pid, media('big.mp4'))).id);
  const bigReady = await proxyOf(big.id);
  check(bigReady && bigReady.proxy.width === 960 && bigReady.proxy.height === 540, `1440p footage gets a 540p proxy automatically (${bigReady?.proxy?.width}×${bigReady?.proxy?.height})`);
  const served = await fetch(`${BASE}/media/${pid}/${encodeURIComponent(bigReady.proxy.file)}`, { method: 'HEAD' });
  check(served.ok, 'the proxy file is served');

  // 2) HEVC (iPhone-style) footage too, when this machine's FFmpeg can make the fixture
  let hevc = null;
  if (fs.existsSync(media('hevc.mp4'))) {
    const h = await waitReady(pid, (await upload(pid, media('hevc.mp4'))).id);
    hevc = await proxyOf(h.id);
    check(hevc && h.meta.codec === 'hevc', `HEVC footage gets a proxy (${h.meta.codec}, ${hevc?.proxy?.width}×${hevc?.proxy?.height})`);
  }

  // 3) the preview plays the proxy; the quality menu switches to the original and back
  await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'v', type: 'video', assetId: big.id, start: 0, duration: 4 } }]);
  if (hevc) await ops(pid, [{ op: 'addClip', trackId: 'Main', clip: { id: 'h', type: 'video', assetId: hevc.id, start: 4, duration: 3 } }]);
  const { page, shot, finish } = await launch('proxies');
  await page.goto(`${BASE}/?project=${pid}`, { waitUntil: 'load' });
  await page.locator('[data-clip-id="v"]').waitFor({ timeout: 20000 });
  const playing = async (t) => {
    await page.evaluate((x) => window.cutroom.seek(x), t);
    await page.waitForTimeout(1200);
    return page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find((x) => x.offsetParent !== null) ?? document.querySelector('video');
      return { src: v?.currentSrc || v?.src || '', width: v?.videoWidth ?? 0 };
    });
  };
  let now = await playing(1);
  check(now.src.includes('.proxy.mp4') && now.width === 960, `the preview plays and decodes the proxy (${now.width}px wide)`);
  await shot('01-proxy-playback');
  await page.getByRole('button', { name: 'Playback quality' }).click();
  await page.getByRole('menuitem', { name: /Originals/ }).click();
  await page.keyboard.press('Escape'); // the preview menus stay open for trying options
  now = await playing(1.5);
  check(!now.src.includes('.proxy.mp4') && now.width === 2560, `"Originals" plays the full-quality file (${now.width}px wide)`);
  await page.getByRole('button', { name: 'Playback quality' }).click();
  await page.getByRole('menuitem', { name: /Proxies/ }).click();
  await page.keyboard.press('Escape'); // the preview menus stay open for trying options
  now = await playing(1);
  check(now.src.includes('.proxy.mp4'), 'and back to proxies');
  if (hevc) {
    const h = await playing(5);
    check(h.src.includes('.proxy.mp4') && h.width === 960, `HEVC plays in the editor through its proxy (${h.width}px wide)`);
  }

  // 4) the media card shows it; the asset menu removes and re-creates it
  const card = page.locator('[title="big.mp4"]').locator('xpath=ancestor::div[contains(@class, "group")][1]');
  check(await card.getByText('proxy', { exact: true }).isVisible(), 'the media card shows a "proxy" badge');
  await card.getByRole('button', { name: 'Asset menu' }).click();
  await page.getByRole('menuitem', { name: /Remove proxy/ }).click();
  const gone = await waitFor(async () => !(await getProject(pid)).assets.find((a) => a.id === big.id).proxy, 20000, 500);
  check(gone, 'Remove proxy plays the original again');
  await card.getByRole('button', { name: 'Asset menu' }).click();
  await page.getByRole('menuitem', { name: /Create proxy/ }).click();
  check(await proxyOf(big.id), 'Create proxy makes it again');
  await shot('02-media-card');

  // 5) with proxies off, new footage keeps playing the original
  const { saved } = await api('/api/settings');
  await put('/api/settings', { render: { ...saved.render, proxies: 'off' } });
  const big2 = await waitReady(pid, (await upload(pid, media('big.mp4'))).id);
  await page.waitForTimeout(5000);
  check(!(await getProject(pid)).assets.find((a) => a.id === big2.id).proxy, 'the "off" setting is respected');
  await put('/api/settings', { render: { ...saved.render } });

  await finish();
})().catch((e) => {
  console.error('SCRIPT FAILED', e);
  process.exit(1);
});
