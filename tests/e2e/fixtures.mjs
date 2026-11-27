#!/usr/bin/env node
// Generates the media the end-to-end suites use (FFmpeg required). Usage: node tests/e2e/fixtures.mjs [outDir]
// Files are only rebuilt when missing or when this script's FIXTURES_VERSION changes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_VERSION = 8;
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

// a multicam podcast: one 14 s "room" sound (noise bursts); the two-person scene filmed by a wide camera
// (12 s, white corner), a left close-up that started 1.5 s later (red) and a right one 0.7 s later
// (blue), plus a lav mic that started 1 s before the wide camera. Each has its own level and noise.
run('mc-world.wav', ['-f', 'lavfi', '-i', "aevalsrc='0.5*(random(0)*2-1)*gt(sin(2*PI*0.9*t)+sin(2*PI*1.37*t+0.5)+sin(2*PI*0.31*t+1.3)\\,0.4)':s=16000:d=14", '-ac', '1']);
run('mc-scene.mp4', [
  '-f', 'lavfi', '-i', 'color=c=0x556070:s=1920x1080:d=12:r=30', '-loop', '1', '-i', portrait,
  '-filter_complex', `[1]scale=540:540,split[a][b];[0][a]overlay=x=60:y=270:shortest=1[l];[l][b]overlay=x=1320:y=270:shortest=1,${mouth(267, 'lt(t\\,4)+gte(t\\,8)')},${mouth(1527, 'between(t\\,4\\,8)')}[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-t', '12',
]);
const world = path.join(out, 'mc-world.wav');
const scene = path.join(out, 'mc-scene.mp4');
const camera = (name, { from, len, crop, color, level, seed }) =>
  run(name, [
    '-i', scene, '-i', world,
    '-filter_complex',
    `[0]trim=start=${from}:duration=${len},setpts=PTS-STARTPTS${crop ? `,crop=${crop}` : ''},drawbox=x=0:y=0:w=80:h=80:color=${color}:t=fill[v];` +
      `[1]atrim=start=${from + 1}:duration=${len},asetpts=PTS-STARTPTS,volume=${level}[a0];anoisesrc=d=${len}:c=white:r=16000:a=0.01:seed=${seed}[n];[a0][n]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1',
  ]);
camera('mc-wide.mp4', { from: 0, len: 12, color: 'white', level: 0.8, seed: 11 });
camera('mc-left.mp4', { from: 1.5, len: 10.5, crop: '1280:720:0:180', color: 'red', level: 1.0, seed: 12 });
camera('mc-right.mp4', { from: 0.7, len: 10.8, crop: '1280:720:640:180', color: 'blue', level: 0.6, seed: 13 });
run('mc-mic.m4a', ['-i', world, '-af', 'atrim=duration=13,volume=1.2', '-c:a', 'aac', '-ac', '1']);
// one lav mic per person: loud while they talk, the other voice bleeding in at -18 dB
run('mc-mic-left.m4a', ['-i', world, '-af', "atrim=duration=13,volume='if(between(t\\,1\\,5)+between(t\\,9\\,13)\\,1\\,0.12)':eval=frame", '-c:a', 'aac', '-ac', '1']);
run('mc-mic-right.m4a', ['-i', world, '-af', "atrim=duration=13,volume='if(between(t\\,5\\,9)\\,1\\,0.12)':eval=frame", '-c:a', 'aac', '-ac', '1']);

// background removal: a talking head filling the frame in front of a grey wall, and one on a green screen
const still = (name, bg, size) =>
  run(name, [
    '-f', 'lavfi', '-i', `color=c=${bg}:s=1280x720:d=3:r=30`, '-loop', '1', '-i', portrait, '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=3',
    '-filter_complex', `[1]scale=${size}:${size}[p];[0][p]overlay=x=(W-w)/2:y=H-h:shortest=1[v]`,
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-t', '3',
  ]);
still('talkhead.mp4', '0x777777', 720);
still('greenscreen.mp4', '0x00B140', 560);

// shaky handheld footage: a still picture seen through a crop window that wobbles every frame
run('shaky.mp4', [
  '-loop', '1', '-i', portrait, '-f', 'lavfi', '-i', 'sine=frequency=250:sample_rate=44100:duration=4',
  '-filter_complex', "[0]scale=1600:1600,crop=1280:720:'160+24*sin(t*17)+18*sin(t*7.3)':'400+20*cos(t*13)+14*sin(t*5.1)'[v]",
  '-map', '[v]', '-map', '1:a', '-r', '30', '-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1',
]);
// a 120 BPM drum loop: kicks at 0.25 s + k·0.5 s, hi-hats in between
run('beat.m4a', ['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*70*t)*exp(-mod(t+0.25\\,0.5)*25)+0.25*(random(0)*2-1)*exp(-mod(t\\,0.5)*60)':s=44100:d=12", '-c:a', 'aac', '-ac', '1']);

// heavy footage for the proxy tests: 1440p H.264, and HEVC when this FFmpeg can encode it (iPhone-style)
run('big.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=2560x1440:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest']);
const hevc = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=3', '-c:v', 'libx265', '-preset', 'ultrafast', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', path.join(out, 'hevc.mp4')], { stdio: 'ignore' });
if (hevc.status !== 0) fs.rmSync(path.join(out, 'hevc.mp4'), { force: true });

fs.writeFileSync(stamp, '');
console.log(`Test fixtures ready in ${out}`);
