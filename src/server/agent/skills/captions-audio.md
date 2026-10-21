---
name: captions-audio
description: Caption styling per format, and audio mixing (voice, music ducking, SFX, loudness) for YouTube.
---
# Captions & audio

## Captions
- Use one captions clip covering the whole video with `add_captions` (auto mode stays in sync with every edit because words come from the clips' transcripts/voiceover).
- Presets:
  - `bold-pop` — uppercase, 2–3 words, active word pops in accent color. Shorts, entertainment, fast explainers.
  - `highlight-box` — active word in a colored box. Shorts, punchy edits.
  - `karaoke` — full line, words fill as spoken. Music/lyrics, storytelling.
  - `clean` — sentence-style subtitles with shadow. Documentaries, tutorials, calm long-form.
  - `boxed` — YouTube-like box. Interviews, accessibility-first.
  - `neon`, `typewriter`, `minimal` — special looks; use sparingly.
- Position: long-form `bottom`; Shorts `center` with `offsetY` ≈ 0.08–0.15 (keeps clear of the Shorts UI at the bottom). Move captions up (`offsetY` negative) when lower thirds are on screen at the bottom.
- Captions need transcripts: transcribe footage (`transcribe`) or use voiceover generated with `generate_voiceover` (word timings included).
- Fix misheard words by editing the transcript (UI) — captions update automatically.

## Audio mixing
- Voice is king: dialogue/voiceover at full level (volume 1). Everything else serves it.
- Music: `role: music`, `duck: true`, `loop: true` for beds, volume 0.35–0.7. The project duck level (default 0.22) lowers it under speech automatically. Fade in 1s, fade out 1.5–2.5s.
- SFX: short, purposeful, volume 0.3–0.7; align to the visual frame where the motion happens (a whoosh starts ~0.15s before a whip transition lands).
- Final loudness is normalized to −14 LUFS (YouTube) at render time (`audio.normalize`).
- Avoid music with vocals under narration. Use the built-in library (`add_library_sound`) for drafts, ElevenLabs music/SFX generation or user-provided tracks for final.
