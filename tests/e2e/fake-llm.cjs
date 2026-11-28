// Scripted OpenAI-compatible model (streams SSE) for the end-to-end agent suite; no real AI needed.
// Flow: update_plan -> ask_user -> apply_edits (uses the answer) -> get_timeline -> final text.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PORT = Number(process.env.FAKE_LLM_PORT || 4590);
const LOG = process.env.FAKE_LLM_LOG || path.join(__dirname, '.out', 'fake-llm.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = (...a) => fs.appendFileSync(LOG, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');

let callSeq = 0;
let ytSeq = 0;
const ytSessions = new Map();
const chunk = (delta, finish = null) => ({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-director', choices: [{ index: 0, delta, finish_reason: finish }] });

// OpenRouter reports what each request cost when asked (usage: { include: true }); the Cloud gateway bills by it
const usageOf = (body) => ({ prompt_tokens: 1200, completion_tokens: 80, ...(body?.usage?.include ? { cost: 1200 * 2e-6 + 80 * 8e-6 } : {}) });

const send = async (res, { text = '', calls = [] }, body) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  write(chunk({ role: 'assistant', content: '' }));
  // stream text in small pieces so the UI shows live typing
  for (const piece of text.match(/.{1,12}/gs) ?? []) {
    write(chunk({ content: piece }));
    await new Promise((r) => setTimeout(r, 15));
  }
  calls.forEach((c, i) => {
    const args = JSON.stringify(c.args);
    const id = `call_${++callSeq}`;
    // split arguments across two deltas, like real providers do
    const mid = Math.floor(args.length / 2);
    write(chunk({ tool_calls: [{ index: i, id, type: 'function', function: { name: c.name, arguments: args.slice(0, mid) } }] }));
    write(chunk({ tool_calls: [{ index: i, function: { arguments: args.slice(mid) } }] }));
  });
  write(chunk({}, calls.length ? 'tool_calls' : 'stop'));
  write({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 0, model: 'fake-director', choices: [], usage: usageOf(body) });
  res.write('data: [DONE]\n\n');
  res.end();
};

const plan = (doneCount) => ({
  name: 'update_plan',
  args: {
    items: ['Ask about the tone', 'Add the title card', 'Check the timeline'].map((title, i) => ({ title, status: i < doneCount ? 'done' : i === doneCount ? 'in_progress' : 'pending' })),
  },
});

const textOf = (m) => (typeof m?.content === 'string' ? m.content : (m?.content ?? []).map((p) => p.text ?? '').join(''));

// Find Shorts: pick the planted hooks by their sentence numbers, answering the way real models
// often do (code fence, a trailing comma, an overlapping pick and an out-of-range one)
const findShorts = (prompt) => {
  const lines = [...prompt.matchAll(/^\[(\d+)\] \S+ (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
  const at = (re) => lines.find((l) => re.test(l.text))?.n;
  const focus = prompt.match(/What the creator wants: (.*)/)?.[1];
  const tag = focus ? ` (${focus})` : '';
  const picks = [];
  const a = at(/^Here is the secret/);
  const b = at(/^The biggest mistake/);
  if (a !== undefined) picks.push({ from: a, to: a + 4, title: `The secret nobody shares${tag}`, why: 'Opens with a promise and pays it off', score: 9 });
  if (b !== undefined) picks.push({ from: b, to: b + 4, title: `The biggest mistake${tag}`, why: 'Relatable and practical', score: 7 });
  if (a !== undefined) picks.push({ from: a + 1, to: a + 5, title: 'Overlapping pick', why: 'duplicate', score: 5 });
  picks.push({ from: 999, to: 1004, title: 'Out of range', why: '', score: 8 });
  return 'Here are the best moments:\n```json\n{"shorts": [\n' + picks.map((p) => ' ' + JSON.stringify(p) + ',').join('\n') + '\n]}\n```';
};

// subtitles: "[es] <the line>", so a test can tell each translated line and its language apart
const translate = (prompt) => {
  const code = prompt.match(/\(([a-zA-Z-]+)\)/)?.[1] ?? 'xx';
  if (/Translate this YouTube title and description/.test(prompt)) {
    const title = prompt.match(/^Title: (.*)$/m)?.[1] ?? '';
    const description = prompt.split('Description:\n')[1] ?? '';
    return JSON.stringify({ title: `[${code}] ${title}`, description: `[${code}] ${description}` });
  }
  const lines = [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => `[${code}] ${m[2]}`);
  return '```json\n' + JSON.stringify({ lines }) + '\n```';
};

// text to speech (OpenAI-style /audio/speech): a tone about as long as the line would take to say
const speech = (input) => {
  const seconds = Math.min(8, Math.max(0.4, input.length * 0.06));
  const r = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=260:sample_rate=24000:duration=${seconds.toFixed(2)}`, '-ac', '1', '-f', 'mp3', 'pipe:1'], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return r.stdout;
};

const step = (body) => {
  const msgs = body.messages ?? [];
  const system = textOf(msgs.find((m) => m.role === 'system'));
  const lastUserText = textOf([...msgs].reverse().find((m) => m.role === 'user'));
  if (!body.tools?.length && /YouTube Shorts editor/.test(system)) return { text: findShorts(lastUserText) };
  if (!body.tools?.length && /You translate video subtitles/.test(system)) return { text: translate(lastUserText) };
  if (!body.tools?.length) return { text: 'Fake summary' };
  const called = [];
  for (const m of msgs) for (const tc of m.tool_calls ?? []) called.push(tc.function.name);
  const toolResult = (name) => {
    // find the tool message answering the last call of this name
    let id = null;
    for (const m of msgs) for (const tc of m.tool_calls ?? []) if (tc.function.name === name) id = tc.id;
    return msgs.find((m) => m.role === 'tool' && m.tool_call_id === id)?.content ?? '';
  };
  if (!called.includes('ask_user')) {
    return {
      text: "Great topic. I'll set up a plan, then ask one quick question before I start editing.",
      calls: [
        plan(0),
        {
          name: 'ask_user',
          args: {
            title: 'Quick question',
            questions: [{ question: 'Which tone should the title have?', header: 'Tone', kind: 'choice', options: [{ label: 'Bold', description: 'Big, punchy type' }, { label: 'Calm', description: 'Soft and minimal' }] }],
          },
        },
      ],
    };
  }
  if (!called.includes('apply_edits')) {
    const answer = toolResult('ask_user');
    const tone = /calm/i.test(answer) ? 'Calm' : 'Bold';
    return {
      text: `Going with a ${tone.toLowerCase()} title.`,
      calls: [
        plan(1),
        {
          name: 'apply_edits',
          args: {
            label: 'Add title',
            ops: [
              { op: 'addClip', trackId: 'Graphics', clip: { type: 'text', text: `${tone} title from the agent`, start: 0.5, duration: 3 } },
              { op: 'addMarker', time: 2, label: 'Agent: check the title' },
            ],
          },
        },
      ],
    };
  }
  if (!called.includes('get_timeline')) return { text: '', calls: [plan(2), { name: 'get_timeline', args: {} }] };
  const tl = toolResult('get_timeline');
  return { text: `All done: the title is on the Graphics track and I left a review marker at 0:02.${/from the agent/.test(tl) ? ' (Timeline check OK.)' : ' (Timeline check FAILED.)'}` };
};

http
  .createServer((req, res) => {
    let raw = '';
    let rawBytes = 0;
    req.on('data', (d) => {
      rawBytes += d.length;
      if (rawBytes < 4 << 20) raw += d;
    });
    req.on('end', async () => {
      try {
        // a scripted YouTube (OAuth token, resumable upload, captions, thumbnails) for publishing tests
        if (req.url.startsWith('/oauth/token')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }));
        }
        if (req.method === 'POST' && req.url.startsWith('/upload/youtube/v3/videos')) {
          const id = `vid${++ytSeq}`;
          ytSessions.set(id, JSON.parse(raw));
          res.writeHead(200, { Location: `http://127.0.0.1:${PORT}/upload-session/${id}` });
          return res.end();
        }
        if (req.method === 'PUT' && req.url.startsWith('/upload-session/')) {
          const id = req.url.split('/').pop();
          const meta = ytSessions.get(id) ?? {};
          fs.appendFileSync(LOG, `YT ${JSON.stringify({ kind: 'video', id, bytes: rawBytes, snippet: meta.snippet, status: meta.status })}\n`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ id }));
        }
        if (req.method === 'POST' && req.url.startsWith('/upload/youtube/v3/captions')) {
          const meta = JSON.parse(raw.match(/\{"snippet".*?\}\}/s)?.[0] ?? '{}');
          fs.appendFileSync(LOG, `YT ${JSON.stringify({ kind: 'captions', videoId: meta.snippet?.videoId, language: meta.snippet?.language, bytes: rawBytes })}\n`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end('{}');
        }
        if (req.url.startsWith('/upload/youtube/v3/thumbnails')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end('{}');
        }
        if (req.method === 'GET' && req.url.endsWith('/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-director', object: 'model' }] }));
        }
        if (req.method === 'POST' && req.url.endsWith('/audio/speech')) {
          const body = JSON.parse(raw);
          const audio = speech(String(body.input ?? ''));
          log('TTS', { voice: body.voice, chars: String(body.input ?? '').length, input: String(body.input ?? '').slice(0, 80) });
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
          return res.end(audio);
        }
        if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
          const body = JSON.parse(raw);
          const out = step(body);
          const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
          log('REQ', { tools: (body.tools ?? []).map((t) => t.function.name), msgs: body.messages.length, reply: out.calls?.map((c) => c.name) ?? 'text', lastUser: typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content });
          return send(res, out, body);
        }
        res.writeHead(404);
        res.end('not found');
      } catch (err) {
        log('ERR', String(err?.stack || err));
        res.writeHead(500);
        res.end(String(err));
      }
    });
  })
  .listen(PORT, '127.0.0.1', () => log(`fake LLM on ${PORT}`));
