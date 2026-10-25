"use strict";

const $ = (id) => document.getElementById(id);

const S = {
  job: null,        // { id, filename, duration, has_video, has_audio, width, height }
  edits: [],        // hide: {id,type,x,y,w,h,style,start,end} | text: {id,type,x,y,text,...,start,end} | cut: {id,type,start,end}
  selected: null,   // edit id
  mode: "select",
  drag: null,
  nextId: 1,
  pollTimer: null,
  compareOriginal: false,
  reviewing: false,
  undo: [], redo: [],
  exportSignature: null,
  submittedRanges: [],
  operation: null,
  suggestions: [],
  resultIsAudio: false,
  auditionUntil: null,
  pendingUpload: null,
  elapsedTimer: null,
  busySince: null,
  reviewLoop: null,
  background: null,
  reframe: null,
};

const editorStore = createEditorStore(S);
function commitEdit(reason, mutation, saveUndo = true) {
  if (saveUndo) checkpoint();
  return editorStore.dispatch(reason, mutation);
}
editorStore.subscribe(({reason}) => {
  if (!S.job) return;
  // Never replace the user's focused text/number input while typing.
  // A lightweight mutation only invalidates timeline, canvas and export.
  if (reason === "edit:property" || reason === "edit:drag") {
    renderTimeline();
  } else if (reason === "edit:update-reframe" ||
             reason === "scene:reframe" || reason === "scene:reset-reframe") {
    // Keep focused controls and existing text/mask cards mounted during sliders.
    renderZoomSelectList();
    renderReframeSections();
    renderTimeline();
  } else {
    renderList();
    if (typeof renderReframeSections === "function") renderReframeSections();
  }
  render();
  updateTransport();
  refreshExportState();
});
let pollRevision = 0;

const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");
const measureCtx = document.createElement("canvas").getContext("2d");

const FONTS = {
  sans: '-apple-system, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Menlo, Consolas, monospace',
};
const MODE_HINTS = {
  select: "Select an edit to adjust it.",
  hide: "Drag over the part of the video you want to hide.",
  text: "Click where the text should go.",
  background: "Drag a rectangle around the camera inset. Press Escape to cancel.",
};

// ---------- helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};
const sourcePlayer = () => S.job?.has_video ? video : $("audio");
const duration = () => S.job?.duration || video.duration || 0;
const getEdit = (id) => S.edits.find((e) => e.id === id);
const isActive = (e, t = video.currentTime) => t >= e.start && t <= e.end;
const show = (el, on = true) => el.classList.toggle("hidden", !on);

const apiClient = import("./api-client.mjs");
async function api(path, opts = {}) {
  const {requestJson} = await apiClient;
  return requestJson(path, opts);
}

// User input may arrive while later classic-script adapters are still loading.
// Wait for their registration before touching editor services.
const adaptersReady = document.readyState === "loading"
  ? new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, {once: true}))
  : Promise.resolve();
let sceneRules;
const editorReady = Promise.all([adaptersReady, import("./scene-schema.mjs").then(rules => { sceneRules = rules; })]);

// ---------- upload ----------
const dropZone = $("dropZone");
$("chooseFileBtn").onclick = (event) => { event.preventDefault(); $("fileInput").click(); };
$("fileInput").addEventListener("change", (e) => e.target.files[0] && upload(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("drag"); }));
dropZone.addEventListener("drop", (e) => e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]));

let LIMITS = { max_upload_mb: 0, max_duration_min: 0 };
api("/api/limits").then((l) => {
  LIMITS = l;
  $("storageDetails").textContent = `Temporary files expire after ${l.job_ttl_hours} hours of inactivity. Active processing is protected.`;
  $("retentionNote").textContent = `Processed on this server. Files expire after ${l.job_ttl_hours} hours when inactive.`;
  const parts = [];
  if (l.max_upload_mb) parts.push(`up to ${l.max_upload_mb} MB`);
  if (l.max_duration_min) parts.push(`${l.max_duration_min} min`);
  let text = parts.length ? parts.join(" · ") : "";
  if (l.max_output_side) text += `${text ? " · " : ""}Edited videos are saved at up to ${l.max_output_side}px`;
  $("dzLimits").textContent = text;
}).catch(() => {});

async function upload(file, knownIdentity = null) {
  S.pendingUpload = file;
  try { await editorReady; }
  catch { return uploadFailed("Could not load the editor. Refresh the page and try again.", true); }
  if (LIMITS.max_upload_mb && file.size > LIMITS.max_upload_mb * 1024 * 1024) {
    return uploadFailed(`File is larger than ${LIMITS.max_upload_mb} MB.`);
  }
  let identity;
  try {
    $("uploadPct").textContent = "Checking recording…";
    show($("uploadProgress"));
    show(dropZone, false);
    identity = knownIdentity || await fingerprintSource(file);
    if (projects.pending && (identity.size !== projects.pending.source.size || identity.fingerprint !== projects.pending.source.fingerprint)) {
      uploadFailed("Choose the original recording for this project, or cancel opening the project.");
      return;
    }
  } catch {
    uploadFailed("Could not read the recording. Select the original file and try again.");
    return;
  }
  show($("retryUploadBtn"), false);

  show($("uploadError"), false);
  show($("uploadProgress"));
  show(dropZone, false);
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    $("uploadBar").style.width = pct + "%";
    $("uploadPct").textContent = pct < 100 ? pct + "%" : "Reading file…";
  };
  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* empty */ }
    if (xhr.status >= 200 && xhr.status < 300) {
      if (projects.pending && !projectMediaMatches(projects.pending.source, body)) {
        uploadFailed("This project's media details do not match the recording. The project may be damaged or unsupported.");
        projects.pending = null;
        api(`/api/jobs/${body.id}`, {method: "DELETE"}).catch(() => {});
        return;
      }
      openEditor(body);
      projectSourceReady(identity);
    }
    else uploadFailed(body.detail || `Upload failed (${xhr.status})`, xhr.status === 429 || xhr.status >= 500);
  };
  xhr.onerror = () => uploadFailed("Connection interrupted. Check your connection and retry the upload.", true);
  // Raw body upload: the server streams it straight to disk
  xhr.open("POST", `/api/upload?filename=${encodeURIComponent(file.name)}`);
  xhr.setRequestHeader("Content-Type", "application/octet-stream");
  xhr.send(file);
}

$("retryUploadBtn").onclick = () => { if (S.pendingUpload) upload(S.pendingUpload); };

function uploadFailed(msg, retry = false) {
  show($("retryUploadBtn"), retry && !!S.pendingUpload);
  show($("uploadProgress"), false);
  show(dropZone);
  $("uploadError").textContent = msg;
  show($("uploadError"));
  $("fileInput").value = "";
}

// ---------- editor setup ----------
function openEditor(job) {
  S.pendingUpload = null;
  S.resultSrc = null;
  S.compareOriginal = false;
  S.job = job;
  S.edits = [];
  S.undo = []; S.redo = [];
  resetNoisePreview();
  resetResultPreview();
  restoreAudioSettings();
  resetBackground();
  resetVideos();
  S.exportSignature = null; S.reviewing = false;
  S.reframe = {...EditorModel.DEFAULT_REFRAME};
  if (typeof syncReframeControls === "function") syncReframeControls();
  S.operation = null; S.suggestions = [];
  resetTimeline();
  resetSilenceRange();
  show($("silenceReview"), false);
  $("silenceStatus").textContent = "";
  show($("retryPausesBtn"), false);
  $("detectSilenceBtn").disabled = false;
  $("exportPreset").value = job.has_video ? "balanced" : "audio_only";
  $("exportPreset").querySelector('[value="audio_only"]').disabled = !job.has_audio;
  show($("silencePanel"), job.has_audio);
  S.selected = null;
  show($("uploadView"), false);
  show($("editorView"));
  show($("newFileBtn"));
  show($("resultPanel"), false);
  setReview(false);
  show($("procError"), false);
  show($("procReference"), false);
  show($("recoverFileBtn"), false);
  show($("procProgress"), false);

  const src = `/api/jobs/${job.id}/source`;
  const isVideo = job.has_video;
  show($("toolbar"));
  show($("backgroundPanel"), isVideo);
  document.querySelectorAll(".tool").forEach(b => show(b, isVideo));
  show($("modeHint"), isVideo);
  show($("stage"), isVideo);
  show($("transport"));
  show($("editsPanel"));
  show($("audio"), !isVideo);
  if (isVideo) {
    video.src = src;
  } else {
    $("audio").src = src;
  }
  show($("audioOpts"), job.has_audio);
  show($("noAudio"), !job.has_audio);
  $("denoise").checked = job.has_audio;

  const bits = [job.filename, fmt(job.duration)];
  if (isVideo) bits.push(`${job.width}×${job.height}`);
  if (!job.has_audio) bits.push("no audio");
  $("fileMeta").textContent = bits.join(" · ");

  setMode("select");
  renderList();
  updateTransport();
  requestAnimationFrame(layoutStage);
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "open" }));
}

function layoutStage() {
  if (!S.job?.has_video) return;
  const wrap = $("stageWrap");
  const style = getComputedStyle(wrap);
  const maxW = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  // Use more of the workspace while preserving the recording's aspect ratio.
  // The timeline stays beneath the preview and never gets overlapped.
  const maxH = Math.max(280, window.innerHeight * (window.innerWidth <= 850 ? 0.65 : 0.78));
  const { width: W, height: H } = S.job;
  const guide = typeof reframeGuideSection === "function" && reframeGuideSection();
  const shape = guide ? {w: W, h: H} : freeeditCropRect(W, H, {...S.reframe, zoom: 1});
  const scale = Math.min(maxW / shape.w, maxH / shape.h);
  const dw = Math.round(shape.w * scale), dh = Math.round(shape.h * scale);
  const stage = $("stage");
  stage.style.width = dw + "px";
  stage.style.height = dh + "px";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(dw * dpr);
  canvas.height = Math.round(dh * dpr);
  // Draw in source-video pixel coordinates
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  render();
}
window.addEventListener("resize", layoutStage);

video.addEventListener("loadeddata", () => render());
$("audio").addEventListener("timeupdate", updateTransport);
$("audio").addEventListener("play", () => { $("playBtn").textContent = "❚❚"; tick(); });
$("audio").addEventListener("pause", () => { S.auditionUntil = null; $("playBtn").textContent = "▶"; });
video.addEventListener("seeked", () => render());
video.addEventListener("timeupdate", () => { updateTransport(); if (video.paused) render(); });
video.addEventListener("play", () => { $("playBtn").textContent = "❚❚"; tick(); });
video.addEventListener("pause", () => { S.auditionUntil = null; $("playBtn").textContent = "▶"; render(); });
video.addEventListener("error", () => {
  $("fileMeta").textContent += " · This browser can't preview this format. You can still process it, but you can't place edits here. Try Safari, or upload an MP4.";
});

// While playing, jump over removed parts so the preview matches the result
function skipCuts() {
  const t = sourcePlayer().currentTime;
  const c = S.edits.find((e) => e.type === "cut" && t >= e.start && t < e.end - 0.02);
  if (c) sourcePlayer().currentTime = Math.min(c.end, duration());
}

function tick() {
  if (S.reviewLoop) {
    const loop = S.reviewLoop;
    if (sourcePlayer().currentTime >= loop.end) sourcePlayer().currentTime = loop.start;
    render(); updateTransport();
    if (!sourcePlayer().paused && !sourcePlayer().ended) requestAnimationFrame(tick);
    return;
  }
  if (S.auditionUntil !== null) {
    if (sourcePlayer().currentTime >= S.auditionUntil) sourcePlayer().pause();
  } else if (!sourcePlayer().paused) skipCuts();
  render();
  updateTransport();
  if (!sourcePlayer().paused && !sourcePlayer().ended) requestAnimationFrame(tick);
}

// ---------- transport ----------
$("playBtn").onclick = () => (sourcePlayer().paused ? sourcePlayer().play() : sourcePlayer().pause());
$("scrubber").addEventListener("input", (e) => {
  sourcePlayer().currentTime = (e.target.value / 1000) * duration();
});

function updateTransport() {
  updateTimelinePlayhead();
  const d = duration();
  const removed = cutRanges().reduce((sum, [a, b]) => sum + (b - a), 0);
  $("timeLabel").innerHTML = `${fmt(sourcePlayer().currentTime)} / ${fmt(d)}` +
    (removed > 0 ? `<br><span class="final-len">Final ${fmt(d - removed)}</span>` : "");
  if (document.activeElement !== $("scrubber")) {
    $("scrubber").value = d ? (sourcePlayer().currentTime / d) * 1000 : 0;
  }
  $("scrubber").setAttribute("aria-valuetext", `${fmt(sourcePlayer().currentTime)} of ${fmt(d)}`);
  const sel = getEdit(S.selected);
  show($("reviewSelectionBtn"), !!sel && !S.reviewing);
  const track = $("rangeTrack");
  if (sel && d) {
    track.style.left = (sel.start / d) * 100 + "%";
    track.style.width = Math.max(0.5, ((sel.end - sel.start) / d) * 100) + "%";
    show(track);
  } else {
    show(track, false);
  }
}

// ---------- drawing ----------
