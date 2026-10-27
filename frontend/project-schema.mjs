import {validateBackground, validatePresenterProject, validateFraming} from "./scene-schema.mjs";

// Pure project-file validation. Editor/scene rules are explicit dependencies;
// this module does not read the DOM, browser storage, or editor state.
const projectPresets = ["balanced", "small", "high", "audio_only"];

export function validateProjectDocument(value, {EditorModel, AnnotationModel}) {
  const fail = () => { throw new Error("This project contains invalid or unsupported settings."); };
  if (value?.format !== "FreeEdit" || value.version !== 2) throw new Error("This project format is not supported. Use a FreeEdit version 2 project.");
  const source = value.source;
  const finite = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (!source || typeof source.name !== "string" || source.name.length > 1024 || !finite(source.size, 1, Number.MAX_SAFE_INTEGER) ||
      !Number.isInteger(source.size) || source.algorithm !== "sha256-chunks-4m-v1" || !/^[a-f0-9]{64}$/.test(source.fingerprint) ||
      !finite(source.duration, 0.001, 1e8) || !finite(source.width, 0, 65536) || !finite(source.height, 0, 65536) ||
      typeof source.has_video !== "boolean" || typeof source.has_audio !== "boolean" || (!source.has_video && !source.has_audio)) fail();
  const settings = value.settings;
  let timelineDuration = source?.duration;
  let sequence = null;
  if (value.sequence !== undefined) {
    const clips = value.sequence?.clips;
    if (!Array.isArray(clips) || clips.length < 2 || clips.length > 8 || !finite(value.sequence.duration, 0.001, 1e8)) fail();
    const validated = clips.map((clip,index) => {
      const identity = clip?.source;
      if (!clip || typeof clip.name !== "string" || clip.name.length > 255 || !finite(clip.duration, 0.001, 1e8) ||
          !identity || !finite(identity.size,1,Number.MAX_SAFE_INTEGER) || !Number.isInteger(identity.size) ||
          typeof identity.name !== "string" || identity.name.length > 1024 || identity.algorithm !== "sha256-chunks-4m-v1" || !/^[a-f0-9]{64}$/.test(identity.fingerprint)) fail();
      if (index === 0 && (identity.fingerprint !== source.fingerprint || identity.size !== source.size)) fail();
      return {id:typeof clip.id === "string" ? clip.id : `clip-${index+1}`, name:clip.name, duration:clip.duration,
        source:{name:identity.name,size:identity.size,fingerprint:identity.fingerprint,algorithm:identity.algorithm}};
    });
    const transitions = value.sequence.transitions === undefined ? validated.slice(1).map(()=>({type:"cut",duration:0})) : value.sequence.transitions;
    if (!Array.isArray(transitions) || transitions.length !== validated.length - 1 || transitions.some((t,i)=>!t || !["cut","crossfade"].includes(t.type) || !finite(t.duration,0,Math.min(2,validated[i].duration,validated[i+1].duration)) || (t.type === "cut" && t.duration !== 0))) fail();
    timelineDuration = validated.reduce((total,clip)=>total+clip.duration,0) - transitions.reduce((total,t)=>total+t.duration,0);
    if (Math.abs(timelineDuration-value.sequence.duration) > .1) fail();
    sequence = {duration:timelineDuration,transitions:transitions.map(t=>({type:t.type,duration:t.duration})),clips:validated};
  }
  const framing = validateFraming(settings?.framing, source);
  const background = validateBackground(settings?.background, source);
  const presenter = validatePresenterProject(settings?.presenter, {...source,duration:timelineDuration});
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
    if (!edit || !EditorModel.TIMELINE_TYPES.includes(edit.type) || !finite(edit.start, 0, timelineDuration) ||
        !finite(edit.end, 0, timelineDuration + 0.05) || edit.end <= edit.start) fail();
    const result = {type: edit.type, start: edit.start, end: Math.min(edit.end, timelineDuration)};
    if (result.type === "audio") {
      if (EditorModel.validateAudioRegion(edit,timelineDuration)) fail();
      Object.assign(result,{volume:edit.volume,fade:edit.fade});
    }
    if (result.type === "reframe") {
      const section = {...edit, start:result.start, end:result.end};
      if (!source.has_video || EditorModel.validateReframe(section, timelineDuration, reframeEdits)) fail();
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
    if (result.type === "annotation") {
      if (!source.has_video || AnnotationModel.validate(edit, timelineDuration, source.width, source.height)) fail();
      for(const key of ["kind","icon","shape","text","image","x","y","w","h","color","opacity","rotation","animation","transition"])result[key]=edit[key];
      if(edit.kind==="drawing"){
        if(edit.strokes)result.strokes=edit.strokes.map(s=>({points:s.points.map(p=>[...p]),strokeWidth:s.strokeWidth,color:s.color,opacity:s.opacity}));
        else {result.points=edit.points.map(p=>[...p]);result.strokeWidth=edit.strokeWidth;}
        if(edit.animationShift!==undefined)result.animationShift=edit.animationShift;
      }
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
      ...(sequence ? {sequence} : {}),
    view: {playhead: finite(value.view?.playhead, 0, timelineDuration) ? value.view.playhead : 0,
      zoom: [1, 2, 4, 8, 16].includes(value.view?.zoom) ? value.view.zoom : 1},
    edits, settings: {audio, presenter, background, framing, reframe, denoise: settings.denoise, strength: settings.strength, preset: settings.preset}};
}
