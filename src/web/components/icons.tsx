import React from 'react';
import { AudioLines, Captions, Clapperboard, CodeXml, Film, Image, Mic, Music, Sparkles, Type, Volume2 } from 'lucide-react';
import type { Clip, Track } from '../../shared/schema';

/** lucide v1 dropped brand icons; this is the YouTube play-button mark. */
export const YouTubeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="currentColor"
      d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z"
    />
    <path fill="#0b0d17" d="m9.6 15.6 6.3-3.6-6.3-3.6v7.2Z" />
  </svg>
);

export const Logo: React.FC<{ className?: string }> = ({ className }) => (
  // Cutroom mark: a play triangle split by a timeline playhead
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#ede9e1" />
    <path d="M21 17 29.5 21.72V42.28L21 47Z" fill="#111318" />
    <path d="M34.5 24.5 48 32 34.5 39.5Z" fill="#111318" />
    <path d="M28 11h8v3l-4 4-4-4Z" fill="#ff4f1f" />
    <rect x="31" y="16" width="2" height="38" rx="1" fill="#ff4f1f" />
  </svg>
);

export const CLIP_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  video: { bg: '#1d3a66', border: '#3b82f6', text: '#cfe1ff' },
  image: { bg: '#123f45', border: '#14b8a6', text: '#c6f6ef' },
  voiceover: { bg: '#163d2a', border: '#22c55e', text: '#cdf7dc' },
  music: { bg: '#2c2a52', border: '#818cf8', text: '#dcdcff' },
  sfx: { bg: '#4a2c16', border: '#f59e0b', text: '#ffe6c2' },
  original: { bg: '#163d2a', border: '#22c55e', text: '#cdf7dc' },
  text: { bg: '#4b3a10', border: '#eab308', text: '#fff1bf' },
  scene: { bg: '#3a2366', border: '#8b5cf6', text: '#e6dbff' },
  code: { bg: '#4d1d43', border: '#ec4899', text: '#ffd6f1' },
  captions: { bg: '#3f3f12', border: '#d4d424', text: '#fbfbc8' },
};

export const clipColor = (clip: Clip) => CLIP_COLORS[clip.type === 'audio' ? clip.role : clip.type] ?? CLIP_COLORS.video!;

export const ClipIcon: React.FC<{ clip: Clip; className?: string }> = ({ clip, className = 'size-3.5' }) => {
  switch (clip.type) {
    case 'video':
      return <Film className={className} />;
    case 'image':
      return <Image className={className} />;
    case 'audio':
      return clip.role === 'voiceover' ? <Mic className={className} /> : clip.role === 'music' ? <Music className={className} /> : <Volume2 className={className} />;
    case 'text':
      return <Type className={className} />;
    case 'scene':
      return <Sparkles className={className} />;
    case 'code':
      return <CodeXml className={className} />;
    case 'captions':
      return <Captions className={className} />;
  }
};

export const TrackIcon: React.FC<{ track: Track; className?: string }> = ({ track, className = 'size-3.5' }) => {
  const n = track.name.toLowerCase();
  if (track.kind === 'captions') return <Captions className={className} />;
  if (track.kind === 'audio') return n.includes('voice') ? <Mic className={className} /> : n.includes('music') ? <Music className={className} /> : <AudioLines className={className} />;
  if (track.kind === 'overlay') return <Sparkles className={className} />;
  return <Clapperboard className={className} />;
};
