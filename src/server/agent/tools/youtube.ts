import fs from 'node:fs';
import { z } from 'zod';
import { store } from '../../storage/projects';
import { uploadVideo, youtubeConfigured } from '../../services/youtube';
import { defineTool } from '../types';
import { getProject, mutate } from './helpers';

export const uploadToYouTube = defineTool({
  name: 'upload_to_youtube',
  category: 'publish',
  description:
    'Upload a finished render to the user\'s connected YouTube channel with the project metadata, thumbnail and captions. ALWAYS requires the user\'s explicit approval. Default privacy is private (the user can publish from YouTube Studio). Only call when the user asked to publish/upload.',
  schema: z.object({
    renderId: z.string().optional().describe('Default: the latest finished full render'),
    privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
    publishAt: z.string().optional().describe('ISO date-time to schedule publishing (uploads as private until then)'),
  }),
  execute: async (input, ctx) => {
    const yt = youtubeConfigured();
    if (!yt.connected) return { text: 'YouTube is not connected. Ask the user to connect their channel in Settings → YouTube (needs a Google OAuth client).', isError: true };
    const p = await getProject(ctx);
    const render = input.renderId ? p.renders.find((r) => r.id === input.renderId) : p.renders.find((r) => r.kind === 'video' && r.status === 'done');
    if (!render?.file) return { text: 'No finished render found. Render the video first (render_video).', isError: true };
    if (!p.youtube.title) return { text: 'Set the YouTube title/description first (set_youtube_metadata).', isError: true };
    const ok = await ctx.approve(`Upload "${p.youtube.title}" to YouTube${yt.channelTitle ? ` (${yt.channelTitle})` : ''} as ${input.publishAt ? `scheduled ${input.publishAt}` : input.privacy}`, undefined, { always: true });
    if (!ok) return { text: 'The user declined the upload.', isError: true };
    const videoFile = store.renderPath(ctx.projectId, render.file);
    const srt = store.renderPath(ctx.projectId, render.file.replace(/\.mp4$/, '.srt'));
    const thumb = p.youtube.thumbnail.file ? store.mediaPath(ctx.projectId, p.youtube.thumbnail.file) : undefined;
    const result = await uploadVideo(p, {
      videoFile,
      thumbnailFile: thumb && fs.existsSync(thumb) ? thumb : undefined,
      captionsFile: fs.existsSync(srt) ? srt : undefined,
      privacy: input.privacy,
      publishAt: input.publishAt,
      onProgress: (x) => ctx.progress(`Uploading ${Math.round(x * 100)}%`),
    });
    await mutate(ctx, 'Uploaded to YouTube', (d) => void (d.youtube.uploadedVideoId = result.videoId));
    return { text: `Uploaded: ${result.url} (${input.publishAt ? `scheduled for ${input.publishAt}` : input.privacy}).${result.warnings.length ? ` Notes: ${result.warnings.join(' ')}` : ''}`, summary: result.url };
  },
});
