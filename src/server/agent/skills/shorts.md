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
- **Reframing landscape footage**: put the 16:9 clip on Main with `fit: cover` (center crop). Use zooms with a focus point on the subject; or show it smaller with `box` + `blurredBackdrop`-style background.
- **Loop**: end on a line/visual that flows back into the first second.
- **Repurposing long-form**: find the most self-contained 20–60s moment in the transcript (a strong claim + payoff), cut it with `auto_cut` using `removeRanges` to keep only that span, then add captions, zooms and a hook text in the first 2s.
