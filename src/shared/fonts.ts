// Curated font families bundled locally (via @fontsource) so preview and render
// look identical and work offline. Ids are what the project JSON stores.

export interface FontDef {
  id: string;
  family: string;
  category: 'sans' | 'display' | 'serif' | 'mono' | 'handwriting';
  weights: number[];
  description: string;
}

export const FONTS: FontDef[] = [
  { id: 'inter', family: 'Inter Variable', category: 'sans', weights: [400, 500, 600, 700, 800, 900], description: 'Clean, neutral UI sans. Great default for body text and subtitles.' },
  { id: 'montserrat', family: 'Montserrat Variable', category: 'sans', weights: [400, 600, 700, 800, 900], description: 'Geometric sans with strong heavy weights. Popular for YouTube titles and bold captions.' },
  { id: 'poppins', family: 'Poppins', category: 'sans', weights: [400, 600, 700, 800], description: 'Friendly geometric sans. Modern explainer look.' },
  { id: 'space-grotesk', family: 'Space Grotesk Variable', category: 'sans', weights: [400, 500, 700], description: 'Techy grotesk. Good for tech, AI and startup topics.' },
  { id: 'anton', family: 'Anton', category: 'display', weights: [400], description: 'Ultra-condensed impact display. Best for punchy uppercase captions and thumbnails.' },
  { id: 'bebas-neue', family: 'Bebas Neue', category: 'display', weights: [400], description: 'Tall condensed caps. Cinematic titles and numbers.' },
  { id: 'oswald', family: 'Oswald Variable', category: 'display', weights: [400, 500, 600, 700], description: 'Condensed sans. News/documentary style headings.' },
  { id: 'archivo-black', family: 'Archivo Black', category: 'display', weights: [400], description: 'Very heavy grotesk. Loud statements and stats.' },
  { id: 'playfair', family: 'Playfair Display Variable', category: 'serif', weights: [400, 600, 700, 800, 900], description: 'Elegant high-contrast serif. Luxury, history, storytelling.' },
  { id: 'dm-serif', family: 'DM Serif Display', category: 'serif', weights: [400], description: 'Editorial display serif for quotes and titles.' },
  { id: 'jetbrains-mono', family: 'JetBrains Mono Variable', category: 'mono', weights: [400, 500, 700, 800], description: 'Monospace for code, terminals and data.' },
  { id: 'permanent-marker', family: 'Permanent Marker', category: 'handwriting', weights: [400], description: 'Marker handwriting for annotations and playful accents.' },
];

export const FONT_IDS = FONTS.map((f) => f.id) as [string, ...string[]];

export const fontFamily = (id: string | undefined, fallback = 'inter'): string => {
  const def = FONTS.find((f) => f.id === id) ?? FONTS.find((f) => f.id === fallback)!;
  return `"${def.family}", system-ui, sans-serif`;
};

export const fontDef = (id: string | undefined): FontDef =>
  FONTS.find((f) => f.id === id) ?? FONTS[0]!;
