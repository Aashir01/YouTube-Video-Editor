import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DIRECTOR_DATA_DIR ??= path.join(os.tmpdir(), `cutroom-config-test-${process.pid}`);
const { SettingsSchema, maskedSettings, mergeSettingsUpdate, cloudUrl } = await import('./config');

describe('Cutroom AI settings', () => {
  const signedIn = SettingsSchema.parse({ cloud: { token: 'crk_secret', email: 'a@example.com', url: '' } });

  it('never sends the token to the browser and keeps it when the browser saves other settings', () => {
    const masked = maskedSettings(signedIn);
    expect(masked.cloud.token).toBe('••••');
    const next = mergeSettingsUpdate(signedIn, { ...masked, render: { ...masked.render, quality: 'high' } });
    expect(next.cloud.token).toBe('crk_secret');
    expect(next.render.quality).toBe('high');
  });

  it('lets the browser change the server address, nothing else of the sign-in', () => {
    const next = mergeSettingsUpdate(signedIn, { cloud: { url: ' https://cloud.example.com/ ', token: 'crk_forged', email: 'x@example.com', models: [] } });
    expect(next.cloud.token).toBe('crk_secret');
    expect(next.cloud.email).toBe('a@example.com');
    expect(cloudUrl(next)).toBe('https://cloud.example.com');
  });
});
