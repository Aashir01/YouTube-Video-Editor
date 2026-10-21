---
name: youtube-scriptwriting
description: Writing YouTube scripts that hold attention — hooks, retention structure, pacing, CTAs, writing for the ear.
---
# YouTube scriptwriting

## The first 15 seconds decide the video
- Open on the payoff or the tension, never on "Hi guys, welcome back". The first sentence must make the viewer need the next one.
- Hook formulas that work:
  - **Contrarian**: "Everything you were told about X is backwards."
  - **Stakes**: "If you do X, you lose Y — and almost everyone does it."
  - **Curiosity gap**: "There's one number that explains X. By the end you'll know it."
  - **Proof first**: show the end result, then "here's exactly how".
  - **Question the viewer is already asking**, answered in a surprising way.
- Within ~10s, state the promise (what they get by staying) and why you are credible (briefly).
- Visual hook: the first shot is the most striking visual you have (a big number, a bold title, motion).

## Structure for retention
- Long-form (6–15 min): Hook → Promise → 3–6 sections, each a mini-story (setup → tension → payoff) → recap → CTA → end screen.
- Open loops: tease something that is paid off later ("the third one surprised me"). Close every loop you open.
- Pattern interrupts every 30–60s: a chapter card, a question card, a chart, a change of pace or music, an SFX hit.
- Shorts (15–60s): hook in the first second, one idea, no intro, end on a line that loops back to the start.

## Pacing and length
- Narration speed ~150 words/min (2.5 words/s). For a target duration T seconds, write ≈ 2.4·T words.
- Short sentences. One idea per sentence. Active voice. Concrete nouns and numbers.
- Write for the ear: contractions, rhetorical questions, "you". Read it aloud mentally — if it's hard to say, rewrite it.
- Every section should have a visual plan: what is on screen while each sentence plays (template, b-roll, footage, chart).

## Facts and honesty
- Never invent statistics, quotes or studies. Use facts from the user's documents or from research (web_search/fetch_url), and keep the source to show on screen (charts have a `source` field).
- If you can't verify something, phrase it as an opinion or leave it out.

## Calls to action
- One soft CTA mid-video when value has been delivered ("if this helped, subscribing helps a lot") and one at the end pointing to the next video (end screen).
- Never beg in the first 30 seconds.

## Script format for `write_script`
- One section per beat (usually 1–4 sentences, 5–25 seconds of narration).
- `narration`: exactly the words to be spoken (no stage directions inside).
- `visuals`: what to show — template id + key props, b-roll search terms, footage moments, on-screen text.
- `onScreenText`: short text to emphasize (≤ 6 words).
