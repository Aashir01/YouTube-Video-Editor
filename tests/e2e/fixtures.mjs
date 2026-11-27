#!/usr/bin/env node
// Generates the media the end-to-end suites use (FFmpeg required). Usage: node tests/e2e/fixtures.mjs [outDir]
// Files are only rebuilt when missing or when this script's FIXTURES_VERSION changes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_VERSION = 4;
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, '.fixtures'));
const portrait = path.join(here, 'fixtures', 'portrait.jpg');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

const stamp = path.join(out, `.version-${FIXTURES_VERSION}`);
if (fs.existsSync(stamp)) process.exit(0);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const run = (name, args) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, path.join(out, name)], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error(`Could not make the test fixture ${name}${r.error ? `: ${r.error.message}` : ''}. Is FFmpeg installed (or FFMPEG_PATH set)?`);
    process.exit(1);
  }
};

// a 20 s talking-head stand-in: moving test pattern with a tone
run('talk.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest']);
// a 100 s talk to find Shorts in (small, so it builds fast)
run('talk-long.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=100', '-f', 'lavfi', '-i', 'sine=frequency=200:sample_rate=44100:duration=100', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest']);
// a 6 s voice/music stand-in
run('voice.m4a', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6', '-c:a', 'aac', '-ac', '1']);
// a solid picture for picture-in-picture
run('photo.png', ['-f', 'lavfi', '-i', 'color=c=0x2B6AB1:s=640x640', '-frames:v', '1']);
// 16:9 shots with a real face: one sliding left to right, one cutting from left to right at 5 s
const bg = ['-f', 'lavfi', '-i', 'color=c=0x556070:s=1920x1080:d=10:r=30', '-loop', '1', '-i', portrait];
run('face-move.mp4', [...bg, '-filter_complex', "[1]scale=540:540[a];[0][a]overlay=x='150+t*110':y=270:shortest=1", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '10']);
run('face-cut.mp4', [...bg, '-filter_complex', "[1]scale=540:540[a];[0][a]overlay=x='if(lt(t,5),180,1200)':y=270:shortest=1", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '10']);

// a two-person podcast: the "talking" mouth (a flickering dark patch) is on the left 0-4 s and 8-12 s, on the right 4-8 s
const mouth = (x, when) => `drawbox=x=${x}:y=411:w=56:h=24:color=0x401010@0.8:t=fill:enable='(${when})*lt(mod(n\\,6)\\,3)'`;
run('two-speakers.mp4', [
  '-f', 'lavfi', '-i', 'color=c=0x556070:s=1920x1080:d=12:r=30', '-loop', '1', '-i', portrait, '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=44100:duration=12',
  '-filter_complex', `[1]scale=540:540,split[a][b];[0][a]overlay=x=60:y=270:shortest=1[l];[l][b]overlay=x=1320:y=270:shortest=1,${mouth(267, 'lt(t\\,4)+gte(t\\,8)')},${mouth(1527, 'between(t\\,4\\,8)')}[v]`,
  '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-t', '12',
]);

// heavy footage for the proxy tests: 1440p H.264, and HEVC when this FFmpeg can encode it (iPhone-style)
run('big.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=2560x1440:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest']);
const hevc = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=3', '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', path.join(out, 'hevc.mp4')], { stdio: 'ignore' });
if (hevc.status !== 0) fs.rmSync(path.join(out, 'hevc.mp4'), { force: true });

fs.writeFileSync(stamp, '');
console.log(`Test fixtures ready in ${out}`);
