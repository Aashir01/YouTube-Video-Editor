---
name: editing-playbook
description: Professional editing technique — cuts, pacing, b-roll, zooms, transitions, sound design, track usage in Cutroom.
---
# Editing playbook

## Tracks in Cutroom (bottom → top)
- **Main** (video): the primary sequence — the talking-head cut, or full-screen scenes/images/b-roll in faceless videos. Avoid gaps (black frames).
- **B-roll** (overlay): cutaways that cover the speaker while their audio continues. Mute b-roll video (`muted: true`) unless its sound matters.
- **Graphics** (overlay): lower thirds, callouts, text, subscribe reminders, transparent code scenes.
- **Captions**: one captions clip spanning the video (auto mode follows the edit).
- **Voiceover / Music / SFX** (audio).

## Cutting talking-head footage
1. Transcribe, then `auto_cut` to remove pauses > ~0.45s and filler words. Alternate punch-in zooms (1.1–1.2×) hide jump cuts.
2. Read the transcript and remove bad takes/repeats with `removeRanges` or `removePhrases` (keep the *last* clean take).
3. Tighten the opening: start on the first strong sentence.
4. Target cadence: a visual change every 3–8 seconds (cut, zoom, b-roll, graphic). Faster for Shorts and entertainment, slower for documentary/education.

## Zooms (punch-ins)
- Emphasis words, punchlines and key numbers: `smooth` zoom 1.25–1.4× for 1–3s, focus on the face (x≈0.5, y≈0.35–0.45 for a centered speaker).
- Jump-cut cover: `snap` 1.1–1.2× on alternating segments.
- Slow push (`slow-push` 1.0→1.15) for serious or emotional moments.

## B-roll
- Put b-roll on keywords: when the speaker says a concrete noun or claim, show it for 2–5 seconds.
- Prefer the user's own footage/images, then stock (search with concrete visual terms: "aerial city night traffic", not "economy").
- Images: add Ken Burns (scale 1.0→1.15) so they never sit still. Portrait images in 16:9: `blurredBackdrop: true`.
- Cover jump cuts and visual dead zones with b-roll; don't cover the speaker's strongest emotional moments.

## Transitions
- Default to hard cuts. Use transitions with intent: `fade` for time passing, `whip`/`slide-*` for energetic topic changes, `zoom-in` into a detail, `flash` on a reveal. 0.25–0.5s.
- Never stack a transition on every cut.

## Sound design
- Music under voice: `duck: true`, volume 0.4–0.7 before ducking, fade in 1s / fade out 1.5–2s. Change music or drop it out at section changes for energy shifts.
- SFX: whoosh on whips/slides, pop on text/graphics appearing, ding/chime on reveals or checkmarks, impact on big numbers, riser before a reveal (ends exactly at the reveal). Keep SFX volume 0.3–0.7.
- Silence is a tool: a 0.5s music drop before a punchline lands harder.

## Captions
- Shorts: `bold-pop` or `highlight-box`, 2–3 words per page, position center/lower-center, avoid the bottom 25% (Shorts UI).
- Long-form: `clean` or `boxed`, 6–9 words, bottom; or `bold-pop` for energetic channels.

## Pacing checks before rendering
- No black gaps on Main, no orphaned b-roll past the end, music ends with a fade at the end of the video.
- Every on-screen text stays long enough to read: ≥ 0.4s per word, ≥ 1.5s minimum.
- Check a few frames with `preview_frames` at scene starts, mid-graphics and the ending.
