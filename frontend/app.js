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
  selectedZoom: null,
};

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
  select: "Click an edit to select it. Drag it to move it.",
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

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, signal: AbortSignal.timeout(15000) });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const detail = Array.isArray(body?.detail) ? body.detail.map((e) => `${e.loc.slice(1).join(".")}: ${e.msg}`).join("; ") : body?.detail;
    const error = new Error(detail || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = body?.error?.code;
    error.requestId = body?.error?.request_id;
    throw error;
  }
  return body;
}

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
  S.selectedZoom = null;
  S.undo = []; S.redo = [];
  resetNoisePreview();
  resetBackground();
  resetVideos();
  S.exportSignature = null; S.reviewing = false;
  S.reframe = {aspect: "original", zoom: 1, focus_x: .5, focus_y: .5, sections: []};
  if (typeof syncReframeControls === "function") syncReframeControls();
  S.operation = null; S.suggestions = [];
  resetTimeline();
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
  const maxH = Math.max(240, window.innerHeight * 0.54);
  const { width: W, height: H } = S.job;
  const scale = Math.min(maxW / W, maxH / H);
  const dw = Math.round(W * scale), dh = Math.round(H * scale);
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

video.addEventListener("loadeddata", render);
$("audio").addEventListener("timeupdate", updateTransport);
$("audio").addEventListener("play", () => { $("playBtn").textContent = "❚❚"; tick(); });
$("audio").addEventListener("pause", () => { S.auditionUntil = null; $("playBtn").textContent = "▶"; });
video.addEventListener("seeked", render);
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
function textMetrics(e) {
  measureCtx.font = textFont(e);
  const lines = (e.text || " ").split("\n");
  const lineH = e.fontSize * 1.25;
  const pad = Math.ceil(e.fontSize * (e.bg === "none" ? 0.2 : 0.4));
  const w = Math.max(...lines.map((l) => measureCtx.measureText(l || " ").width));
  return { lines, lineH, pad, w: Math.ceil(w + pad * 2), h: Math.ceil(lines.length * lineH + pad * 2) };
}
const textFont = (e) => `${e.bold ? 700 : 400} ${e.fontSize}px ${FONTS[e.font] || FONTS.sans}`;

// Shared by the live preview and the PNG export, so what you see is what renders
function paintText(c, e, ox, oy) {
  const m = textMetrics(e);
  e.w = m.w; e.h = m.h;
  c.save();
  if (e.bg !== "none") {
    c.fillStyle = e.bg === "dark" ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.85)";
    c.beginPath();
    c.roundRect(ox, oy, m.w, m.h, m.pad * 0.6);
    c.fill();
  } else {
    c.shadowColor = "rgba(0,0,0,0.7)";
    c.shadowBlur = Math.max(2, e.fontSize * 0.08);
    c.shadowOffsetY = Math.max(1, e.fontSize * 0.03);
  }
  c.font = textFont(e);
  c.fillStyle = e.color;
  c.textBaseline = "middle";
  m.lines.forEach((line, i) => c.fillText(line, ox + m.pad, oy + m.pad + m.lineH * (i + 0.5)));
  c.restore();
}

const pixelCanvas = document.createElement("canvas");
function paintHide(e) {
  const { x, y, w, h } = e;
  if (e.style === "black") {
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    return;
  }
  if (video.readyState < 2) return;
  if (e.style === "pixelate") {
    const block = Math.max(4, Math.min(w, h) / 12);
    const sw = Math.max(1, Math.floor(w / block)), sh = Math.max(1, Math.floor(h / block));
    pixelCanvas.width = sw; pixelCanvas.height = sh;
    const pc = pixelCanvas.getContext("2d");
    pc.drawImage(video, x, y, w, h, 0, 0, sw, sh);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixelCanvas, 0, 0, sw, sh, x, y, w, h);
    ctx.restore();
    return;
  }
  // blur: sample a slightly larger area so edges don't fade to transparent
  const W = S.job.width, H = S.job.height;
  const radius = Math.max(2, Math.min(w, h) / 8);
  const px = Math.max(0, x - radius), py = Math.max(0, y - radius);
  const pw = Math.min(W, x + w + radius) - px, ph = Math.min(H, y + h + radius) - py;
  const screenScale = canvas.width / W;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = `blur(${radius * screenScale * 0.6}px)`;
  ctx.drawImage(video, px, py, pw, ph, px, py, pw, ph);
  ctx.restore();
}

function render() {
  refreshExportState();
  if (!S.job?.has_video) return;
  const W = S.job.width, H = S.job.height;
  ctx.clearRect(0, 0, W, H);
  const lw = W / (canvas.width / (window.devicePixelRatio || 1)); // 1 screen px in source px

  drawPresenter(ctx);

  for (const e of S.edits) {
    if (e.type === "cut") continue;
    if (!isActive(e)) {
      if (e.type === "text") { const m = textMetrics(e); e.w = m.w; e.h = m.h; }
      continue;
    }
    if (e.type === "hide") paintHide(e);
    else paintText(ctx, e, e.x, e.y);
  }

  const sel = getEdit(S.selected);
  if (sel && sel.type !== "cut") {
    ctx.save();
    ctx.lineWidth = 2 * lw;
    ctx.setLineDash([6 * lw, 4 * lw]);
    ctx.strokeStyle = isActive(sel) ? "#5b8ff0" : "rgba(91,143,240,0.45)";
    ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
    if (sel.type === "hide") {
      ctx.setLineDash([]);
      ctx.fillStyle = "#5b8ff0";
      const hs = 10 * lw;
      ctx.fillRect(sel.x + sel.w - hs / 2, sel.y + sel.h - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  if (S.edits.some((e) => e.type === "cut" && isActive(e))) {
    ctx.save();
    ctx.fillStyle = "rgba(20,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${Math.round(H * 0.05)}px ${FONTS.sans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✂  This part will be removed", W / 2, H / 2);
    ctx.restore();
  }

  drawCameraRegion(ctx, lw);
  // Display the retained region without altering input coordinates or selection.
  if (S.reframe && (S.reframe.aspect !== "original" || S.reframe.zoom > 1 || S.reframe.sections?.length)) {
    const r = freeeditCropRect(W, H, freeeditReframeAt(S.reframe, video.currentTime));

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, 0, W, r.y);
    ctx.fillRect(0, r.y, r.x, r.h);
    ctx.fillRect(r.x + r.w, r.y, W - r.x - r.w, r.h);
    ctx.fillRect(0, r.y + r.h, W, H - r.y - r.h);
    ctx.strokeStyle = "#e5e1ff";
    ctx.lineWidth = Math.max(2 * lw, W / 800);
    ctx.setLineDash([7 * lw, 4 * lw]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  if (S.drag?.kind === "new") {
    const r = normRect(S.drag);
    ctx.save();
    ctx.lineWidth = 2 * lw;
    ctx.setLineDash([6 * lw, 4 * lw]);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  if (typeof updateReframePreview === "function") {
    const active = S.reframe && (S.reframe.aspect !== "original" || S.reframe.zoom > 1 || S.reframe.sections?.length);
    updateReframePreview(active ? freeeditCropRect(W, H, freeeditReframeAt(S.reframe, video.currentTime)) : null);
  }
}

function normRect(d) {
  const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
  return { x, y, w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
}

// ---------- canvas interaction ----------
function toSource(ev) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp(((ev.clientX - r.left) / r.width) * S.job.width, 0, S.job.width),
    y: clamp(((ev.clientY - r.top) / r.height) * S.job.height, 0, S.job.height),
  };
}

function hitTest(p) {
  const lw = S.job.width / canvas.getBoundingClientRect().width;
  const sel = getEdit(S.selected);
  if (sel?.type === "hide") {
    const hs = 14 * lw;
    if (Math.abs(p.x - (sel.x + sel.w)) < hs && Math.abs(p.y - (sel.y + sel.h)) < hs) {
      return { edit: sel, part: "resize" };
    }
  }
  const inside = (e) => p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h;
  if (sel && sel.type !== "cut" && inside(sel)) return { edit: sel, part: "move" };
  for (let i = S.edits.length - 1; i >= 0; i--) {
    const e = S.edits[i];
    if (e.type !== "cut" && isActive(e) && inside(e)) return { edit: e, part: "move" };
  }
  return null;
}

canvas.addEventListener("pointerdown", (ev) => {
  const p = toSource(ev);
  canvas.setPointerCapture(ev.pointerId);
  if (S.mode === "hide" || S.mode === "background") {
    S.drag = { background: S.mode === "background", kind: "new", x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    return;
  }
  if (S.mode === "text") {
    const e = addTextAt(p.x, p.y);
    setMode("select");
    // Stop the canvas click from stealing focus back from the text box
    ev.preventDefault();
    const ta = document.querySelector(`.card[data-id="${e.id}"] textarea`);
    ta?.focus();
    ta?.select();
    return;
  }
  const hit = hitTest(p);
  if (hit) checkpoint();
  if (!hit) { select(null); return; }
  select(hit.edit.id);
  S.drag = hit.part === "resize"
    ? { kind: "resize", edit: hit.edit }
    : { kind: "move", edit: hit.edit, dx: p.x - hit.edit.x, dy: p.y - hit.edit.y };
});

canvas.addEventListener("pointermove", (ev) => {
  if (!S.job) return;
  const p = toSource(ev);
  const d = S.drag;
  if (!d) {
    if (S.mode === "select") {
      const hit = hitTest(p);
      canvas.className = hit ? hit.part : "";
    }
    return;
  }
  const W = S.job.width, H = S.job.height;
  if (d.kind === "new") {
    d.x1 = p.x; d.y1 = p.y;
  } else if (d.kind === "move") {
    d.edit.x = Math.round(clamp(p.x - d.dx, -d.edit.w / 2, W - d.edit.w / 2));
    d.edit.y = Math.round(clamp(p.y - d.dy, -d.edit.h / 2, H - d.edit.h / 2));
    if (d.edit.type === "hide") {
      d.edit.x = clamp(d.edit.x, 0, W - d.edit.w);
      d.edit.y = clamp(d.edit.y, 0, H - d.edit.h);
    }
  } else if (d.kind === "resize") {
    d.edit.w = Math.round(clamp(p.x - d.edit.x, 8, W - d.edit.x));
    d.edit.h = Math.round(clamp(p.y - d.edit.y, 8, H - d.edit.y));
  }
  render();
});

canvas.addEventListener("pointercancel", () => { S.drag = null; render(); });

canvas.addEventListener("pointerup", () => {
  const d = S.drag;
  S.drag = null;
  if (d?.kind === "new") {
    const r = normRect(d);
    if (r.w >= 8 && r.h >= 8 && d.background) {
      checkpoint();
      S.background.region = {x: Math.round(r.x), y: Math.round(r.y), w: Math.min(S.job.width - Math.round(r.x), Math.round(r.w)), h: Math.min(S.job.height - Math.round(r.y), Math.round(r.h))};
      syncBackgroundControls(); backgroundChanged(); setMode("select");
    } else if (r.w >= 8 && r.h >= 8) {
      addEdit({ type: "hide", style: "black", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      setMode("select");
    }
  }
  render();
});

function addTextAt(x, y) {
  return addEdit({type: "text", text: "Your text", x: Math.round(x), y: Math.round(y),
    fontSize: Math.max(16, Math.round(S.job.height * 0.055)),
    color: "#ffffff", font: "sans", bg: "dark", bold: true});
}
$("placeEditBtn").onclick = () => {
  const {width, height} = S.job;
  if (S.mode === "hide") {
    addEdit({type: "hide", style: "black", x: Math.floor(width / 4), y: Math.floor(height / 3),
      w: Math.max(8, Math.floor(width / 2)), h: Math.max(8, Math.floor(height / 5))});
  } else if (S.mode === "text") addTextAt(width / 3, height / 2);
  setMode("select");
};

function setMode(mode) {
  S.mode = mode;
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "mode" }));
  $("drawCameraAreaBtn").setAttribute("aria-pressed", String(mode === "background"));
  $("drawCameraAreaBtn").textContent = mode === "background" ? "Cancel area selection" : "Draw camera area";
  show($("placeEditBtn"), mode !== "select" && mode !== "background" && !!S.job?.has_video);
  document.querySelectorAll(".tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
  $("modeHint").textContent = MODE_HINTS[mode];
  canvas.className = (mode === "hide" || mode === "background") ? "crosshair" : mode === "text" ? "text" : "";
}
function chooseSelectTool() {
  if (S.reviewing) setReview(false);
  setMode("select");
  // An explicit Select action must reveal the edits inspector, even when
  // selection mode is already active (the default after uploading).
  window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "select-tool"}));
}
document.querySelectorAll(".tool").forEach((b) => (b.onclick = () => {
  if (b.dataset.mode === "select") chooseSelectTool();
  else setMode(b.dataset.mode);
}));

// ---------- removing parts ----------
$("cutBtn").onclick = addCut;

function addCut() {
  if (!S.job || !duration()) return;
  sourcePlayer().pause();
  if (S.reviewing) setReview(false);
  setMode("select");
  window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "cut"}));
}

// Merged [start, end] ranges of everything marked for removal
function cutRanges(edits = S.edits) {
  const spans = edits.filter((e) => e.type === "cut").map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of spans) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

// Push a changed edit's times into its sidebar card and the timeline
function syncCard(e) {
  const card = document.querySelector(`.card[data-id="${e.id}"]`);
  if (card) {
    card.querySelector('[data-k="start"]').value = e.start;
    card.querySelector('[data-k="end"]').value = e.end;
    card.querySelector(".card-title").textContent = cardTitle(e);
  }
  renderTimeline();
  updateTransport();
  render();
}

// ---------- edits ----------
function addEdit(props) {
  checkpoint();
  const d = duration();
  const start = sourcePlayer().currentTime >= d - 0.05 ? 0 : +sourcePlayer().currentTime.toFixed(1);
  const e = { id: S.nextId++, start, end: +d.toFixed(2), ...props };
  if (e.type === "text") { const m = textMetrics(e); e.w = m.w; e.h = m.h; }
  S.edits.push(e);
  S.selected = e.id;
  renderList();
  render();
  updateTransport();
  return e;
}

function deleteEdit(id) {
  checkpoint();
  S.edits = S.edits.filter((e) => e.id !== id);
  if (S.selected === id) {
    S.selected = null;
    window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "selection"}));
  }
  renderList();
  render();
  updateTransport();
}

function select(id) {
  stopReviewLoop();
  S.selected = id;
  S.selectedZoom = null;
  if (typeof syncZoomSelection === "function") syncZoomSelection();
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "selection" }));
  document.querySelectorAll(".card").forEach((c) => {
    const selected = +c.dataset.id === id;
    c.classList.toggle("selected", selected);
    c.querySelector(".card-title").setAttribute("aria-expanded", String(selected));
  });
  renderTimeline();
  updateTransport();
  render();
}

function cardTitle(e) {
  const range = `${fmt(e.start)}–${fmt(e.end)}`;
  if (e.type === "cut") return `${range} (${(e.end - e.start).toFixed(1)}s)`;
  if (e.type === "text") return `${(e.text || "").split("\n")[0]} · ${range}`;
  return `${{ blur: "Blur", pixelate: "Pixelate", black: "Solid cover" }[e.style]} · ${range}`;
}

function renderList() {
  if (S.selected) window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "selection" }));
  if (typeof renderZoomSelectList === "function") renderZoomSelectList();
  const list = $("editsList");
  list.innerHTML = "";
  $("editCount").textContent = S.edits.length;
  show($("editsEmpty"), S.edits.length === 0);
  renderTimeline();

  for (const e of S.edits) {
    const tpl = $({ hide: "hideCardTpl", text: "textCardTpl", cut: "cutCardTpl" }[e.type]).content.cloneNode(true);
    const card = tpl.querySelector(".card");
    card.dataset.id = e.id;
    card.classList.toggle("selected", e.id === S.selected);
    card.querySelector(".times").append($("timesTpl").content.cloneNode(true));
    const title = card.querySelector(".card-title");
    title.textContent = cardTitle(e);
    title.setAttribute("aria-expanded", String(e.id === S.selected));
    title.onclick = () => { select(e.id); sourcePlayer().currentTime = e.start; };

    card.querySelectorAll("[data-k]").forEach((input) => {
      const k = input.dataset.k;
      if (input.type === "checkbox") input.checked = !!e[k];
      else input.value = e[k];
      input.addEventListener("focus", checkpoint);
      if (input.type === "number") input.addEventListener("change", () => { input.value = e[k]; });
      input.addEventListener("input", () => {
        let v = input.type === "checkbox" ? input.checked : input.value;
        if (input.type === "number") {
          v = parseFloat(v);
          if (Number.isNaN(v)) return;
          if (["x", "y", "w", "h"].includes(k)) {
            const axis = ["x", "w"].includes(k) ? S.job.width : S.job.height;
            if (k === "w" || k === "h") v = clamp(Math.round(v), 8, axis - e[k === "w" ? "x" : "y"]);
            else v = clamp(Math.round(v), 0, axis - (e.type === "hide" ? e[k === "x" ? "w" : "h"] : 1));
          }
          if (k === "fontSize") v = clamp(Math.round(v), 8, 400);
          if (k === "start") v = clamp(v, 0, e.end);
          if (k === "end") v = clamp(v, e.start, duration());
        }
        e[k] = v;
        title.textContent = cardTitle(e);
        renderTimeline();
        render();
        updateTransport();
      });
    });

    card.querySelectorAll("[data-now]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        checkpoint();
        const k = btn.dataset.now;
        const t = +sourcePlayer().currentTime.toFixed(2);
        if (k === "start") { e.start = Math.min(t, e.end); }
        else { e.end = Math.max(t, e.start); }
        syncCard(e);
      };
    });

    if (e.type === "cut") {
      card.querySelector(".del").textContent = "Delete cut";
      card.querySelector(".del").setAttribute("aria-label", "Delete cut");
    }
    card.querySelector(".del").onclick = (ev) => { ev.stopPropagation(); deleteEdit(e.id); };
    card.addEventListener("pointerdown", () => {
      if (S.selected === e.id) return;
      select(e.id);
      sourcePlayer().currentTime = e.start;
    });
    list.append(tpl);
  }
}

document.addEventListener("keydown", (ev) => {
  if (document.querySelector("dialog[open]")) return;
  if (!S.job || $("editorView").classList.contains("hidden")) return;
  if (ev.target.closest("input, textarea, select")) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); restoreHistory(ev.shiftKey); return; }
  if (S.reviewing) return;
  if (ev.key === " " && ev.target.closest("button, a")) return;
  if (ev.key === " ") { ev.preventDefault(); sourcePlayer().paused ? sourcePlayer().play() : sourcePlayer().pause(); }
  else if ((ev.key === "Delete" || ev.key === "Backspace") && S.selected) { ev.preventDefault(); deleteEdit(S.selected); }
  else if (ev.key === "Escape") { select(null); setMode("select"); }
  else if (ev.key.toLowerCase() === "v" && S.job.has_video) chooseSelectTool();
  else if (ev.key === "h" && S.job.has_video) setMode("hide");
  else if (ev.key === "t" && S.job.has_video) setMode("text");
  else if (ev.key === "x") addCut();
  else if (ev.key === "ArrowLeft") sourcePlayer().currentTime = Math.max(0, sourcePlayer().currentTime - (ev.shiftKey ? 1 : 1 / 30));
  else if (ev.key === "ArrowRight") sourcePlayer().currentTime = Math.min(duration(), sourcePlayer().currentTime + (ev.shiftKey ? 1 : 1 / 30));
});

// ---------- history and export review ----------
function snapshot() { return JSON.stringify({edits: S.edits, background: S.background, presenter: presenterProject(), reframe: S.reframe}); }
function checkpoint() {
  const current = snapshot();
  if (S.undo.at(-1) !== current) S.undo.push(current);
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
}
function restoreHistory(redo = false) {
  const from = redo ? S.redo : S.undo, to = redo ? S.undo : S.redo;
  while (from.length && from.at(-1) === snapshot()) from.pop();
  if (!from.length) return;
  to.push(snapshot());
  const restored = JSON.parse(from.pop());
  S.edits = restored.edits; S.background = restored.background;
  S.reframe = restored.reframe || {aspect:"original",zoom:1,focus_x:.5,focus_y:.5,sections:[]};
  syncReframeControls();
  window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail:"reframe-restore"}));
  restorePresenter(restored.presenter, true);
  syncBackgroundControls(); invalidateBackgroundPreview();
  S.selected = null;
  renderList(); render(); updateTransport();
}
$("undoBtn").onclick = () => restoreHistory();
$("redoBtn").onclick = () => restoreHistory(true);
function editSignature() {
  return JSON.stringify({ edits: S.edits.map(({ id, ...edit }) => {
    if (edit.type === "text") { delete edit.w; delete edit.h; }
    return edit;
  }), presenter: presenterProject(), background: getBackgroundSettings(), reframe: S.reframe, denoise: $("denoise").checked, strength: $("strength").value, preset: $("exportPreset").value });
}
function refreshExportState() {
  if (!S.job) return;
  if (typeof scheduleProjectSave === "function") scheduleProjectSave();
  updatePresetInfo();
  $("undoBtn").disabled = !S.undo.length;
  $("redoBtn").disabled = !S.redo.length;
  const removed = cutRanges().reduce((sum, [a, b]) => sum + b - a, 0);
  $("noisePreviewBtn").disabled = !!S.operation || !!getPresenterSettings();
  $("noisePreviewBtn").title = getPresenterSettings() ? "The noise sample uses the main recording. Export to hear noise reduction on the combined sound." : "";
  $("exportSummary").textContent = `${fmt(Math.max(0, duration() - removed))} output · ${S.edits.filter(e => e.type === "cut").length} cuts · ${S.edits.filter(e => e.type === "hide").length} masks · Noise reduction ${$("denoise").checked ? "on" : "off"}${getBackgroundSettings() && $("exportPreset").value !== "audio_only" ? " · Background " + S.background.mode : ""}`;
  const stale = S.exportSignature !== null && S.exportSignature !== editSignature();
  $("resultNote").textContent = stale ? "Edits changed. Export again to include them; this download is the previous result." : "Rendered export ready to review.";
  $("previewLabel").textContent = S.reviewing ? `${S.compareOriginal ? "Original recording" : "Rendered export"}${stale ? " · edits changed since export" : ""}` : "Edits preview · audio and background effects use processed samples";
}
$("denoise").addEventListener("change", refreshExportState);
$("strength").addEventListener("change", refreshExportState);
function setReview(reviewing) {
  stopReviewLoop();
  S.reviewing = reviewing;
  video.pause(); $("audio").pause(); $("resultVideo").pause(); $("resultAudio").pause();
  show($("stage"), !reviewing && S.job.has_video);
  show($("audio"), !reviewing && !S.job.has_video);
  show($("toolbar"), !reviewing);
  show($("transport"), !reviewing);
  show($("backToEditBtn"), reviewing);
  const audioResult = S.resultIsAudio;
  show($("resultVideo"), reviewing && !audioResult);
  show($("resultAudio"), reviewing && audioResult);
  $("editsPanel").inert = reviewing;
  show($("previewSwitch"), reviewing && !!S.resultSrc);
  $("originalPreviewBtn").setAttribute("aria-pressed", String(S.compareOriginal));
  $("exportedPreviewBtn").setAttribute("aria-pressed", String(!S.compareOriginal));
  refreshExportState();
}
$("backToEditBtn").onclick = () => setReview(false);
$("reviewBtn").onclick = () => setReview(true);
// Mirror the renderer's retained intervals, including its tiny-fragment rules.
function keptRangesForExport() {
  const ranges = cutRanges().filter(([a, b]) => b - a > 0.01);
  if (!ranges.length) return [[0, duration()]];
  const keep = []; let t = 0;
  for (const [a, b] of ranges) { if (a - t > 0.05) keep.push([t, a]); t = Math.max(t, b); }
  if (duration() - t > 0.05) keep.push([t, duration()]);
  return keep;
}
function mapComparisonTime(t, fromOriginal) {
  let elapsed = 0;
  for (const [a, b] of S.submittedRanges) {
    if (fromOriginal && t < b) return elapsed + Math.max(0, t - a);
    if (!fromOriginal && t < elapsed + b - a) return a + t - elapsed;
    elapsed += b - a;
  }
  return fromOriginal ? elapsed : (S.submittedRanges.at(-1)?.[1] || 0);
}

function setBusy(operation) {
  ++pollRevision;
  clearTimeout(S.pollTimer);
  const wasBusy = !!S.operation;
  S.operation = operation;
  $("processBtn").disabled = !!operation;
  $("detectSilenceBtn").disabled = !!operation;
  $("retryPausesBtn").disabled = !!operation;
  $("noisePreviewBtn").disabled = !!operation || !!getPresenterSettings();
  $("backgroundPreviewBtn").disabled = !!operation;
  $("backgroundControls").inert = !!operation;
  $("backgroundMode").disabled = !!operation;
  $("videosPanel").inert = !!operation;
  $("compositionPreviewPlayer").pause();
  if (operation) $("backgroundPreviewPlayer").pause();
  $("cancelProcessingBtn").disabled = false;
  $("cancelProcessingBtn").textContent = "Cancel";
  if (operation && !wasBusy) {
    S.busySince = Date.now();
    clearInterval(S.elapsedTimer);
    const update = () => { $("elapsedTime").textContent = `Elapsed ${fmt((Date.now() - S.busySince) / 1000)}`; };
    update(); S.elapsedTimer = setInterval(update, 1000);
  } else if (!operation) {
    clearInterval(S.elapsedTimer); S.elapsedTimer = null;
  }
}

function updatePresetInfo() {
  const preset = $("exportPreset").value;
  if (!S.job.has_video || preset === "audio_only") {
    $("presetInfo").textContent = "WAV · 48 kHz · uncompressed audio. Video, text, and masks are excluded; cuts and noise reduction are included.";
    return;
  }
  const limits = [LIMITS.max_output_side, LIMITS.presets?.[preset]?.max_side || (preset === "small" ? 1280 : 0)].filter(v => v > 0);
  const scale = limits.length ? Math.min(1, Math.min(...limits) / Math.max(S.job.width, S.job.height)) : 1;
  const even = n => Math.max(2, (scale < 1 ? Math.round(n / 2) : Math.floor(n / 2)) * 2);
  const w = even(S.job.width * scale), h = even(S.job.height * scale);
  $("presetInfo").textContent = `MP4 · H.264 / AAC · ${w}×${h}. Size depends on the recording.${scale < 0.8 ? " Resolution will be reduced; check small text in the export." : ""}`;
}
$("exportPreset").addEventListener("change", refreshExportState);

// ---------- processing ----------
function textToPng(e) {
  const m = textMetrics(e);
  const c = document.createElement("canvas");
  c.width = m.w; c.height = m.h;
  paintText(c.getContext("2d"), e, 0, 0);
  return c.toDataURL("image/png");
}

function buildPayload() {
  const cuts = S.edits.filter((e) => e.type === "cut").map((e) => ({ start: e.start, end: e.end }));
  const edits = S.edits.filter((e) => e.type !== "cut").map((e) => {
    const base = { type: e.type, start: e.start, end: e.end };
    if (e.type === "hide") return { ...base, style: e.style, x: e.x, y: e.y, w: e.w, h: e.h };
    return { ...base, x: Math.round(e.x), y: Math.round(e.y), image: textToPng(e) };
  });
  const strength = $("strength").value;
  return {
    presenter: getPresenterSettings(),
    reframe: S.job.has_video && $("exportPreset").value !== "audio_only" ? S.reframe : null,
    background: $("exportPreset").value !== "audio_only" ? getBackgroundSettings() : null,
    denoise: (S.job.has_audio || !!presenterProject()?.source.has_audio) && $("denoise").checked,
    atten_lim: strength ? parseInt(strength, 10) : null,
    preset: $("exportPreset").value,
    edits: S.job.has_video && $("exportPreset").value !== "audio_only" ? edits : [],
    cuts,
  };
}

async function startExport() {
  if (!validateVideos()) return;
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "export" }));
  show($("procError"), false);
  show($("procReference"), false);
  show($("recoverFileBtn"), false);
  video.pause(); $("audio").pause();
  setBusy("export");
  const id = S.job.id;
  const payload = buildPayload();
  const signature = editSignature();
  const ranges = keptRangesForExport();
  try {
    await api(`/api/jobs/${id}/process`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (S.job?.id !== id) return;
    S.exportSignature = signature;
    S.submittedRanges = ranges;
    S.resultIsAudio = $("exportPreset").value === "audio_only" || !S.job.has_video;
    show($("resultPanel"), false);
    setReview(false);
    show($("procProgress"));
    setProgress("Waiting in queue", null);
    poll();
  } catch (err) {
    if (S.job?.id !== id) return;
    // A lost response may follow a successful submission. Check before retrying.
    if (!err.status || err.status === 409) {
      S.exportSignature = signature; S.submittedRanges = ranges;
      show($("procProgress"));
      setProgress("Checking export status…", null);
      poll();
    } else procFailed(err.message, false, err.requestId);
  }
}

function setProgress(stage, pct) {
  const stageText = stage || "Working…";
  if ($("procStage").textContent !== stageText) $("procStage").textContent = stageText;
  const bar = $("procBar").parentElement;
  bar.classList.toggle("indeterminate", pct == null);
  $("procBar").style.width = pct == null ? "" : Math.round(pct * 100) + "%";
  $("procPct").textContent = pct == null ? "" : Math.round(pct * 100) + "%";
}

function poll(delay = 800) {
  const revision = ++pollRevision;
  const operation = S.operation;
  clearTimeout(S.pollTimer);
  if (!operation) return;
  const id = S.job?.id;
  S.pollTimer = setTimeout(async () => {
    if (S.job?.id !== id || S.operation !== operation || revision !== pollRevision) return;
    try {
      const j = await api(`/api/jobs/${id}`);
      if (S.job?.id !== id || S.operation !== operation || revision !== pollRevision) return;
      if (j.queued_at) S.busySince = j.queued_at * 1000;
      if (j.status === "cancelled") {
        const wasSilence = S.operation === "silence";
        const wasPreview = S.operation === "preview";
        const wasComposition = S.operation === "composition";
        const wasBackground = S.operation === "background";
        setBusy(null); show($("procProgress"), false);
        if (wasComposition) return compositionPreviewDone({error: "Combined preview stopped."});
        if (wasBackground) return backgroundPreviewDone({error: "Background preview stopped."});
        if (wasPreview) return noisePreviewDone({error: "Sample processing stopped."});
        if (wasSilence) $("silenceStatus").textContent = "Detection stopped. Your edits are unchanged.";
        else { $("procError").textContent = "Export stopped. Your recording and edits are ready to try again."; show($("procError")); }
        return;
      }
      if (j.status === "cancelling") { setProgress("Stopping…", null); poll(); return; }
      if (S.operation === "composition") {
        if (j.composition_preview) return compositionPreviewDone(j.composition_preview);
        if (!["queued", "processing", "cancelling"].includes(j.status)) return compositionPreviewDone({error: "Combined preview was not started. Please retry."});
      } else if (S.operation === "background") {
        if (j.background_preview) return backgroundPreviewDone(j.background_preview);
        if (!["queued", "processing", "cancelling"].includes(j.status)) return backgroundPreviewDone({error: "Background preview was not started. Please retry."});
      } else if (S.operation === "preview") {
        if (j.preview) return noisePreviewDone(j.preview);
        if (!["queued", "processing", "cancelling"].includes(j.status)) return noisePreviewDone({error: "Sample was not started. Please retry."});
      } else if (S.operation === "silence") {
        if (j.silence) return silenceDone(j.silence);
        if (!["queued", "processing", "cancelling"].includes(j.status)) return silenceDone({error: "Detection was not started. Please retry."});
      } else if (j.status === "done") return processDone(j);
      if (j.status === "error") return procFailed(j.error, false, j.id);
      if (j.status === "uploaded") return procFailed("Export was not started. Please try again.");
      setProgress(j.stage, j.progress);
      poll();
    } catch (err) {
      if (S.job?.id !== id || S.operation !== operation || revision !== pollRevision) return;
      if (err.status === 404) return procFailed("This file expired or the server restarted. Upload a replacement to continue.", true);
      setProgress("Connection interrupted. Reconnecting to processing…", null);
      poll(Math.min(delay * 2, 10000));
    }
  }, delay);
}

function procFailed(msg, replaceFile = false, reference = null) {
  if (S.operation === "export") window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "export" }));
  show($("recoverFileBtn"), replaceFile);
  show($("procReference"), !!reference);
  $("procReference").textContent = reference ? `Reference: ${reference}` : "";
  if (S.operation === "silence") return silenceDone({error: msg});
  if (S.operation === "composition") return compositionPreviewDone({error: msg});
  if (S.operation === "background") return backgroundPreviewDone({error: msg});
  if (S.operation === "preview") return noisePreviewDone({error: msg});
  setBusy(null);
  $("processBtn").textContent = "Retry export";
  show($("procProgress"), false);
  $("procError").textContent = msg;
  show($("procError"));
}

function processDone(job) {
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "export" }));
  setBusy(null);
  $("processBtn").textContent = "Export updated file";
  show($("procProgress"), false);
  const isAudio = job.output.endsWith(".wav");
  S.resultIsAudio = isAudio;
  const player = isAudio ? $("resultAudio") : $("resultVideo");
  show($("resultVideo"), !isAudio);
  show($("resultAudio"), isAudio);
  S.resultSrc = `/api/jobs/${S.job.id}/result?t=${Date.now()}`;
  S.compareOriginal = false;
  player.src = S.resultSrc;

  $("downloadBtn").href = `/api/jobs/${S.job.id}/result?download=1`;
  show($("resultPanel"));
  setReview(true);
  refreshExportState();
  $("stageWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// A/B toggle between the original and cleaned file at the same playback position
function comparePreview(original) {
  if (S.compareOriginal === original) { setReview(true); return; }
  const player = S.resultIsAudio ? $("resultAudio") : $("resultVideo");
  const t = mapComparisonTime(player.currentTime, S.compareOriginal);
  const playing = !player.paused;
  setReview(true);
  S.compareOriginal = original;
  player.addEventListener("loadedmetadata", () => {
    player.currentTime = Math.min(t, player.duration || t);
    if (playing) player.play().catch(() => {});
  }, { once: true });
  player.src = S.compareOriginal ? `/api/jobs/${S.job.id}/source` : S.resultSrc;
  refreshExportState();
  $("originalPreviewBtn").setAttribute("aria-pressed", String(original));
  $("exportedPreviewBtn").setAttribute("aria-pressed", String(!original));
}
$("originalPreviewBtn").onclick = () => comparePreview(true);
$("exportedPreviewBtn").onclick = () => comparePreview(false);

// ---------- reset ----------
$("newFileBtn").onclick = () => {
  $("newFileWarning").textContent = S.operation
    ? "Processing will continue, but you will leave this file and lose access to its result here. Your current edits will be discarded."
    : "Your current file, edits, and export settings will be cleared, including browser recovery. Save a project to continue later, or download your export before continuing.";
  $("newFileDialog").returnValue = "cancel";
  $("newFileDialog").showModal();
};

$("newFileDialog").addEventListener("close", () => {
  if ($("newFileDialog").returnValue === "discard") resetFile();
});

function resetFile() {
  resetProject();
  resetNoisePreview();
  resetBackground();
  resetVideos();
  clearTimeout(S.pollTimer);
  const id = S.job?.id;
  stopReviewLoop();
  video.pause(); $("audio").pause(); $("resultVideo").pause(); $("resultAudio").pause();
  S.job = null;
  S.edits = []; S.suggestions = [];
  S.selectedZoom = null;
  S.undo = []; S.redo = [];
  S.selected = null; S.selectedZoom = null; S.exportSignature = null;
  S.reframe = null;
  setBusy(null);
  $("strength").value = "18";
  video.removeAttribute("src"); video.load();
  $("audio").removeAttribute("src");
  $("resultVideo").removeAttribute("src");
  $("resultAudio").removeAttribute("src");
  $("processBtn").textContent = "Export file";
  $("processBtn").disabled = false;
  show($("editorView"), false);
  show($("newFileBtn"), false);
  show($("uploadView"));
  show($("uploadProgress"), false);
  show(dropZone);
  $("uploadBar").style.width = "0";
  $("fileInput").value = "";
  if (id) api(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
}

$("recoverFileBtn").onclick = () => $("newFileBtn").click();
window.addEventListener("online", () => { if (S.operation) poll(0); });
window.addEventListener("offline", () => {
  if (S.operation) setProgress("You are offline. Processing can continue on the server; reconnect to see its status.", null);
});

function stopReviewLoop() {
  S.reviewLoop = null;
  $("reviewSelectionBtn").setAttribute("aria-pressed", "false");
  $("reviewSelectionBtn").textContent = "Review selection";
}
$("reviewSelectionBtn").onclick = () => {
  if (S.reviewLoop) { sourcePlayer().pause(); stopReviewLoop(); return; }
  const edit = getEdit(S.selected);
  if (!edit) return;
  const start = Math.max(0, edit.start - 0.7);
  const end = Math.min(duration(), Math.min(edit.end, edit.start + 8) + 0.7);
  S.reviewLoop = {start, end};
  sourcePlayer().currentTime = start;
  $("reviewSelectionBtn").setAttribute("aria-pressed", "true");
  $("reviewSelectionBtn").textContent = "Stop review";
  sourcePlayer().play().catch(stopReviewLoop);
};
$("cancelProcessingBtn").onclick = async () => {
  if (!S.job || !S.operation) return;
  const id = S.job.id;
  $("cancelProcessingBtn").disabled = true;
  $("cancelProcessingBtn").textContent = "Stopping…";
  try { await api(`/api/jobs/${id}/cancel`, {method: "POST"}); }
  catch (error) {
    if (S.job?.id !== id) return;
    if (error.status !== 409) { $("cancelProcessingBtn").disabled = false; $("cancelProcessingBtn").textContent = "Retry cancel"; }
  }
  if (S.job?.id === id) poll(0);
};

$("processBtn").onclick = () => {
  const warnings = [];
  if ($("exportPreset").value === "audio_only" && (S.edits.some(e => e.type !== "cut") || getBackgroundSettings() || getPresenterSettings())) warnings.push("Audio-only export excludes video layers, background effects, text, and hidden areas. Audio and cuts are included.");
  if ($("exportPreset").value === "small" && S.edits.some(e => e.type === "text")) warnings.push("Small file compression can make text less readable. Review the exported result before sharing.");
  if (warnings.length) showProjectMessage("Check before exporting", warnings.join(" "), () => { $("projectDialog").close(); startExport(); }, "Export file");
  else startExport();
};
