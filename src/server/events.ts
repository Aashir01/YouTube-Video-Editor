import type { Project, RenderRecord } from '../shared/schema';
import type { AgentEvent } from '../shared/agent-types';

export type StudioEvent =
  | { type: 'project'; project: Project; label: string; source: 'user' | 'agent' | 'system' | 'mcp'; canUndo: boolean; canRedo: boolean }
  | { type: 'agent'; event: AgentEvent }
  | { type: 'render'; render: RenderRecord }
  | { type: 'job'; id: string; label: string; status: 'running' | 'done' | 'error'; progress?: number; detail?: string }
  | { type: 'toast'; level: 'info' | 'success' | 'warning' | 'error'; message: string };

type Listener = (e: StudioEvent) => void;

/** Fan-out of server events to SSE subscribers, per project. */
class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(projectId: string, fn: Listener): () => void {
    let set = this.listeners.get(projectId);
    if (!set) {
      set = new Set();
      this.listeners.set(projectId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.listeners.delete(projectId);
    };
  }

  emit(projectId: string, event: StudioEvent): void {
    for (const fn of this.listeners.get(projectId) ?? []) {
      try {
        fn(event);
      } catch (err) {
        console.error('[events] listener failed', err);
      }
    }
    // the "*" channel receives everything (used by the MCP bridge / project list)
    if (projectId !== '*') for (const fn of this.listeners.get('*') ?? []) fn(event);
  }

  toast(projectId: string, level: 'info' | 'success' | 'warning' | 'error', message: string) {
    this.emit(projectId, { type: 'toast', level, message });
  }
}

export const bus = new EventBus();
