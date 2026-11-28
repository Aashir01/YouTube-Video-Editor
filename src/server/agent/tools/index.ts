import type { AgentTool } from '../types';
import { askUser, delegate, loadSkill, updatePlan } from './conversation';
import { checkTimeline, getProjectTool, getTimeline, setBrand, setBrief, setCanvas } from './project';
import { analyzeMedia, annotateAsset, enhanceAudio, getTranscript, inspectAssets, readDocument, searchTranscript, transcribe, viewMedia } from './assets';
import { fetchUrl, webSearchTool } from './research';
import { generateVoiceover, listVoicesTool, writeScript } from './script';
import { addCaptions, addMedia, addScene, applyEdits, autoCut } from './edit';
import { addLibrarySound, generateAudio, generateImageTool, importStock, searchStockTool } from './generate';
import { listTemplates, writeCodeScene } from './motion';
import { previewFrames, reviewRetention } from './review';
import { createShortTool, designThumbnail, findShorts, renderVideo, setYouTubeMetadata } from './publish';
import { uploadToYouTube } from './youtube';
import { shortsAutopilotTool } from './autopilot';
import { autoReframe } from './reframe';
import { blurFaces, trackMotion } from './tracking';
import { createMulticam } from './multicam';
import { removeBackgroundTool } from './background';
import { applyLutTool, cutToBeatTool, stabilizeTool } from './footage';
import { createDubTool, translateSubtitlesTool } from './languages';

/** All built-in tools, in a stable order (keeps prompt caching effective). */
export const BUILTIN_TOOLS: AgentTool[] = [
  askUser,
  updatePlan,
  loadSkill,
  delegate,
  getProjectTool,
  getTimeline,
  setBrief,
  setBrand,
  setCanvas,
  inspectAssets,
  getTranscript,
  searchTranscript,
  transcribe,
  analyzeMedia,
  viewMedia,
  readDocument,
  annotateAsset,
  enhanceAudio,
  autoReframe,
  blurFaces,
  trackMotion,
  createMulticam,
  removeBackgroundTool,
  stabilizeTool,
  applyLutTool,
  cutToBeatTool,
  webSearchTool,
  fetchUrl,
  writeScript,
  listVoicesTool,
  generateVoiceover,
  searchStockTool,
  importStock,
  generateImageTool,
  addLibrarySound,
  generateAudio,
  applyEdits,
  addMedia,
  addScene,
  addCaptions,
  autoCut,
  listTemplates,
  writeCodeScene,
  previewFrames,
  reviewRetention,
  checkTimeline,
  setYouTubeMetadata,
  designThumbnail,
  renderVideo,
  findShorts,
  createShortTool,
  translateSubtitlesTool,
  createDubTool,
  uploadToYouTube,
  shortsAutopilotTool,
];

export const SUBAGENT_TOOLS: Record<string, string[]> = {
  researcher: ['web_search', 'fetch_url', 'read_document', 'inspect_assets', 'get_transcript', 'search_transcript', 'get_project', 'load_skill'],
  scriptwriter: ['get_project', 'read_document', 'get_transcript', 'search_transcript', 'inspect_assets', 'load_skill', 'write_script', 'web_search', 'fetch_url'],
  motion_designer: ['get_project', 'get_timeline', 'list_templates', 'add_scene', 'write_code_scene', 'apply_edits', 'preview_frames', 'inspect_assets', 'view_media', 'load_skill', 'add_library_sound', 'add_media'],
  reviewer: ['get_project', 'get_timeline', 'check_timeline', 'review_retention', 'preview_frames', 'inspect_assets', 'get_transcript', 'view_media', 'load_skill'],
};

export const toolByName = (tools: AgentTool[], name: string) => tools.find((t) => t.name === name);
