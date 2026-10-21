import type { PlayerRef } from '@remotion/player';
import { useStudio } from './store';

/**
 * One preview player per editor. Components that don't own the player (timeline,
 * shortcuts, chat links) control it through this registry.
 */
let ref: PlayerRef | null = null;
let fps = 30;
let durationFrames = 1;

export const player = {
  attach(r: PlayerRef | null, f: number, frames: number) {
    ref = r;
    fps = f;
    durationFrames = Math.max(1, frames);
  },
  get fps() {
    return fps;
  },
  seek(t: number) {
    const frame = Math.max(0, Math.min(durationFrames - 1, Math.round(t * fps)));
    useStudio.getState().setTime(ref ? frame / fps : Math.max(0, t));
    ref?.seekTo(frame);
  },
  toggle() {
    if (!ref) return;
    if (ref.isPlaying()) ref.pause();
    else {
      // restart from the top when parked at the end
      if (ref.getCurrentFrame() >= durationFrames - 1) ref.seekTo(0);
      ref.play();
    }
  },
  pause() {
    ref?.pause();
  },
  step(frames: number) {
    const cur = ref ? ref.getCurrentFrame() : Math.round(useStudio.getState().time * fps);
    this.seek((cur + frames) / fps);
  },
  toEnd() {
    this.seek((durationFrames - 1) / fps);
  },
};
