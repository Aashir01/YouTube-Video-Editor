import { z } from 'zod';
import { FONT_IDS } from './fonts';

/**
 * The project document is the single source of truth for a video. The agent,
 * the editor UI, the MCP server and the Remotion renderer all read and write it.
 *
 * Conventions:
 * - Times are in seconds (floats). Frames are derived at render time from `canvas.fps`.
 * - Positions/boxes are fractions of the canvas (0..1) so layouts survive aspect changes.
 * - Sizes (font sizes, radii, strokes) are "design px": 1 unit = 1px when the short
 *   side of the canvas is 1080px. They scale automatically for 720p/4K/vertical.
 */

export const SCHEMA_VERSION = 1;

const Id = z.string().min(1);
const Seconds = z.number().min(0);
const Color = z.string().min(1).describe('CSS color such as #FFCC00 or rgba(0,0,0,0.6)');
const FontId = z.enum(FONT_IDS).describe('Font id from the bundled font list');

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const TRANSITION_TYPES = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom-in',
  'zoom-out',
  'blur',
  'wipe-left',
  'wipe-right',
  'circle',
  'flash',
  'whip',
  'glitch',
] as const;

export const TransitionSchema = z
  .object({
    type: z.enum(TRANSITION_TYPES),
    duration: z.number().min(0.05).max(5).default(0.4).describe('Seconds'),
  })
  .describe('Entrance/exit transition applied at the clip edge');

export const BoxSchema = z
  .object({
    x: z.number().min(-1).max(2).describe('Left edge as a fraction of canvas width'),
    y: z.number().min(-1).max(2).describe('Top edge as a fraction of canvas height'),
    w: z.number().min(0.01).max(3).describe('Width as a fraction of canvas width'),
    h: z.number().min(0.01).max(3).describe('Height as a fraction of canvas height'),
  })
  .describe('Placement rectangle in canvas fractions. Omit for full-frame.');

export const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'snappy'] as const;

export const KenBurnsSchema = z
  .object({
    fromScale: z.number().min(0.5).max(4).default(1),
    toScale: z.number().min(0.5).max(4).default(1.15),
    fromX: z.number().min(0).max(1).default(0.5).describe('Focus x at start (0-1)'),
    fromY: z.number().min(0).max(1).default(0.5),
    toX: z.number().min(0).max(1).default(0.5),
    toY: z.number().min(0).max(1).default(0.5),
    easing: z.enum(EASINGS).default('ease-in-out'),
  })
  .describe('Slow pan/zoom across the clip duration (Ken Burns effect)');

export const ZoomSchema = z
  .object({
    at: z.number().min(0).describe('Seconds from the clip start where the zoom begins'),
    duration: z.number().min(0.1).describe('How long the zoom is held, in seconds'),
    scale: z.number().min(1).max(4).default(1.25),
    x: z.number().min(0).max(1).default(0.5).describe('Focus point x (0-1), e.g. the speaker face'),
    y: z.number().min(0).max(1).default(0.4).describe('Focus point y (0-1)'),
    style: z
      .enum(['smooth', 'snap', 'slow-push'])
      .default('smooth')
      .describe('smooth = eased punch-in, snap = instant cut zoom (jump-cut feel), slow-push = gradual push over the duration'),
  })
  .describe('Punch-in zoom on a portion of a clip');

export const GRADE_PRESETS = [
  'none',
  'cinematic',
  'warm',
  'cool',
  'vibrant',
  'muted',
  'bw',
  'vintage',
  'teal-orange',
  'punchy',
] as const;

export const ColorGradeSchema = z
  .object({
    preset: z.enum(GRADE_PRESETS).default('none'),
    brightness: z.number().min(0).max(3).default(1),
    contrast: z.number().min(0).max(3).default(1),
    saturation: z.number().min(0).max(3).default(1),
    hue: z.number().min(-180).max(180).default(0),
    vignette: z.number().min(0).max(1).default(0),
    blur: z.number().min(0).max(60).default(0),
  })
  .describe('Color correction / look for a visual clip');

export const WordSchema = z.object({
  text: z.string(),
  start: z.number().describe('Seconds'),
  end: z.number().describe('Seconds'),
  confidence: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const clipBase = {
  id: Id,
  start: Seconds.describe('Position on the timeline in seconds'),
  duration: z.number().positive().describe('Length on the timeline in seconds'),
  name: z.string().optional(),
  transitionIn: TransitionSchema.optional(),
  transitionOut: TransitionSchema.optional(),
};

const visualProps = {
  box: BoxSchema.optional(),
  opacity: z.number().min(0).max(1).default(1),
  radius: z.number().min(0).default(0).describe('Corner radius in design px (picture-in-picture look)'),
  shadow: z.boolean().default(false),
  rotation: z.number().default(0).describe('Degrees'),
  flipX: z.boolean().default(false),
  grade: ColorGradeSchema.optional(),
};

export const VideoClipSchema = z.object({
  ...clipBase,
  ...visualProps,
  type: z.literal('video'),
  assetId: Id,
  trimStart: Seconds.default(0).describe('Offset into the source media (seconds) where playback starts'),
  speed: z.number().min(0.25).max(4).default(1),
  volume: z.number().min(0).max(2).default(1),
  muted: z.boolean().default(false),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  zooms: z.array(ZoomSchema).default([]),
  kenBurns: KenBurnsSchema.optional(),
  audioFadeIn: z.number().min(0).default(0),
  audioFadeOut: z.number().min(0).default(0),
});

export const ImageClipSchema = z.object({
  ...clipBase,
  ...visualProps,
  type: z.literal('image'),
  assetId: Id,
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  kenBurns: KenBurnsSchema.optional(),
  blurredBackdrop: z
    .boolean()
    .default(false)
    .describe('Fill letterbox bars with a blurred copy (useful for portrait images in 16:9)'),
});

export const AUDIO_ROLES = ['voiceover', 'music', 'sfx', 'original'] as const;

export const AudioClipSchema = z.object({
  ...clipBase,
  type: z.literal('audio'),
  assetId: Id,
  role: z.enum(AUDIO_ROLES).default('music'),
  trimStart: Seconds.default(0),
  speed: z.number().min(0.25).max(4).default(1),
  volume: z.number().min(0).max(2).default(1),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
  duck: z.boolean().default(false).describe('Automatically lower this clip while someone is speaking (use for music)'),
  loop: z.boolean().default(false).describe('Loop the source to fill the clip duration (music beds)'),
});

export const TEXT_ANIMATIONS = [
  'none',
  'fade',
  'rise',
  'pop',
  'slide-left',
  'slide-right',
  'typewriter',
  'words',
  'letters',
  'blur-in',
  'scale-down',
] as const;

export const TextStyleSchema = z.object({
  font: FontId.default('montserrat'),
  size: z.number().min(6).max(600).default(84).describe('Design px'),
  weight: z.number().min(100).max(900).default(800),
  color: Color.default('#FFFFFF'),
  align: z.enum(['left', 'center', 'right']).default('center'),
  uppercase: z.boolean().default(false),
  italic: z.boolean().default(false),
  letterSpacing: z.number().default(0).describe('em'),
  lineHeight: z.number().default(1.1),
  background: Color.optional().describe('Pill/box behind the text'),
  padding: z.number().min(0).default(24),
  radius: z.number().min(0).default(16),
  strokeColor: Color.optional(),
  strokeWidth: z.number().min(0).default(0),
  shadow: z.boolean().default(true),
  highlightColor: Color.optional().describe('Color for *emphasized* words written as *word* in the text'),
  maxWidth: z.number().min(0.1).max(1).default(0.85).describe('Max width as a fraction of canvas width'),
});

export const TextClipSchema = z.object({
  ...clipBase,
  type: z.literal('text'),
  text: z.string().describe('Text to show. Wrap words in *asterisks* to emphasize them with highlightColor.'),
  style: TextStyleSchema.default(TextStyleSchema.parse({})),
  x: z.number().min(0).max(1).default(0.5).describe('Horizontal anchor (0-1) of the text center'),
  y: z.number().min(0).max(1).default(0.5).describe('Vertical anchor (0-1) of the text center'),
  animationIn: z.enum(TEXT_ANIMATIONS).default('rise'),
  animationOut: z.enum(TEXT_ANIMATIONS).default('fade'),
  opacity: z.number().min(0).max(1).default(1),
  rotation: z.number().default(0),
});

export const SceneClipSchema = z.object({
  ...clipBase,
  type: z.literal('scene'),
  template: z.string().describe('Motion-graphics template id (see list_templates)'),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const CodeClipSchema = z.object({
  ...clipBase,
  type: z.literal('code'),
  code: z.string().describe('TSX source of a custom Remotion scene with a default-exported component'),
  props: z.record(z.string(), z.unknown()).default({}),
  description: z.string().optional(),
  transparent: z.boolean().default(false).describe('true when the scene is an overlay that does not paint a background'),
});

export const CAPTION_PRESETS = [
  'bold-pop',
  'karaoke',
  'clean',
  'boxed',
  'neon',
  'typewriter',
  'minimal',
  'highlight-box',
] as const;

export const CaptionStyleSchema = z.object({
  preset: z.enum(CAPTION_PRESETS).default('bold-pop'),
  font: FontId.optional(),
  fontSize: z.number().min(10).max(300).optional().describe('Design px; preset default if omitted'),
  color: Color.default('#FFFFFF'),
  highlightColor: Color.optional().describe('Active word color; brand accent if omitted'),
  backgroundColor: Color.optional(),
  position: z.enum(['bottom', 'center', 'top']).default('bottom'),
  offsetY: z.number().min(-0.5).max(0.5).default(0).describe('Extra vertical offset as a fraction of canvas height'),
  maxWordsPerPage: z.number().int().min(1).max(20).optional(),
  uppercase: z.boolean().optional(),
  strokeWidth: z.number().min(0).max(30).optional(),
});

export const CaptionsClipSchema = z.object({
  ...clipBase,
  type: z.literal('captions'),
  mode: z
    .enum(['auto', 'manual'])
    .default('auto')
    .describe('auto = generated live from the transcripts of clips on the timeline (stays in sync after edits); manual = uses `words`'),
  words: z.array(WordSchema).default([]).describe('Timeline-relative words (manual mode only)'),
  sourceTrackIds: z.array(Id).optional().describe('Tracks to caption in auto mode (default: all tracks with speech)'),
  style: CaptionStyleSchema.default(CaptionStyleSchema.parse({})),
});

export const ClipSchema = z.discriminatedUnion('type', [
  VideoClipSchema,
  ImageClipSchema,
  AudioClipSchema,
  TextClipSchema,
  SceneClipSchema,
  CodeClipSchema,
  CaptionsClipSchema,
]);

export const TRACK_KINDS = ['video', 'overlay', 'audio', 'captions'] as const;

export const TrackSchema = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(TRACK_KINDS),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  clips: z.array(ClipSchema).default([]),
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const ASSET_KINDS = ['video', 'audio', 'image', 'document', 'other'] as const;
export const ASSET_ORIGINS = ['upload', 'stock', 'generated', 'tts', 'render', 'url', 'library'] as const;

export const AssetSchema = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(ASSET_KINDS),
  file: z.string().describe('File name inside the project media folder'),
  mime: z.string().default('application/octet-stream'),
  size: z.number().default(0),
  origin: z.enum(ASSET_ORIGINS).default('upload'),
  createdAt: z.string(),
  status: z.enum(['processing', 'ready', 'error']).default('ready'),
  error: z.string().optional(),
  meta: z
    .object({
      duration: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fps: z.number().optional(),
      hasAudio: z.boolean().optional(),
      hasVideo: z.boolean().optional(),
      codec: z.string().optional(),
    })
    .default({}),
  thumb: z.string().optional(),
  waveform: z.string().optional().describe('Peaks JSON file name'),
  transcript: z
    .object({
      status: z.enum(['none', 'pending', 'done', 'error']).default('none'),
      engine: z.string().optional(),
      language: z.string().optional(),
      file: z.string().optional(),
      preview: z.string().optional(),
      wordCount: z.number().optional(),
      error: z.string().optional(),
    })
    .default({ status: 'none' }),
  text: z
    .object({ file: z.string(), chars: z.number(), preview: z.string() })
    .optional()
    .describe('Extracted text for documents'),
  description: z.string().optional().describe('What the asset shows/contains (from AI analysis or the user)'),
  tags: z.array(z.string()).default([]),
  source: z
    .object({
      provider: z.string(),
      url: z.string().optional(),
      author: z.string().optional(),
      authorUrl: z.string().optional(),
      license: z.string().optional(),
      query: z.string().optional(),
    })
    .optional(),
  voice: z
    .object({ engine: z.string(), voice: z.string().optional(), text: z.string() })
    .optional()
    .describe('For AI voiceover assets'),
  analysis: z
    .object({
      silences: z.array(z.tuple([z.number(), z.number()])).optional(),
      scenes: z.array(z.number()).optional(),
      loudnessLufs: z.number().optional(),
    })
    .default({}),
});

// ---------------------------------------------------------------------------
// Brief, brand, script, publishing
// ---------------------------------------------------------------------------

export const BriefSchema = z.object({
  topic: z.string().default(''),
  mode: z
    .enum(['edit', 'generate', 'hybrid'])
    .default('hybrid')
    .describe('edit = cut the user footage; generate = build from topic with voiceover & graphics; hybrid = both'),
  format: z.enum(['long', 'short']).default('long').describe('long = 16:9 YouTube video, short = 9:16 YouTube Short'),
  goal: z.string().default(''),
  audience: z.string().default(''),
  tone: z.string().default(''),
  style: z.string().default('').describe('Visual style direction'),
  targetDurationSec: z.number().min(5).max(7200).optional(),
  language: z.string().default('en'),
  callToAction: z.string().default(''),
  keyPoints: z.array(z.string()).default([]),
  notes: z.string().default(''),
  status: z.enum(['new', 'gathering', 'ready']).default('new'),
});

export const BrandSchema = z.object({
  primary: Color.default('#7C5CFF'),
  secondary: Color.default('#22D3EE'),
  accent: Color.default('#FACC15'),
  background: Color.default('#0B0D17'),
  surface: Color.default('#161A2E'),
  text: Color.default('#FFFFFF'),
  mutedText: Color.default('#A8B0CF'),
  headingFont: FontId.default('montserrat'),
  bodyFont: FontId.default('inter'),
  monoFont: FontId.default('jetbrains-mono'),
  logoAssetId: z.string().optional(),
  channelName: z.string().default(''),
  handle: z.string().default(''),
  watermark: z.boolean().default(false).describe('Show the logo as a small corner watermark'),
});

export const ScriptSectionSchema = z.object({
  id: Id,
  title: z.string().default(''),
  narration: z.string().default('').describe('Exact words to be spoken'),
  visuals: z.string().default('').describe('What should be on screen (b-roll, graphics, template ideas)'),
  onScreenText: z.string().optional(),
  durationSec: z.number().optional(),
  voiceAssetId: z.string().optional(),
  status: z.enum(['draft', 'voiced', 'placed']).default('draft'),
});

export const ScriptSchema = z.object({
  title: z.string().default(''),
  hook: z.string().default(''),
  sections: z.array(ScriptSectionSchema).default([]),
  callToAction: z.string().default(''),
  notes: z.string().default(''),
});

export const ChapterSchema = z.object({ time: Seconds, title: z.string() });

export const ThumbnailSchema = z.object({
  template: z.string().default('bold-text'),
  props: z.record(z.string(), z.unknown()).default({}),
  code: z.string().optional().describe('Optional custom TSX thumbnail component'),
  file: z.string().optional().describe('Rendered PNG in the media folder'),
});

export const YouTubeSchema = z.object({
  title: z.string().default(''),
  titleOptions: z.array(z.string()).default([]),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  chapters: z.array(ChapterSchema).default([]),
  category: z.string().default('27').describe('YouTube category id (27 = Education, 28 = Science & Tech, 22 = People & Blogs, 24 = Entertainment)'),
  privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
  madeForKids: z.boolean().default(false),
  thumbnail: ThumbnailSchema.default(ThumbnailSchema.parse({})),
  uploadedVideoId: z.string().optional(),
});

export const RenderRecordSchema = z.object({
  id: Id,
  kind: z.enum(['video', 'thumbnail', 'audio']).default('video'),
  createdAt: z.string(),
  status: z.enum(['queued', 'bundling', 'rendering', 'finishing', 'done', 'error', 'cancelled']),
  progress: z.number().min(0).max(1).default(0),
  preset: z.string().default('standard'),
  file: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  sizeBytes: z.number().optional(),
  error: z.string().optional(),
  elapsedSec: z.number().optional(),
});

export const MarkerSchema = z.object({
  id: Id,
  time: Seconds,
  label: z.string(),
  color: Color.default('#FACC15'),
});

export const CanvasSchema = z.object({
  width: z.number().int().min(64).max(7680).default(1920),
  height: z.number().int().min(64).max(7680).default(1080),
  fps: z.number().int().min(12).max(60).default(30),
  background: Color.default('#000000'),
});

export const AudioMixSchema = z.object({
  duckLevel: z.number().min(0).max(1).default(0.22).describe('Music volume multiplier while speech is playing'),
  normalize: z.boolean().default(true).describe('Normalize final loudness for YouTube'),
  loudnessTarget: z.number().min(-30).max(-8).default(-14).describe('Integrated LUFS target'),
});

export const ProjectSchema = z.object({
  schemaVersion: z.number().default(SCHEMA_VERSION),
  id: Id,
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canvas: CanvasSchema.default(CanvasSchema.parse({})),
  brief: BriefSchema.default(BriefSchema.parse({})),
  brand: BrandSchema.default(BrandSchema.parse({})),
  assets: z.array(AssetSchema).default([]),
  tracks: z.array(TrackSchema).default([]),
  script: ScriptSchema.default(ScriptSchema.parse({})),
  youtube: YouTubeSchema.default(YouTubeSchema.parse({})),
  markers: z.array(MarkerSchema).default([]),
  renders: z.array(RenderRecordSchema).default([]),
  audio: AudioMixSchema.default(AudioMixSchema.parse({})),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Transition = z.infer<typeof TransitionSchema>;
export type Box = z.infer<typeof BoxSchema>;
export type KenBurns = z.infer<typeof KenBurnsSchema>;
export type Zoom = z.infer<typeof ZoomSchema>;
export type ColorGrade = z.infer<typeof ColorGradeSchema>;
export type Word = z.infer<typeof WordSchema>;
export type VideoClip = z.infer<typeof VideoClipSchema>;
export type ImageClip = z.infer<typeof ImageClipSchema>;
export type AudioClip = z.infer<typeof AudioClipSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
export type SceneClip = z.infer<typeof SceneClipSchema>;
export type CodeClip = z.infer<typeof CodeClipSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type CaptionsClip = z.infer<typeof CaptionsClipSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type ClipType = Clip['type'];
export type ClipInput = z.input<typeof ClipSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type TrackKind = Track['kind'];
export type Asset = z.infer<typeof AssetSchema>;
export type AssetKind = Asset['kind'];
export type Brief = z.infer<typeof BriefSchema>;
export type Brand = z.infer<typeof BrandSchema>;
export type ScriptSection = z.infer<typeof ScriptSectionSchema>;
export type Script = z.infer<typeof ScriptSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Thumbnail = z.infer<typeof ThumbnailSchema>;
export type YouTubeMeta = z.infer<typeof YouTubeSchema>;
export type RenderRecord = z.infer<typeof RenderRecordSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;
export type AudioMix = z.infer<typeof AudioMixSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export type VisualClip = VideoClip | ImageClip | TextClip | SceneClip | CodeClip;
export type MediaClip = VideoClip | AudioClip;

export const isVisualClip = (c: Clip): c is VisualClip =>
  c.type === 'video' || c.type === 'image' || c.type === 'text' || c.type === 'scene' || c.type === 'code';

export const isMediaClip = (c: Clip): c is MediaClip => c.type === 'video' || c.type === 'audio';

/** Which clip types a track kind can hold. */
export const TRACK_ACCEPTS: Record<TrackKind, ClipType[]> = {
  video: ['video', 'image', 'scene', 'code', 'text'],
  overlay: ['video', 'image', 'scene', 'code', 'text'],
  audio: ['audio'],
  captions: ['captions'],
};

/** Data passed to the Remotion composition (preview and render). */
export interface CompositionInput extends Record<string, unknown> {
  project: Project;
  /** assetId -> absolute or root-relative URL the browser/renderer can load */
  assetUrls: Record<string, string>;
  /** assetId -> source-relative words (used by auto captions and ducking) */
  transcripts: Record<string, Word[]>;
  /** 'preview' in the editor, 'render' for final output, 'still' for QA frames */
  mode: 'preview' | 'render' | 'still';
}

export interface ThumbnailInput extends Record<string, unknown> {
  project: Project;
  assetUrls: Record<string, string>;
  thumbnail: Thumbnail;
}
