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
- **Edit your footage.** It transcribes, removes silences and filler words (jump cuts with punch-in zooms that hide the cuts), adds b-roll, captions, lower thirds, music with automatic ducking, sound effects and loudness normalization.
- **Create from a topic.** It researches the web with sources, writes a retention-focused script and generates AI voiceover with word timings. It then builds animated graphics (charts, lists, quotes, timelines, comparisons…) and adds stock footage, AI images, captions and music.

**Agentic, like a real editor**
- Asks structured questions with options, and collects your files right in the chat.
- Publishes a live plan checklist and keeps it current.
- Loads **playbooks (skills)** for scripting, editing, motion design, captions/audio, Shorts and thumbnails/SEO.
- **Delegates** to specialist sub-agents: researcher, scriptwriter, motion designer and reviewer.
- **Looks at its own work.** It renders real preview frames and inspects them (vision models), then fixes overflow, collisions and pacing.
- Writes **custom animated scenes in code** (React + Remotion), checked and sandboxed, when no template fits.
- Asks before paid actions (AI voice, AI images), and always asks before uploading to YouTube.
- Reads what you're looking at: the playhead and selected clips travel with your message, so "make *this* shorter" just works.

**A professional editor, not just a chat**
- Multi-track timeline: move, trim, split, ripple delete, snapping, multi-select, track mute/hide/lock, waveforms, filmstrips, YouTube chapter markers and zoom.
- Frame-accurate preview (Remotion Player) with safe-zone guides for Shorts.
- Inspector for every clip type: placement and picture-in-picture, color grading, Ken Burns, punch-in zooms, transitions, text styling, captions styling, and auto-generated forms for template props.
- **28 motion-graphics templates** that use your brand colors and fonts, **8 caption styles**, and **12 built-in sound effects** with 2 music beds, all generated locally.
- 16:9 videos and 9:16 Shorts (also 1:1 and 4:5), 24/30/60 fps.
- Export to H.264 MP4 (draft / standard / high / 4K) plus an SRT file, with a live thumbnail designer, YouTube metadata (title options, description, tags, chapters) and direct upload with scheduling.

## How it's built

| Layer | Tech |
|---|---|
| Composition & rendering | [Remotion](https://www.remotion.dev) 4 (React → video), FFmpeg |
| Server | Node 20+, Hono, Server-Sent Events, Zod-validated project document |
| Agent | Custom tool-calling loop (Claude-Code-style): 40 tools, skills, sub-agents, context compaction |
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

On the home screen, describe the video, pick **16:9** or **Short 9:16**, and choose **From topic**, **Edit footage** or **Both**. The Director takes it from there. Answer its questions, drop in your files, and watch the timeline fill up. Hit **Export** when it's done (or ask the Director to render it).

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
┌ Top bar: project · format · undo/redo · activity · settings · Export ─────────────────┐
├ Media / Graphics / ├──────────── Preview (Remotion Player) ────────────┤ Director chat  │
│ Audio / Script /   │                                                   │ (plan, steps,  │
│ Project panels     │   transport · loop · safe zones · fullscreen     │  questions)    │
│                    ├──────────── Timeline (tracks, clips, ruler) ──────┤  or Inspector  │
└────────────────────┴───────────────────────────────────────────────────┴────────────────┘
```

| Shortcut | Action |
|---|---|
| `Space` | Play / pause |
| `←` `→` / `Shift`+`←` `→` | Previous/next frame / second |
| `Home` / `End` | Go to start / end |
| `S` or `Ctrl/⌘+B` | Split at playhead |
| `Delete` / `Shift+Delete` | Delete / ripple delete selected clips |
| `Ctrl/⌘+D` | Duplicate selected clips |
| `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` | Undo, redo |
| `+` / `-`, `Ctrl/⌘+wheel` | Zoom the timeline |
| `Ctrl/⌘+K` or `/` | Talk to the Director |
| `Ctrl/⌘+E` | Export |
| Double-click a clip | Open it in the Inspector |
| Right-click a clip | Split, duplicate, move to playhead, ask the Director, delete |

You can drag media, templates and sounds from the left panel (or files from your desktop) onto any track.

---

## Use it from Claude Code, Claude Desktop or Cursor (MCP)

Cutroom is an MCP server with **41 tools**: the Director's 37 non-chat tools plus `list_projects`, `create_project`, `select_project` and `import_file`. It also provides two prompts, `produce_video` and `edit_footage`. Everything an MCP client does shows up live in the open editor.

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
data/projects/<id>/media/          uploads, generated media, thumbnails, waveforms, transcripts
data/projects/<id>/renders/        exported MP4s and SRTs
data/skills/                       your own playbooks
data/cache/                        render bundle, downloaded local models
```

Content is sent only to the services you configure: your LLM provider, and optionally TTS, transcription, stock, search, image and YouTube APIs.

## Troubleshooting

- **"No AI model connected"**: add a provider in Settings → AI models and use **Test**. For local models, start Ollama or LM Studio first.
- **The Director stops with a model error**: the message shows the provider's error. Common causes are an invalid key, a model without tool-calling support, or a context window that's too small (use a bigger model).
- **Render fails on Linux**: Chromium needs the usual system libraries (`libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`…). Alternatively, set a local Chrome in Settings → Rendering.
- **No captions appear**: captions follow the transcripts. Check the transcription engine in Settings → Voice & speech, then use "Transcribe" on the asset in the Media panel.
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
src/server/agent/       Director loop, prompts, skills (Markdown), 40 tools
src/web/                the editor UI
docs/ARCHITECTURE.md    how it all fits together
```

## Licensing notes

- **Remotion** has its own license: it's free for individuals and small companies, while larger for-profit organizations need a company license. See <https://www.remotion.dev/license>.
- Stock media keeps its provider license (Pexels, Pixabay, Openverse/CC). Cutroom stores attribution with each asset and the Director credits sources in the description.
- AI-generated voice and images are subject to your providers' terms.
