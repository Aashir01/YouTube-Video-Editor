import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DIRECTOR_DATA_DIR ??= path.join(os.tmpdir(), `cutroom-hosted-test-${process.pid}`);
process.env.CUTROOM_FORCE_URL_GUARD = '1';
const { assertPublicUrl, isPrivateAddress } = await import('./hosted');

describe('website URL guard', () => {
  it('knows private, loopback, link-local and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1'])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '149.28.31.193', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses addresses that lead into the server, and other schemes', async () => {
    const lookup = (map: Record<string, string>) => async (host: string) => (map[host] ? [{ address: map[host]! }] : []);
    await expect(assertPublicUrl('http://127.0.0.1:8787/v1/admin/stats')).rejects.toThrow(/private network/);
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(/private network/);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/private network/);
    await expect(assertPublicUrl('http://sneaky.example/', lookup({ 'sneaky.example': '10.0.0.5' }))).rejects.toThrow(/private network/);
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/http and https/);
    await expect(assertPublicUrl('https://nowhere.invalid/', lookup({}))).rejects.toThrow(/Could not find/);
    expect((await assertPublicUrl('https://videos.example/a.mp4', lookup({ 'videos.example': '93.184.216.34' }))).hostname).toBe('videos.example');
  });
});
