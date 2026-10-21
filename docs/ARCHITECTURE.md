# Architecture

Director Studio is a local web app: a Node server owns the projects, media pipeline, renderer and AI agent, and a React UI edits the same project live. External MCP clients get the same capabilities as the in-app agent.

```
                    ┌──────────────────────────── Browser (React UI) ────────────────────────────┐
                    │ Timeline · Inspector · Panels · Remotion Player (preview) · Director chat   │
                    └───────▲─────────────── REST (ops, uploads, chat) ──────────────┬────────────┘
                            │ SSE: project / agent / render / job / toast events     │
┌───────────────────────────┴────────────────────────── Node server (Hono) ──────────▼────────────────────┐
│ ProjectStore ── applyOps (src/shared/ops.ts) ── history (undo/redo) ── EventBus                         │
│ Media pipeline: upload → probe/thumb/waveform/silences/scenes/loudness → transcription                │
│ Renderer: Remotion bundle (cached) → renderMedia/renderStill → FFmpeg loudnorm → MP4 + SRT             │
│ Agent: Director loop ── 40 tools ── skills ── sub-agents ── LLM adapters (Anthropic / OpenAI / Gemini)  │
│ MCP server (/mcp HTTP, stdio) · MCP client (external servers) · YouTube Data API                        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 1. The project document

`src/shared/schema.ts` defines one Zod-validated JSON document per video (`data/projects/<id>/project.json`). The UI, the agent tools, MCP and the renderer all read and write it.

Conventions:
- **Time** is in seconds (floats). Frames are derived from `canvas.fps` only when rendering.
- **Positions and boxes** are fractions of the canvas (0..1), so layouts survive aspect changes such as 16:9 → 9:16.
- **Sizes** (fonts, radii, strokes) are *design px*: 1 unit = 1 px when the short side is 1080 px. They scale automatically for 720p, 4K or vertical video.

Main parts:

| Field | Purpose |
|---|---|
| `tracks[]` | Ordered tracks (`video`, `overlay`, `audio`, `captions`) with clips; later tracks paint on top |
| clips | `video`, `image`, `audio`, `text`, `scene` (template + props), `code` (custom TSX), `captions` (auto or manual words) |
| `assets[]` | Media and documents with probe metadata, thumbnail, waveform peaks, transcript status, analysis (silences, scenes, loudness), source/license |
| `brief`, `brand` | What the video is (topic, audience, tone, format, length) and how it looks (colors, fonts, logo, watermark) |
| `script` | Sections with exact narration and visual plan; linked to voiceover assets |
| `youtube` | Title + options, description, tags, chapters, category, privacy, thumbnail design |
| `renders[]`, `audio` | Export records; mix settings (duck level, loudness target) |

Default tracks: Main, B-roll, Graphics, Captions, Voiceover, Music, SFX.

**Auto captions** don't store words. They are derived live from the transcripts of the clips on the timeline (`timelineWords` maps source-relative words through trims and speed), so they stay in sync after any cut. **Ducking** uses the same speech intervals to lower music under narration.

## 2. Edits, history and live sync

`src/shared/ops.ts` defines `EditOp`: `addClip`, `updateClip`, `moveClip`, `trimClip`, `splitClip`, `removeClips` (optionally ripple), `rippleDelete`, `shiftClips`, `closeGaps`, track ops, `setBrief` / `setBrand` / `setCanvas` / `setYoutube` / `setScript` / `setAudioMix`, and asset ops. `applyOps` mutates a draft and throws readable errors (overlaps, locked tracks, invalid template props, media bounds).

- **Server**: `ProjectStore.update(id, label, mutator)` serializes writes per project, validates the result, stores an undo snapshot, keeps "follower" clips attached to the end (auto captions, looping music), saves atomically and emits a `project` event.
- **UI**: the Zustand store applies the same `applyOps` locally for instant feedback, then sends the ops. Requests are chained so the server sees them in order; the response from the latest one wins. Typing and sliders use `editSoon`, which merges patches per field and flushes after a pause, so a drag creates one undo step.
- **SSE** (`/api/projects/:id/events`) streams `project`, `agent` (messages, text deltas, plan, status, usage), `render` progress, background `job`s and `toast`s. The connection resyncs after reconnects.

Because every change goes through the same ops, an edit made by the user, the Director or an MCP client looks and undoes the same way.

## 3. Composition (Remotion)

`src/remotion/` renders the document:

- `Main.tsx` turns each clip into a `<Sequence>` with transitions (14 types), grading, Ken Burns, punch-in zooms, picture-in-picture boxes and audio fades and ducking.
- `templates/`: 28 parameterized motion-graphics scenes (titles, lists, charts, explainers, quotes, CTAs, overlays). Each template's props have a Zod schema in `src/shared/templates.ts`. That one schema validates agent input, generates the Inspector form and documents the template for the LLM.
- Captions come in 8 presets with word-level highlight and pagination.
- `code/runtime.tsx` handles **code scenes**. TSX written by the agent is compiled with Sucrase in the browser and renderer (never executed on the server) against a fixed module map (`react`, `remotion`, `@remotion/shapes|paths|noise|layout-utils`, and a `director` kit of helpers). A static check (`src/shared/code-check.ts`) rejects non-determinism and network access before a scene is saved, and an error boundary reports runtime errors back to the agent.
- `Thumbnail.tsx` provides 6 thumbnail layouts (or custom code), rendered as a still.
- Fonts (12 families) are bundled locally, so preview and render are identical and work offline.

The same composition runs in the editor (Remotion Player), the agent's QA frames (`renderStill`) and the final render.

## 4. Rendering

`src/server/render/render.ts`:
1. **Bundle** the composition with `@remotion/bundler`, cached by a hash of `src/remotion` and `src/shared`. It's warmed up at startup.
2. Run `selectComposition` and `renderMedia` with a preset (`draft` at half resolution, `standard`, `high`, `4k`). The headless browser fetches media from this server.
3. **Loudness**: two-pass FFmpeg `loudnorm` to the project target (−14 LUFS by default).
4. Write the **SRT** from the timeline words.
5. Report progress over SSE. Renders are queued and can be cancelled.

`renderFrames` renders individual stills for the agent's visual review, and `renderThumbnail` renders the YouTube thumbnail PNG.

## 5. Media pipeline

`src/server/media/ingest.ts`: an upload, URL import, stock import, TTS output or library sound runs through `registerAsset`, then a background `analyzeAsset`. Analysis covers probe metadata, a thumbnail, waveform peaks, silence detection, scene cuts, loudness, and text extraction for documents (PDF, DOCX, TXT/Markdown, CSV/TSV, JSON, HTML, XML, YAML, RTF, SRT/VTT). Speech is transcribed automatically when enabled. FFmpeg is resolved from `FFMPEG_PATH`, then the system install, then Remotion's bundled binary.

## 6. The Director agent

`src/server/agent/session.ts` implements a Claude-Code-style loop per project:

- **Context per turn**: the user's text plus a `<studio_state>` block (brief, brand, assets, timeline summary, lint warnings, available engines) and an optional `<editor_context>` (playhead, selected clips) from the UI. The history is append-only so provider prompt caches stay warm.
- **Tools** (`tools/`, 40 in total):

  | Category | Tools |
  |---|---|
  | Conversation | `ask_user`, `update_plan`, `load_skill`, `delegate` |
  | Project | `get_project`, `get_timeline`, `set_brief`, `set_brand`, `set_canvas` |
  | Media | `inspect_assets`, `analyze_media`, `view_media`, `transcribe`, `get_transcript`, `search_transcript`, `read_document`, `annotate_asset` |
  | Research | `web_search`, `fetch_url` |
  | Script | `write_script`, `list_voices` |
  | Generate | `generate_voiceover`, `search_stock`, `import_stock`, `generate_image`, `generate_audio`, `add_library_sound` |
  | Edit | `apply_edits`, `add_media`, `add_scene`, `add_captions`, `auto_cut` |
  | Motion | `list_templates`, `write_code_scene` |
  | Review | `check_timeline`, `preview_frames` |
  | Publish | `set_youtube_metadata`, `design_thumbnail`, `render_video`, `upload_to_youtube` |

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

## 7. MCP

- **Server** (`src/server/mcp/server.ts`): `/mcp` uses the Streamable HTTP transport, and `director mcp` runs over stdio. Stdio bridges to a running studio, or starts one in-process. It exposes the 37 non-chat Director tools plus `list_projects`, `create_project`, `select_project` and `import_file`, and the prompts `produce_video` and `edit_footage`. Changes appear live in any open editor.
- **Client** (`src/server/mcp/client.ts`): servers configured in Settings (stdio or HTTP) are connected at startup and on change. Their tools are offered to the Director as `mcp__<server>__<tool>`.

## 8. Services and fallbacks

| Service | Engines (in automatic order) |
|---|---|
| Transcription | Groq → ElevenLabs → OpenAI → whisper.cpp → Transformers.js (local) |
| Voice | ElevenLabs (exact word timings) → OpenAI → Gemini → Kokoro (local) → system voice |
| Stock | Pexels, Pixabay, Openverse |
| Images | OpenAI gpt-image, Gemini |
| Search | Tavily, Brave, DuckDuckGo |
| Sound | 12 SFX + 2 music beds synthesized locally (no downloads) |

When an engine gives no word timings, the voiceover is transcribed for alignment. If that's unavailable, timings are estimated.

## 9. Security notes

- The server binds to `127.0.0.1` by default.
- Settings are stored with file mode 600. API keys are masked (`••••abcd`) in every API response, and masked values sent back are merged with the stored secrets.
- Media paths are resolved inside the project folder, which prevents path traversal.
- Agent-written code runs only inside the browser and the render sandbox, after static checks. The server only checks it statically and never executes it.
- YouTube uses the user's own OAuth client (Desktop app, loopback redirect), and uploads always require explicit approval.
