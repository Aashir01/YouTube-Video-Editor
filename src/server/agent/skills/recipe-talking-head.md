---
name: recipe-talking-head
description: Step-by-step recipe for editing user footage (talking head, tutorial, vlog, podcast) into a polished YouTube video.
---
# Recipe: edit the user's footage

1. **Understand the footage**: `inspect_assets`, then `transcribe` each speaking clip (if not already). Use `view_media` on the main footage (4–6 frames) to see framing, lighting and where the face is (for zoom focus). `annotate_asset` with what you learned.
2. **Read the transcript** (`get_transcript` as sentences). Identify: the strongest opening line, retakes/mistakes (keep the last good take), tangents to drop, the key points and emotional peaks.
3. **Rough cut**: `auto_cut` the main footage onto Main with `removeRanges` for bad takes/tangents and `jumpCutZoom: true`. Check the new length against the brief's target.
4. **Hook**: if the best line is later in the video, consider a cold open (copy that segment to the start) or a `title-card`/`question` scene after the first sentence.
5. **Zooms**: add `smooth` punch-ins (1.25–1.35×) on emphasis moments via `apply_edits` updateClip (`zooms`).
6. **B-roll & graphics**: for each key claim/noun, add b-roll (user images/clips, stock) on the B-roll track, and graphics (lower third for the speaker's intro in the first 10–20s, charts for numbers, bullet lists for summaries). Load `motion-graphics`.
7. **Captions**: `add_captions` (style per format).
8. **Audio**: music bed ducked under speech, SFX on graphics/transitions, fade out at the end.
9. **Chapters**: `chapter-card` scenes or just metadata chapters at topic changes.
10. **Review**: `check_timeline` + `preview_frames` (opening, every graphic, ending). Fix issues.
11. **Publish package**: `design_thumbnail`, `set_youtube_metadata` (title options, description with chapters), then `render_video`.
