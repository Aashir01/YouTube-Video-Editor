import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import busboy from 'busboy';
import type { Context } from 'hono';
import { mimeFor } from '../media/ingest';

/** Serves a file with HTTP Range support (needed for video seeking in the preview and renderer). */
export const serveFile = async (c: Context, file: string, opts: { download?: string; cache?: string } = {}): Promise<Response> => {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return c.json({ error: 'Not found' }, 404);
  }
  const type = mimeFor(file);
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': opts.cache ?? 'private, max-age=60',
    'Access-Control-Allow-Origin': '*',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  if (opts.download) headers['Content-Disposition'] = `attachment; filename="${opts.download.replace(/"/g, '')}"`;
  const range = c.req.header('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? Number(m[1]) : NaN;
      let end = m[2] ? Number(m[2]) : stat.size - 1;
      if (Number.isNaN(start)) {
        // suffix range: last N bytes
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      }
      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
      }
      const stream = fs.createReadStream(file, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
      });
    }
  }
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
};

export interface UploadedFile {
  tmpPath: string;
  filename: string;
  mime: string;
  size: number;
}

/** Streams multipart uploads straight to disk (no buffering of large videos in memory). */
export const receiveUploads = (c: Context, tmpDir: string): Promise<{ files: UploadedFile[]; fields: Record<string, string> }> =>
  new Promise((resolve, reject) => {
    const body = c.req.raw.body;
    if (!body) return reject(new Error('Empty request body'));
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => (headers[k] = v));
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers, limits: { fileSize: 50 * 1024 ** 3, files: 50 } });
    } catch (err) {
      return reject(err);
    }
    fs.mkdirSync(tmpDir, { recursive: true });
    const files: UploadedFile[] = [];
    const fields: Record<string, string> = {};
    const writes: Promise<void>[] = [];
    bb.on('field', (name, value) => (fields[name] = value));
    bb.on('file', (_name, stream, info) => {
      const safe = path.basename(info.filename || 'upload').replace(/[^\w.\- ()[\]]+/g, '_');
      const tmpPath = path.join(tmpDir, `.up-${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`);
      const out = fs.createWriteStream(tmpPath);
      let size = 0;
      stream.on('data', (d: Buffer) => (size += d.length));
      writes.push(
        new Promise<void>((res, rej) => {
          out.on('finish', () => {
            files.push({ tmpPath, filename: info.filename || safe, mime: info.mimeType, size });
            res();
          });
          out.on('error', rej);
          stream.on('error', rej);
        }),
      );
      stream.pipe(out);
    });
    bb.on('error', reject);
    bb.on('close', () => {
      Promise.all(writes)
        .then(() => resolve({ files, fields }))
        .catch(reject);
    });
    Readable.fromWeb(body as never).pipe(bb);
  });
