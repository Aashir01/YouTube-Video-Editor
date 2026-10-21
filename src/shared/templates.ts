import { z } from 'zod';

/**
 * Motion-graphics template catalog. Each template is a parameterized Remotion
 * component (src/remotion/templates). Full-screen templates paint their own
 * background; overlay templates are transparent and sit above footage.
 */

const Background = z
  .enum(['gradient', 'mesh', 'grid', 'dots', 'solid', 'spotlight', 'noise', 'image', 'transparent'])
  .default('mesh')
  .describe('Animated background style (image uses imageAssetId)');

const text = (d: string) => z.string().describe(d);

export const TEMPLATE_CATEGORIES = ['titles', 'lists', 'data', 'quotes', 'overlays', 'calls-to-action', 'explainers', 'media'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  overlay: boolean;
  defaultDuration: number;
  schema: S;
  example: z.input<S>;
}

const def = <S extends z.ZodTypeAny>(d: TemplateDef<S>): TemplateDef<S> => d;

export const TEMPLATES = [
  def({
    id: 'title-card',
    name: 'Title Card',
    category: 'titles',
    description: 'Big animated title with optional kicker and subtitle. Use for the video intro, section openers or a bold statement.',
    overlay: false,
    defaultDuration: 4,
    schema: z.object({
      title: text('Main title (keep under ~8 words). Wrap words in *asterisks* to highlight them.'),
      subtitle: text('Optional subtitle').default(''),
      kicker: text('Small label above the title, e.g. "EPISODE 4"').default(''),
      align: z.enum(['center', 'left']).default('center'),
      animation: z.enum(['rise', 'split', 'typewriter', 'glitch', 'zoom']).default('rise'),
      background: Background,
      imageAssetId: z.string().optional(),
    }),
    example: { title: 'The *Future* of Energy', subtitle: 'What nobody tells you', kicker: 'DEEP DIVE' },
  }),
  def({
    id: 'kinetic-text',
    name: 'Kinetic Typography',
    category: 'titles',
    description: 'Punchy word-by-word typography for a key sentence. Great as a pattern interrupt or to land a strong point.',
    overlay: false,
    defaultDuration: 3.5,
    schema: z.object({
      text: text('Sentence to animate (max ~14 words)'),
      emphasis: z.array(z.string()).default([]).describe('Words to highlight with the accent color'),
      style: z.enum(['stack', 'flow', 'impact']).default('stack'),
      background: Background,
    }),
    example: { text: 'This changes everything you know about sleep', emphasis: ['everything', 'sleep'] },
  }),
  def({
    id: 'chapter-card',
    name: 'Chapter Card',
    category: 'titles',
    description: 'Section divider with a big number and chapter title. Use between major parts of a long video.',
    overlay: false,
    defaultDuration: 3,
    schema: z.object({
      number: z.union([z.number(), z.string()]).default(1),
      title: text('Chapter title'),
      subtitle: text('Optional one-line teaser').default(''),
      background: Background,
    }),
    example: { number: 2, title: 'How It Actually Works', subtitle: 'The physics in 60 seconds' },
  }),
  def({
    id: 'question',
    name: 'Big Question',
    category: 'titles',
    description: 'A large question that creates curiosity ("But why?"). Use as a retention hook before a reveal.',
    overlay: false,
    defaultDuration: 2.5,
    schema: z.object({ question: text('The question'), background: Background }),
    example: { question: 'So why does nobody talk about this?' },
  }),
  def({
    id: 'bullet-list',
    name: 'Bullet List',
    category: 'lists',
    description: 'Heading plus 2-6 points revealed one by one. Use for summaries, tips, requirements, takeaways.',
    overlay: false,
    defaultDuration: 6,
    schema: z.object({
      heading: text('List heading'),
      items: z.array(z.string()).min(1).max(8).describe('Short points (under ~10 words each)'),
      icon: z.enum(['check', 'dot', 'number', 'arrow', 'cross', 'star']).default('check'),
      background: Background,
    }),
    example: { heading: '3 Rules for Better Sleep', items: ['Same wake-up time every day', 'No screens 1 hour before bed', 'Keep the room cool'] },
  }),
  def({
    id: 'steps',
    name: 'Process Steps',
    category: 'lists',
    description: 'Numbered steps connected by a progress line. Use for how-tos, workflows and processes.',
    overlay: false,
    defaultDuration: 7,
    schema: z.object({
      title: text('Process title').default(''),
      steps: z
        .array(z.object({ title: z.string(), description: z.string().default('') }))
        .min(2)
        .max(6),
      background: Background,
    }),
    example: { title: 'How a Bill Becomes Law', steps: [{ title: 'Draft', description: 'A member writes the bill' }, { title: 'Committee', description: 'Experts review it' }, { title: 'Vote', description: 'Both chambers vote' }, { title: 'Sign', description: 'The president signs' }] },
  }),
  def({
    id: 'ranking',
    name: 'Ranking Item',
    category: 'lists',
    description: 'Listicle entry like "#3 — Title" with optional image. Use for top-N / countdown videos.',
    overlay: false,
    defaultDuration: 4,
    schema: z.object({
      rank: z.union([z.number(), z.string()]),
      title: text('Item title'),
      description: text('One-line description').default(''),
      imageAssetId: z.string().optional(),
      background: Background,
    }),
    example: { rank: 3, title: 'The Great Barrier Reef', description: 'Visible from space' },
  }),
  def({
    id: 'big-number',
    name: 'Big Number',
    category: 'data',
    description: 'Huge animated count-up statistic with a label. Use to make one striking number memorable.',
    overlay: false,
    defaultDuration: 4,
    schema: z.object({
      value: z.number(),
      prefix: z.string().default(''),
      suffix: z.string().default(''),
      decimals: z.number().int().min(0).max(4).default(0),
      label: text('What the number means'),
      sublabel: text('Optional context or source').default(''),
      countFrom: z.number().default(0),
      background: Background,
    }),
    example: { value: 8.1, suffix: 'B', decimals: 1, label: 'people on Earth', sublabel: 'UN estimate, 2024' },
  }),
  def({
    id: 'stat-grid',
    name: 'Stat Grid',
    category: 'data',
    description: '2-4 stat tiles that count up together. Use for comparing several key numbers.',
    overlay: false,
    defaultDuration: 5,
    schema: z.object({
      title: text('Optional heading').default(''),
      stats: z
        .array(z.object({ value: z.number(), prefix: z.string().default(''), suffix: z.string().default(''), decimals: z.number().default(0), label: z.string() }))
        .min(2)
        .max(4),
      background: Background,
    }),
    example: { title: 'By the numbers', stats: [{ value: 71, suffix: '%', label: 'of Earth is water' }, { value: 3.5, suffix: '%', decimals: 1, label: 'is fresh water' }, { value: 1, suffix: '%', label: 'is drinkable' }] },
  }),
  def({
    id: 'bar-chart',
    name: 'Bar Chart',
    category: 'data',
    description: 'Animated bar chart. Use for comparing quantities across categories. Always cite a source.',
    overlay: false,
    defaultDuration: 6,
    schema: z.object({
      title: text('Chart title'),
      data: z.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() })).min(1).max(12),
      unit: z.string().default(''),
      highlightIndex: z.number().int().optional().describe('Index of the bar to emphasize'),
      orientation: z.enum(['vertical', 'horizontal']).default('vertical'),
      source: text('Data source citation').default(''),
      background: Background,
    }),
    example: { title: 'Smartphone users (billions)', data: [{ label: '2016', value: 2.5 }, { label: '2018', value: 3.0 }, { label: '2020', value: 3.6 }, { label: '2022', value: 4.3 }, { label: '2024', value: 4.9 }], highlightIndex: 4, source: 'Statista' },
  }),
  def({
    id: 'line-chart',
    name: 'Line Chart',
    category: 'data',
    description: 'Animated line chart that draws itself. Use for trends over time.',
    overlay: false,
    defaultDuration: 6,
    schema: z.object({
      title: text('Chart title'),
      labels: z.array(z.string()).min(2).describe('X axis labels'),
      series: z.array(z.object({ name: z.string(), values: z.array(z.number()), color: z.string().optional() })).min(1).max(4),
      unit: z.string().default(''),
      source: text('Data source citation').default(''),
      background: Background,
    }),
    example: { title: 'Global average temperature anomaly', labels: ['1980', '1990', '2000', '2010', '2020'], series: [{ name: '°C', values: [0.26, 0.45, 0.42, 0.72, 1.01] }], unit: '°C', source: 'NASA GISS' },
  }),
  def({
    id: 'donut-chart',
    name: 'Donut Chart',
    category: 'data',
    description: 'Animated donut/pie chart with legend. Use for shares of a whole (percentages).',
    overlay: false,
    defaultDuration: 5,
    schema: z.object({
      title: text('Chart title'),
      data: z.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() })).min(2).max(7),
      centerLabel: z.string().default(''),
      source: text('Data source citation').default(''),
      background: Background,
    }),
    example: { title: 'Where electricity comes from', data: [{ label: 'Fossil', value: 61 }, { label: 'Renewables', value: 30 }, { label: 'Nuclear', value: 9 }], centerLabel: 'World 2023', source: 'Ember' },
  }),
  def({
    id: 'comparison',
    name: 'Comparison',
    category: 'explainers',
    description: 'Two-column comparison (A vs B, before/after, pros/cons) with an optional verdict.',
    overlay: false,
    defaultDuration: 7,
    schema: z.object({
      leftTitle: z.string(),
      rightTitle: z.string(),
      leftItems: z.array(z.string()).max(6).default([]),
      rightItems: z.array(z.string()).max(6).default([]),
      mode: z.enum(['vs', 'before-after', 'pros-cons']).default('vs'),
      verdict: z.string().default(''),
      background: Background,
    }),
    example: { leftTitle: 'Electric', rightTitle: 'Gasoline', leftItems: ['Cheap to run', 'Quiet', 'Slow to refuel'], rightItems: ['Refuel in 5 min', 'Higher running cost', 'Emissions'], verdict: 'EVs win on total cost' },
  }),
  def({
    id: 'timeline',
    name: 'Timeline',
    category: 'explainers',
    description: 'Horizontal timeline of dated events that reveals in order. Use for history and roadmaps.',
    overlay: false,
    defaultDuration: 7,
    schema: z.object({
      title: text('Timeline title').default(''),
      events: z.array(z.object({ date: z.string(), label: z.string(), description: z.string().default('') })).min(2).max(7),
      background: Background,
    }),
    example: { title: 'The road to the Moon', events: [{ date: '1957', label: 'Sputnik' }, { date: '1961', label: 'First human in space' }, { date: '1968', label: 'Apollo 8 orbits' }, { date: '1969', label: 'Moon landing' }] },
  }),
  def({
    id: 'definition',
    name: 'Definition',
    category: 'explainers',
    description: 'Dictionary-style definition card. Use when introducing a key term or jargon.',
    overlay: false,
    defaultDuration: 5,
    schema: z.object({
      term: z.string(),
      phonetic: z.string().default(''),
      partOfSpeech: z.string().default('noun'),
      definition: z.string(),
      example: z.string().default(''),
      background: Background,
    }),
    example: { term: 'Entropy', phonetic: '/ˈen.trə.pi/', definition: 'A measure of disorder; the tendency of systems to move toward randomness.', example: 'Your room tends toward maximum entropy.' },
  }),
  def({
    id: 'code-block',
    name: 'Code Block',
    category: 'explainers',
    description: 'Editor-style code window with syntax coloring and typing animation. Use for programming tutorials.',
    overlay: false,
    defaultDuration: 7,
    schema: z.object({
      title: z.string().default(''),
      code: z.string(),
      language: z.string().default('typescript'),
      highlightLines: z.array(z.number().int()).default([]).describe('1-based line numbers to highlight'),
      typing: z.boolean().default(true),
      background: Background,
    }),
    example: { title: 'fetch.ts', code: "const res = await fetch('/api/users');\nconst users = await res.json();\nconsole.log(users.length);", highlightLines: [2] },
  }),
  def({
    id: 'quote',
    name: 'Quote',
    category: 'quotes',
    description: 'Elegant quote card with author attribution. Use for quotes, testimonials, key statements.',
    overlay: false,
    defaultDuration: 6,
    schema: z.object({
      quote: z.string(),
      author: z.string().default(''),
      role: z.string().default(''),
      imageAssetId: z.string().optional(),
      background: Background,
    }),
    example: { quote: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese proverb' },
  }),
  def({
    id: 'social-card',
    name: 'Social / News Card',
    category: 'quotes',
    description: 'A post, headline, comment or review card that pops in. Use to show a tweet, news headline or viewer comment.',
    overlay: false,
    defaultDuration: 5,
    schema: z.object({
      kind: z.enum(['post', 'headline', 'comment', 'review']).default('post'),
      author: z.string().default(''),
      handle: z.string().default(''),
      text: z.string(),
      source: z.string().default('').describe('Publication or platform name'),
      date: z.string().default(''),
      rating: z.number().min(0).max(5).optional(),
      avatarAssetId: z.string().optional(),
      background: Background,
    }),
    example: { kind: 'headline', text: 'Scientists achieve net energy gain in fusion experiment', source: 'Science Daily', date: 'Dec 2022' },
  }),
  def({
    id: 'highlight-text',
    name: 'Highlighted Passage',
    category: 'quotes',
    description: 'A paragraph (e.g. from a document or article) with key phrases marker-highlighted in sequence.',
    overlay: false,
    defaultDuration: 6,
    schema: z.object({
      text: z.string().describe('Passage of 1-4 sentences'),
      highlights: z.array(z.string()).default([]).describe('Exact phrases from the text to highlight'),
      source: z.string().default(''),
      background: Background,
    }),
    example: { text: 'The study found that participants who slept less than six hours were four times more likely to catch a cold.', highlights: ['less than six hours', 'four times more likely'], source: 'SLEEP journal, 2015' },
  }),
  def({
    id: 'image-showcase',
    name: 'Image Showcase',
    category: 'media',
    description: 'Show an image or video asset inside a styled frame (browser, phone, polaroid) with a caption.',
    overlay: false,
    defaultDuration: 5,
    schema: z.object({
      assetId: z.string().describe('Image or video asset id'),
      frame: z.enum(['clean', 'browser', 'phone', 'polaroid', 'tilted']).default('clean'),
      caption: z.string().default(''),
      url: z.string().default('').describe('Address bar text for the browser frame'),
      background: Background,
    }),
    example: { assetId: '', frame: 'browser', caption: 'The new dashboard', url: 'app.example.com' },
  }),
  def({
    id: 'logo-reveal',
    name: 'Logo / Channel Intro',
    category: 'titles',
    description: 'Short branded intro: logo (or channel name) reveal with tagline. Keep it under 3 seconds.',
    overlay: false,
    defaultDuration: 2.5,
    schema: z.object({
      text: z.string().default('').describe('Channel name (defaults to brand channel name)'),
      tagline: z.string().default(''),
      logoAssetId: z.string().optional(),
      background: Background,
    }),
    example: { text: 'Curious Minds', tagline: 'Science, simplified' },
  }),
  def({
    id: 'end-screen',
    name: 'End Screen',
    category: 'calls-to-action',
    description: 'Final 10-20s YouTube end screen with space for the video and subscribe elements YouTube overlays.',
    overlay: false,
    defaultDuration: 12,
    schema: z.object({
      title: z.string().default('Watch next'),
      subtitle: z.string().default(''),
      showSubscribe: z.boolean().default(true),
      background: Background,
    }),
    example: { title: 'Watch this next', subtitle: 'Thanks for watching!' },
  }),
  def({
    id: 'lower-third',
    name: 'Lower Third',
    category: 'overlays',
    description: 'Name/title bar in the lower part of the frame. Use to introduce a speaker, location or topic over footage.',
    overlay: true,
    defaultDuration: 4,
    schema: z.object({
      name: z.string(),
      title: z.string().default(''),
      position: z.enum(['left', 'right', 'center']).default('left'),
      style: z.enum(['bar', 'glass', 'minimal', 'bold']).default('bar'),
    }),
    example: { name: 'Dr. Jane Smith', title: 'Climate Scientist, MIT' },
  }),
  def({
    id: 'callout',
    name: 'Callout / Annotation',
    category: 'overlays',
    description: 'Points at something in the frame: circle, arrow, box or underline with a label. Coordinates are 0-1 fractions.',
    overlay: true,
    defaultDuration: 3,
    schema: z.object({
      label: z.string().default(''),
      x: z.number().min(0).max(1).describe('Target x (0-1)'),
      y: z.number().min(0).max(1).describe('Target y (0-1)'),
      shape: z.enum(['circle', 'arrow', 'box', 'underline']).default('circle'),
      width: z.number().min(0.02).max(1).default(0.16).describe('Size of circle/box as a fraction of canvas width'),
      height: z.number().min(0.02).max(1).default(0.12),
      color: z.string().optional(),
    }),
    example: { label: 'Look here', x: 0.62, y: 0.42, shape: 'circle' },
  }),
  def({
    id: 'subscribe-cta',
    name: 'Subscribe Reminder',
    category: 'calls-to-action',
    description: 'Animated subscribe button with bell/like that pops in over footage. Use once, ~30-60s in or near the end.',
    overlay: true,
    defaultDuration: 4,
    schema: z.object({
      text: z.string().default('Subscribe'),
      handle: z.string().default(''),
      position: z.enum(['bottom-left', 'bottom-right', 'bottom-center', 'center', 'top-right']).default('bottom-center'),
      showLike: z.boolean().default(true),
      showBell: z.boolean().default(true),
    }),
    example: { text: 'Subscribe', handle: '@curiousminds' },
  }),
  def({
    id: 'progress-bar',
    name: 'Chapter Progress Bar',
    category: 'overlays',
    description: 'Thin progress bar with chapter labels across the top/bottom of the video. Place it over the whole video.',
    overlay: true,
    defaultDuration: 10,
    schema: z.object({
      position: z.enum(['top', 'bottom']).default('bottom'),
      chapters: z.array(z.object({ time: z.number(), title: z.string() })).default([]).describe('Timeline seconds; defaults to project chapters'),
      showLabel: z.boolean().default(true),
    }),
    example: { position: 'bottom', chapters: [{ time: 0, title: 'Intro' }, { time: 4, title: 'Part 1' }, { time: 7, title: 'Part 2' }] },
  }),
  def({
    id: 'emoji-burst',
    name: 'Emoji Burst',
    category: 'overlays',
    description: 'Burst of emojis/reaction stickers for comedic or emotional emphasis. Use sparingly.',
    overlay: true,
    defaultDuration: 2,
    schema: z.object({
      emoji: z.string().default('🔥'),
      count: z.number().int().min(3).max(40).default(14),
      x: z.number().min(0).max(1).default(0.5),
      y: z.number().min(0).max(1).default(0.6),
    }),
    example: { emoji: '🤯', count: 16 },
  }),
  def({
    id: 'countdown',
    name: 'Countdown',
    category: 'titles',
    description: 'Big countdown numbers (e.g. 3-2-1) with ticks. Use for intros of reveals or timed challenges.',
    overlay: false,
    defaultDuration: 3,
    schema: z.object({ from: z.number().int().min(1).max(20).default(3), label: z.string().default(''), background: Background }),
    example: { from: 3, label: 'Revealing the winner' },
  }),
];

export type TemplateId = (typeof TEMPLATES)[number]['id'];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export const getTemplate = (id: string): TemplateDef | undefined => TEMPLATES.find((t) => t.id === id);

/** Validate + fill defaults for scene props. Throws a readable error. */
export const parseTemplateProps = (id: string, props: unknown): Record<string, unknown> => {
  const t = getTemplate(id);
  if (!t) throw new Error(`Unknown template "${id}". Available: ${TEMPLATE_IDS.join(', ')}`);
  const r = t.schema.safeParse(props ?? {});
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid props for template "${id}": ${issues}`);
  }
  return r.data as Record<string, unknown>;
};

/** Same as parseTemplateProps but never throws (falls back to raw props). Used by the renderer. */
export const safeTemplateProps = (id: string, props: unknown): Record<string, unknown> => {
  const t = getTemplate(id);
  if (!t) return (props as Record<string, unknown>) ?? {};
  const r = t.schema.safeParse(props ?? {});
  return r.success ? (r.data as Record<string, unknown>) : { ...(t.schema.safeParse(t.example).data as object), ...(props as object) };
};

export const templateCatalog = () =>
  TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    overlay: t.overlay,
    defaultDuration: t.defaultDuration,
    props: z.toJSONSchema(t.schema, { io: 'input', unrepresentable: 'any' }),
    example: t.example,
  }));
