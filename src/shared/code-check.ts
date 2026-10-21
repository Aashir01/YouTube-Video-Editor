import { transform } from 'sucrase';

export const CODE_SCENE_MODULES = ['react', 'remotion', '@remotion/shapes', '@remotion/paths', '@remotion/noise', '@remotion/layout-utils', 'director'];

export interface CodeCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Static checks for AI-written scenes (no execution): syntax, imports, export, determinism. */
export const checkSceneCode = (code: string): CodeCheck => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let js = '';
  try {
    js = transform(code, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'classic', production: true, filePath: 'scene.tsx' }).code;
  } catch (err) {
    errors.push(`Syntax error: ${(err as Error).message}`);
    return { ok: false, errors, warnings };
  }
  // check the source too: TypeScript-style elision drops unused imports from the output
  const imported = new Set<string>();
  for (const m of js.matchAll(/require\(['"]([^'"]+)['"]\)/g)) imported.add(m[1]!);
  for (const m of code.matchAll(/^\s*import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gm)) imported.add(m[1]!);
  for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) imported.add(m[1]!);
  for (const name of imported) {
    if (!CODE_SCENE_MODULES.includes(name)) errors.push(`Import "${name}" is not available. Allowed: ${CODE_SCENE_MODULES.join(', ')}`);
  }
  if (!/exports\.default\s*=|exports,\s*["']default["']/.test(js) && !/export\s+default/.test(code)) errors.push('The scene must `export default` a React component.');
  if (/Math\.random\(/.test(code)) errors.push('Math.random() makes frames non-deterministic; use random("seed") from remotion.');
  if (/Date\.now\(|new Date\(/.test(code)) warnings.push('Avoid Date.now()/new Date(): renders must be deterministic.');
  if (/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(code)) errors.push('Network requests are not allowed in scenes.');
  if (/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(code)) errors.push('Timers are not allowed; animate with useCurrentFrame()/interpolate().');
  if (/transition\s*:\s*['"`]|animation\s*:\s*['"`]|@keyframes/.test(code)) warnings.push('CSS transitions/animations do not render; drive animation from the frame.');
  return { ok: errors.length === 0, errors, warnings };
};
