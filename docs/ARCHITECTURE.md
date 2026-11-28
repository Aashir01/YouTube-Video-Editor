# Architecture

Cutroom is a local web app: a Node server owns the projects, media pipeline, renderer and AI agent, and a React UI edits the same project live. External MCP clients get the same capabilities as the in-app agent.

```
                    ┌──────────────────────────── Browser (React UI) ────────────────────────────┐
                    │ Timeline · Inspector · Panels · Remotion Player (preview) · Director chat   │
                    └───────▲─────────────── REST (ops, uploads, chat) ──────────────┬────────────┘
                            │ SSE: project / agent / render / job / toast events     │
┌───────────────────────────┴────────────────────────── Node server (Hono) ──────────▼────────────────────┐
│ ProjectStore ── applyOps (src/shared/ops.ts) ── history (undo/redo) ── EventBus                         │
│ Media pipeline: upload → probe/thumb/filmstrip/waveform/silences/scenes/loudness → transcription      │
│ Renderer: Remotion bundle (cached) → renderMedia/renderStill → FFmpeg loudnorm → MP4/MP3 + SRT         │
│ Agent: Director loop ── 55 tools ── skills ── sub-agents ── LLM adapters (Anthropic / OpenAI / Gemini)  │
│ MCP server (/mcp HTTP, stdio) · MCP client (external servers) · YouTube Data API                        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. The project document

`src/shared/schema.ts` defines one Zod-validated JSON document per video (`data/projects/<id>/project.json`). The UI, the agent tools, MCP and the renderer all read and write it.

Conventions:
- **Time** is in seconds (floats). Frames are derived from `canvas.fps` only when rendering.
- **Positions and boxes** are fractions of the canvas (0..1), so layouts survive aspect changes such as 16:9 → 9:16.
- **Sizes** (fonts, radii, strokes) are *design px*: 1 unit = 1 px when the short side is 1080 px. They scale automatically for 720p, 4K or vertical video.
- **Reframing**: video and image clips have `focus` (the point of the source kept in view, 0..1) and `scale` (zoom). This is how footage is panned inside a frame, and how a 16:9 shot is reframed for 9:16.
- **Keyframes**: any clip can carry `keyframes: { channel: [{ t, v, ease? }] }`. Here `t` is in seconds from the clip start, and an animated channel overrides its static field (see "Keyframe animation" below).

Main parts:

| Field | Purpose |
|---|---|
| `tracks[]` | Ordered tracks (`video`, `overlay`, `audio`, `captions`) with clips; later tracks paint on top |
| clips | `video`, `image`, `audio`, `text`, `scene` (template + props), `code` (custom TSX), `captions` (auto or manual words), `blur` (a blurred box or ellipse over the picture) |
| `assets[]` | Media and documents with probe metadata, thumbnail, waveform peaks, transcript status, analysis (silences, scenes, loudness, beats and tempo of music), editing proxy, source/license; processed copies (background removed, stabilized, color look) record the original they were `derived` from |
| `brief`, `brand` | What the video is (topic, audience, tone, format, length) and how it looks (colors, fonts, logo, watermark) |
| `script` | Sections with exact narration and visual plan; linked to voiceover assets |
| `youtube` | Title + options, description, tags, chapters, category, privacy, thumbnail design |
| `markers[]` | Labelled review markers on the ruler (time, label, color), set by the user (`M`) or the Director |
| `renders[]`, `audio` | Export records (video or audio-only, whole or a range, with their subtitle languages); mix settings (duck level, loudness target) |
| `multicam[]` | Groups of cameras and microphones of one recording, each placed on a shared clock (`offset`); camera cuts are video clips linked to their group |

Some per-project data lives next to `project.json` instead of in it, because it is not part of the undoable edit: `moments.json` (Shorts found by the AI), `autopilot.json` (the Shorts autopilot run) and `translations.json` (the subtitle translation cache).

Default tracks: Main, B-roll, Graphics, Captions, Voiceover, Music, SFX. A Blur track is added between B-roll and Graphics the first time a blur box is used; blur boxes may overlap each other, so several faces can be hidden at once.

**Auto captions** don't store words. They are derived live from the transcripts of the clips on the timeline (`timelineWords` maps source-relative words through trims and speed), so they stay in sync after any cut. **Ducking** uses the same speech intervals to lower music under narration.

## 2. Edits, history and live sync

`src/shared/ops.ts` defines `EditOp`: `addClip`, `updateClip`, `moveClip`, `trimClip`, `splitClip`, `removeClips` (optionally ripple), `rippleDelete`, `liftRange` (clear a range, keep the gap), `shiftClips`, `closeGaps`, `addMarker` / `updateMarker` / `removeMarker`, keyframe ops (`setKeyframe`, `removeKeyframe`, `clearKeyframes`, `moveKeyframes`, `setKeyframeEase`), multicam ops (`setMulticam`, `switchAngle`), track ops, `setBrief` / `setBrand` / `setCanvas` / `setYoutube` / `setScript` / `setAudioMix`, and asset ops. `applyOps` mutates a draft and throws readable errors (overlaps, locked tracks, invalid template props, media bounds).

- **Server**: `ProjectStore.update(id, label, mutator)` serializes writes per project, validates the result, stores an undo snapshot, keeps "follower" clips attached to the end (auto captions, looping music), saves atomically and emits a `project` event.
- **UI**: the Zustand store applies the same `applyOps` locally for instant feedback, then sends the ops. Requests are chained so the server sees them in order; the response from the latest one wins. Typing and sliders use `editSoon`, which merges patches per field and flushes after a pause, so a drag creates one undo step.
- **SSE** (`/api/projects/:id/events`) streams `project`, `agent` (messages, text deltas, plan, status, usage), `render` progress, background `job`s and `toast`s. The connection resyncs after reconnects.

Because every change goes through the same ops, an edit made by the user, the Director or an MCP client looks and undoes the same way.

**Ripple edits** (ripple delete, Q/W trims, transcript cuts, range delete) apply to the *sync tracks*: every unlocked track except music-only tracks, so graphics, captions and b-roll stay in sync with the picture while a music bed keeps playing.

## 3. Composition (Remotion)

`src/remotion/` renders the document:

- `Main.tsx` turns each clip into a `<Sequence>` with transitions (14 types), grading, Ken Burns, punch-in zooms, picture-in-picture boxes and audio fades and ducking.
- `templates/`: 28 parameterized motion-graphics scenes (titles, lists, charts, explainers, quotes, CTAs, overlays). Each template's props have a Zod schema in `src/shared/templates.ts`. That one schema validates agent input, generates the Inspector form and documents the template for the LLM.
- Captions come in 8 presets with word-level highlight and pagination.
- `code/runtime.tsx` handles **code scenes**. TSX written by the agent is compiled with Sucrase in the browser and renderer (never executed on the server) against a fixed module map (`react`, `remotion`, `@remotion/shapes|paths|noise|layout-utils`, and a `director` kit of helpers). A static check (`src/shared/code-check.ts`) rejects non-determinism and network access before a scene is saved, and an error boundary reports runtime errors back to the agent.
- `Thumbnail.tsx` provides 6 thumbnail layouts (or custom code), rendered as a still.
- **Blur clips** (`BlurView` in `clips.tsx`) blur whatever is painted below them with CSS `backdrop-filter`. An ellipse is a radial mask with a soft edge. The headless render browser draws them exactly as the preview does.
- **Transparent video** (background removed): VP9 with alpha in WebM. The editor plays it natively, and the renderer extracts its frames as PNG (`OffthreadVideo transparent`) so the alpha survives.
- **Captions in another language**: a captions clip with a `language` shows the translation (see "Subtitles in other languages"), right to left for Arabic, Hebrew, Persian and Urdu.
- Fonts (12 families) are bundled locally, so preview and render are identical and work offline.

The same composition runs in the editor (Remotion Player), the agent's QA frames (`renderStill`) and the final render.

### Keyframe animation

`src/shared/keyframes.ts` is the one model behind every animation:
- **Channels:** it defines the animatable channels per clip type.
  - video/image: `box.x/y/w/h`, `focus.x/y`, `scale`, `opacity`, `rotation`, plus `volume` on video;
  - text: `x`, `y`, `style.size`, `opacity`, `rotation`;
  - audio: `volume`;
  - blur: `box.x/y/w/h`, `opacity`.
- **Interpolation:** easing applies per segment (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `hold`).
- **Edit helpers:** set, remove, clear, move and re-ease keys, shared by the ops, the editor and the agent tools.

How it works:
- **Rendering:** `Main.tsx` wraps each visual clip in `Animated`, which evaluates `animateClip(clip, frame / fps)`. The clip views therefore render an ordinary clip whose fields already hold this frame's values. Volume curves call `channelAt` inside Remotion's per-frame `volume` callback.
- **Timeline edits keep the motion in place:**
  - Split pieces shift their keys and keep the nearest out-of-range key on each side, so the motion is continuous across the cut.
  - Start-trims shift video and audio keys so they stay on the same footage. Graphics keep theirs relative to the clip start.
  - Speed changes stretch key times.
- **Editor:** a channel with keys is "animated". Editing its value in the Inspector or on the canvas upserts a key at the playhead (auto-key) instead of touching the static field.

Clip elements carry `data-clip-box` / `data-clip-kind` attributes (`text`, `box`, `frame`, `captions`). The editor's canvas overlay uses them to hit-test and outline what's under the pointer in the live preview, so on-canvas editing works for every clip type and template without per-template code.

## 4. Rendering

`src/server/render/render.ts`:
1. **Bundle** the composition with `@remotion/bundler`, cached by a hash of `src/remotion` and `src/shared`. It's warmed up at startup.
2. Run `selectComposition` and `renderMedia` with a preset (`draft` at half resolution, `standard`, `high`, `4k`), optionally limited to an in–out `frameRange`. The headless browser fetches media from this server.
3. **Loudness**: two-pass FFmpeg `loudnorm` to the project target (−14 LUFS by default).
4. Write the **SRT** from what the captions show (every captions clip, since an edit can split one), or from the timeline words without captions, shifted to the range when one is exported. Each subtitle language gets its own `<id>.<lang>.srt`.
5. **Audio-only** exports render the mix as WAV, then encode an MP3 (320 kbps, with M4A as the fallback).
6. Report progress over SSE. Renders are queued and can be cancelled.

`renderFrames` renders individual stills for the agent's visual review, and `renderThumbnail` renders the YouTube thumbnail PNG.

## 5. Media pipeline

`src/server/media/ingest.ts`: an upload, URL import, stock import, TTS output or library sound runs through `registerAsset`, then a background `analyzeAsset`. Analysis covers probe metadata, a thumbnail, waveform peaks, silence detection, scene cuts, loudness, and text extraction for documents (PDF, DOCX, TXT/Markdown, CSV/TSV, JSON, HTML, XML, YAML, RTF, SRT/VTT). Speech is transcribed automatically when enabled. FFmpeg is resolved from `FFMPEG_PATH`, then the system install, then Remotion's bundled binary.

- **Filmstrips**: each video gets a sprite of evenly spaced frames (`tile` filter, keyframes only for long files) that the timeline slices into thumbnails at any zoom.
- **Browser recordings** (voice, camera, screen from `MediaRecorder`) are WebM files without a duration; they are remuxed with stream copy before probing.
- **Face detection** (`media/faces.ts`): the bundled YuNet model (`assets/models`, 232 KB, MIT) runs on `onnxruntime-node`, an optional dependency.
  - FFmpeg streams letterboxed BGR frames of the needed source range at 2 fps, and the stream is paused while inference catches up, so memory stays flat.
  - The model's outputs are decoded at strides 8/16/32, with non-maximum suppression. That costs about 30 ms per frame on a CPU.
  - Its landmarks give each face a mouth box. `analyzeTalking` reads 10 frames a second, detects faces on every fifth and links them into per-person tracks. For each person it measures how much the mouth changes from frame to frame, minus how much the forehead changes, so nodding is not talking. Frames where the whole picture changes (a cut or a flash) are skipped.
- **Object tracking** (`media/track.ts`): normalized cross-correlation template matching in plain JS, with no model.
  - Frames are downscaled so the template is at most about 48 px, and integral images make each window's mean and variance O(1).
  - The search runs coarse to fine around the last position. The template adapts slowly to changes in look. When the match score falls below 0.35 the region counts as lost, and its last good position is held.
- **Proxies** (`shared/proxy.ts`, `makeProxy`): light editing copies of heavy footage.
  - **When:** made automatically after analysis for codecs browsers can't play (anything but H.264, VP8, VP9 and AV1, e.g. HEVC or ProRes), for footage above 1080p, and for files over 20 minutes. The `render.proxies` setting picks `auto`, `always` or `off`, and the media card's menu creates or removes one by hand.
  - **What:** 540 px on the short side, H.264 (`veryfast`, CRF 27) with a keyframe every half second for quick seeking, AAC audio and `faststart`. They run on their own one-at-a-time job queue with progress.
  - **Use:** the preview's asset URLs point to the proxy (the **Playback quality** menu switches to the originals). Renders, frame reviews and analysis always read the original file.
- **Sync by sound** (`media/audio.ts`, `shared/dsp.ts`): FFmpeg streams each file's sound at 8 kHz into loudness per 10 ms; the half-wave rectified change of log loudness (onsets) ignores the level, so different microphones match. Two recordings are lined up by FFT cross-correlation normalized by the energy of their overlap, with a parabola through the peak for sub-frame precision and a confidence (how far the peak stands out).
- **Person segmentation** (`media/segment.ts`): MediaPipe's selfie segmentation (Apache-2.0), converted from TFLite to ONNX by `scripts/convert-selfie-segmentation.py` (which handles its custom transposed convolution) and bundled in `assets/models` (the landscape model for wide footage, the square one otherwise).
- **Processed copies** (`bake.ts`): background removal, green screen, stabilizing and LUT looks process only the part of the source a clip uses, register the result as `derived` from the original, and switch the clip to it in one undo step; **Restore the original** switches back. Alpha videos are never proxied. File paths in FFmpeg filter options are escaped for both levels of the filter graph.
- **Speech enhancement** (`enhanceSpeech`): `highpass` → `lowpass` → `afftdn` → `acompressor` → `loudnorm`, in light / medium / strong strengths. The video stream is copied, not re-encoded, and the transcript carries over to the new asset, which then replaces the original's clips in one undo step.

## 6. The Director agent

`src/server/agent/session.ts` implements a Claude-Code-style loop per project:

- **Context per turn**: the user's text plus a `<studio_state>` block (brief, brand, assets, timeline summary, lint warnings, available engines) and an optional `<editor_context>` (playhead, selected clips, in/out range) from the UI. The history is append-only so provider prompt caches stay warm.
- **Tools** (`tools/`, 55 in total):

  | Category | Tools |
  |---|---|
  | Conversation | `ask_user`, `update_plan`, `load_skill`, `delegate` |
  | Project | `get_project`, `get_timeline`, `set_brief`, `set_brand`, `set_canvas` |
  | Media | `inspect_assets`, `analyze_media`, `view_media`, `transcribe`, `get_transcript`, `search_transcript`, `read_document`, `annotate_asset`, `enhance_audio` |
  | Research | `web_search`, `fetch_url` |
  | Script | `write_script`, `list_voices` |
  | Generate | `generate_voiceover`, `search_stock`, `import_stock`, `generate_image`, `generate_audio`, `add_library_sound` |
  | Edit | `apply_edits`, `add_media`, `add_scene`, `add_captions`, `auto_cut`, `auto_reframe`, `blur_faces`, `track_motion`, `create_multicam`, `remove_background`, `stabilize_video`, `apply_lut`, `cut_to_beat` |
  | Motion | `list_templates`, `write_code_scene` |
  | Review | `check_timeline`, `preview_frames`, `review_retention` |
  | Publish | `set_youtube_metadata`, `design_thumbnail`, `render_video`, `find_shorts`, `create_short`, `translate_subtitles`, `create_dub`, `upload_to_youtube`, `shorts_autopilot` |

- **Human in the loop**: `ask_user` renders a question card (choices, multi-select, text, file drop zone) and waits for the answer. Paid actions request approval unless autonomy is "auto", and YouTube upload always does. A message typed while the agent works is delivered between steps.
- **Skills** are Markdown playbooks in `agent/skills/` plus user skills in `data/skills/`. They are loaded on demand to keep the base prompt small.
- **Sub-agents**: researcher, scriptwriter, motion_designer and reviewer. Each runs its own loop with a focused prompt and tool subset, and reports back.
- **Robustness**: tool inputs are validated with Zod and errors go back to the model. Truncated tool calls (`max_tokens`) are never executed. Read-only calls run in parallel. Tool output is capped. At about 150k tokens the history is compacted by the fast model.
- **Persistence**: `chat.json` holds the UI messages, the provider-neutral LLM history (including provider-specific replay data such as Claude thinking blocks and Gemini thought signatures) and the plan.

### LLM adapters

`src/server/ai/llm.ts` maps one neutral message format onto three wire protocols:
- **Anthropic** (official SDK): streaming, prompt caching, adaptive thinking where supported, server-side model fallbacks, and raw content-block replay.
- **OpenAI-compatible**: streaming tool-call assembly, `max_completion_tokens` vs `max_tokens` quirks, and image parts. This covers OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, LM Studio and anything else that speaks the protocol.
- **Gemini** (`@google/genai`): JSON-schema function declarations and thought-signature replay.

### Smart reframe

`src/shared/reframe.ts` turns face samples into a crop path. It is pure and unit tested.
1. **Focus formula.** For a "cover" fit with zoom `s`, media point `c` appears at `f + s·(c·k − f·(k−1) − f)`, where `k` is how far the media overflows the frame. Solving for the focus `f` that puts the face at the target (center, slightly above middle) gives `f = (s·c·k − target) / (s·k − 1)` per axis.
2. **Subject.** The subject is the biggest face, but the camera stays with the current one while it is comparable, so it doesn't flip between two people. Frames with no face hold the last position.
3. **Path.** A median filter removes detector spikes. Jumps bigger than a quarter frame split the path into shots, aligned to the asset's scene cuts when known, with `hold` keys so the camera cuts with the footage.
4. **Simplify.** Each shot is smoothed and simplified with Ramer–Douglas–Peucker within a tolerance measured in frame units. A steady subject becomes one static focus; otherwise you get a few linear `focus.x/y` keys.

**Conversations** (`planSpeakerReframe`) frame whoever is talking instead of the biggest face:
1. **When.** It needs at least two people who share the frame for at least 30% of the clip. People who never appear together are one person across shots, so the single-subject plan above is used.
2. **Group shot.** If everyone fits in the crop together, they are framed as a group with no cuts.
3. **Who talks.** Mouth activity is averaged per half second and measured above each person's resting level: their quietest 10%, capped near the quietest person's level, so someone who hardly stops talking still counts. A step counts only during speech (the asset's silence analysis) and only when one person clearly leads.
4. **Shots.** A new speaker must lead for 1 s, and every shot lasts at least 2 s, so the camera doesn't flicker. Because the plan is made offline, each cut is moved back to when the new speaker started, snapped to the start of their sentence or a cut in the footage when one is within 0.6 s. Shots are `hold` keys: the crop cuts rather than pans.

`src/server/reframe.ts` applies this to clips: the `auto_reframe` tool (Director, MCP, the Inspector's **Track faces**) and Make a Short, which reframes the new 9:16 project automatically. Each clip's summary says which plan was used (one subject, speakers or group).

### Motion tracking and blur

`src/shared/motion.ts` maps between the footage and the canvas. A point in the source goes through the clip's fit, zoom, focus, punch-in zooms, Ken Burns and keyframes (`mediaToCanvas`, `canvasToMedia`). The path is then simplified (Ramer–Douglas–Peucker) into keyframes (`pathKeyframes`).

`src/server/motion.ts` uses it for two features:
- **Follow** (`followTarget`, the `track_motion` tool, the Inspector's **Motion tracking**): a text, picture-in-picture or blur clip follows the nearest face (detector tracks) or whatever is under it (template matching). It keeps its offset from the target and gets smoothed `box.x/y` or `x/y` keys.
- **Blur faces** (`blurFacesOps`, the `blur_faces` tool, the Inspector's **Privacy** section): one blur clip per person in the shot, sized a little larger than the face. Position and size are smoothed separately, so the box moves with the face without jitter. It all lands as one undo step.

### Shorts from a long video

`src/server/shorts.ts` (`create_short`, `POST /api/projects/:id/shorts`, and **Make a Short** in the UI) derives a new project from one or more time ranges. It never modifies the source:
1. Merge and clamp the ranges (at least 0.5 s each, at most 180 s in total).
2. Ripple-delete everything outside them on every track except music beds, last gap first, so graphics and b-roll stay aligned. Music keeps playing from the start and is cut to the new length.
3. Switch the canvas to 1080×1920. Full-frame footage gets `fit: cover` with a focus point, and auto captions are added if none remain.
4. Reset the markers and the YouTube metadata (`#shorts`, private).
5. Copy only the assets still in use. Their files are hard-linked when possible, so a Short costs no extra disk space. Multicam groups still in use keep all their cameras, so cuts can still switch.

### Find Shorts

`src/server/moments.ts` and `src/shared/moments.ts` (the Shorts tab, `find_shorts`):
1. The timeline words become numbered sentences with times. Long transcripts are read in overlapping stretches (about 24k characters each, three at a time) so modest context windows work.
2. The AI answers with sentence numbers (JSON, read forgivingly: code fences, prose, trailing commas), so every moment starts and ends exactly on a sentence.
3. Picks are snapped with a little air (never into the neighboring sentence), trimmed or extended by whole sentences to the length limits, and overlaps go to the better score.
4. The list is saved in `moments.json` with a fingerprint of the words: the tab (and the server, which refuses stale times) knows when the edit has changed since. Making a Short reuses `createShort` and remembers the new project.

### Retention coach

`src/shared/retention.ts` (the Coach tab, `review_retention`) is a pure function of the project and its transcripts. The tab runs it on every edit in the browser; the Director runs it on the server. It needs no AI.

1. **Hook score:** the first 5 s of a Short (vertical canvas) or 15 s of a long video is scored out of 10 on weighted checks:
   - the first word within 0.8 s;
   - a hook cue in the first sentence (a question, "you", a number, words like secret, mistake or why);
   - pace in words a minute;
   - a visual change early on;
   - words on screen;
   - captions, on Shorts.
2. **Dead spots:**
   - pauses of a second or more;
   - filler words;
   - stretches between visual changes (clip edges on visible tracks, zooms, keyframes, detected scene cuts) longer than 5 s on a Short or 15 s on a long video, while someone talks;
   - minutes well below the video's own pace;
   - silence after the last word;
   - no call to action at the end.
3. **Fixes:** most are plain edit ops, so a fix is one undo step:
   - ripple cuts skip music beds and run from the last cut to the first, so earlier times stay valid;
   - snap punch-ins are spread over long shots;
   - the hook is added as a title.

   A few fixes run a tool (captions). The rest are prompts for the Director. Fixes are worked out on the current edit, so the tab analyzes again after each one.

### Shorts autopilot

`src/server/autopilot.ts` and `src/shared/autopilot.ts` (the Shorts tab's Autopilot card, `shorts_autopilot`):

1. **Order and schedule:** found moments are ordered best first. Each gets a publish slot: the first time, then every N hours.
2. **One at a time, in the background**, each moment goes through four steps:
   - **Make:** the Short is created, or the one already made is reused.
   - **Describe:** it gets its YouTube title, its hook, a link to the full video when that is uploaded, and #Shorts.
   - **Render:** it renders through the normal render queue.
   - **Upload:** it goes up as private with `publishAt`. A slot that has already passed moves to an hour from now, because YouTube refuses past times.
3. **State:** the run is kept in `autopilot.json` and streamed as `autopilot` events.
   - **Failures:** a failed Short doesn't stop the others.
   - **Stopping:** cancels the running render.
   - **Restarts:** a run cut short by a restart reads as stopped. "Retry" re-queues what didn't finish, at its slot.
4. **Approval:** uploads from the Director always ask first. A click in the Shorts tab is the approval.
5. **Tests:** the Google endpoints can be overridden (`CUTROOM_YOUTUBE_API_BASE`, `CUTROOM_GOOGLE_OAUTH_BASE`), so the e2e suite publishes to a scripted YouTube.

### Multicam

`src/server/multicam.ts` and `src/shared/multicam.ts` (the Multicam dialog, `create_multicam`):
1. **Sync**: every camera and microphone is lined up with the first camera by sound (see "Sync by sound").
2. **Who talks**: with one microphone per person, their RMS level (the other voice bleeding in stays far below); otherwise mouth movement in each close-up (`analyzeTalking`), with the speech of the main recording as a mask. Microphones are matched to the close-up whose mouth follows them best. The camera with the most people is the wide shot.
3. **Cutting** (`planCameraCuts`, pure): each person's level above their resting level, scaled so talking is about 1; a new speaker must lead for 1 s, shots last at least 2 s, cuts move back to when the speaker started (snapped to a sentence start), people talking over each other get the wide shot, and long monologues an occasional cutaway. A camera that was not recording hands over to the wide shot (or any that was).
4. **The edit**: camera cuts are ordinary video clips with their sound off, linked to the group (`multicam`); the microphones (or the first camera) play as continuous audio on their own tracks. `switchAngle` shows another camera at the same moment (`trimStart` moves by the offset difference), optionally cutting first at the playhead: that is what keys 1–9 do.

### Subtitles in other languages

`src/server/subtitles.ts` and `src/shared/subtitles.ts` (Export → Languages, `translate_subtitles`):
- **Cache, not copies.** Translations are kept per language as sentence text → translation (`translations.json`). Subtitles are always rebuilt from what the captions show now, so they follow every edit, and only new sentences go to the AI (in batches of about 3,500 characters, as numbered lines, answered as JSON). The YouTube title and description are translated too, and re-translated when they change.
- **Timing.** A translated sentence takes the original's time span, its words spread by length; Chinese, Japanese and Thai are cut into a few characters at word boundaries (`Intl.Segmenter`), never inside a character. Sentences not translated yet show in the original.
- **Where they go.** An SRT per language from the API, next to every render, and as caption tracks on YouTube with the translated title and description (`localizations`); captions with a `language` show one in the picture.
- **Dubbed versions** (`src/server/dub.ts`, `create_dub`): a derived project where each line (short sentences joined) is voiced where it was said, sped up to 1.35× when the translation runs long (then cut short), the original speech lowered to 12% or muted, captions fixed to the translation, and the YouTube text translated.

### Beats

`src/shared/beats.ts` (the music clip's **Find the beats**, `cut_to_beat`):
- **Tracking.** The tempo is the autocorrelation peak of the loudness onsets between 60 and 180 BPM, weighted toward 120; the beats are the best path through the onsets with steps close to that period (dynamic programming, after Ellis 2007), so it follows tempo drift and quiet breaks. They are kept with the asset.
- **Using them.** Music clips show their beats on the timeline, and every drag snaps to them. **Cut to the beat** re-times the chosen clips back to back from the beat nearest the first, each lasting whole beats (about as long as before, or `every` N beats), within what a video has left of its source.

## 7. MCP

- **Server** (`src/server/mcp/server.ts`): `/mcp` uses the Streamable HTTP transport, and `director mcp` runs over stdio. Stdio bridges to a running studio, or starts one in-process. It exposes the 50 Director tools that need no chat (all but `ask_user`, `update_plan` and `delegate`) plus `list_projects`, `create_project`, `select_project` and `import_file`, and the prompts `produce_video` and `edit_footage`. Changes appear live in any open editor.
- **Client** (`src/server/mcp/client.ts`): servers configured in Settings (stdio or HTTP) are connected at startup and on change. Their tools are offered to the Director as `mcp__<server>__<tool>`.

## 8. The editor UI

`src/web/` is a React app. A Zustand store (`lib/store.ts`) holds the project, playhead, selection, in/out range and UI preferences.
- **Shared actions** (`lib/actions.ts`) are used by keyboard shortcuts, context menus, toolbar buttons and the command palette alike. They cover split, ripple trims, nudges, clipboard, markers, ranges, J/K/L shuttle, transcript cuts, speech enhancement and Make a Short.
- **Canvas overlay** (`editor/CanvasOverlay.tsx`): selection outlines, drag/resize handles, snapping guides and keyboard nudges over the live preview. Drags start from the animated values at the playhead and auto-key animated channels. They go through `editSoon`, so each gesture is one undo step.
- **Keyframes UI** (`editor/Keyframes.tsx`):
  - the ◆ button next to animatable fields;
  - `useAnim`, which binds fields to channel values at the playhead and auto-keys;
  - the Animation section: presets, plus every key with its time, value, easing and delete.
  Timeline clips show key diamonds (drag to retime, right-click for easing) and an animated volume curve.
- **Timeline** (`editor/Timeline.tsx`, `TimelineClip.tsx`): a canvas ruler (ticks, chapters, markers, range), clips with filmstrips, waveforms, volume envelopes and fade handles, rubber-band selection and snapping.
- **Transcript panel** (`panels/TranscriptPanel.tsx`): timeline words (`timelineWordsDetailed`) mapped back to clips. Cutting words turns them into ripple-deleted ranges, and filler and pause detection (`fillerRanges`, `pauseRanges`) live in `src/shared/timeline.ts`.
- **Command palette** (`lib/commands.ts`, `editor/CommandPalette.tsx`): fuzzy search over commands, clips and times, plus one-line Director briefs.
- **Tracking and blur** (`editor/Tracking.tsx`): the Motion tracking buttons (follow a face or what's under the clip), **Blur faces**, and the blur box editor (shape, strength, opacity). Blur boxes are moved and resized on the canvas like any box.
- **Preview** (`editor/Preview.tsx`): plays proxies when they exist. The **Playback quality** menu switches to the originals.
- **Shorts tab** (`panels/ShortsPanel.tsx`): finding moments (how many, length, what to look for), playing one (it sets the in/out range), making Shorts, and noticing when the edit changed.
- **Multicam** (`editor/MulticamDialog.tsx`, the Media panel's camera button): pick cameras in order and microphones, follow the speaker or stay on camera 1. Cuts are labeled "Cam N", switched from the clip menu, the Inspector's Multicam section, or keys 1–9 at the playhead.
- **Languages** (`editor/LanguagesPanel.tsx`, a tab of Export): add languages, see what is new since the last translation, download SRTs, show a language in the captions, make a dubbed version. The captions Inspector has a Language picker too.
- **Background and Footage** (Inspector sections in `editor/Tracking.tsx`): remove the background or a green screen (with a blurred original behind), stabilize, apply a .cube look at any strength, and restore the original. Music clips get a Beats row.
- **Recording** (`editor/RecordDialog.tsx`): `getUserMedia` / `getDisplayMedia` + `MediaRecorder`, uploaded as a normal asset and placed at the playhead.
- `window.cutroom` exposes the store and player for automation and end-to-end tests.

## 9. Services and fallbacks

| Service | Engines (in automatic order) |
|---|---|
| Transcription | Groq → ElevenLabs → OpenAI → whisper.cpp → Transformers.js (local) |
| Voice | ElevenLabs (exact word timings) → OpenAI → Gemini → Kokoro (local) → system voice |
| Stock | Pexels, Pixabay, Openverse |
| Images | OpenAI gpt-image, Gemini |
| Search | Tavily, Brave, DuckDuckGo |
| Sound | 12 SFX + 2 music beds synthesized locally (no downloads) |

When an engine gives no word timings, the voiceover is transcribed for alignment. If that's unavailable, timings are estimated.

**Cutroom AI** is the AI provider for people without a key. It is served by Cutroom Cloud, a separate server in `src/cloud/` (see [CLOUD.md](CLOUD.md)).

- **Sign-in:** signing in (`/api/cloud/*`) stores a Cloud token in settings. `getSettings()` then adds a read-only `cutroom` OpenAI-compatible provider. Its `visionModels` tell the adapter which catalog models accept images. The token is masked like every key, and only `/api/cloud` can change the sign-in.
- **Billing:** Cloud forwards `/v1/chat/completions` to OpenRouter and reads the request's reported cost from the final usage chunk. It then writes a ledger row and takes the credits.
  - Credits sit in buckets: the monthly allowance, which resets lazily on the next use, then gifts, then bought credits.
  - A request the account can't afford gets `402`, which the Director shows as an error.
- **Routing:** `auto` routes by content: text steps go to a cheap text model, and steps with frames go to a vision model.
- **Credit meter:** the top bar shows the credits left. The meter refreshes when a Director run stops, when Settings closes, and every two minutes.

## 10. Distribution

- **Launchers** (`Cutroom.bat`, `Cutroom.command`, `cutroom.sh`):
  - **Node.js:** installed when missing. Windows uses winget; on macOS and Linux it's a checksum-verified private copy in `.cutroom-runtime/`.
  - **Packages:** `npm ci` runs on the first launch, and again whenever `package-lock.json` changes.
  - **Start:** `director start` builds the UI if needed and opens the browser.
- **Docker** (`Dockerfile`, `docker-compose.yml`):
  - **Build:** a two-stage build (`npm ci` → UI build → `npm prune --omit=dev`) onto `node:22-bookworm-slim`, with FFmpeg, Chrome's libraries and the Remotion render browser.
  - **Runtime:** runs as `node`, with `DIRECTOR_DATA_DIR=/data` on a volume and a health check on `/api/health`.
  - **Compose:** publishes on `127.0.0.1:3333` only and gives Chrome 1 GB of shared memory.

## 11. Tests

- **Unit and integration** (`npm test`, Vitest): timeline and ops, keyframes, Shorts and finding them, the reframe, motion and multicam planners, sync by sound and the FFT, beats, subtitles and their timing, matte helpers, proxies, YouTube metadata, Cutroom Cloud (the credit ledger, plans, pricing and the gateway against a scripted upstream), the retention coach (each finding and that its fix resolves it), the autopilot schedule, the agent loop, LLM adapters, MCP and services. The planners are pure functions, so they're tested on synthetic tracks and signals.
- **End to end** (`npm run test:e2e`, `tests/e2e/`): Playwright drives a real Chromium against `director start` on a temporary data folder. A scripted OpenAI-compatible model stands in for the AI.
  - **Fixtures:** FFmpeg makes the test media, including footage with a real face, two "speakers", a multicam recording (three cameras and mics that started at different moments), a green screen, shaky footage, a drum loop, and 1440p and HEVC files.
  - **The scripted model** also finds Shorts, translates subtitles, and speaks for dubbed versions (the runner points OpenAI voices at it with `OPENAI_BASE_URL`).
  - **Checks:** the suites use the app like a person would, then check the saved project and the rendered frames: faces are re-detected on renders to check reframing and blur, pixel colors show which camera is on or what shows through a removed background, and shake is measured with the app's own tracker. Any browser console error fails a suite.

- **Retention coach** (`coach` suite): a talk with a slow, flat opening, a long pause, a filler and a silent ending gets fixed click by click from the Coach tab. The hook and retention scores go up, one Ctrl+Z undoes a fix, the Director's tool applies fixes, and a weak hook line goes to the Director.
- **Shorts autopilot** (`autopilot` suite): the scripted model also stands in for YouTube (OAuth token, resumable upload, captions).
  - **A scheduled run:** two found Shorts are made, rendered and uploaded as private, one a day from the chosen time, best first, with titles, hooks and captions.
  - **A render-only run:** started through the Director's tool, then stopped.

- **Cutroom Cloud** (`cloud` suite): the runner also starts Cloud on its own database, billing the scripted model, which reports a cost like OpenRouter does.
  - **Account and model:** the suite creates an account in Settings, switches the Director to Cutroom AI and runs a session.
  - **Charges:** it checks every request's charge against its cost, and that the meter follows.
  - **Out of credits:** it runs out and sees the Director's message, then applies a manual payment twice; it must count once.
  - **Sign-in:** it signs out and back in.

## 12. Security notes

- The server binds to `127.0.0.1` by default.
- Settings are stored with file mode 600. API keys are masked (`••••abcd`) in every API response, and masked values sent back are merged with the stored secrets.
- Media paths are resolved inside the project folder, which prevents path traversal.
- Agent-written code runs only inside the browser and the render sandbox, after static checks. The server only checks it statically and never executes it.
- Cutroom Cloud stores scrypt password hashes and only SHA-256 hashes of app tokens. It limits signups per network and failed sign-ins, and runs its admin API only with an `ADMIN_TOKEN`.
- YouTube uses the user's own OAuth client (Desktop app, loopback redirect), and uploads always require explicit approval.
