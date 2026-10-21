import type { StudioEvent } from '../../server/events';

interface Handlers {
  onEvent: (e: StudioEvent) => void;
  onStatus: (connected: boolean) => void;
  /** Fired on every (re)connection; use it to resync state that may have been missed. */
  onHello: () => void;
}

/** Live project events over SSE. EventSource reconnects on its own after network blips or server restarts. */
export const connectProject = (projectId: string, h: Handlers): (() => void) => {
  const es = new EventSource(`/api/projects/${projectId}/events`);
  es.addEventListener('hello', () => {
    h.onStatus(true);
    h.onHello();
  });
  es.addEventListener('studio', (ev) => {
    try {
      h.onEvent(JSON.parse((ev as MessageEvent<string>).data) as StudioEvent);
    } catch (err) {
      console.warn('[events] bad event', err);
    }
  });
  es.onerror = () => h.onStatus(false);
  return () => es.close();
};
