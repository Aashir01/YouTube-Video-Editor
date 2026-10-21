// Bundled fonts (offline, identical in preview and render).
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/montserrat/index.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource/anton/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource-variable/oswald/index.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource-variable/playfair-display/index.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@fontsource/permanent-marker/400.css';
import { useEffect } from 'react';
import { continueRender, delayRender, getRemotionEnvironment } from 'remotion';
import { FONTS } from '../shared/fonts';

/** Load every weight of every bundled family (local files, a few hundred ms). */
const loadAllFonts = async (): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts) return;
  const jobs = FONTS.flatMap((f) => f.weights.map((w) => document.fonts.load(`${w} 48px "${f.family}"`).catch(() => undefined)));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 15000))]);
};

let fontsPromise: Promise<void> | null = null;
export const ensureFonts = (): Promise<void> => (fontsPromise ??= loadAllFonts());

export const ALL_FONT_IDS = FONTS.map((f) => f.id);

// When rendering, block the first frame until fonts are ready. This runs once at
// module load (not inside a component) so discarded/retried React renders can't
// leave a dangling delayRender handle.
if (typeof document !== 'undefined') {
  let rendering = false;
  try {
    rendering = getRemotionEnvironment().isRendering;
  } catch {
    rendering = false;
  }
  if (rendering) {
    const handle = delayRender('Loading fonts', { timeoutInMilliseconds: 30000 });
    void ensureFonts().finally(() => continueRender(handle));
  }
}

/** Preloads fonts in the editor preview (rendering is already covered at module load). */
export const useFontsReady = (_ids?: string[]): void => {
  useEffect(() => {
    void ensureFonts();
  }, []);
};
