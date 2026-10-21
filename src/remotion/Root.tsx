import React from 'react';
import { Composition, Still, type CalculateMetadataFunction } from 'remotion';
import type { CompositionInput, ThumbnailInput } from '../shared/schema';
import { projectDuration } from '../shared/timeline';
import { createDemoProject } from '../shared/sample';
import { Main } from './Main';
import { ThumbnailComposition } from './Thumbnail';

const demo = createDemoProject();

const defaultInput: CompositionInput = { project: demo, assetUrls: {}, transcripts: {}, mode: 'preview' };

export const calculateMainMetadata: CalculateMetadataFunction<CompositionInput> = ({ props }) => {
  const { canvas } = props.project;
  return {
    durationInFrames: Math.max(1, Math.ceil(projectDuration(props.project) * canvas.fps)),
    fps: canvas.fps,
    width: canvas.width,
    height: canvas.height,
  };
};

const calculateThumbnailMetadata: CalculateMetadataFunction<ThumbnailInput> = ({ props }) => {
  const portrait = props.project.canvas.height > props.project.canvas.width;
  return portrait ? { width: 1080, height: 1920 } : { width: 1280, height: 720 };
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Main"
      component={Main}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
      defaultProps={defaultInput}
      calculateMetadata={calculateMainMetadata}
    />
    <Still
      id="Thumbnail"
      component={ThumbnailComposition}
      width={1280}
      height={720}
      defaultProps={{ project: demo, assetUrls: {}, thumbnail: { template: 'bold-text', props: { text: 'Why *Sleep* Matters', subtext: 'The 60-second science', emoji: '😴' } } }}
      calculateMetadata={calculateThumbnailMetadata}
    />
  </>
);
