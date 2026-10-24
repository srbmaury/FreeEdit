"use strict";

function recoveryTabId() {
  try {
    const key = "freeedit.recovery.tab";
    let id = sessionStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

const projects = {
  key: "freeedit.recovery.v1", source: null, pending: null, recovery: null,
  timer: null, signature: null, savedSignature: null, writing: false,
  tabId: recoveryTabId(), ownerKey: "freeedit.recovery.owner", conflict: false,
};
const projectPresets = ["balanced", "small", "high", "audio_only"];

async function fingerprintSource(file) {
  // Hash every byte in fixed chunks, then hash their digests. Memory stays bounded.
  const chunkSize = 4 * 1024 * 1024;
  const digests = [];
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const bytes = await file.slice(offset, offset + chunkSize).arrayBuffer();
    digests.push(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  }
  const combined = new Uint8Array(digests.length * 32);
  digests.forEach((digest, index) => combined.set(digest, index * 32));
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return {name: file.name, size: file.size, fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), algorithm: "sha256-chunks-4m-v1"};
}

function projectDocument() {
  if (!S.job || !projects.source) return null;
  const edits = S.edits.map(({id, ...edit}) => {
    const copy = {...edit};
    if (copy.type === "text") { delete copy.w; delete copy.h; }
    return copy;
  });
  return {
    format: "FreeEdit", version: 1,
    source: {...projects.source, duration: S.job.duration, width: S.job.width, height: S.job.height, has_video: S.job.has_video, has_audio: S.job.has_audio},
    view: {playhead: sourcePlayer().currentTime || 0, zoom: timeline.zoom},
    edits, settings: {presenter: presenterProject(), background: getBackgroundSettings(), reframe: S.reframe, denoise: $("denoise").checked, strength: $("strength").value, preset: $("exportPreset").value},
  };
}

function validateProject(value) {
  const fail = () => { throw new Error("This project contains invalid or unsupported settings."); };
  if (value?.format !== "FreeEdit" || value.version !== 1) throw new Error("This project format is not supported. Use a FreeEdit version 1 project.");
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
  if (reframe) {
    if (!source.has_video || !["original", "wide", "vertical", "square"].includes(reframe.aspect) ||
        ![reframe.zoom, reframe.focus_x, reframe.focus_y].every(Number.isFinite) ||
        reframe.zoom < 1 || reframe.zoom > 3 || reframe.focus_x < 0 || reframe.focus_x > 1 ||
        reframe.focus_y < 0 || reframe.focus_y > 1) fail();
    if (reframe.sections != null) {
      if (!Array.isArray(reframe.sections) || reframe.sections.length > 20) fail();
      const sections = [...reframe.sections].sort((a,b)=>a.start-b.start);
      for (let i=0;i<sections.length;i++) {
        const s=sections[i];
        if (!finite(s.start,0,source.duration) || !finite(s.end,0,source.duration+.05) ||
            s.end<=s.start || !finite(s.zoom,1,3) || !finite(s.focus_x,0,1) ||
            !finite(s.focus_y,0,1) || !finite(s.transition,0,1.5) ||
            (i>0 && sections[i-1].end>s.start)) fail();
      }
      reframe.sections = sections;
    }
  }
  if (!settings || typeof settings.denoise !== "boolean" || !["", "10", "18", "30"].includes(settings.strength) || !projectPresets.includes(settings.preset)) fail();
  if ((settings.preset === "audio_only" && !source.has_audio && !presenter?.source.has_audio) || (source.has_video && (!source.width || !source.height))) fail();
  if (!Array.isArray(value.edits) || value.edits.length > 200) fail();
  const edits = value.edits.map(edit => {
    if (!edit || !["cut", "hide", "text"].includes(edit.type) || !finite(edit.start, 0, source.duration) ||
        !finite(edit.end, 0, source.duration + 0.05) || edit.end <= edit.start) fail();
    const result = {type: edit.type, start: edit.start, end: Math.min(edit.end, source.duration)};
    if (result.type !== "cut") {
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
  if (edits.filter(e => e.type === "cut").length > 100 || edits.filter(e => e.type !== "cut").length > 100) fail();
  return {format: "FreeEdit", version: 1,
    source: {name: source.name, size: source.size, fingerprint: source.fingerprint, algorithm: source.algorithm,
      duration: source.duration, width: source.width, height: source.height, has_video: source.has_video, has_audio: source.has_audio},
    view: {playhead: finite(value.view?.playhead, 0, source.duration) ? value.view.playhead : 0,
      zoom: [1, 2, 4, 8, 16].includes(value.view?.zoom) ? value.view.zoom : 1},
    edits, settings: {presenter, background, reframe, denoise: settings.denoise, strength: settings.strength, preset: settings.preset}};
}

function projectEditSignature(project) {
  if (!project) return null;
  const {view, ...content} = project;
  return JSON.stringify(content);
}

function ownsRecovery() {
  try {
    const owner = JSON.parse(localStorage.getItem(projects.ownerKey) || "null");
    if (owner && owner.id !== projects.tabId && Date.now() - owner.at < 20000) {
      projects.conflict = true;
      $("projectStatus").textContent = "Another tab owns browser recovery. Save a project file to keep this tab’s edits.";
      show($("takeRecoveryBtn"));
      return false;
    }
    localStorage.setItem(projects.ownerKey, JSON.stringify({id: projects.tabId, at: Date.now()}));
    projects.conflict = false;
    show($("takeRecoveryBtn"), false);
    return true;
  } catch { return true; }
}

function projectMediaMatches(expected, actual) {
  return Math.abs(expected.duration - actual.duration) < 0.1 && expected.width === actual.width &&
    expected.height === actual.height && expected.has_video === actual.has_video && expected.has_audio === actual.has_audio;
}

function projectSourceReady(identity) {
  projects.source = identity;
  projects.signature = null;
  projects.savedSignature = null;
  if (projects.pending) {
    const pending = projects.pending;
    projects.pending = null;
    applyProject(pending);
  }
  $("saveProjectBtn").disabled = false;
  show($("resumePanel"), false);
  saveRecovery();
}

function applyProject(project) {
  projects.writing = true;
  restorePresenter(project.settings.presenter);
  S.reframe = project.settings.reframe || {aspect:"original",zoom:1,focus_x:.5,focus_y:.5};
  syncReframeControls();
  S.background = project.settings.background || {mode: "off", blur: 16, color: "#e5e7eb", image: null, region: null, preset: "studio"};
  syncBackgroundControls(); invalidateBackgroundPreview();
  $("backgroundPanel").open = !!project.settings.background;
  S.edits = project.edits.map(edit => ({...edit, id: S.nextId++}));
  S.undo = []; S.redo = []; S.selected = null;
  $("denoise").checked = project.settings.denoise && (S.job.has_audio || !!project.settings.presenter?.source.has_audio);
  $("strength").value = project.settings.strength;
  $("exportPreset").value = S.job.has_video ? project.settings.preset : "audio_only";
  S.exportSignature = null;
  renderList(); render(); updateTransport(); refreshExportState();
  const restoreView = () => {
    sourcePlayer().currentTime = Math.min(project.view?.playhead || 0, duration());
    zoomTimeline(project.view?.zoom || 1);
    updateTransport();
  };
  if (sourcePlayer().readyState >= 1) restoreView();
  else sourcePlayer().addEventListener("loadedmetadata", restoreView, {once: true});
  projects.writing = false;
  projects.savedSignature = projectEditSignature(projectDocument());
}

function scheduleProjectSave() {
  if (projects.writing || !projects.source || !S.job || projects.timer) return;
  projects.timer = setTimeout(() => { projects.timer = null; saveRecovery(); }, 500);
}

function saveRecovery() {
  const project = projectDocument();
  if (!project) return;
  const signature = JSON.stringify(project);
  if (!ownsRecovery()) return;
  if (signature === projects.signature) return;
  try {
    localStorage.setItem(projects.key, JSON.stringify({project, jobId: S.job.id, waveform: S.job.waveform, savedAt: new Date().toISOString()}));
    projects.signature = signature;
    $("projectStatus").textContent = `Recovery saved at ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})} · Keep the original recording` ;
  } catch {
    $("projectStatus").textContent = "Browser recovery is unavailable. Use Save project to keep your edits.";
  }
}

$("saveProjectBtn").onclick = () => {
  const project = projectDocument();
  if (!project) return;
  try { validateProject(project); } catch (error) {
    $("projectStatus").textContent = `Could not save project: ${error.message} Check edit time ranges and settings.`;
    return;
  }
  const blob = new Blob([JSON.stringify(project, null, 2)], {type: "application/json"});
  if (blob.size > 2 * 1024 * 1024) {
    $("projectStatus").textContent = "The project exceeds 2 MB. Shorten long text overlays before saving.";
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projects.source.name.replace(/\.[^.]+$/, "")}.freeedit.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  projects.savedSignature = projectEditSignature(project);
  saveRecovery();
  $("projectStatus").textContent = "Project download started · Keep the original recording with this project file";
  appMenu.open = false;
};

function showProjectMessage(title, message, action, label = "Continue") {
  $("projectDialogTitle").textContent = title;
  $("projectMessage").textContent = message;
  $("confirmProjectBtn").textContent = label;
  $("confirmProjectBtn").onclick = action || (() => $("projectDialog").close());
  if (!$("projectDialog").open) $("projectDialog").showModal();
}
$("cancelProjectBtn").onclick = () => { projects.pending = null; $("projectDialog").close(); };
$("projectDialog").addEventListener("cancel", () => { projects.pending = null; });

$("openProjectBtn").onclick = () => { appMenu.open = false; $("projectInput").click(); };
$("projectInput").onchange = async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("Project files must be smaller than 2 MB. Select the .freeedit.json file, not the recording.");
    const project = validateProject(JSON.parse(await file.text()));
    requestProjectOpen(project);
  } catch (error) {
    showProjectMessage("Could not open project", error instanceof SyntaxError ? "This file is not valid JSON. Select a .freeedit.json project." : error.message, null, "OK");
  }
};

function requestProjectOpen(project, recovery = null) {
  if (S.operation) {
    showProjectMessage("Processing is still running", "Wait for processing to finish before opening another project.", null, "OK");
    return;
  }
  const proceed = () => {
    $("projectDialog").close();
    if (S.job) resetFile();
    projects.pending = project;
    locateProjectSource(project, recovery);
  };
  if (S.job) showProjectMessage("Replace current editing session?", "Save your current project first if you want to keep it. Opening this project will replace the current edits.", proceed, "Open project");
  else proceed();
}

async function locateProjectSource(project, recovery) {
  if (recovery && /^[a-f0-9]{12}$/.test(recovery.jobId)) {
    try {
      const job = await api(`/api/jobs/${recovery.jobId}`);
      // The server's job ID still refers to the same source from this autosave.
      const response = await fetch(`/api/jobs/${recovery.jobId}/source`, {headers: {Range: "bytes=0-0"}, signal: AbortSignal.timeout(10000)});
      if (response.body) await response.body.cancel();
      if (response.ok && projectMediaMatches(project.source, job.media)) {
        openEditor({id: job.id, filename: project.source.name, ...job.media, waveform: recovery.waveform});
        projectSourceReady(project.source);
        if (["queued", "processing", "cancelling"].includes(job.status)) {
          S.submittedRanges = keptRangesForExport();
          S.exportSignature = editSignature();
          setBusy(job.operation);
          show($("procProgress"));
          setProgress("Reconnecting to processing…", null);
          poll();
        }
        return;
      }
    } catch { /* Expired sources can be selected again below. */ }
  }
  showProjectMessage("Locate the original recording", `Choose “${project.source.name}” (${(project.source.size / 1048576).toFixed(1)} MB). The recording is not included in the project. Its contents will be checked before your edits are restored.`, () => $("projectSourceInput").click(), "Choose recording");
}

$("projectSourceInput").onchange = async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !projects.pending) return;
  const project = projects.pending;
  $("confirmProjectBtn").disabled = true;
  $("projectMessage").textContent = "Checking the recording’s contents…";
  try {
    if (file.size !== project.source.size) throw new Error("This recording does not match the saved project. Choose the original file.");
    const identity = await fingerprintSource(file);
    if (identity.fingerprint !== project.source.fingerprint) throw new Error("This recording’s contents do not match. Choose the original file to avoid applying edits to the wrong recording.");
    if (projects.pending !== project) return;
    $("projectDialog").close();
    upload(file, identity);
  } catch (error) {
    $("projectMessage").textContent = error.message;
  } finally {
    $("confirmProjectBtn").disabled = false;
  }
};

function resetProject() {
  clearTimeout(projects.timer); projects.timer = null;
  projects.source = null; projects.signature = null; projects.savedSignature = null; projects.pending = null;
  projects.recovery = null;
  try {
    const owner = JSON.parse(localStorage.getItem(projects.ownerKey) || "null");
    if (!owner || owner.id === projects.tabId || Date.now() - owner.at >= 20000) {
      localStorage.removeItem(projects.key);
      localStorage.removeItem(projects.ownerKey);
    }
  } catch { /* No recovery was saved. */ }
  show($("takeRecoveryBtn"), false);
  $("saveProjectBtn").disabled = true;
  $("projectStatus").textContent = "";
  show($("resumePanel"), false);
}

try {
  const raw = localStorage.getItem(projects.key);
  if (raw) {
    const recovery = JSON.parse(raw);
    projects.recovery = {...recovery, project: validateProject(recovery.project),
      waveform: Array.isArray(recovery.waveform) && recovery.waveform.length <= 4096 && recovery.waveform.every(n => typeof n === "number" && n >= 0 && n <= 1) ? recovery.waveform : null};
    $("resumeDetails").textContent = `${recovery.project.source.name} · ${recovery.project.edits.length} edits${Number.isFinite(Date.parse(recovery.savedAt)) ? " · saved " + new Date(recovery.savedAt).toLocaleString() : ""}. You may need to select the original again.`;
    show($("resumePanel"));
  }
} catch { /* Ignore incompatible or malformed browser recovery data. */ }
$("resumeProjectBtn").onclick = () => {
  if (projects.recovery) requestProjectOpen(projects.recovery.project, projects.recovery);
};
$("discardRecoveryBtn").onclick = () => {
  showProjectMessage("Discard saved recovery?", "This removes the browser's recovery copy. Downloaded project files and original recordings are unchanged.", () => {
    resetProject(); projects.recovery = null; $("projectDialog").close();
  }, "Discard recovery");
};
window.addEventListener("pagehide", () => {
  saveRecovery();
  try {
    const owner = JSON.parse(localStorage.getItem(projects.ownerKey) || "null");
    if (owner?.id === projects.tabId) localStorage.removeItem(projects.ownerKey);
  } catch { /* Storage may be unavailable. */ }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) saveRecovery(); });
window.addEventListener("beforeunload", event => {
  saveRecovery();
  const document = projectDocument();
  if (S.operation || (document && projectEditSignature(document) !== projects.savedSignature)) {
    event.preventDefault(); event.returnValue = "";
  }
});

$("saveBeforeResetBtn").onclick = () => $("saveProjectBtn").click();

$("takeRecoveryBtn").onclick = () => {
  showProjectMessage("Use recovery for this tab?", "This tab will replace the shared browser recovery. Save a project file in the other tab first if you want to keep its edits.", () => {
    try { localStorage.setItem(projects.ownerKey, JSON.stringify({id: projects.tabId, at: Date.now()})); } catch { /* Fall back to project downloads. */ }
    projects.signature = null;
    saveRecovery(); $("projectDialog").close();
  }, "Use this tab");
};
setInterval(() => { if (S.job && projects.source) { ownsRecovery(); saveRecovery(); } }, 5000);
