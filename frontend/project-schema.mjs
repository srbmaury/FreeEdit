import {validateBackground, validatePresenterProject} from "./scene-schema.mjs";

// Pure project-file validation. Editor/scene rules are explicit dependencies;
// this module does not read the DOM, browser storage, or editor state.
const projectPresets = ["balanced", "small", "high", "audio_only"];

export function validateProjectDocument(value, {EditorModel}) {
  const fail = () => { throw new Error("This project contains invalid or unsupported settings."); };
  if (value?.format !== "FreeEdit" || value.version !== 2) throw new Error("This project format is not supported. Use a FreeEdit version 2 project.");
  const source = value.source;
  const finite = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (!source || typeof source.name !== "string" || source.name.length > 1024 || !finite(source.size, 1, Number.MAX_SAFE_INTEGER) ||
      !Number.isInteger(source.size) || source.algorithm !== "sha256-chunks-4m-v1" || !/^[a-f0-9]{64}$/.test(source.fingerprint) ||
      !finite(source.duration, 0.001, 1e8) || !finite(source.width, 0, 65536) || !finite(source.height, 0, 65536) ||
      typeof source.has_video !== "boolean" || typeof source.has_audio !== "boolean" || (!source.has_video && !source.has_audio)) fail();
  const settings = value.settings;
  const background = validateBackground(settings?.background, source);
  const presenter = validatePresenterProject(settings?.presenter, source);
  const reframe = settings?.reframe == null ? null : settings.reframe;
  if (reframe && (!source.has_video || !["original", "wide", "vertical", "square"].includes(reframe.aspect) ||
      ![reframe.zoom, reframe.focus_x, reframe.focus_y].every(Number.isFinite) ||
      reframe.zoom < 1 || reframe.zoom > 3 || reframe.focus_x < 0 || reframe.focus_x > 1 ||
      reframe.focus_y < 0 || reframe.focus_y > 1 || "sections" in reframe)) fail();
  const audio = settings?.audio || {level_speech:false, fade_in:0, fade_out:0};
  if (typeof audio.level_speech !== "boolean" || !finite(audio.fade_in, 0, 5) || !finite(audio.fade_out, 0, 5)) fail();
  if (!settings || typeof settings.denoise !== "boolean" || !["", "10", "18", "30"].includes(settings.strength) || !projectPresets.includes(settings.preset)) fail();
  if ((settings.preset === "audio_only" && !source.has_audio && !presenter?.source.has_audio) || (source.has_video && (!source.width || !source.height))) fail();
  if (!Array.isArray(value.edits) || value.edits.length > 200) fail();
  const reframeEdits = [];
  const edits = value.edits.map(edit => {
    if (!edit || !EditorModel.TIMELINE_TYPES.includes(edit.type) || !finite(edit.start, 0, source.duration) ||
        !finite(edit.end, 0, source.duration + 0.05) || edit.end <= edit.start) fail();
    const result = {type: edit.type, start: edit.start, end: Math.min(edit.end, source.duration)};
    if (result.type === "reframe") {
      const section = {...edit, start:result.start, end:result.end};
      if (!source.has_video || EditorModel.validateReframe(section, source.duration, reframeEdits)) fail();
      Object.assign(result, {zoom:section.zoom,focus_x:section.focus_x,focus_y:section.focus_y,transition:section.transition});
      reframeEdits.push(result);
    }
    if (result.type === "hide" || result.type === "text") {
      if (!source.has_video || !finite(edit.x, -65536, 65536) || !finite(edit.y, -65536, 65536)) fail();
      Object.assign(result, {x: edit.x, y: edit.y});
    }
    if (result.type === "hide") {
      if (!["black", "blur", "pixelate"].includes(edit.style) || !finite(edit.w, 4, source.width) || !finite(edit.h, 4, source.height) ||
          edit.x < 0 || edit.y < 0 || edit.x + edit.w > source.width || edit.y + edit.h > source.height) fail();
      Object.assign(result, {w: edit.w, h: edit.h, style: edit.style});
    }
    if (result.type === "text") {
      if (typeof edit.text !== "string" || edit.text.length > 10000 || !finite(edit.fontSize, 8, 400) ||
          !/^#[a-f0-9]{6}$/i.test(edit.color) || !["sans", "serif", "mono"].includes(edit.font) ||
          !["none", "dark", "light"].includes(edit.bg) || typeof edit.bold !== "boolean") fail();
      Object.assign(result, {text: edit.text, fontSize: edit.fontSize, color: edit.color, font: edit.font, bg: edit.bg, bold: edit.bold});
    }
    return result;
  });
  if (EditorModel.limitError(edits)) fail();
  return {format: "FreeEdit", version: 2,
    source: {name: source.name, size: source.size, fingerprint: source.fingerprint, algorithm: source.algorithm,
      duration: source.duration, width: source.width, height: source.height, has_video: source.has_video, has_audio: source.has_audio},
    view: {playhead: finite(value.view?.playhead, 0, source.duration) ? value.view.playhead : 0,
      zoom: [1, 2, 4, 8, 16].includes(value.view?.zoom) ? value.view.zoom : 1},
    edits, settings: {audio, presenter, background, reframe, denoise: settings.denoise, strength: settings.strength, preset: settings.preset}};
}
