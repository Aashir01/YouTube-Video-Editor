import type React from 'react';
import { toast } from 'sonner';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  AudioLines,
  Bookmark,
  Bot,
  Brain,
  Camera,
  Captions,
  Clapperboard,
  ClipboardPaste,
  Copy,
  Download,
  Eraser,
  EyeOff,
  FileText,
  Film,
  Gauge,
  Home,
  Image,
  Keyboard,
  KeyRound,
  LayoutTemplate,
  Magnet,
  Maximize2,
  Mic,
  MonitorUp,
  Music,
  Palette,
  Pause,
  Plug,
  Redo2,
  Repeat,
  Rows3,
  Scissors,
  ScrollText,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Smartphone,
  SwitchCamera,
  Sparkles,
  SquareDashedMousePointer,
  TextQuote,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand,
} from 'lucide-react';
import { TEMPLATES } from '../../shared/templates';
import { api } from './api';
import { editorContext, useStudio, type LeftTab, type SettingsSection } from './store';
import { player } from './player';
import { prefs } from './prefs';
import { navigate } from './nav';
import { addAtPlayhead } from './dnd';
import { errorText, isMac } from './utils';
import {
  addMarkerAtPlayhead,
  clearRangeMarks,
  copySelection,
  deleteSelection,
  duplicateSelection,
  jumpToEdit,
  liftRangeMarks,
  makeShort,
  cutToBeat,
  markIn,
  markOut,
  pasteAtPlayhead,
  rippleDeleteRange,
  rippleTrim,
  selectAll,
  selectForward,
  splitAtPlayhead,
} from './actions';

export interface Command {
  id: string;
  title: string;
  group: string;
  icon: React.ElementType;
  run: () => void;
  shortcut?: string;
  keywords?: string;
  /** hide when false (evaluated when the palette opens) */
  when?: () => boolean;
}

const mod = isMac ? '⌘' : 'Ctrl+';

/** Ready-made briefs for the Director: shared by the palette and the chat's "/" menu. */
export const AI_ACTIONS: { id: string; title: string; prompt: string; icon: React.ElementType; hint: string }[] = [
  { id: 'captions', title: 'Add captions', hint: 'styled, synced to speech', icon: Captions, prompt: 'Add stylish captions to the whole video (pick the best style for this format) and make sure they never collide with graphics.' },
  { id: 'cut', title: 'Cut silences & filler words', hint: 'jump cuts with punch-ins', icon: Scissors, prompt: 'Tighten my footage: cut silences, filler words and bad takes, with subtle punch-in zooms to hide the jump cuts. Keep the best takes.' },
  { id: 'broll', title: 'Add b-roll', hint: 'a visual change every few seconds', icon: Film, prompt: 'Add relevant b-roll over the talking parts (my media first, then stock) so there is a visual change every few seconds.' },
  { id: 'graphics', title: 'Add motion graphics', hint: 'titles, charts, lists', icon: Sparkles, prompt: 'Add motion graphics where they help understanding: section titles, charts for numbers, lists for steps. Match the brand.' },
  { id: 'music', title: 'Add music & sound effects', hint: 'ducked under speech', icon: Music, prompt: 'Add a fitting music bed, ducked under speech, and subtle sound effects on transitions and graphics.' },
  { id: 'hook', title: 'Improve the hook', hint: 'stronger first 5 seconds', icon: Wand, prompt: 'Make the first 5 seconds much stronger: find or write the most compelling hook and restructure the opening.' },
  { id: 'review', title: 'Review the edit', hint: 'QA like a senior editor', icon: Brain, prompt: 'Review the whole edit like a senior editor: look at real frames, pacing, readability, audio and collisions. Fix what you find and tell me what you changed.' },
  { id: 'thumbnail', title: 'Design the thumbnail', hint: 'high click-through', icon: Image, prompt: 'Design a high-CTR thumbnail for this video and show it to me.' },
  { id: 'metadata', title: 'Write title, description & chapters', hint: 'YouTube SEO', icon: FileText, prompt: 'Write 5 title options, an SEO description with chapters (timestamps) and tags, and save them to the YouTube details.' },
  { id: 'short', title: 'Make a Short from this video', hint: 'vertical, captioned', icon: Smartphone, prompt: 'Find the most engaging 30–50 seconds of this video and turn it into a vertical YouTube Short with bold captions.' },
  { id: 'translate', title: 'Translate on-screen text', hint: 'captions & titles', icon: TextQuote, prompt: 'Translate the on-screen text and captions to ' },
  { id: 'render', title: 'Final check & render', hint: 'high quality MP4', icon: Clapperboard, prompt: 'Run a final check of the edit and render the video in high quality.' },
];

/** Send a brief to the Director, or put it in the composer when it needs more words (or no model is set). */
export const askDirector = (prompt: string) => {
  const st = useStudio.getState();
  if (!st.projectId) return;
  if (prompt.endsWith(' ') || !st.system?.llm) {
    useStudio.setState({ composerPrefill: prompt });
    st.focusComposer();
    if (!st.system?.llm) toast.info('Connect an AI model in Settings to run this.');
    return;
  }
  st.setRightTab('director');
  api.sendChat(st.projectId, prompt, [], editorContext()).catch((err) => toast.error(errorText(err)));
};

const panel = (tab: LeftTab) => () => useStudio.getState().setLeftTab(tab);
const settings = (section: SettingsSection) => () => useStudio.getState().openSettings(section);

export const buildCommands = (): Command[] => {
  const st = () => useStudio.getState();
  const hasSel = () => st().selection.length > 0;
  const hasRange = () => st().range !== null;
  const list: Command[] = [
    // edit
    { id: 'split', group: 'Edit', title: 'Split at playhead', icon: Scissors, shortcut: 'S', run: splitAtPlayhead, keywords: 'cut razor blade' },
    { id: 'delete', group: 'Edit', title: 'Delete selected clips', icon: Trash2, shortcut: '⌫', run: () => deleteSelection(false), when: hasSel },
    { id: 'ripple-delete', group: 'Edit', title: 'Ripple delete selected clips', icon: Trash2, shortcut: '⇧⌫', run: () => deleteSelection(true), when: hasSel, keywords: 'close gap' },
    { id: 'duplicate', group: 'Edit', title: 'Duplicate selected clips', icon: Copy, shortcut: `${mod}D`, run: duplicateSelection, when: hasSel },
    { id: 'copy', group: 'Edit', title: 'Copy', icon: Copy, shortcut: `${mod}C`, run: () => copySelection(false), when: hasSel },
    { id: 'cut-clips', group: 'Edit', title: 'Cut', icon: Scissors, shortcut: `${mod}X`, run: () => copySelection(true), when: hasSel },
    { id: 'paste', group: 'Edit', title: 'Paste at playhead', icon: ClipboardPaste, shortcut: `${mod}V`, run: pasteAtPlayhead },
    { id: 'select-all', group: 'Edit', title: 'Select all clips', icon: SquareDashedMousePointer, shortcut: `${mod}A`, run: selectAll },
    { id: 'select-forward', group: 'Edit', title: 'Select clips after playhead', icon: ArrowRightToLine, run: selectForward },
    { id: 'trim-start', group: 'Edit', title: 'Ripple trim start to playhead', icon: ArrowLeftToLine, shortcut: 'Q', run: () => rippleTrim('start') },
    { id: 'trim-end', group: 'Edit', title: 'Ripple trim end to playhead', icon: ArrowRightToLine, shortcut: 'W', run: () => rippleTrim('end') },
    { id: 'undo', group: 'Edit', title: 'Undo', icon: Undo2, shortcut: `${mod}Z`, run: () => void st().undo() },
    { id: 'redo', group: 'Edit', title: 'Redo', icon: Redo2, shortcut: `⇧${mod}Z`, run: () => void st().redo() },
    // markers & range
    { id: 'marker', group: 'Markers & range', title: 'Add marker at playhead', icon: Bookmark, shortcut: 'M', run: addMarkerAtPlayhead },
    { id: 'mark-in', group: 'Markers & range', title: 'Mark in', icon: ArrowDownToLine, shortcut: 'I', run: markIn },
    { id: 'mark-out', group: 'Markers & range', title: 'Mark out', icon: ArrowUpToLine, shortcut: 'O', run: markOut },
    { id: 'loop-range', group: 'Markers & range', title: 'Loop the range', icon: Repeat, run: () => useStudio.setState({ loopRange: !st().loopRange }), when: hasRange },
    { id: 'delete-range', group: 'Markers & range', title: 'Delete range (close the gap)', icon: Trash2, run: rippleDeleteRange, when: hasRange },
    { id: 'lift-range', group: 'Markers & range', title: 'Lift range (keep the gap)', icon: Eraser, run: liftRangeMarks, when: hasRange },
    { id: 'clear-range', group: 'Markers & range', title: 'Clear range', icon: Eraser, shortcut: 'Alt+X', run: clearRangeMarks, when: hasRange },
    { id: 'short-range', group: 'Markers & range', title: 'Make a Short from the range', icon: Smartphone, run: () => void makeShort([st().range!]), when: hasRange, keywords: 'vertical repurpose 9:16 clip' },
    { id: 'export-range', group: 'Markers & range', title: 'Export the range…', icon: Download, run: () => st().setExportOpen(true), when: hasRange },
    // add
    { id: 'add-title', group: 'Add', title: 'Add a title', icon: Type, run: () => void addAtPlayhead({ kind: 'text', preset: 'title' }), keywords: 'text heading' },
    { id: 'add-lower', group: 'Add', title: 'Add a lower third', icon: Type, run: () => void addAtPlayhead({ kind: 'text', preset: 'lower' }), keywords: 'name text' },
    { id: 'add-textbox', group: 'Add', title: 'Add a text box', icon: Type, run: () => void addAtPlayhead({ kind: 'text', preset: 'caption-box' }) },
    { id: 'add-blur', group: 'Add', title: 'Add a blur box', icon: EyeOff, run: () => void addAtPlayhead({ kind: 'blur' }), keywords: 'hide face plate privacy censor' },
    { id: 'add-captions', group: 'Add', title: 'Add auto captions', icon: Captions, run: () => void api.runTool(st().projectId!, 'add_captions', { style: { preset: 'bold-pop' } }).then(() => toast.success('Captions added')).catch((e) => toast.error(errorText(e))), keywords: 'subtitles' },
    { id: 'upload', group: 'Add', title: 'Upload media…', icon: Upload, run: () => {
      st().setLeftTab('media');
      setTimeout(() => window.dispatchEvent(new CustomEvent('cutroom:upload')), 50);
    }, keywords: 'import file video image' },
    { id: 'rec-voice', group: 'Add', title: 'Record voiceover', icon: Mic, run: () => useStudio.setState({ recorder: 'voice' }), keywords: 'microphone narrate' },
    { id: 'rec-camera', group: 'Add', title: 'Record camera', icon: Camera, run: () => useStudio.setState({ recorder: 'camera' }), keywords: 'webcam facecam' },
    { id: 'rec-screen', group: 'Add', title: 'Record screen', icon: MonitorUp, run: () => useStudio.setState({ recorder: 'screen' }), keywords: 'screencast tutorial' },
    ...TEMPLATES.map((t) => ({ id: `tpl-${t.id}`, group: 'Add', title: `Add ${t.name}`, icon: LayoutTemplate, run: () => void addAtPlayhead({ kind: 'template', templateId: t.id }), keywords: `${t.category} template graphic ${t.description}` })),
    // playback
    { id: 'play', group: 'Playback', title: 'Play / pause', icon: Pause, shortcut: 'Space', run: () => player.toggle() },
    { id: 'start', group: 'Playback', title: 'Go to start', icon: SkipBack, shortcut: 'Home', run: () => player.seek(0) },
    { id: 'end', group: 'Playback', title: 'Go to end', icon: SkipForward, shortcut: 'End', run: () => player.toEnd() },
    { id: 'next-edit', group: 'Playback', title: 'Next edit point', icon: SkipForward, shortcut: '↓', run: () => jumpToEdit(1) },
    { id: 'prev-edit', group: 'Playback', title: 'Previous edit point', icon: SkipBack, shortcut: '↑', run: () => jumpToEdit(-1) },
    ...[0.5, 1, 1.5, 2].map((r) => ({ id: `speed-${r}`, group: 'Playback', title: `Playback speed ${r}×`, icon: Gauge, run: () => useStudio.setState({ playbackRate: r }) })),
    // view
    { id: 'fit', group: 'View', title: 'Zoom timeline to fit', icon: Maximize2, shortcut: '\\', run: () => useStudio.setState({ autoFit: true }) },
    { id: 'snap', group: 'View', title: 'Toggle snapping', icon: Magnet, run: () => st().setSnapping(!st().snapping) },
    ...([0.75, 1, 1.5] as const).map((v) => ({ id: `tracks-${v}`, group: 'View', title: `${v === 0.75 ? 'Compact' : v === 1 ? 'Normal' : 'Tall'} tracks`, icon: Rows3, run: () => {
      prefs.set('trackScale', v);
      useStudio.setState({ trackScale: v });
    } })),
    // panels
    { id: 'p-media', group: 'Panels', title: 'Media', icon: Film, run: panel('media') },
    { id: 'p-text', group: 'Panels', title: 'Transcript (text editing)', icon: TextQuote, run: panel('transcript') },
    { id: 'p-shorts', group: 'Panels', title: 'Find Shorts (best moments)', icon: Smartphone, run: panel('shorts'), keywords: 'highlights clips viral repurpose vertical moments' },
    { id: 'beat-cut', group: 'Edit', title: 'Cut the selected clips to the beat', icon: Music, run: () => void cutToBeat(st().selection), when: hasSel, keywords: 'music rhythm sync b-roll montage tempo' },
    { id: 'multicam', group: 'Edit', title: 'Multicam: sync cameras by sound', icon: SwitchCamera, run: () => useStudio.setState({ multicamOpen: true }), keywords: 'podcast interview angles cameras switch sync audio' },
    { id: 'p-graphics', group: 'Panels', title: 'Graphics & templates', icon: Sparkles, run: panel('graphics') },
    { id: 'p-audio', group: 'Panels', title: 'Audio & voiceover', icon: AudioLines, run: panel('audio') },
    { id: 'p-script', group: 'Panels', title: 'Script', icon: ScrollText, run: panel('script') },
    { id: 'p-project', group: 'Panels', title: 'Project: brief & brand', icon: Palette, run: panel('brand') },
    { id: 'p-director', group: 'Panels', title: 'Director chat', icon: Bot, shortcut: '/', run: () => st().focusComposer() },
    { id: 'p-inspector', group: 'Panels', title: 'Inspector', icon: SlidersHorizontal, run: () => st().setRightTab('inspector') },
    // project
    { id: 'export', group: 'Project', title: 'Export & publish', icon: Download, shortcut: `${mod}E`, run: () => st().setExportOpen(true), keywords: 'render youtube upload mp4' },
    { id: 'shortcuts', group: 'Project', title: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', run: () => window.dispatchEvent(new CustomEvent('cutroom:shortcuts')) },
    { id: 's-models', group: 'Project', title: 'Settings: AI models', icon: KeyRound, run: settings('models'), keywords: 'api key llm openai gemini claude' },
    { id: 's-speech', group: 'Project', title: 'Settings: voice & speech', icon: Mic, run: settings('speech'), keywords: 'tts elevenlabs whisper' },
    { id: 's-mcp', group: 'Project', title: 'Settings: MCP & integrations', icon: Plug, run: settings('mcp'), keywords: 'claude code cursor' },
    { id: 'home', group: 'Project', title: 'All projects', icon: Home, run: () => navigate(null) },
  ];
  return list.filter((c) => !c.when || c.when());
};

/** Parse "83", "1:23", "1:02:03", "12.5s" into seconds. */
export const parseTime = (q: string): number | null => {
  const s = q.trim().replace(/s$/i, '');
  if (!/^[\d:.]+$/.test(s) || !/\d/.test(s)) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n)) || parts.length > 3) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/** Subsequence fuzzy score (higher is better; -1 = no match). */
export const fuzzy = (query: string, text: string): number => {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at * 2 - t.length * 0.1 + (at === 0 || t[at - 1] === ' ' ? 200 : 0);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    score += i === ti ? 6 : 1;
    ti = i + 1;
  }
  return score;
};

export const commandSearchText = (c: Command) => `${c.title} ${c.group} ${c.keywords ?? ''}`;
