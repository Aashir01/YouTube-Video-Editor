/**
 * Shorts autopilot: every moment Find Shorts picked becomes a Short, is rendered, and (with YouTube
 * connected) is uploaded scheduled one after another, e.g. one a day at 5 pm, best first.
 */
import type { Moment } from './moments';

export type AutopilotItemStatus = 'queued' | 'making' | 'rendering' | 'uploading' | 'scheduled' | 'rendered' | 'failed' | 'cancelled';

export interface AutopilotItem {
  momentId: string;
  title: string;
  /** when it goes public (ISO), with uploads on */
  publishAt?: string;
  status: AutopilotItemStatus;
  /** 0-1 within the current step */
  progress?: number;
  shortId?: string;
  renderId?: string;
  videoId?: string;
  url?: string;
  error?: string;
  note?: string;
}

export interface AutopilotOptions {
  /** upload to YouTube scheduled (otherwise only render) */
  upload: boolean;
  /** the first publish time (ISO) */
  firstAt: string;
  /** hours between two Shorts */
  everyHours: number;
}

export interface AutopilotState {
  createdAt: string;
  options: AutopilotOptions;
  status: 'running' | 'done' | 'stopped';
  items: AutopilotItem[];
}

export const FINISHED: AutopilotItemStatus[] = ['scheduled', 'rendered'];

/** Publish times: `n` slots from `firstAt`, `everyHours` apart. */
export const planSchedule = (n: number, firstAt: string | Date, everyHours: number): string[] => {
  const t0 = new Date(firstAt).getTime();
  if (!Number.isFinite(t0)) throw new Error('Pick a valid date and time for the first Short');
  const step = Math.max(1, everyHours) * 3_600_000;
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * step).toISOString());
};

/** The next `hour`:00 local time that is at least `leadMinutes` away (today or tomorrow). */
export const nextSlot = (now: Date, hour = 17, leadMinutes = 60): Date => {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() - now.getTime() < leadMinutes * 60_000) d.setDate(d.getDate() + 1);
  return d;
};

/** Best first: by score, then in the order they come in the video. */
export const autopilotOrder = (moments: Moment[]) => [...moments].sort((a, b) => b.score - a.score || a.start - b.start);

/** What a Short says on YouTube: its title, the hook, where it comes from, and #Shorts. */
export const shortMetadata = (m: Pick<Moment, 'title' | 'hook'>, source: { title: string; videoId?: string; hashtags: string[] }) => {
  const from = source.videoId ? `Full video: https://youtu.be/${source.videoId}` : source.title ? `From "${source.title}"` : '';
  const tags = source.hashtags.map((h) => h.replace(/^#/, '')).filter((h) => h && h.toLowerCase() !== 'shorts');
  return {
    title: m.title.slice(0, 100),
    description: [m.hook, from].filter(Boolean).join('\n\n'),
    hashtags: ['Shorts', ...tags].slice(0, 15),
  };
};
