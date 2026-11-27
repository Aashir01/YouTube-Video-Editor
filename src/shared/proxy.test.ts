import { describe, expect, it } from 'vitest';
import { needsProxy, proxySize } from './proxy';

describe('editing proxies', () => {
  it('are made for footage browsers struggle with', () => {
    expect(needsProxy({ codec: 'h264', width: 1920, height: 1080, duration: 60 })).toBe(false);
    expect(needsProxy({ codec: 'hevc', width: 1920, height: 1080, duration: 60 })).toBe(true); // iPhone footage
    expect(needsProxy({ codec: 'prores', width: 1920, height: 1080, duration: 60 })).toBe(true);
    expect(needsProxy({ codec: 'h264', width: 3840, height: 2160, duration: 60 })).toBe(true); // 4K
    expect(needsProxy({ codec: 'h264', width: 1920, height: 1080, duration: 3600 })).toBe(true); // an hour
    expect(needsProxy({ codec: 'h264', width: 1280, height: 720 }, 'always')).toBe(true);
    expect(needsProxy({ codec: 'hevc', width: 3840, height: 2160 }, 'off')).toBe(false);
  });

  it('keep the shape with the short side at 540 px (never upscaled)', () => {
    expect(proxySize(3840, 2160)).toEqual({ width: 960, height: 540 });
    expect(proxySize(1080, 1920)).toEqual({ width: 540, height: 960 });
    expect(proxySize(640, 360)).toEqual({ width: 640, height: 360 });
  });
});
