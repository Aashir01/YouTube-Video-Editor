import type { PlayerRef } from '@remotion/player';
import { useStudio } from './store';

/**
 * One preview player per editor. Components that don't own the player (timeline,
 * shortcuts, chat links) control it through this registry.
 */
let ref: PlayerRef | null = null;
let fps = 30;
let durationFrames = 1;
let beyond: number | null = null;

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
    // the playhead may sit past the end (to paste or add things there); the picture shows the last frame
    beyond = t > (durationFrames - 1) / fps + 1e-6 ? Math.round(t * fps) / fps : null;
    useStudio.getState().setTime(beyond ?? (ref ? frame / fps : Math.max(0, t)));
    ref?.seekTo(frame);
  },
  /** Playhead time past the end of the video, if it was put there. */
  get beyondEnd() {
    return beyond;
  },
  toggle() {
    if (!ref) return;
    beyond = null;
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
  play() {
    beyond = null;
    ref?.play();
  },
  get playing() {
    return ref?.isPlaying() ?? false;
  },
  step(frames: number) {
    const cur = ref ? ref.getCurrentFrame() : Math.round(useStudio.getState().time * fps);
    this.seek((cur + frames) / fps);
  },
  toEnd() {
    this.seek((durationFrames - 1) / fps);
  },
};
