import type { AgentTool } from '../types';
import { askUser, delegate, loadSkill, updatePlan } from './conversation';
import { checkTimeline, getProjectTool, getTimeline, setBrand, setBrief, setCanvas } from './project';
import { analyzeMedia, annotateAsset, getTranscript, inspectAssets, readDocument, searchTranscript, transcribe, viewMedia } from './assets';
import { fetchUrl, webSearchTool } from './research';
import { generateVoiceover, listVoicesTool, writeScript } from './script';
import { addCaptions, addMedia, addScene, applyEdits, autoCut } from './edit';
import { addLibrarySound, generateAudio, generateImageTool, importStock, searchStockTool } from './generate';
import { listTemplates, writeCodeScene } from './motion';
import { previewFrames } from './review';
import { designThumbnail, renderVideo, setYouTubeMetadata } from './publish';
import { uploadToYouTube } from './youtube';

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
  checkTimeline,
  setYouTubeMetadata,
  designThumbnail,
  renderVideo,
  uploadToYouTube,
];

export const SUBAGENT_TOOLS: Record<string, string[]> = {
  researcher: ['web_search', 'fetch_url', 'read_document', 'inspect_assets', 'get_transcript', 'search_transcript', 'get_project', 'load_skill'],
  scriptwriter: ['get_project', 'read_document', 'get_transcript', 'search_transcript', 'inspect_assets', 'load_skill', 'write_script', 'web_search', 'fetch_url'],
  motion_designer: ['get_project', 'get_timeline', 'list_templates', 'add_scene', 'write_code_scene', 'apply_edits', 'preview_frames', 'inspect_assets', 'view_media', 'load_skill', 'add_library_sound', 'add_media'],
  reviewer: ['get_project', 'get_timeline', 'check_timeline', 'preview_frames', 'inspect_assets', 'get_transcript', 'view_media', 'load_skill'],
};

export const toolByName = (tools: AgentTool[], name: string) => tools.find((t) => t.name === name);
