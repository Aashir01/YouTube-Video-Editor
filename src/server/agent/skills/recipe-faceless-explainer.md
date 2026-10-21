---
name: recipe-faceless-explainer
description: Step-by-step recipe for generating a video from a topic (faceless explainer / documentary / listicle) with voiceover, motion graphics and b-roll.
---
# Recipe: generate a video from a topic

1. **Brief**: make sure you know topic, audience, tone, target length and format (ask with `ask_user` if not). Ask for attachments that make it unique: their logo, images, data, documents, or footage.
2. **Research** (delegate to `researcher` for anything factual): collect 5–12 verifiable facts with sources. Read user documents first (`read_document`).
3. **Script**: load `youtube-scriptwriting`, then `write_script` with 6–15 sections. Each section: narration + visual plan (template or b-roll terms). Target words ≈ 2.4 × target seconds.
4. **Approve**: summarize the script outline for the user and ask for approval (`ask_user` choice) before spending on voiceover — unless the user asked you to run fully autonomously.
5. **Voiceover**: `generate_voiceover` for all sections with `place: true` (sequential on the Voiceover track). This gives exact section timings.
6. **Visuals per section** (start/end = that section's voiceover clip):
   - Scenes on Main for graphics-friendly sections (`add_scene` with the section timing), b-roll/images on Main for visual sections (stock via `search_stock` → `import_stock`, or user images, or `generate_image`).
   - Split long sections into 2–3 visuals (a change every 3–8s).
   - Write custom code scenes for unique visuals (load `code-scenes`).
7. **Captions** (`add_captions`), **music** (ducked bed), **SFX** on transitions/reveals.
8. **Branding**: `set_brand` colors/fonts/logo; optional `logo-reveal` intro ≤ 2.5s; `end-screen` at the end (10–20s).
9. **Review**: `check_timeline`, `preview_frames` across scenes; delegate to `reviewer` for a second opinion on longer videos. Fix everything you find.
10. **Publish package**: thumbnail, metadata with chapters from sections, render.
