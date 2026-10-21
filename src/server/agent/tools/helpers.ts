import type { Project } from '../../../shared/schema';
import { formatTime, lintProject, projectDuration, summarizeTimeline } from '../../../shared/timeline';
import { TEMPLATE_IDS } from '../../../shared/templates';
import { store } from '../../storage/projects';
import { getServerOrigin } from '../../render/render';
import type { ToolContext } from '../types';

export const mutate = (ctx: ToolContext, label: string, fn: (draft: Project) => void | Promise<void>): Promise<Project> =>
  store.update(ctx.projectId, label, fn, { source: ctx.source });

export const getProject = (ctx: ToolContext) => store.get(ctx.projectId);

/** Short state readout appended to edit results so the model keeps an accurate picture. */
export const timelineReadout = (p: Project, opts: { full?: boolean } = {}): string => {
  const warnings = lintProject(p, TEMPLATE_IDS);
  const dur = projectDuration(p);
  const target = p.brief.targetDurationSec ? ` (target ${formatTime(p.brief.targetDurationSec, false)})` : '';
  return [
    `Timeline length: ${formatTime(dur)}${target}`,
    opts.full ? summarizeTimeline(p, 60) : summarizeTimeline(p, 12),
    warnings.length ? `Warnings:\n- ${warnings.slice(0, 8).join('\n- ')}` : 'Warnings: none',
  ].join('\n');
};

export const mediaUrl = (projectId: string, file: string) => `${getServerOrigin()}/media/${projectId}/${encodeURIComponent(file)}`;

export const toSeconds = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const parts = v.trim().split(':').map(Number);
  if (parts.some((x) => Number.isNaN(x))) return undefined;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
};

export const mainTrackEnd = (p: Project): number => {
  const main = p.tracks.find((t) => t.name === 'Main') ?? p.tracks.find((t) => t.kind === 'video');
  return main ? main.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) : 0;
};
