# Cutroom

**An agentic, AI-powered video editor for YouTube.** Tell the Director what you want to make. It asks for what it needs (topic, audience, footage, logo, notes), then scripts, edits, animates, captions, mixes, designs the thumbnail and packages the video for YouTube, live on a real timeline you can edit by hand at any moment.

It runs locally as a web app (browser UI + Node server), works with **any LLM** (OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, LM Studio or any OpenAI-compatible API), and is also an **MCP server**, so Claude Code, Claude Desktop or Cursor can drive it too.

```
 You: "A 6-minute explainer on how compound interest works, for beginners"
  │
  ▼
 Director ──► asks: audience? length? style? any notes/footage/logo?   (question cards + file drop)
          ──► plan ▸ research ▸ script ▸ voiceover ▸ graphics ▸ b-roll ▸ captions ▸ music ▸ review frames
          ──► thumbnail ▸ title/description/chapters/tags ▸ render ▸ (optional) upload to YouTube
  │
  ▼
 Timeline + preview update live. Every change is undoable, and you can edit anything yourself.
```

---

## What it can do

**Two kinds of videos (or both at once)**
- **Edit your footage.** It transcribes, cleans up the voice (denoise and leveling), removes silences and filler words (jump cuts with punch-in zooms that hide the cuts), adds b-roll, captions, lower thirds, music with automatic ducking, sound effects and loudness normalization.
- **Create from a topic.** It researches the web with sources, writes a retention-focused script and generates AI voiceover with word timings. It then builds animated graphics (charts, lists, quotes, timelines, comparisons…) and adds stock footage, AI images, captions and music.

**Agentic, like a real editor**
- Asks structured questions with options, and collects your files right in the chat.
- Publishes a live plan checklist and keeps it current.
- Loads **playbooks (skills)** for scripting, editing, motion design, captions/audio, Shorts and thumbnails/SEO.
- **Delegates** to specialist sub-agents: researcher, scriptwriter, motion designer and reviewer.
- **Looks at its own work.** It renders real preview frames and inspects them (vision models), then fixes overflow, collisions and pacing.
- Writes **custom animated scenes in code** (React + Remotion), checked and sandboxed, when no template fits.
- Asks before paid actions (AI voice, AI images), and always asks before uploading to YouTube.
- Reads what you're looking at: the playhead, selected clips and in/out range travel with your message, so "make *this* shorter" or "turn this part into a Short" just works.

**A professional editor, not just a chat**
- **Edit right on the video.** Click anything in the preview to select it, drag to move, pull handles to resize, and nudge with the arrow keys. Guides snap to the center, the thirds, the safe margins and other elements. Drag full-frame footage to reframe it, or zoom in with one-click presets (center, left, right, top, face).
- **Edit by text.** The transcript follows playback word by word. Select words and press Delete to cut them from the video. One click removes every filler word or tightens long pauses, and a double-click fixes a misheard word.
- **Pro timeline**:
  - Editing: move, trim, split, ripple delete, rubber-band selection, copy/paste at the playhead, Q/W ripple trims, frame nudges, J/K/L shuttle and jumps between edit points.
  - Ranges and markers: mark in/out to loop, delete, lift, export or turn a range into a Short; labelled markers for review notes.
  - Clips and tracks: a volume line and fade handles on every clip, filmstrips and waveforms, adjustable track heights, mute/hide/lock, and YouTube chapters.
- **Record** your voice, camera or screen straight onto the timeline at the playhead, with device picker, level meter and countdown. A camera take becomes a picture-in-picture when the main track is in use.
- **Enhance speech** in one click: rumble and hiss removal, denoise, compression and loudness leveling, without re-encoding the video.
- **Command palette** (`Ctrl/⌘+K`): run any command, jump to a time (`1:23`), find a clip by its text, or ask the Director. `?` lists every shortcut. There's also an undo-history menu, a save indicator and `/` quick briefs in the chat.
- **Long video → Shorts.** Mark a range or select words in the transcript, then click **Make a Short**. You get a new 9:16 project with the footage reframed, graphics kept in sync, music trimmed to length and captions added. The Director can do the same.
- Frame-accurate preview (Remotion Player) with playback speed, zoom, safe-zone, thirds and center guides, and in/out looping.
- Inspector for every clip type: placement and picture-in-picture, color grading, Ken Burns, punch-in zooms, transitions, text styling, captions styling, and auto-generated forms for template props. Your brand colors are one click away in every color field.
- **28 motion-graphics templates** that use your brand colors and fonts, **8 caption styles**, and **12 built-in sound effects** with 2 music beds, all generated locally.
- 16:9 videos and 9:16 Shorts (also 1:1 and 4:5), 24/30/60 fps.
- Export to H.264 MP4 (draft / standard / high / 4K) plus an SRT file, an audio-only MP3, or just the in–out range. Also includes a live thumbnail designer, YouTube metadata (title options, description, tags, chapters) and direct upload with scheduling.
- Start fast from recipes on the home screen (faceless explainer, talking-head edit, top-10 list, tutorial, Short, podcast → Shorts), and search, sort and rename your projects.

## How it's built

| Layer | Tech |
|---|---|
| Composition & rendering | [Remotion](https://www.remotion.dev) 4 (React → video), FFmpeg |
| Server | Node 20+, Hono, Server-Sent Events, Zod-validated project document |
| Agent | Custom tool-calling loop (Claude-Code-style): 42 tools, skills, sub-agents, context compaction |
| LLM adapters | Native Anthropic, OpenAI-compatible and Gemini adapters (streaming, tool calls, vision) |
| UI | React 19, Vite, Tailwind CSS 4, Zustand, Radix |
| Integrations | MCP server (Streamable HTTP + stdio), MCP client, YouTube Data API |

The editor UI, the AI agent and MCP clients all edit the **same project document** with the **same operations**, so manual and AI edits behave identically and share one undo history. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Quick start

### 1. Requirements

- **Node.js 20.19 or newer** (22 LTS recommended): <https://nodejs.org>
- **FFmpeg** (recommended; a bundled fallback covers most features):
  - macOS: `brew install ffmpeg`
  - Windows: `winget install Gyan.FFmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
- About 1 GB of disk space. On the first render, Remotion downloads a headless Chrome (~100 MB) unless you point it at an installed Chrome (Settings → Rendering).

### 2. Install and run

```bash
git clone https://github.com/Aashir01/YouTube-Video-Editor.git director-studio
cd director-studio
npm install
npm start          # builds the UI on first run, then opens http://localhost:3333
```

Run `npm run doctor` any time to check FFmpeg, the render browser, your AI model and the optional local engines.

### 3. Connect an AI model

Open **Settings → AI models**, click a provider, paste a key, press **Fetch** to list its models, then **Test** and **Save**. Pick a strong **main model** (it runs the Director) and a cheap **fast model** (summaries and small tasks).

Or put keys in a `.env` file (copy [.env.example](.env.example)); they're picked up automatically:

```bash
OPENAI_API_KEY=sk-...        # or GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY
```

| Provider | Notes |
|---|---|
| OpenAI | GPT-5 family. The same key also enables OpenAI TTS, Whisper and gpt-image. |
| Google Gemini | Gemini 2.5 Pro/Flash, with a generous free tier. The same key enables Gemini TTS and images. |
| Anthropic | Claude (adaptive thinking, prompt caching, automatic model fallbacks). |
| OpenRouter | One key for hundreds of models. |
| Groq, DeepSeek, Mistral, xAI, Together | OpenAI-compatible endpoints, preconfigured. |
| Ollama / LM Studio | Free and local. Use a model with solid tool calling (e.g. a recent Qwen or Llama 70B-class); small models struggle with long agentic tasks. |
| Custom | Any OpenAI-compatible base URL. |

The Director needs a model that supports **tool calling**. Vision support is optional but recommended: it lets the Director look at your footage and its own preview frames.

### 4. Make a video

On the home screen, describe the video (or start from a recipe), pick **16:9** or **Short 9:16**, and choose **From topic**, **Edit footage** or **Both**. The Director takes it from there. Answer its questions, drop in your files, and watch the timeline fill up. Hit **Export** when it's done (or ask the Director to render it).

No model yet? You can still edit manually: drag media, graphics and sounds onto the timeline, use the Inspector, and export.

---

## Optional services (all fall back gracefully)

| Capability | Best | Also supported | Free / local fallback |
|---|---|---|---|
| Transcription (captions, jump cuts) | Groq Whisper (fast, cheap) | OpenAI Whisper, ElevenLabs Scribe | whisper.cpp or Transformers.js Whisper, on your machine |
| AI voiceover | ElevenLabs | OpenAI TTS, Gemini TTS | **Kokoro** (local, good quality), system voice |
| Stock footage | Pexels, Pixabay (free keys) | | Openverse images (no key) |
| Web research | Tavily | Brave Search | DuckDuckGo (no key) |
| AI images | OpenAI gpt-image | Gemini image | none |
| Music & SFX | Your uploads | | 12 built-in synthesized SFX + 2 beds |

Keys go in **Settings → Voice & speech** / **Media & search keys** or in `.env`. Local models (Whisper, Kokoro) download once on first use, roughly 80–150 MB each.

---

## The editor

```
┌ Top bar: project · format · undo/redo + history · save state · search/palette · settings · Export ┐
├ Media / Text /     ├──────────── Preview (Remotion Player) ────────────┤ Director chat  │
│ Graphics / Audio / │   click, drag, resize and reframe right on video  │ (plan, steps,  │
│ Script / Project   │   speed · zoom · guides · loop · fullscreen       │  questions)    │
│ panels             ├──── Timeline (tracks, clips, ruler, range) ───────┤  or Inspector  │
└────────────────────┴───────────────────────────────────────────────────┴────────────────┘
```

Press `?` in the editor to see every shortcut.

| Shortcut | Action |
|---|---|
| `Space` | Play / pause |
| `J` / `K` / `L` | Play backwards / pause / play forwards (press again for 2×, 4×, 8×) |
| `←` `→` / `Shift`+`←` `→` | Previous/next frame / second |
| `↑` / `↓` | Previous / next edit point |
| `Home` / `End` | Go to start / end |
| `S` or `Ctrl/⌘+B` | Split at playhead |
| `Q` / `W` | Ripple-trim the clip start / end to the playhead |
| `Delete` / `Shift+Delete` | Delete / ripple delete selected clips |
| `Ctrl/⌘+C` / `X` / `V` | Copy / cut / paste at the playhead |
| `Ctrl/⌘+D`, `Ctrl/⌘+A` | Duplicate, select all |
| `Alt`+`←` `→` | Nudge selected clips one frame (`Shift`: 10 frames) |
| `I` / `O`, `Alt+X` | Mark in / out, clear the range |
| `M` | Add a marker |
| `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` | Undo, redo |
| `+` / `-`, `Ctrl/⌘+wheel`, `\` | Zoom the timeline, zoom to fit |
| Arrows (preview selection) | Nudge 0.5% (`Shift` 5%, `Alt` 0.1%) |
| `Ctrl/⌘+K` | Command palette: commands, clips, times, the Director |
| `/` | Message the Director |
| `Ctrl/⌘+E` | Export |
| Double-click a clip | Open it in the Inspector |
| Double-click text in the preview | Edit the text |
| Right-click a clip or empty track | Split, duplicate, paste, add marker, close gaps, ask the Director… |

You can drag media, templates and sounds from the left panel (or files from your desktop) onto any track. Drag on empty timeline space to rubber-band select; drag a clip's volume line or its corner fade handles to mix by hand.

---

## Use it from Claude Code, Claude Desktop or Cursor (MCP)

Cutroom is an MCP server with **43 tools**: the Director's 39 non-chat tools plus `list_projects`, `create_project`, `select_project` and `import_file`. It also provides two prompts, `produce_video` and `edit_footage`. Everything an MCP client does shows up live in the open editor.

**Claude Code** (while the studio is running):

```bash
claude mcp add --transport http director-studio http://localhost:3333/mcp
```

**Claude Desktop / Cursor** (stdio; it connects to a running studio, or starts one itself):

```json
{
  "mcpServers": {
    "director-studio": {
      "command": "node",
      "args": ["/absolute/path/to/director-studio/bin/director.mjs", "mcp"]
    }
  }
}
```

Settings → **MCP & integrations** shows these snippets with your real paths, ready to copy.

### Give the Director more tools

Settings → MCP & integrations also accepts external MCP servers, in the same format as Claude Desktop's `mcpServers`. Their tools appear to the Director as `mcp__<server>__<tool>`. For example:

```json
{
  "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Videos"] },
  "my-api": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
}
```

### Teach it your style

Add Markdown playbooks to `data/skills/` (with a `description:` front-matter line), for example your channel's editing rules, intro format and banned phrases. The Director lists them next to the built-in skills and loads them when relevant.

---

## Publishing to YouTube

Uploads use your own free Google Cloud project, so videos never pass through anyone else's servers.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com), create a project and enable **YouTube Data API v3**.
2. On the OAuth consent screen, choose **External** and add your Google account as a test user.
3. Under Credentials, create an **OAuth client ID** of type **Desktop app**.
4. In Cutroom → Settings → **YouTube**, paste the client ID and secret, then click **Save & connect channel**.

**Export → YouTube** uploads the render with the title, description and chapters, plus the tags, category, privacy, thumbnail and SRT captions. You can schedule a publish time. The Director can upload too, but always asks for your approval first.

---

## CLI

```
director start [--port 3333] [--host 127.0.0.1] [--no-open]   # default
director dev                                                  # hot reload for development
director mcp                                                  # MCP over stdio
director build                                                # build the UI
director doctor                                               # diagnostics
```

Use `npm start`, `npm run dev`, `npm run mcp` and `npm run doctor`, or run `node bin/director.mjs …` directly.

## Data & privacy

Everything stays on your computer in `data/` (override it with `DIRECTOR_DATA_DIR`):

```
data/settings.json                 your settings and keys (file mode 600; keys are masked in the UI)
data/projects/<id>/project.json    the project document
data/projects/<id>/chat.json       the Director conversation
data/projects/<id>/media/          uploads, recordings, generated media, thumbnails, filmstrips, waveforms, transcripts
data/projects/<id>/renders/        exported MP4s, MP3s and SRTs
data/skills/                       your own playbooks
data/cache/                        render bundle, downloaded local models
```

Content is sent only to the services you configure: your LLM provider, and optionally TTS, transcription, stock, search, image and YouTube APIs.

## Troubleshooting

- **"No AI model connected"**: add a provider in Settings → AI models and use **Test**. For local models, start Ollama or LM Studio first.
- **The Director stops with a model error**: the message shows the provider's error. Common causes are an invalid key, a model without tool-calling support, or a context window that's too small (use a bigger model).
- **Render fails on Linux**: Chromium needs the usual system libraries (`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`…). Alternatively, set a local Chrome in Settings → Rendering.
- **No captions appear**: captions follow the transcripts. Check the transcription engine in Settings → Voice & speech, then use "Transcribe" on the asset in the Media panel (or "Transcribe the timeline" in the Text panel).
- **Recording doesn't start**: allow camera/microphone access for the page in your browser. Screen recording needs a browser that supports screen capture (Chrome, Edge, Firefox).
- Run `npm run doctor` for a full report.

## Development

```bash
npm run dev         # server + Vite with hot reload on http://localhost:3333
npm test            # unit + integration tests (timeline, ops, agent loop, LLM adapters, MCP, services)
npm run typecheck
npx tsx scripts/template-gallery.ts   # renders every template as stills into dist/gallery
```

```
bin/director.mjs        CLI
src/shared/             project schema, timeline operations, templates catalog (used by server, UI and renderer)
src/remotion/           the video composition: clips, effects, 28 templates, captions, code scenes, thumbnails
src/server/             HTTP API, storage, media pipeline, rendering, services, agent, MCP
src/server/agent/       Director loop, prompts, skills (Markdown), 42 tools
src/web/                the editor UI
docs/ARCHITECTURE.md    how it all fits together
```

## Licensing notes

- **Remotion** has its own license: it's free for individuals and small companies, while larger for-profit organizations need a company license. See <https://www.remotion.dev/license>.
- Stock media keeps its provider license (Pexels, Pixabay, Openverse/CC). Cutroom stores attribution with each asset and the Director credits sources in the description.
- AI-generated voice and images are subject to your providers' terms.
