// How shaky a video is: follow a patch in the middle with the app's own tracker and report how far it
// moves from frame to frame (RMS, in pixels of a 1280-wide picture). Usage: node --import tsx measure-shake.ts <file>...
import { probe } from '../../src/server/media/ffmpeg';
import { trackRegion } from '../../src/server/media/track';

const out: number[] = [];
for (const file of process.argv.slice(2)) {
  const info = await probe(file);
  const size = { width: info.width ?? 1280, height: info.height ?? 720 };
  const pts = await trackRegion(file, size, 0.5, Math.min(info.duration ?? 4, 3.5), { cx: 0.5, cy: 0.45, w: 0.16, h: 0.22 }, { fps: 30 });
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += ((pts[i]!.cx - pts[i - 1]!.cx) * 1280) ** 2 + ((pts[i]!.cy - pts[i - 1]!.cy) * 720) ** 2;
  out.push(Math.round(Math.sqrt(sum / Math.max(1, pts.length - 1)) * 100) / 100);
}
console.log(`RESULT${JSON.stringify(out)}`);
