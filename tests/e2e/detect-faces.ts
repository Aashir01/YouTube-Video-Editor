// Runs the app's face detector on still images and prints the faces it finds (used by the e2e suites).
// Usage: node --import tsx tests/e2e/detect-faces.ts '{"files":["a.jpg"],"size":{"width":1080,"height":1920}}'
import { detectFaces } from '../../src/server/media/faces';

const { files, size } = JSON.parse(process.argv[2] ?? '{}') as { files: string[]; size: { width: number; height: number } };
const out: unknown[] = [];
for (const f of files) {
  const r = await detectFaces(f, size);
  out.push(r?.[0]?.faces ?? null);
}
console.log(`RESULT${JSON.stringify(out)}`);
