/**
 * Proxies: light copies of heavy footage for smooth editing in the browser (renders always use the
 * original). Made automatically for footage browsers can't play (HEVC/ProRes…), above 1080p or long.
 */
export type ProxyMode = 'auto' | 'always' | 'off';

/** Video codecs every browser editor plays well. */
export const BROWSER_CODECS = ['h264', 'vp8', 'vp9', 'av1'];

export const needsProxy = (meta: { codec?: string; width?: number; height?: number; duration?: number }, mode: ProxyMode = 'auto'): boolean => {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  const codec = (meta.codec ?? 'h264').toLowerCase();
  return !BROWSER_CODECS.includes(codec) || (meta.width ?? 0) * (meta.height ?? 0) > 1920 * 1088 || (meta.duration ?? 0) > 1200;
};

/** Proxy picture size: the short side at most 540 px, even dimensions, same shape. */
export const proxySize = (width: number, height: number): { width: number; height: number } => {
  const k = Math.min(1, 540 / Math.min(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
};
