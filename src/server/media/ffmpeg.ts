import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export interface FfBinaries {
  ffmpeg: string;
  ffprobe: string;
  /** working directory needed by the bundled build (it loads its libs relative to itself) */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** true for a full system build; the Remotion-bundled build lacks some filters */
  full: boolean;
  source: 'env' | 'system' | 'bundled';
}

let cached: FfBinaries | null = null;

const works = (bin: string, cwd?: string, env?: NodeJS.ProcessEnv) => {
  try {
    const r = spawnSync(bin, ['-version'], { cwd, env, timeout: 8000, windowsHide: true });
    return r.status === 0;
  } catch {
    return false;
  }
};

const bundledDir = (): string | null => {
  const candidates = [
    `@remotion/compositor-${process.platform}-${process.arch}`,
    `@remotion/compositor-${process.platform}-${process.arch}-gnu`,
    `@remotion/compositor-${process.platform}-${process.arch}-musl`,
    `@remotion/compositor-${process.platform}-${process.arch}-msvc`,
  ];
  for (const name of candidates) {
    try {
      return path.dirname(require.resolve(`${name}/package.json`));
    } catch {
      /* not installed for this platform */
    }
  }
  return null;
};

/** Locate ffmpeg: FFMPEG_PATH env, then the system PATH, then Remotion's bundled binaries. */
export const ff = (): FfBinaries => {
  if (cached) return cached;
  const exe = process.platform === 'win32' ? '.exe' : '';
  if (process.env.FFMPEG_PATH && works(process.env.FFMPEG_PATH)) {
    const probe = process.env.FFPROBE_PATH ?? path.join(path.dirname(process.env.FFMPEG_PATH), `ffprobe${exe}`);
    cached = { ffmpeg: process.env.FFMPEG_PATH, ffprobe: probe, full: true, source: 'env' };
    return cached;
  }
  if (works('ffmpeg') && works('ffprobe')) {
    cached = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', full: true, source: 'system' };
    return cached;
  }
  const dir = bundledDir();
  if (dir) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = dir;
    if (process.platform === 'win32') env.PATH = [dir, process.env.PATH].filter(Boolean).join(';');
    cached = { ffmpeg: path.join(dir, `ffmpeg${exe}`), ffprobe: path.join(dir, `ffprobe${exe}`), cwd: dir, env, full: false, source: 'bundled' };
    return cached;
  }
  throw new Error('FFmpeg not found. Install FFmpeg (https://ffmpeg.org/download.html) or run `npm install` again.');
};

export interface RunOptions {
  signal?: AbortSignal;
  onStderrLine?: (line: string) => void;
  stdoutToBuffer?: boolean;
  timeoutMs?: number;
}

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export const runFf = (bin: 'ffmpeg' | 'ffprobe', args: string[], opts: RunOptions = {}): Promise<RunResult> => {
  const b = ff();
  return new Promise((resolve, reject) => {
    const child = spawn(bin === 'ffmpeg' ? b.ffmpeg : b.ffprobe, bin === 'ffmpeg' ? ['-hide_banner', '-nostdin', ...args] : args, {
      cwd: b.cwd,
      env: b.env,
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let err = '';
    let partial = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      if (err.length < 400_000) err += s;
      if (opts.onStderrLine) {
        partial += s;
        const lines = partial.split(/\r|\n/);
        partial = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) opts.onStderrLine(l);
      }
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    const onAbort = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(new Error('Cancelled'));
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err });
    });
  });
};

const must = async (bin: 'ffmpeg' | 'ffprobe', args: string[], opts?: RunOptions): Promise<RunResult> => {
  const r = await runFf(bin, args, opts);
  if (r.code !== 0) {
    const tail = r.stderr.split('\n').filter(Boolean).slice(-6).join('\n');
    throw new Error(`${bin} failed (${r.code}): ${tail}`);
  }
  return r;
};

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

export interface ProbeResult {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  codec?: string;
  isImage: boolean;
}

const parseRate = (r?: string): number | undefined => {
  if (!r) return undefined;
  const [a, b] = r.split('/').map(Number);
  if (!a || !b) return undefined;
  const v = a / b;
  return v > 0 && v < 1000 ? Math.round(v * 1000) / 1000 : undefined;
};

export const probe = async (file: string): Promise<ProbeResult> => {
  const r = await must('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(r.stdout.toString() || '{}') as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; duration?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[]; disposition?: { attached_pic?: number } }[];
  };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  const fmt = j.format?.format_name ?? '';
  const isImage = Boolean(v) && (/image2|png_pipe|jpeg_pipe|webp_pipe|gif|bmp|tiff|svg/.test(fmt) || v?.codec_name === 'mjpeg' && !a && !j.format?.duration);
  let width = v?.width;
  let height = v?.height;
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ?? 0));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const duration = Number(j.format?.duration ?? v?.duration ?? a?.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 && !isImage ? Math.round(duration * 1000) / 1000 : undefined,
    width,
    height,
    fps: parseRate(v?.avg_frame_rate) ?? parseRate(v?.r_frame_rate),
    hasAudio: Boolean(a),
    hasVideo: Boolean(v) && !isImage,
    codec: v?.codec_name ?? a?.codec_name,
    isImage,
  };
};

// ---------------------------------------------------------------------------
// Thumbnails, frames, waveforms
// ---------------------------------------------------------------------------

export const thumbnail = async (input: string, output: string, atSec = 0, width = 480): Promise<void> => {
  const args = atSec > 0 ? ['-ss', atSec.toFixed(3), '-i', input] : ['-i', input];
  await must('ffmpeg', ['-y', ...args, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', output]);
};

/** Grab frames at the given times as JPEG buffers (for vision models). */
export const extractFrames = async (input: string, times: number[], width = 768): Promise<{ time: number; jpeg: Buffer }[]> => {
  const out: { time: number; jpeg: Buffer }[] = [];
  for (const t of times) {
    const r = await runFf('ffmpeg', ['-ss', Math.max(0, t).toFixed(3), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']);
    if (r.code === 0 && r.stdout.length > 0) out.push({ time: t, jpeg: r.stdout });
  }
  return out;
};

export const resizeImage = async (input: string, width = 1024): Promise<Buffer> => {
  const r = await must('ffmpeg', ['-i', input, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']);
  return r.stdout;
};

/** Peaks for timeline waveforms: `rate` values per second, 0-255, base64 encoded. */
export const waveformPeaks = async (input: string, rate = 25): Promise<{ rate: number; peaks: string; length: number }> => {
  const sr = 8000;
  const r = await must('ffmpeg', ['-i', input, '-vn', '-ac', '1', '-ar', String(sr), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'], { timeoutMs: 10 * 60_000 });
  const samples = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2));
  const win = Math.max(1, Math.floor(sr / rate));
  const n = Math.ceil(samples.length / win);
  const peaks = new Uint8Array(n);
  let max = 1;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(samples.length, (i + 1) * win);
    for (let k = i * win; k < end; k++) {
      const v = Math.abs(samples[k]!);
      if (v > m) m = v;
    }
    raw[i] = m;
    if (m > max) max = m;
  }
  for (let i = 0; i < n; i++) peaks[i] = Math.round(Math.sqrt(raw[i]! / max) * 255);
  return { rate, peaks: Buffer.from(peaks).toString('base64'), length: n };
};

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export const detectSilence = async (input: string, noiseDb = -35, minDur = 0.35): Promise<[number, number][]> => {
  const r = await runFf('ffmpeg', ['-i', input, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'], { timeoutMs: 20 * 60_000 });
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const line of r.stderr.split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push([Math.round(start * 1000) / 1000, Math.round(Number(e[1]) * 1000) / 1000]);
      start = null;
    }
  }
  if (start !== null) {
    const p = await probe(input).catch(() => null);
    if (p?.duration) out.push([start, p.duration]);
  }
  return out;
};

/** Scene cut times (needs a full ffmpeg build with the `select` filter). */
export const detectScenes = async (input: string, threshold = 0.32): Promise<number[] | null> => {
  if (!ff().full) return null;
  const r = await runFf('ffmpeg', ['-i', input, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { timeoutMs: 20 * 60_000 });
  if (r.code !== 0) return null;
  const times: number[] = [];
  for (const m of r.stderr.matchAll(/pts_time:([\d.]+)/g)) times.push(Math.round(Number(m[1]) * 100) / 100);
  return times;
};

export const measureLoudness = async (input: string): Promise<{ i: number; tp: number; lra: number; thresh: number; offset: number } | null> => {
  const r = await runFf('ffmpeg', ['-i', input, '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], { timeoutMs: 20 * 60_000 });
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(r.stderr);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, string>;
    return { i: Number(j.input_i), tp: Number(j.input_tp), lra: Number(j.input_lra), thresh: Number(j.input_thresh), offset: Number(j.target_offset) };
  } catch {
    return null;
  }
};

/** Two-pass EBU R128 normalization to the YouTube target, copying the video stream. */
export const normalizeLoudness = async (input: string, output: string, target = -14, signal?: AbortSignal): Promise<void> => {
  const m = await measureLoudness(input);
  const filter =
    m && Number.isFinite(m.i) && m.i > -70
      ? `loudnorm=I=${target}:TP=-1:LRA=11:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true`
      : `loudnorm=I=${target}:TP=-1:LRA=11`;
  await must('ffmpeg', ['-y', '-i', input, '-c:v', 'copy', '-af', filter, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], { signal, timeoutMs: 60 * 60_000 });
};

export const extractAudioWav = async (input: string, output: string, sampleRate = 16000): Promise<void> => {
  await must('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_s16le', output], { timeoutMs: 30 * 60_000 });
};

export const transcodeAudio = async (input: string, output: string): Promise<void> => {
  const ext = path.extname(output).toLowerCase();
  const codec = ext === '.mp3' ? ['-c:a', 'libmp3lame', '-b:a', '192k'] : ext === '.wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k'];
  await must('ffmpeg', ['-y', '-i', input, '-vn', ...codec, output]);
};

/** Wrap raw PCM (e.g. from Gemini TTS) into a WAV file. */
export const pcmToWav = (pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer => {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

export const floatToWav = (samples: Float32Array, sampleRate: number): Buffer => {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    pcm.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return pcmToWav(pcm, sampleRate);
};

export const ffInfo = () => {
  try {
    const b = ff();
    return { available: true, source: b.source, full: b.full };
  } catch (err) {
    return { available: false, error: (err as Error).message, source: 'none', full: false };
  }
};

export const fileExists = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
