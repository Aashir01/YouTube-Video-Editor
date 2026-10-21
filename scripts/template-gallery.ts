/**
 * Renders a still of every motion-graphics template (16:9 and 9:16) into
 * ./dist/gallery. Doubles as a smoke test for the Remotion toolchain.
 *
 *   npx tsx scripts/template-gallery.ts [--only=title-card,bar-chart] [--portrait-only]
 */
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { TEMPLATES } from '../src/shared/templates';
import { createProject, placeClip } from '../src/shared/timeline';
import { createDemoProject } from '../src/shared/sample';
import { resolveBrowserExecutable } from '../src/server/render/browser';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist/gallery');
fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const formats: ('long' | 'short')[] = process.argv.includes('--portrait-only') ? ['short'] : process.argv.includes('--landscape-only') ? ['long'] : ['long', 'short'];

const serveUrl = await bundle({ entryPoint: path.join(root, 'src/remotion/index.ts') });
const browserExecutable = resolveBrowserExecutable();
const browser = await openBrowser('chrome', { browserExecutable });

for (const format of formats) {
  for (const t of TEMPLATES) {
    if (only && !only.includes(t.id)) continue;
    const p = createProject({ name: `gallery ${t.id}`, format });
    p.brand.channelName = 'Curious Minds';
    p.brand.handle = '@curiousminds';
    if (t.overlay) {
      // overlays are shown over a neutral backdrop scene
      placeClip(p, { id: 'bg', type: 'scene', template: 'title-card', start: 0, duration: t.defaultDuration, props: { title: ' ', background: 'gradient' } }, { trackId: 'Main' });
      placeClip(p, { id: 'ov', type: 'scene', template: t.id, start: 0, duration: t.defaultDuration, props: t.example as Record<string, unknown> }, { trackId: 'Graphics' });
    } else {
      placeClip(p, { id: 'sc', type: 'scene', template: t.id, start: 0, duration: t.defaultDuration, props: t.example as Record<string, unknown> }, { trackId: 'Main' });
    }
    const inputProps = { project: p, assetUrls: {}, transcripts: {}, mode: 'still' };
    const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, puppeteerInstance: browser });
    const frame = Math.min(composition.durationInFrames - 1, Math.round(composition.durationInFrames * 0.7));
    const file = path.join(outDir, `${t.id}-${format === 'long' ? '16x9' : '9x16'}.jpg`);
    await renderStill({ composition, serveUrl, inputProps, frame, output: file, imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5, puppeteerInstance: browser, logLevel: 'error' });
    console.log('rendered', path.relative(root, file));
  }
}

// demo project + thumbnails
if (!only) {
  const demo = createDemoProject();
  const inputProps = { project: demo, assetUrls: {}, transcripts: {}, mode: 'still' };
  const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, puppeteerInstance: browser });
  for (const sec of [1.5, 6, 12]) {
    const file = path.join(outDir, `demo-${sec}s.jpg`);
    await renderStill({ composition, serveUrl, inputProps, frame: Math.round(sec * 30), output: file, imageFormat: 'jpeg', scale: 0.5, puppeteerInstance: browser, logLevel: 'error' });
    console.log('rendered', path.relative(root, file));
  }
  for (const template of ['bold-text', 'minimal', 'number', 'news']) {
    const thumbProps = { project: demo, assetUrls: {}, thumbnail: { template, props: { text: 'Why *Sleep* Matters', subtext: 'The 60-second science', emoji: '😴', number: '7h', badge: 'New study' } } };
    const comp = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps: thumbProps, puppeteerInstance: browser });
    const file = path.join(outDir, `thumb-${template}.jpg`);
    await renderStill({ composition: comp, serveUrl, inputProps: thumbProps, output: file, imageFormat: 'jpeg', scale: 0.5, puppeteerInstance: browser, logLevel: 'error' });
    console.log('rendered', path.relative(root, file));
  }
}

await browser.close({ silent: true });
