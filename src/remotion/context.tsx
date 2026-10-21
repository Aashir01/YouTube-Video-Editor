import React, { createContext, useContext } from 'react';
import type { Brand, Project, Word } from '../shared/schema';
import type { Interval } from '../shared/timeline';
import { fontFamily } from '../shared/fonts';

export interface Theme {
  W: number;
  H: number;
  /** Design unit: 1u = 1px when the short side is 1080px. */
  u: number;
  portrait: boolean;
  fps: number;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    bg: string;
    surface: string;
    text: string;
    muted: string;
  };
  fonts: { heading: string; body: string; mono: string };
  brand: Brand;
}

export const makeTheme = (brand: Brand, width: number, height: number, fps: number): Theme => ({
  W: width,
  H: height,
  u: Math.min(width, height) / 1080,
  portrait: height > width * 1.05,
  fps,
  colors: {
    primary: brand.primary,
    secondary: brand.secondary,
    accent: brand.accent,
    bg: brand.background,
    surface: brand.surface,
    text: brand.text,
    muted: brand.mutedText,
  },
  fonts: {
    heading: fontFamily(brand.headingFont, 'montserrat'),
    body: fontFamily(brand.bodyFont, 'inter'),
    mono: fontFamily(brand.monoFont, 'jetbrains-mono'),
  },
  brand,
});

export interface StudioContextValue {
  project: Project;
  assetUrls: Record<string, string>;
  transcripts: Record<string, Word[]>;
  mode: 'preview' | 'render' | 'still';
  speech: Interval[];
}

const StudioContext = createContext<StudioContextValue | null>(null);
const ThemeContext = createContext<Theme | null>(null);

export const StudioProvider: React.FC<{ value: StudioContextValue; theme: Theme; children: React.ReactNode }> = ({
  value,
  theme,
  children,
}) => (
  <StudioContext.Provider value={value}>
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  </StudioContext.Provider>
);

export const ThemeProvider = ThemeContext.Provider;

export const useStudio = (): StudioContextValue | null => useContext(StudioContext);

export const useTheme = (): Theme => {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside a Director composition');
  return t;
};

export const useAssetUrl = (assetId: string | undefined): string | undefined => {
  const studio = useStudio();
  if (!assetId || !studio) return undefined;
  return studio.assetUrls[assetId];
};
