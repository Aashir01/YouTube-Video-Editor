import { describe, expect, it } from 'vitest';
import { createProject } from '../../shared/timeline';
import { videoMetadata } from './youtube';

describe('YouTube upload metadata', () => {
  const project = () => {
    const p = createProject({ name: 'Demo' });
    p.youtube.title = 'How to grow a channel';
    p.youtube.description = 'Everything I learned.';
    p.youtube.hashtags = ['youtube', '#growth'];
    return p;
  };

  it('sends the title and description in other languages, with the original language set', () => {
    const p = project();
    p.brief.language = 'en';
    const meta = videoMetadata(p, { privacy: 'unlisted', localizations: { es: { title: 'Cómo hacer crecer un canal', description: 'Todo lo que aprendí.' } } });
    expect(meta.snippet.defaultLanguage).toBe('en');
    expect(meta.localizations).toEqual({ es: { title: 'Cómo hacer crecer un canal', description: 'Todo lo que aprendí.\n\n#youtube #growth' } });
    expect(meta.snippet.description).toBe('Everything I learned.\n\n#youtube #growth');
    expect(meta.status.privacyStatus).toBe('unlisted');
  });

  it('leaves localizations out when there are none', () => {
    const meta = videoMetadata(project(), { privacy: 'private' });
    expect('localizations' in meta).toBe(false);
  });
});
