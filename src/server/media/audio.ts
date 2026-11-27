/**
 * The sound of a file as loudness per 10 ms (log energy), streamed from FFmpeg so hour-long
 * recordings stay small in memory. Used to line up multicam recordings and to tell who talks.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ff } from './ffmpeg';

/** frames per second of the loudness series */
export const LOUDNESS_RATE = 100;

export const audioLoudness = (file: string, signal?: AbortSignal): Promise<Float32Array> => {
  const sampleRate = 8000;
  const hop = sampleRate / LOUDNESS_RATE;
  const b = ff();
  return new Promise((resolve, reject) => {
    const child = spawn(b.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], {
      cwd: b.cwd,
      env: b.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: number[] = [];
    let carry: Buffer = Buffer.alloc(0);
    let acc = 0;
    let count = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const n = Math.floor(buf.length / 4);
      for (let i = 0; i < n; i++) {
        const v = buf.readFloatLE(i * 4);
        acc += v * v;
        if (++count === hop) {
          out.push(Math.log(1e-9 + acc / hop));
          acc = 0;
          count = 0;
        }
      }
      carry = buf.subarray(n * 4);
    });
    let err = '';
    child.stderr.on('data', (d) => (err += String(d)));
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (code === 0 && out.length) return resolve(Float32Array.from(out));
      reject(new Error(`${path.basename(file)} has no sound to sync by${err ? ` (${err.trim().split('\n').pop()})` : ''}`));
    });
  });
};
