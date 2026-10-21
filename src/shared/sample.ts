import type { Project, Word } from './schema';
import { createProject, placeClip } from './timeline';

const words = (text: string, start: number, wps = 2.6): Word[] => {
  const out: Word[] = [];
  let t = start;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const d = Math.max(0.18, Math.min(0.6, w.length / (wps * 4.5)));
    out.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 });
    t += d + 0.06;
  }
  return out;
};

/** A media-free demo that exercises templates, text, transitions and captions. */
export const createDemoProject = (format: 'long' | 'short' = 'long'): Project => {
  const p = createProject({ name: format === 'short' ? 'Demo Short' : 'Demo: Why Sleep Matters', format, mode: 'generate', topic: 'Why sleep matters' });
  p.brief.audience = 'Curious adults';
  p.brief.tone = 'Energetic, friendly';
  p.brand.channelName = 'Curious Minds';
  p.brand.handle = '@curiousminds';
  const main = 'Main';
  let t = 0;
  const add = (template: string, duration: number, props: Record<string, unknown>, transition = true) => {
    placeClip(p, { id: '', type: 'scene', template, start: t, duration, props, transitionIn: transition && t > 0 ? { type: 'fade', duration: 0.35 } : undefined }, { trackId: main });
    t += duration;
  };
  add('title-card', 4, { title: 'Why *Sleep* Matters', subtitle: 'The science in 60 seconds', kicker: 'Health explained', background: 'mesh' }, false);
  add('big-number', 4, { value: 35, suffix: '%', label: 'of adults sleep less than 7 hours', sublabel: 'CDC estimate', background: 'spotlight' });
  add('bullet-list', 6, { heading: '3 rules for better sleep', items: ['Same wake-up time every day', 'No screens an hour before bed', 'Keep your room cool and dark'], icon: 'check', background: 'grid' });
  add('bar-chart', 6, { title: 'Reaction time vs. hours slept', data: [{ label: '4h', value: 410 }, { label: '5h', value: 360 }, { label: '6h', value: 320 }, { label: '7h', value: 290 }, { label: '8h', value: 270 }], unit: 'ms', highlightIndex: 4, source: 'Illustrative data' });
  add('quote', 5, { quote: 'Sleep is the golden chain that ties health and our bodies together.', author: 'Thomas Dekker' });
  add('end-screen', 5, { title: 'Watch next', subtitle: 'Thanks for watching!' });
  const narration = 'Sleep is your superpower. Yet one in three adults does not get enough of it. Here are three simple rules that will change your nights.';
  placeClip(p, { id: '', type: 'captions', mode: 'manual', start: 0, duration: 14, words: words(narration, 0.4), style: { preset: 'bold-pop' } });
  placeClip(p, { id: '', type: 'text', text: 'Stay till the end 👀', start: 21, duration: 3, x: 0.5, y: 0.88, style: { size: 46, background: 'rgba(0,0,0,0.6)', font: 'inter', weight: 700 }, animationIn: 'pop' });
  placeClip(p, { id: '', type: 'scene', template: 'subscribe-cta', start: 26, duration: 3.5, props: { handle: '@curiousminds' } }, { trackId: 'Graphics' });
  p.youtube.chapters = [
    { time: 0, title: 'Intro' },
    { time: 4, title: 'The problem' },
    { time: 8, title: 'Three rules' },
    { time: 14, title: 'The data' },
  ];
  return p;
};
