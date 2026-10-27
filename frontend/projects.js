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
  source: null, pending: null, recovery: null,
  timer: null, signature: null, savedSignature: null, writing: false,
  recoveryRevision: 0, pendingSignature: null,
  tabId: recoveryTabId(), ownerKey: "freeedit.recovery.owner", conflict: false,
};
const recoveryStore = import("./recovery-store.mjs").then(module => module.createRecoveryStore());

async function fingerprintSource(file) {
  const identity = await import("./source-identity.mjs");
  return identity.fingerprintSource(file);
}

function projectDocument() {
  if (!S.job || !projects.source) return null;
  const edits = S.edits.map(EditorModel.editableProperties);
  return {
    format: "FreeEdit", version: 2,
    source: {...projects.source, duration: S.job.duration, width: S.job.width, height: S.job.height, has_video: S.job.has_video, has_audio: S.job.has_audio},
    view: {playhead: sourcePlayer().currentTime || 0, zoom: timeline.zoom},
    edits, settings: {audio: getAudioSettings(), presenter: presenterProject(), background: getBackgroundSettings(), framing: S.job.has_video ? S.framing : null, reframe: S.job.has_video ? S.reframe : null, denoise: $("denoise").checked, strength: $("strength").value, preset: $("exportPreset").value},
  };
}

async function validateProject(value) {
  const {validateProjectDocument} = await import("./project-schema.mjs");
  return validateProjectDocument(value, {EditorModel, AnnotationModel});
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

function projectSourceReady(identity, {save = true} = {}) {
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
  if (save) saveRecovery();
}

function applyProject(project) {
  projects.writing = true;
  restorePresenter(project.settings.presenter);
  const imported = project.edits.map(edit => ({...edit, id: S.nextId++}));
  editorStore.dispatch("project:load", state => {
    state.framing = project.settings.framing || null;
    state.reframe = project.settings.reframe || {...EditorModel.DEFAULT_REFRAME};
    state.background = project.settings.background || {mode: "off", blur: 16, color: "#e5e7eb", image: null, region: null, preset: "studio"};
    state.edits = imported;
    state.undo = []; state.redo = []; state.selected = null;
  });
  syncReframeControls();
  syncBackgroundControls(); invalidateBackgroundPreview();
  syncCanvasControls(); layoutStage();
  $("backgroundPanel").open = !!project.settings.background;
  restoreAudioSettings(project.settings.audio);
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

async function saveRecovery() {
  const project = structuredClone(projectDocument());
  if (!project) return;
  const exportSubmission = S.exportSubmission?.jobId === S.job.id ? S.exportSubmission : null;
  const resultPreviewSubmission = previewSubmission?.id === S.job.id ? previewSubmission : null;
  const signature = JSON.stringify({project, exportSubmission, previewSubmission: resultPreviewSubmission});
  if (!ownsRecovery()) return;
  if (signature === projects.pendingSignature ||
      (signature === projects.signature && projects.pendingSignature === null)) return;
  const revision = ++projects.recoveryRevision;
  const jobId = S.job.id;
  projects.pendingSignature = signature;
  try {
    const store = await recoveryStore;
    if (revision !== projects.recoveryRevision || S.job?.id !== jobId || !ownsRecovery()) return;
    await store.write({project, exportSubmission, previewSubmission: resultPreviewSubmission,
      jobId, waveform: S.job.waveform, savedAt: new Date().toISOString()});
    if (revision !== projects.recoveryRevision || S.job?.id !== jobId) return;
    projects.signature = signature;
    $("projectStatus").textContent = `Saved in this browser · ${new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}` ;
  } catch {
    if (revision === projects.recoveryRevision && S.job?.id === jobId)
      $("projectStatus").textContent = "Browser recovery is unavailable. Use Save project to keep your edits.";
  } finally {
    if (revision === projects.recoveryRevision) projects.pendingSignature = null;
  }
}

$("saveProjectBtn").onclick = async () => {
  const project = structuredClone(projectDocument());
  if (!project) return;
  const jobId = S.job.id;
  try { await validateProject(project); } catch (error) {
    if (S.job?.id === jobId) $("projectStatus").textContent = `Could not save project: ${error.message} Check edit time ranges and settings.`;
    return;
  }
  const blob = new Blob([JSON.stringify(project, null, 2)], {type: "application/json"});
  if (blob.size > 2 * 1024 * 1024) {
    if (S.job?.id === jobId) $("projectStatus").textContent = "The project exceeds 2 MB. Shorten long text overlays before saving.";
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.source.name.replace(/\.[^.]+$/, "")}.freeedit.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (S.job?.id === jobId) {
    projects.savedSignature = projectEditSignature(project);
    saveRecovery();
    $("projectStatus").textContent = "Project download started · Keep the original recording with this project file";
    appMenu.open = false;
  }
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
    const project = await validateProject(JSON.parse(await file.text()));
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
  const initialJob = S.job;
  const current = () => projects.pending === project && S.job === initialJob && !S.pendingUpload;
  try { await editorReady; }
  catch {
    if (!current()) return;
    showProjectMessage("Could not load the editor", "Refresh the page and try again.", null, "OK");
    return;
  }
  if (!current()) return;
  if (recovery && /^[a-f0-9]{12}$/.test(recovery.jobId)) {
    try {
      const job = await api(`/api/jobs/${recovery.jobId}`);
      if (!current()) return;
      // The server's job ID still refers to the same source from this autosave.
      const response = await fetch(`/api/jobs/${recovery.jobId}/source`, {headers: {Range: "bytes=0-0"}, signal: AbortSignal.timeout(10000)});
      if (response.body) await response.body.cancel();
      if (!current()) return;
      if (response.ok && projectMediaMatches(project.source, job.media)) {
        openEditor({id: job.id, filename: project.source.name, ...job.media, waveform: recovery.waveform});
        // Apply the document without flushing a half-restored recovery snapshot.
        projectSourceReady(project.source, {save: false});
        const submission = exportRules.recoverSubmission(recovery.exportSubmission, job);
        S.exportSubmission = submission;
        S.submittedRanges = submission?.ranges || [];
        S.exportSignature = submission?.signature || "";
        restoreResultPreviewSubmission(recovery.previewSubmission, job);
        if (["queued", "processing", "cancelling"].includes(job.status)) {
          setBusy(job.operation);
          show($("procProgress"));
          setProgress("Reconnecting to processing…", null);
          poll();
        } else {
          if (job.status === "done" && job.output) processDone(job);
          if (job.operation === "result-preview" && job.result_preview && recovery.previewSubmission) {
            resultPreviewDone(job.result_preview);
          }
        }
        saveRecovery();
        return;
      }
    } catch { /* Expired sources can be selected again below. */ }
    if (!current()) return;
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
  ++projects.recoveryRevision; projects.pendingSignature = null;
  let clearRecovery = true;
  try {
    const owner = JSON.parse(localStorage.getItem(projects.ownerKey) || "null");
    clearRecovery = !owner || owner.id === projects.tabId || Date.now() - owner.at >= 20000;
    if (clearRecovery) {
      localStorage.removeItem(projects.ownerKey);
    }
  } catch { /* No recovery was saved. */ }
  if (clearRecovery) void recoveryStore.then(store => store.clear()).catch(() => {});
  show($("takeRecoveryBtn"), false);
  $("saveProjectBtn").disabled = true;
  $("projectStatus").textContent = "";
  show($("resumePanel"), false);
}

// Initialize recovery after feature adapters are registered. The schema module
// loads through its explicit import before any project is offered for resume.
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const recovery = await (await recoveryStore).read();
    if (recovery) {
      const project = await validateProject(recovery.project);
      if (S.job || S.pendingUpload || projects.pending) return;
      projects.recovery = {...recovery, project,
        waveform: Array.isArray(recovery.waveform) && recovery.waveform.length <= 4096 && recovery.waveform.every(n => typeof n === "number" && n >= 0 && n <= 1) ? recovery.waveform : null};
      $("resumeDetails").textContent = `${recovery.project.source.name} · ${recovery.project.edits.length} edits${Number.isFinite(Date.parse(recovery.savedAt)) ? " · saved " + new Date(recovery.savedAt).toLocaleString() : ""}. You may need to select the original again.`;
      show($("resumePanel"));
    }
  } catch { /* Ignore incompatible or malformed browser recovery data. */ }
}, {once: true});
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

// Keep a visible editor (or playing source) alive even when media is fully buffered.
async function touchOpenRecording() {
  if (!S.job || S.operation || (document.hidden && sourcePlayer().paused)) return;
  const id = S.job.id;
  try { await api(`/api/jobs/${id}`); } catch { /* Normal processing/relink flows report connection failures. */ }
}
setInterval(touchOpenRecording, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) touchOpenRecording(); });
