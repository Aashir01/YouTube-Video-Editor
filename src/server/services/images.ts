import fsp from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { uid } from '../../shared/ids';
import { CACHE_DIR, type Settings } from '../config';

export interface GeneratedImage {
  file: string;
  engine: 'openai' | 'gemini';
  model: string;
}

export const imageEngine = (s: Settings): 'openai' | 'gemini' | null => {
  if (s.images.engine === 'none') return null;
  if (s.images.engine === 'openai') return s.keys.openai ? 'openai' : null;
  if (s.images.engine === 'gemini') return s.keys.gemini ? 'gemini' : null;
  return s.keys.openai ? 'openai' : s.keys.gemini ? 'gemini' : null;
};

const save = async (b64: string, ext = '.png') => {
  const dir = path.join(CACHE_DIR, 'tmp');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${uid('img')}${ext}`);
  await fsp.writeFile(file, Buffer.from(b64, 'base64'));
  return file;
};

export const generateImage = async (prompt: string, aspect: '16:9' | '9:16' | '1:1', s: Settings): Promise<GeneratedImage> => {
  const engine = imageEngine(s);
  if (!engine) throw new Error('No image generation engine available. Add an OpenAI or Gemini key in Settings → Media (or use stock images instead).');
  if (engine === 'openai') {
    const client = new OpenAI({ apiKey: s.keys.openai });
    const size = aspect === '16:9' ? '1536x1024' : aspect === '9:16' ? '1024x1536' : '1024x1024';
    const res = await client.images.generate({ model: s.images.openaiModel, prompt, size, n: 1, quality: 'high' } as never);
    const b64 = (res as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data');
    return { file: await save(b64), engine, model: s.images.openaiModel };
  }
  const ai = new GoogleGenAI({ apiKey: s.keys.gemini ?? '' });
  const res = await ai.models.generateContent({
    model: s.images.geminiModel,
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nAspect ratio ${aspect}. No text, no watermark unless explicitly requested.` }] }],
    config: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: aspect } } as never,
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(`Gemini returned no image${res.text ? `: ${res.text.slice(0, 200)}` : ''}`);
  const ext = part.inlineData.mimeType?.includes('jpeg') ? '.jpg' : '.png';
  return { file: await save(part.inlineData.data, ext), engine, model: s.images.geminiModel };
};
