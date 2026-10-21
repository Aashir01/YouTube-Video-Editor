import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Picks a Chromium for rendering. Order:
 *  1. DIRECTOR_BROWSER / REMOTION_BROWSER_EXECUTABLE env var
 *  2. A Playwright "chromium_headless_shell" install (common on dev machines/CI)
 *  3. null -> Remotion downloads its own Chrome Headless Shell on first render
 */
export const resolveBrowserExecutable = (configured?: string | null): string | null => {
  const explicit = configured || process.env.DIRECTOR_BROWSER || process.env.REMOTION_BROWSER_EXECUTABLE;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')].filter(
    (p): p is string => Boolean(p),
  );
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    const shells = entries.filter((e) => e.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const dir of shells) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/headless_shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-win/headless_shell.exe', 'chrome-headless-shell-win64/chrome-headless-shell.exe']) {
        const candidate = path.join(root, dir, rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
};
