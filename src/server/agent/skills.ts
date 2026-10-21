import fs from 'node:fs';
import path from 'node:path';
import { USER_SKILLS_DIR } from '../config';

export interface Skill {
  name: string;
  description: string;
  body: string;
  source: 'builtin' | 'user';
}

const BUILTIN_DIR = path.join(import.meta.dirname, 'skills');

const parse = (raw: string, fallbackName: string, source: Skill['source']): Skill => {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw.replace(/\r/g, ''));
  const meta: Record<string, string> = {};
  if (m) for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name: meta.name || fallbackName, description: meta.description || '', body: (m ? m[2]! : raw).trim(), source };
};

const readDir = (dir: string, source: Skill['source']): Skill[] => {
  const out: Skill[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    try {
      if (e.isFile() && e.name.endsWith('.md')) out.push(parse(fs.readFileSync(path.join(dir, e.name), 'utf8'), e.name.replace(/\.md$/, ''), source));
      else if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md'))) out.push(parse(fs.readFileSync(path.join(dir, e.name, 'SKILL.md'), 'utf8'), e.name, source));
    } catch {
      /* unreadable skill */
    }
  }
  return out;
};

/** Built-in skills plus the user's own (data/skills/*.md or data/skills/<name>/SKILL.md). */
export const listSkills = (): Skill[] => {
  const map = new Map<string, Skill>();
  for (const s of readDir(BUILTIN_DIR, 'builtin')) map.set(s.name, s);
  for (const s of readDir(USER_SKILLS_DIR, 'user')) map.set(s.name, s);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const getSkill = (name: string): Skill | undefined => listSkills().find((s) => s.name === name.trim().toLowerCase() || s.name === name.trim());

export const skillIndex = (): string =>
  listSkills()
    .map((s) => `- ${s.name}: ${s.description}${s.source === 'user' ? ' (user skill)' : ''}`)
    .join('\n');
