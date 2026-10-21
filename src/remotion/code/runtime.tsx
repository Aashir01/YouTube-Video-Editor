import React from 'react';
import * as Remotion from 'remotion';
import * as Shapes from '@remotion/shapes';
import * as Paths from '@remotion/paths';
import * as Noise from '@remotion/noise';
import * as LayoutUtils from '@remotion/layout-utils';
import { transform } from 'sucrase';
import * as Kit from '../templates/kit';
import { useAssetUrl, useStudio, useTheme } from '../context';
import { ease, lerp, clamp01 } from '../effects';

/**
 * Runtime for AI-generated scenes ("code clips"). The TSX is transpiled with
 * sucrase and evaluated with a fixed module map, both in the editor preview and
 * inside the headless renderer. Scenes can import from:
 *   react, remotion, @remotion/shapes, @remotion/paths, @remotion/noise,
 *   @remotion/layout-utils, and "director" (theme + motion kit helpers).
 */

const directorModule = {
  ...Kit,
  useTheme,
  useAssetUrl,
  useStudio,
  ease,
  lerp,
  clamp01,
};

const MODULES: Record<string, unknown> = {
  react: React,
  remotion: Remotion,
  '@remotion/shapes': Shapes,
  '@remotion/paths': Paths,
  '@remotion/noise': Noise,
  '@remotion/layout-utils': LayoutUtils,
  director: directorModule,
};

export const ALLOWED_IMPORTS = Object.keys(MODULES);

export interface CompileResult {
  component?: React.ComponentType<Record<string, unknown>>;
  error?: string;
}

const cache = new Map<string, CompileResult>();

export const transpileScene = (code: string): string =>
  transform(code, {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxRuntime: 'classic',
    production: true,
    filePath: 'scene.tsx',
  }).code;

export const compileScene = (code: string): CompileResult => {
  const hit = cache.get(code);
  if (hit) return hit;
  let result: CompileResult;
  try {
    const js = transpileScene(code);
    const module = { exports: {} as Record<string, unknown> };
    const requireFn = (name: string) => {
      if (name in MODULES) return MODULES[name];
      throw new Error(`Import "${name}" is not available in code scenes. Allowed: ${ALLOWED_IMPORTS.join(', ')}`);
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', 'React', js);
    fn(requireFn, module, module.exports, React);
    const exp = module.exports as Record<string, unknown>;
    const component = (exp.default ?? exp.Scene ?? Object.values(exp).find((v) => typeof v === 'function')) as
      | React.ComponentType<Record<string, unknown>>
      | undefined;
    result = component ? { component } : { error: 'The scene must `export default` a React component.' };
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) };
  }
  if (cache.size > 200) cache.clear();
  cache.set(code, result);
  return result;
};

interface BoundaryProps {
  children: React.ReactNode;
  label: string;
  onError?: (message: string) => void;
}

class SceneErrorBoundary extends React.Component<BoundaryProps, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // Tagged so the server can surface code-scene errors from renderer logs.
    console.error(`[DIRECTOR_SCENE_ERROR] ${this.props.label}: ${message}`);
    this.props.onError?.(message);
  }

  render() {
    if (this.state.error) return <SceneError label={this.props.label} message={this.state.error} />;
    return this.props.children;
  }
}

export const SceneError: React.FC<{ label: string; message: string }> = ({ label, message }) => (
  <Remotion.AbsoluteFill
    style={{
      background: 'repeating-linear-gradient(45deg, #2a0f14, #2a0f14 24px, #331219 24px, #331219 48px)',
      color: '#FFB4C0',
      fontFamily: 'monospace',
      fontSize: 28,
      padding: 60,
      justifyContent: 'center',
    }}
  >
    <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 20, color: '#FF6B81' }}>Scene error · {label}</div>
    <div style={{ whiteSpace: 'pre-wrap' }}>{message}</div>
  </Remotion.AbsoluteFill>
);

export const CodeScene: React.FC<{ code: string; props: Record<string, unknown>; label: string }> = ({ code, props, label }) => {
  const compiled = compileScene(code);
  if (compiled.error || !compiled.component) {
    if (typeof console !== 'undefined') console.error(`[DIRECTOR_SCENE_ERROR] ${label}: ${compiled.error}`);
    return <SceneError label={label} message={compiled.error ?? 'No component'} />;
  }
  const Comp = compiled.component;
  return (
    <SceneErrorBoundary label={label}>
      <Comp {...props} />
    </SceneErrorBoundary>
  );
};
