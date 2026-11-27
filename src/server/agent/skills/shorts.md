---
name: shorts
description: YouTube Shorts / vertical video specifics — format, safe zones, hooks, pacing, looping.
---
# YouTube Shorts (9:16)

- Canvas 1080×1920 (`set_canvas` aspect 9:16 or brief format `short`). Up to 3 minutes is allowed; 20–45s performs best for most topics.
- **Safe zones**: the top ~12% (title/search UI) and the bottom ~25% (channel name, description, buttons) and right edge (like/comment buttons, ~12%) are covered. Keep text and faces in the middle band.
- **Hook in the first second**: start mid-action or with the boldest line; no logo intro, no "hey guys".
- **Captions**: `bold-pop` or `highlight-box`, 2–3 words, `position: center`, `offsetY` 0.08–0.15.
- **Pacing**: a visual change every 1.5–3s (cuts, zooms, b-roll, text pops, emoji bursts).
- **Reframing landscape footage**: put the 16:9 clip on Main with `fit: cover`, then call `auto_reframe`: it finds the speaker's face and keeps it in frame (a locked crop, smooth `focus.x` keyframes when they move, cuts with the footage). For podcasts and interviews it cuts to whoever is talking. Check the result with `preview_frames`. To place it by hand instead, set `focus` or animate `focus.x` keyframes; or show the footage smaller with `box` + `blurredBackdrop`-style background.
- **Loop**: end on a line/visual that flows back into the first second.
- **Repurposing long-form**: find the most self-contained 20–60s moment in the transcript (a strong claim + payoff), cut it with `auto_cut` using `removeRanges` to keep only that span, then add captions, zooms and a hook text in the first 2s.

## Repurposing a long video
To make Shorts from an existing long video, don't rebuild by hand: read the transcript (`get_transcript`), pick 1–3 self-contained moments (20–60s, starting on a hook line, ending on a payoff) and call `create_short` with their timeline ranges and a punchy title. It creates a separate 9:16 project with footage reframed on the speaker's face automatically (pass `focusX` only to force a fixed crop), synced graphics, captions and #shorts metadata. Tell the user the new project's name.
