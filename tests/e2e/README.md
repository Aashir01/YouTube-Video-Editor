# End-to-end tests

Browser tests that use Cutroom like a person does: clicking, dragging, typing and exporting in a real Chromium, against a real server.

```bash
npm run test:e2e                       # every suite (about 4 minutes)
npm run test:e2e -- canvas keyframes   # only some suites
npm run test:e2e -- --keep             # keep the temporary data folder afterwards
```

**Requirements:**
- FFmpeg on your `PATH` (or `FFMPEG_PATH`).
- Playwright's Chromium, installed once with `npx playwright install chromium`. To use another Chrome or Chromium binary, set `CUTROOM_E2E_CHROME`.

**What the runner (`run.mjs`) does:**
1. Builds the test media in `.fixtures/` with FFmpeg (`fixtures.mjs`).
2. Starts the app with `director start` on a free port and a temporary data folder.
3. Starts a scripted OpenAI-compatible model (`fake-llm.cjs`), so the Director's agent loop is tested without a real AI.
4. Runs the suites one by one. Screenshots and logs go to `.out/<suite>/`.

| Suite | What it checks |
|---|---|
| `canvas` | Select, move, resize, snap and nudge clips on the preview; pan a reframed video; one undo step per drag |
| `timeline` | Filmstrips, rubber-band selection, copy/paste, frame nudges, markers, volume and fade handles, ripple trims, ranges, J/K/L |
| `transcript` | Text-based editing: cut words, remove fillers and pauses, fix a word, undo |
| `record` | Voice and camera recording (fake devices), placement at the playhead, speech enhancement |
| `palette` | Command palette, shortcuts sheet, undo history, save state, slash briefs, draft restore |
| `shorts` | Make a Short from ranges (API and UI), audio-only and in–out exports, home recipes |
| `agent` | A full Director session: plan, question card, edits, editor context, one-step undo |
| `keyframes` | Keyframe buttons, auto-keying from fields and canvas drags, timeline diamonds, easing, presets, agent ops, rendered motion |
| `reframe` | Smart reframe on moving and cutting faces, re-checked on rendered frames; Track faces; Make a Short |

**Writing a suite:** use the helpers in `lib.cjs`:
- `api`, `post`, `ops`, `upload` and `waitReady` for the REST API;
- `launch` for a browser page;
- `mcpClient` for the Director's tools;
- `pixel` and `facesIn` to inspect rendered frames.

Print `PASS:`/`FAIL:` lines through `check` and end with `finish()` (or `done()` for suites without a browser).
