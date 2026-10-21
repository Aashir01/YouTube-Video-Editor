import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChatModel, type LlmMessage } from './llm';

/**
 * Wire-level tests for the three provider adapters: a local mock server speaks
 * each provider's streaming protocol so the real SDKs are exercised end-to-end.
 */

const requests: { path: string; body: any; headers: http.IncomingHttpHeaders }[] = [];
let server: http.Server;
let base = '';

const sse = (res: http.ServerResponse, events: (string | [string, unknown])[]) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  for (const e of events) {
    if (typeof e === 'string') res.write(`data: ${e}\n\n`);
    else res.write(`event: ${e[0]}\ndata: ${JSON.stringify(e[1])}\n\n`);
  }
  res.end();
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url ?? '', body, headers: req.headers });
      const url = req.url ?? '';
      if (url.startsWith('/openai/chat/completions')) {
        const chunk = (delta: unknown, finish: string | null = null) => JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
        return sse(res, [
          chunk({ role: 'assistant', content: 'Adding ' }),
          chunk({ content: 'a scene.' }),
          chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add_scene', arguments: '' } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '{"template":"ti' } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: 'tle-card","props":{"title":"Hi"}}' } }] }),
          chunk({ tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'get_project', arguments: '{}' } }] }),
          chunk({}, 'tool_calls'),
          JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } }),
          '[DONE]',
        ]);
      }
      if (url.startsWith('/anthropic/v1/messages')) {
        return sse(res, [
          ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 1, cache_read_input_tokens: 20 } } }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'On it.' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 1 }],
          ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'add_scene', input: {} } }],
          ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"template":' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"quote","props":{"quote":"x"}}' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 2 }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 25 } }],
          ['message_stop', { type: 'message_stop' }],
        ]);
      }
      if (url.includes(':streamGenerateContent')) {
        return sse(res, [
          JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Sure, ' }] } }] }),
          JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'adding it.' }] } }] }),
          JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'add_scene', args: { template: 'big-number', props: { value: 3, label: 'x' } } }, thoughtSignature: 'gsig' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } }),
        ]);
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => server.close());

const tools = [{ name: 'add_scene', description: 'Add a scene', parameters: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { template: { type: 'string' } }, required: ['template'] } }];

const history: LlmMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Make a title' }, { type: 'image', mime: 'image/jpeg', data: 'AAAA' }] },
  { role: 'assistant', text: 'Looking.', toolCalls: [{ id: 'prev_1', name: 'view_media', input: { assetId: 'a1' } }] },
  { role: 'tool', results: [{ callId: 'prev_1', name: 'view_media', content: '2 frames', images: [{ mime: 'image/jpeg', data: 'BBBB' }] }] },
];

describe('OpenAI-compatible adapter', () => {
  it('streams text and assembles streamed tool calls', async () => {
    const m = createChatModel({ id: 'p1', type: 'openai-compatible', name: 'Mock', baseUrl: `${base}/openai`, apiKey: 'k', models: [] }, 'gpt-4o');
    let streamed = '';
    const r = await m.chat({ system: 'SYS', messages: history, tools, onText: (d) => (streamed += d) });
    expect(streamed).toBe('Adding a scene.');
    expect(r.toolCalls).toEqual([
      { id: 'call_1', name: 'add_scene', input: { template: 'title-card', props: { title: 'Hi' } }, parseError: undefined },
      { id: 'call_2', name: 'get_project', input: {}, parseError: undefined },
    ]);
    expect(r.stop).toBe('tool_calls');
    expect(r.usage).toMatchObject({ input: 42, output: 7 });
    const req = requests.filter((x) => x.path.startsWith('/openai')).pop()!;
    expect(req.body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(req.body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,AAAA');
    expect(req.body.messages[2].tool_calls[0].function).toEqual({ name: 'view_media', arguments: '{"assetId":"a1"}' });
    expect(req.body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'prev_1', content: '2 frames' });
    // images from tools are forwarded as a follow-up user message for vision models
    expect(req.body.messages[4].role).toBe('user');
    expect(req.body.tools[0].function.parameters.$schema).toBeUndefined();
    expect(req.body.max_tokens).toBeGreaterThan(0);
    expect(req.body.stream).toBe(true);
  });
});

describe('Anthropic adapter', () => {
  it('uses the Messages API with caching, effort, eager tool streaming and replays raw blocks', async () => {
    const m = createChatModel({ id: 'p2', type: 'anthropic', name: 'Mock Claude', baseUrl: `${base}/anthropic`, apiKey: 'k', models: [] }, 'claude-opus-5-5');
    let streamed = '';
    const r = await m.chat({ system: 'SYS', messages: history, tools, onText: (d) => (streamed += d) });
    expect(streamed).toBe('On it.');
    expect(r.toolCalls).toEqual([{ id: 'toolu_1', name: 'add_scene', input: { template: 'quote', props: { quote: 'x' } } }]);
    expect(r.stop).toBe('tool_calls');
    expect(r.raw?.provider).toBe('anthropic');
    const req = requests.filter((x) => x.path.startsWith('/anthropic')).pop()!;
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.body.output_config).toEqual({ effort: 'high' });
    expect(req.body.thinking).toBeUndefined();
    expect(req.body.tools[0].eager_input_streaming).toBe(true);
    expect(req.body.tools[0].input_schema.$schema).toBeUndefined();
    // custom base URL => no server-side fallback beta
    expect(req.body.fallbacks).toBeUndefined();
    expect(req.body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(req.body.messages[2].content[0].type).toBe('tool_result');
    expect(req.body.messages[2].content[0].content[1].type).toBe('image');
    // second turn: the raw content (incl. the signed thinking block) is replayed verbatim
    await m.chat({ system: 'SYS', messages: [...history, { role: 'assistant', text: r.text, toolCalls: r.toolCalls, raw: r.raw }, { role: 'tool', results: [{ callId: 'toolu_1', name: 'add_scene', content: 'ok' }] }], tools });
    const req2 = requests.filter((x) => x.path.startsWith('/anthropic')).pop()!;
    const replayed = req2.body.messages[3].content;
    expect(replayed[0]).toMatchObject({ type: 'thinking', signature: 'sig123' });
    expect(replayed[2]).toMatchObject({ type: 'tool_use', id: 'toolu_1' });
  });
});

describe('Gemini adapter', () => {
  it('streams parts, returns function calls and replays thought signatures', async () => {
    const m = createChatModel({ id: 'p3', type: 'gemini', name: 'Mock Gemini', baseUrl: `${base}/gemini`, apiKey: 'k', models: [] }, 'gemini-2.5-pro');
    let streamed = '';
    const r = await m.chat({ system: 'SYS', messages: history, tools, onText: (d) => (streamed += d) });
    expect(streamed).toBe('Sure, adding it.');
    expect(r.toolCalls[0]).toMatchObject({ name: 'add_scene', input: { template: 'big-number', props: { value: 3, label: 'x' } } });
    expect(r.stop).toBe('tool_calls');
    const req = requests.filter((x) => x.path.includes('streamGenerateContent')).pop()!;
    expect(req.path).toContain('gemini-2.5-pro:streamGenerateContent');
    expect(req.body.systemInstruction.parts[0].text).toBe('SYS');
    expect(req.body.tools[0].functionDeclarations[0].parametersJsonSchema.$schema).toBeUndefined();
    expect(req.body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(req.body.contents[2].parts[0].functionResponse).toMatchObject({ name: 'view_media', response: { output: '2 frames' } });
    await m.chat({ system: 'SYS', messages: [...history, { role: 'assistant', text: r.text, toolCalls: r.toolCalls, raw: r.raw }, { role: 'tool', results: [{ callId: r.toolCalls[0]!.id, name: 'add_scene', content: 'ok' }] }], tools });
    const req2 = requests.filter((x) => x.path.includes('streamGenerateContent')).pop()!;
    const modelTurn = req2.body.contents[3];
    expect(modelTurn.role).toBe('model');
    expect(modelTurn.parts.some((p: { thoughtSignature?: string }) => p.thoughtSignature === 'gsig')).toBe(true);
  });
});
