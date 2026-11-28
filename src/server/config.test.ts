import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DIRECTOR_DATA_DIR ??= path.join(os.tmpdir(), `cutroom-config-test-${process.pid}`);
const { SettingsSchema, maskedSettings, mergeSettingsUpdate, cloudUrl, madeWithCutroom } = await import('./config');

describe('Cutroom AI settings', () => {
  const signedIn = SettingsSchema.parse({ cloud: { token: 'crk_secret', email: 'a@example.com', url: '' } });

  it('never sends the token to the browser and keeps it when the browser saves other settings', () => {
    const masked = maskedSettings(signedIn);
    expect(masked.cloud.token).toBe('••••');
    const next = mergeSettingsUpdate(signedIn, { ...masked, render: { ...masked.render, quality: 'high' } });
    expect(next.cloud.token).toBe('crk_secret');
    expect(next.render.quality).toBe('high');
  });

  it('puts the "Made with Cutroom" badge only on the free Cutroom AI plan', () => {
    expect(madeWithCutroom({ ...signedIn, cloud: { ...signedIn.cloud, plan: 'free' } })).toBe(true);
    expect(madeWithCutroom({ ...signedIn, cloud: { ...signedIn.cloud, plan: 'creator' } })).toBe(false);
    expect(madeWithCutroom({ ...signedIn, cloud: { ...signedIn.cloud, token: '', plan: 'free' } })).toBe(false);
  });

  it("uses Cutroom's own server unless one is set", () => {
    const saved = process.env.CUTROOM_CLOUD_URL;
    delete process.env.CUTROOM_CLOUD_URL;
    try {
      expect(cloudUrl(SettingsSchema.parse({}))).toBe('https://cloud.cutroom.aashirnoman.dev');
      process.env.CUTROOM_CLOUD_URL = 'http://localhost:8787/';
      expect(cloudUrl(SettingsSchema.parse({}))).toBe('http://localhost:8787');
      expect(cloudUrl(SettingsSchema.parse({ cloud: { url: 'https://mine.example.com' } }))).toBe('https://mine.example.com');
    } finally {
      if (saved === undefined) delete process.env.CUTROOM_CLOUD_URL;
      else process.env.CUTROOM_CLOUD_URL = saved;
    }
  });

  it('lets the browser change the server address, nothing else of the sign-in', () => {
    const next = mergeSettingsUpdate(signedIn, { cloud: { url: ' https://cloud.example.com/ ', token: 'crk_forged', email: 'x@example.com', plan: 'creator', models: [] } });
    expect(next.cloud.token).toBe('crk_secret');
    expect(next.cloud.email).toBe('a@example.com');
    expect(next.cloud.plan).toBe('');
    expect(cloudUrl(next)).toBe('https://cloud.example.com');
  });
});
