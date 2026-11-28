import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Project } from '../../shared/schema';
import { getSavedSettings, getSettings, saveSettings } from '../config';

/**
 * YouTube Data API v3 publishing (OAuth "installed app" flow with a loopback
 * redirect). Users create a Google Cloud OAuth client of type "Desktop app",
 * enable "YouTube Data API v3", and paste the client id/secret in Settings.
 */

// overridable so tests can stand in for Google
const API = () => (process.env.CUTROOM_YOUTUBE_API_BASE || 'https://www.googleapis.com').replace(/\/+$/, '');
const OAUTH = () => (process.env.CUTROOM_GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com').replace(/\/+$/, '');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'];

let pendingState: { state: string; redirectUri: string } | null = null;

export const youtubeConfigured = () => {
  const s = getSettings().youtube;
  return { hasClient: Boolean(s.clientId && s.clientSecret), connected: Boolean(s.refreshToken), channelTitle: s.channelTitle };
};

export const authUrl = (redirectUri: string): string => {
  const s = getSettings().youtube;
  if (!s.clientId || !s.clientSecret) throw new Error('Add your Google OAuth client id and secret in Settings → YouTube first.');
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  pendingState = { state, redirectUri };
  const params = new URLSearchParams({
    client_id: s.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

export const handleCallback = async (code: string, state: string): Promise<string> => {
  if (!pendingState || pendingState.state !== state) throw new Error('OAuth state mismatch. Start the connection again from Settings.');
  const s = getSettings().youtube;
  const res = await fetch(`${OAUTH()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: pendingState.redirectUri, grant_type: 'authorization_code' }),
  });
  pendingState = null;
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; error_description?: string; error?: string };
  if (!res.ok || !j.refresh_token) throw new Error(`Google sign-in failed: ${j.error_description ?? j.error ?? res.status}${!j.refresh_token && res.ok ? ' (no refresh token returned — remove the app from your Google account permissions and retry)' : ''}`);
  let channelTitle = '';
  try {
    const ch = await fetch(`${API()}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${j.access_token}` } });
    const cj = (await ch.json()) as { items?: { snippet?: { title?: string } }[] };
    channelTitle = cj.items?.[0]?.snippet?.title ?? '';
  } catch {
    /* channel lookup is cosmetic */
  }
  const saved = getSavedSettings();
  saveSettings({ ...saved, youtube: { ...saved.youtube, refreshToken: j.refresh_token, channelTitle } });
  return channelTitle;
};

export const disconnect = () => {
  const saved = getSavedSettings();
  saveSettings({ ...saved, youtube: { ...saved.youtube, refreshToken: '', channelTitle: '' } });
};

/**
 * GET from the YouTube Data API: with a Data API key (Settings → Media & search keys, or
 * YOUTUBE_API_KEY) when there is one, otherwise as the connected channel.
 */
export const youtubeApiGet = async <T>(resource: string, params: Record<string, string | number | undefined>): Promise<T> => {
  const key = getSettings().keys.youtube;
  if (!key && !getSettings().youtube.refreshToken) throw new Error('Add a YouTube Data API key (Settings → Media & search keys) or connect your channel (Settings → YouTube) first.');
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  if (key) q.set('key', key);
  const res = await fetch(`${API()}/youtube/v3/${resource}?${q}`, { headers: key ? {} : { Authorization: `Bearer ${await accessToken()}` } });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    throw new Error(reason === 'quotaExceeded' ? 'The YouTube API quota for today is used up (it resets at midnight Pacific time)' : `YouTube API: ${j.error?.message ?? res.status}`);
  }
  return j;
};

const accessToken = async (): Promise<string> => {
  const s = getSettings().youtube;
  if (!s.refreshToken) throw new Error('YouTube is not connected. Connect your channel in Settings → YouTube.');
  const res = await fetch(`${OAUTH()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' }),
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Could not refresh YouTube access: ${j.error_description ?? res.status}`);
  return j.access_token;
};

export interface UploadOptions {
  videoFile: string;
  thumbnailFile?: string;
  captionsFile?: string;
  /** more subtitle tracks, one per language */
  subtitles?: { language: string; name: string; file: string }[];
  /** the title and description in other languages */
  localizations?: Record<string, { title: string; description: string }>;
  privacy: 'private' | 'unlisted' | 'public';
  publishAt?: string;
  onProgress?: (p: number) => void;
}

const descriptionWithChapters = (p: Project): string => {
  const d = p.youtube.description.trim();
  if (!p.youtube.chapters.length || /\b0?0:00\b/.test(d)) return d;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return `${d}\n\nChapters:\n${p.youtube.chapters.map((c) => `${fmt(c.time)} ${c.title}`).join('\n')}`;
};

/** The videos.insert body: snippet, status and (when there are any) the title and description in other languages. */
export const videoMetadata = (project: Project, opts: Pick<UploadOptions, 'privacy' | 'publishAt' | 'localizations'>) => {
  const hashtags = project.youtube.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  const localizations = Object.fromEntries(
    Object.entries(opts.localizations ?? {}).map(([lang, l]) => [lang, { title: l.title.slice(0, 100), description: [l.description, hashtags].filter(Boolean).join('\n\n').slice(0, 5000) }]),
  );
  const localized = Object.keys(localizations).length > 0;
  return {
    snippet: {
      title: (project.youtube.title || project.name).slice(0, 100),
      description: [descriptionWithChapters(project), hashtags].filter(Boolean).join('\n\n').slice(0, 5000),
      tags: project.youtube.tags.slice(0, 30),
      categoryId: project.youtube.category || '27',
      // YouTube needs the original language to accept localizations
      defaultLanguage: project.brief.language || (localized ? 'en' : undefined),
    },
    status: { privacyStatus: opts.publishAt ? 'private' : opts.privacy, selfDeclaredMadeForKids: project.youtube.madeForKids, ...(opts.publishAt ? { publishAt: opts.publishAt } : {}) },
    ...(localized ? { localizations } : {}),
  };
};

export const uploadVideo = async (project: Project, opts: UploadOptions): Promise<{ videoId: string; url: string; warnings: string[] }> => {
  const token = await accessToken();
  const size = (await fsp.stat(opts.videoFile)).size;
  const meta = videoMetadata(project, opts);
  const parts = `snippet,status${'localizations' in meta ? ',localizations' : ''}`;
  const init = await fetch(`${API()}/upload/youtube/v3/videos?uploadType=resumable&part=${parts}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`YouTube upload init failed (${init.status}): ${(await init.text()).slice(0, 400)}`);
  const session = init.headers.get('location');
  if (!session) throw new Error('YouTube did not return an upload session');
  let sent = 0;
  const stream = fs.createReadStream(opts.videoFile);
  stream.on('data', (d) => {
    sent += d.length;
    opts.onProgress?.(sent / size);
  });
  const put = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: Readable.toWeb(stream) as unknown as BodyInit,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  if (!put.ok) throw new Error(`YouTube upload failed (${put.status}): ${(await put.text()).slice(0, 400)}`);
  const video = (await put.json()) as { id: string };
  const warnings: string[] = [];
  if (opts.thumbnailFile) {
    const img = await fsp.readFile(opts.thumbnailFile);
    const t = await fetch(`${API()}/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' }, body: img });
    if (!t.ok) warnings.push(`Thumbnail not set (${t.status}) — custom thumbnails require a verified YouTube account.`);
  }
  const tracks = [...(opts.captionsFile ? [{ language: project.brief.language || 'en', name: 'Captions', file: opts.captionsFile }] : []), ...(opts.subtitles ?? [])];
  for (const track of tracks) {
    const boundary = `director${Date.now()}`;
    const srt = await fsp.readFile(track.file);
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ snippet: { videoId: video.id, language: track.language, name: track.name, isDraft: false } })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--`);
    const c = await fetch(`${API()}/upload/youtube/v3/captions?uploadType=multipart&part=snippet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([head, srt, tail]),
    });
    if (!c.ok) warnings.push(`${track.name} subtitles (${track.language}) not uploaded (${c.status}).`);
  }
  return { videoId: video.id, url: `https://youtu.be/${video.id}`, warnings };
};
