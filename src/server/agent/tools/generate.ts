import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { uid } from '../../../shared/ids';
import { CACHE_DIR } from '../../config';
import { downloadToProject, registerAsset } from '../../media/ingest';
import { libraryFile, listLibrary } from '../../media/sfx';
import { generateImage, imageEngine } from '../../services/images';
import { searchStock, type StockResult } from '../../services/stock';
import { store } from '../../storage/projects';
import { defineTool, j, type ToolImage } from '../types';
import { getProject } from './helpers';

const lastSearch = new Map<string, Map<string, StockResult>>();

export const searchStockTool = defineTool({
  name: 'search_stock',
  category: 'generate',
  readOnly: true,
  description:
    'Search free stock footage or photos (Pexels/Pixabay; Openverse for images without keys). Use concrete visual queries ("close-up hands typing laptop night", "aerial forest fog sunrise"). Returns candidates with ids and thumbnail images to judge visually, then import the best with import_stock.',
  schema: z.object({
    query: z.string().min(2),
    type: z.enum(['video', 'image']).default('video'),
    orientation: z.enum(['landscape', 'portrait', 'square']).optional().describe('Defaults to the project aspect'),
    count: z.number().int().min(1).max(12).default(6),
  }),
  execute: async (input, ctx) => {
    const p = await getProject(ctx);
    const orientation = input.orientation ?? (p.canvas.height > p.canvas.width ? 'portrait' : 'landscape');
    const { results, errors } = await searchStock({ query: input.query, type: input.type, orientation, count: input.count }, ctx.settings);
    if (!results.length) return { text: `No results.${errors.length ? ` Errors: ${errors.join('; ')}` : ''}`, isError: errors.length > 0 };
    const map = lastSearch.get(ctx.projectId) ?? new Map<string, StockResult>();
    for (const r of results) map.set(r.id, r);
    lastSearch.set(ctx.projectId, map);
    const images: ToolImage[] = [];
    await Promise.all(
      results.slice(0, 8).map(async (r, i) => {
        try {
          const res = await fetch(r.thumb);
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 300_000) images[i] = { mime: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg', data: buf.toString('base64') };
        } catch {
          /* thumbnail unavailable */
        }
      }),
    );
    const rows = results.map((r, i) => `${i + 1}. ${r.id} [${r.type}${r.duration ? ` ${r.duration}s` : ''} ${r.width}x${r.height}] ${r.description ?? ''} — by ${r.author ?? 'unknown'} (${r.provider})`);
    return {
      text: `${rows.join('\n')}\nThumbnails are attached in the same order.${errors.length ? `\nProvider errors: ${errors.join('; ')}` : ''}`,
      images: images.filter(Boolean),
      imageUrls: results.slice(0, 8).map((r) => r.thumb),
      summary: `${results.length} ${input.type}s`,
    };
  },
});

export const importStock = defineTool({
  name: 'import_stock',
  category: 'generate',
  description: 'Download stock results (ids from search_stock) into the project as assets (with author/license credits). Returns asset ids to place on the timeline.',
  schema: z.object({ ids: z.array(z.string()).min(1).max(12) }),
  execute: async (input, ctx) => {
    const map = lastSearch.get(ctx.projectId);
    const out: Record<string, unknown>[] = [];
    for (const id of input.ids) {
      const r = map?.get(id);
      if (!r) {
        out.push({ id, error: 'unknown id — run search_stock first' });
        continue;
      }
      ctx.progress(`Downloading ${id}…`);
      try {
        const ext = r.type === 'video' ? '.mp4' : path.extname(new URL(r.url).pathname) || '.jpg';
        const asset = await downloadToProject(ctx.projectId, r.url, `${(r.description ?? r.id).slice(0, 40).replace(/[^\w\- ]+/g, '').trim() || r.id}${ext}`, {
          origin: 'stock',
          description: r.description,
          tags: ['stock', r.provider],
          source: { provider: r.provider, url: r.pageUrl, author: r.author, authorUrl: r.authorUrl, license: r.license },
          wait: true,
          updateSource: ctx.source === 'mcp' ? 'mcp' : 'agent',
        });
        out.push({ id, assetId: asset.id, kind: asset.kind, duration: asset.meta.duration, size: `${asset.meta.width}x${asset.meta.height}` });
      } catch (err) {
        out.push({ id, error: (err as Error).message });
      }
    }
    return { text: j(out), summary: `${out.filter((x) => x.assetId).length} imported` };
  },
});

export const generateImageTool = defineTool({
  name: 'generate_image',
  category: 'generate',
  description: 'Generate an image with AI (OpenAI gpt-image / Gemini) for illustrations, backgrounds or b-roll when stock or user media cannot show the idea. Describe subject, style, composition, lighting; avoid text in images. Costs money.',
  schema: z.object({ prompt: z.string().min(10), aspect: z.enum(['16:9', '9:16', '1:1']).optional(), name: z.string().optional() }),
  execute: async (input, ctx) => {
    const engine = imageEngine(ctx.settings);
    if (!engine) return { text: 'No image generation engine (needs an OpenAI or Gemini key). Use search_stock or ask the user for images.', isError: true };
    const ok = await ctx.approve(`Generate an AI image with ${engine}: "${input.prompt.slice(0, 120)}"`);
    if (!ok) return { text: 'The user declined image generation.', isError: true };
    const p = await getProject(ctx);
    const aspect = input.aspect ?? (p.canvas.height > p.canvas.width ? '9:16' : '16:9');
    ctx.progress('Generating image…');
    const img = await generateImage(input.prompt, aspect, ctx.settings);
    const asset = await registerAsset(ctx.projectId, {
      sourcePath: img.file,
      originalName: `${(input.name ?? input.prompt).slice(0, 40).replace(/[^\w\- ]+/g, '').trim() || 'ai-image'}${path.extname(img.file)}`,
      origin: 'generated',
      description: `AI image (${img.model}): ${input.prompt}`,
      tags: ['ai-image'],
      wait: true,
      updateSource: ctx.source === 'mcp' ? 'mcp' : 'agent',
    });
    const data = await fsp.readFile(store.mediaPath(ctx.projectId, asset.file));
    return {
      text: `Image created: ${asset.id} (${asset.meta.width}x${asset.meta.height}).`,
      images: data.length < 4_000_000 ? [{ mime: asset.mime, data: data.toString('base64') }] : undefined,
      imageUrls: [`/media/${ctx.projectId}/${asset.file}`],
      summary: asset.id,
    };
  },
});

export const addLibrarySound = defineTool({
  name: 'add_library_sound',
  category: 'generate',
  description: `Add a built-in royalty-free sound to the project (returns an asset id; place it with apply_edits/add_media). Sounds: ${listLibrary()
    .map((s) => `${s.id} (${s.kind}: ${s.description})`)
    .join('; ')}.`,
  schema: z.object({ soundId: z.string() }),
  execute: async (input, ctx) => {
    const item = listLibrary().find((s) => s.id === input.soundId);
    if (!item) return { text: `Unknown sound. Available: ${listLibrary().map((s) => s.id).join(', ')}`, isError: true };
    const existing = (await getProject(ctx)).assets.find((a) => a.origin === 'library' && a.tags.includes(item.id));
    if (existing) return { text: `Already in project: ${existing.id} (${existing.meta.duration?.toFixed(2)}s)`, summary: existing.id };
    const asset = await registerAsset(ctx.projectId, { sourcePath: libraryFile(item.id), originalName: `${item.name}.wav`, copy: true, origin: 'library', tags: [item.id, item.kind, ...item.tags], description: item.description, wait: true, updateSource: ctx.source === 'mcp' ? 'mcp' : 'agent' });
    return { text: `Added ${item.name}: ${asset.id} (${asset.meta.duration?.toFixed(2)}s, ${item.kind}).`, summary: asset.id };
  },
});

export const generateAudio = defineTool({
  name: 'generate_audio',
  category: 'generate',
  description: 'Generate a custom sound effect or music track with ElevenLabs (needs an ElevenLabs key). kind "sfx": 0.5–22s from a description ("deep cinematic whoosh with reverb tail"). kind "music": instrumental bed from a prompt (genre, mood, tempo, instruments, "no vocals"). Costs money.',
  schema: z.object({ kind: z.enum(['sfx', 'music']), prompt: z.string().min(3), durationSec: z.number().min(0.5).max(300).optional() }),
  execute: async (input, ctx) => {
    const key = ctx.settings.keys.elevenlabs;
    if (!key) return { text: 'ElevenLabs key not configured. Use add_library_sound instead, or ask the user for music.', isError: true };
    const ok = await ctx.approve(`Generate ${input.kind === 'music' ? 'a music track' : 'a sound effect'} with ElevenLabs: "${input.prompt.slice(0, 100)}"`);
    if (!ok) return { text: 'The user declined.', isError: true };
    ctx.progress(`Generating ${input.kind}…`);
    const res =
      input.kind === 'sfx'
        ? await fetch('https://api.elevenlabs.io/v1/sound-generation', {
            method: 'POST',
            headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: input.prompt, duration_seconds: input.durationSec ? Math.min(22, input.durationSec) : undefined, prompt_influence: 0.4 }),
          })
        : await fetch('https://api.elevenlabs.io/v1/music', {
            method: 'POST',
            headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: input.prompt, music_length_ms: Math.round((input.durationSec ?? 60) * 1000) }),
          });
    if (!res.ok) return { text: `ElevenLabs ${input.kind} generation failed (${res.status}): ${(await res.text()).slice(0, 300)}`, isError: true };
    const dir = path.join(CACHE_DIR, 'tmp');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${uid('gen')}.mp3`);
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
    const asset = await registerAsset(ctx.projectId, {
      sourcePath: file,
      originalName: `${input.kind === 'music' ? 'Music' : 'SFX'} ${input.prompt.slice(0, 40).replace(/[^\w\- ]+/g, '')}.mp3`,
      origin: 'generated',
      description: `ElevenLabs ${input.kind}: ${input.prompt}`,
      tags: [input.kind],
      wait: true,
      updateSource: ctx.source === 'mcp' ? 'mcp' : 'agent',
    });
    return { text: `Created ${asset.id} (${asset.meta.duration?.toFixed(2)}s).`, summary: asset.id };
  },
});
