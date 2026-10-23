import { DATA_DIR, getSettings } from './config';
import { ffInfo } from './media/ffmpeg';
import { resolveBrowserExecutable } from './render/browser';
import { localWhisperAvailable, pickTranscriptionEngine } from './services/transcribe';
import { kokoroAvailable, pickTtsEngine } from './services/tts';
import { testModel } from './ai/llm';
import { imageEngine } from './services/images';

const ok = (s: string) => console.log(`  ✅ ${s}`);
const warn = (s: string) => console.log(`  ⚠️  ${s}`);
const bad = (s: string) => console.log(`  ❌ ${s}`);

/** `director doctor`: environment diagnostics with actionable hints. */
export const runDoctor = async (): Promise<number> => {
  let failures = 0;
  const s = getSettings();
  console.log('\nCutroom doctor\n');
  console.log(`Node ${process.version} on ${process.platform}-${process.arch}; data in ${DATA_DIR}\n`);

  console.log('Media');
  const f = ffInfo();
  if (!f.available) {
    bad('FFmpeg not found — install it from https://ffmpeg.org/download.html (or reinstall dependencies)');
    failures++;
  } else if (f.full) ok(`FFmpeg (${f.source})`);
  else warn('Using Remotion\'s bundled FFmpeg: everything works except scene-cut detection. Install FFmpeg for the full feature set.');
  const browser = resolveBrowserExecutable(s.render.browserExecutable);
  ok(browser ? `Render browser: ${browser}` : 'Render browser: Remotion will download Chrome Headless Shell on the first render (one time)');

  console.log('\nAI models');
  if (!s.llm.main) {
    bad('No LLM configured. Open Settings → AI Models in the app, or set OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY in .env');
    failures++;
  } else {
    const provider = s.llm.providers.find((p) => p.id === s.llm.main!.providerId);
    if (!provider) {
      bad(`Main model refers to missing provider ${s.llm.main.providerId}`);
      failures++;
    } else {
      process.stdout.write(`  … testing ${provider.name} / ${s.llm.main.model} `);
      const r = await testModel(provider, s.llm.main.model);
      console.log('');
      if (r.ok) ok(`${provider.name} / ${s.llm.main.model} replied in ${r.latencyMs}ms`);
      else {
        bad(`${provider.name} / ${s.llm.main.model}: ${r.error}`);
        failures++;
      }
    }
  }

  console.log('\nSpeech & media services');
  const stt = await pickTranscriptionEngine(s);
  stt ? ok(`Transcription: ${stt.label}`) : warn('No transcription engine (add an OpenAI/Groq/ElevenLabs key, or keep the optional local Whisper package installed)');
  if (stt?.id === 'local') warn('Local Whisper downloads its model (~150 MB) from Hugging Face on first use');
  const tts = await pickTtsEngine(s);
  tts ? ok(`Voiceover: ${tts.label}`) : warn('No voiceover engine (add ElevenLabs/OpenAI/Gemini keys, or keep the optional Kokoro package installed)');
  if (tts?.id === 'kokoro') warn('Kokoro downloads its voice model (~90 MB) from Hugging Face on first use');
  console.log(`  ℹ️  Local Whisper package: ${(await localWhisperAvailable()) ? 'installed' : 'not installed'}; Kokoro: ${(await kokoroAvailable()) ? 'installed' : 'not installed'}`);
  s.keys.pexels || s.keys.pixabay ? ok(`Stock media: ${[s.keys.pexels && 'Pexels', s.keys.pixabay && 'Pixabay'].filter(Boolean).join(', ')}`) : warn('No stock video key (free keys: https://www.pexels.com/api/ and https://pixabay.com/api/docs/)');
  const img = imageEngine(s);
  img ? ok(`AI images: ${img}`) : warn('AI images disabled (needs an OpenAI or Gemini key)');
  s.keys.tavily || s.keys.brave ? ok(`Web search: ${s.keys.tavily ? 'Tavily' : 'Brave'}`) : warn('Web search uses the basic DuckDuckGo fallback (a free Tavily key gives better research)');
  console.log(failures ? `\n${failures} problem(s) found.\n` : '\nAll essentials are ready. Run `npm start`.\n');
  return failures ? 1 : 0;
};
