import type React from 'react';
import { BarChart, BigNumber, DonutChart, LineChart, StatGrid } from './data';
import { CodeBlock, Comparison, Definition, Timeline } from './explainers';
import { BulletList, Ranking, Steps } from './lists';
import { EndScreen, ImageShowcase } from './media';
import { Callout, EmojiBurst, LowerThird, ProgressBar, SubscribeCta } from './overlays';
import { HighlightText, Quote, SocialCard } from './quotes';
import { ChapterCard, Countdown, KineticText, LogoReveal, Question, TitleCard } from './titles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATE_COMPONENTS: Record<string, React.FC<any>> = {
  'title-card': TitleCard,
  'kinetic-text': KineticText,
  'chapter-card': ChapterCard,
  question: Question,
  'bullet-list': BulletList,
  steps: Steps,
  ranking: Ranking,
  'big-number': BigNumber,
  'stat-grid': StatGrid,
  'bar-chart': BarChart,
  'line-chart': LineChart,
  'donut-chart': DonutChart,
  comparison: Comparison,
  timeline: Timeline,
  definition: Definition,
  'code-block': CodeBlock,
  quote: Quote,
  'social-card': SocialCard,
  'highlight-text': HighlightText,
  'image-showcase': ImageShowcase,
  'logo-reveal': LogoReveal,
  'end-screen': EndScreen,
  'lower-third': LowerThird,
  callout: Callout,
  'subscribe-cta': SubscribeCta,
  'progress-bar': ProgressBar,
  'emoji-burst': EmojiBurst,
  countdown: Countdown,
};
