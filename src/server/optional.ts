/**
 * Optional dependencies (local Whisper, Kokoro, ONNX Runtime for face tracking) may be missing on some platforms.
 * Importing them through a variable keeps type-checking and bundling independent of them.
 */
export interface TransformersModule {
  env: { cacheDir: string };
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<unknown>;
}

export const importOptional = <T>(name: 'kokoro-js' | '@huggingface/transformers' | 'onnxruntime-node'): Promise<T> => import(/* @vite-ignore */ name) as Promise<T>;
