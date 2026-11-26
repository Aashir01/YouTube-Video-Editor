import { useStudio } from './store';
import { player } from './player';

/** A small scripting surface: used by end-to-end tests and handy from the browser console. */
declare global {
  interface Window {
    cutroom?: { store: typeof useStudio; player: typeof player; seek: (t: number) => void; state: () => ReturnType<typeof useStudio.getState> };
  }
}

window.cutroom = { store: useStudio, player, seek: (t) => player.seek(t), state: () => useStudio.getState() };
