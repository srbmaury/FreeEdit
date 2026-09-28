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
};

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
};

// ---------- helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
};
const duration = () => S.job?.duration || video.duration || 0;
const getEdit = (id) => S.edits.find((e) => e.id === id);
const isActive = (e, t = video.currentTime) => t >= e.start && t <= e.end;
const show = (el, on = true) => el.classList.toggle("hidden", !on);

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(body?.detail || `Request failed (${res.status})`);
  return body;
}

// ---------- upload ----------
const dropZone = $("dropZone");
$("fileInput").addEventListener("change", (e) => e.target.files[0] && upload(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove("drag"); }));
dropZone.addEventListener("drop", (e) => e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]));

let LIMITS = { max_upload_mb: 0, max_duration_min: 0 };
api("/api/limits").then((l) => {
  LIMITS = l;
  const parts = [];
  if (l.max_upload_mb < 1024) parts.push(`up to ${l.max_upload_mb} MB`);
  if (l.max_duration_min) parts.push(`${l.max_duration_min} min`);
  if (parts.length) $("dzLimits").textContent = "Max " + parts.join(", ");
}).catch(() => {});

function upload(file) {
  if (LIMITS.max_upload_mb && file.size > LIMITS.max_upload_mb * 1024 * 1024) {
    return uploadFailed(`File is larger than ${LIMITS.max_upload_mb} MB.`);
  }
  show($("uploadError"), false);
  show($("uploadProgress"));
  show(dropZone, false);
  const xhr = new XMLHttpRequest();
  const fd = new FormData();
  fd.append("file", file);
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    $("uploadBar").style.width = pct + "%";
    $("uploadPct").textContent = pct < 100 ? pct + "%" : "Reading file…";
  };
  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* empty */ }
    if (xhr.status >= 200 && xhr.status < 300) openEditor(body);
    else uploadFailed(body.detail || `Upload failed (${xhr.status})`);
  };
  xhr.onerror = () => uploadFailed("Upload failed. Is the server running?");
  xhr.open("POST", "/api/upload");
  xhr.send(fd);
}

function uploadFailed(msg) {
  show($("uploadProgress"), false);
  show(dropZone);
  $("uploadError").textContent = msg;
  show($("uploadError"));
  $("fileInput").value = "";
}

// ---------- editor setup ----------
function openEditor(job) {
  S.job = job;
  S.edits = [];
  S.selected = null;
  show($("uploadView"), false);
  show($("editorView"));
  show($("newFileBtn"));
  show($("resultPanel"), false);
  show($("procError"), false);
  show($("procProgress"), false);

  const src = `/api/jobs/${job.id}/source`;
  const isVideo = job.has_video;
  show($("toolbar"), isVideo);
  show($("stage"), isVideo);
  show($("transport"), isVideo);
  show($("editsPanel"), isVideo);
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
  requestAnimationFrame(layoutStage);
}

function layoutStage() {
  if (!S.job?.has_video) return;
  const wrap = $("stageWrap");
  const maxW = wrap.clientWidth;
  const maxH = Math.max(240, window.innerHeight * 0.66);
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
video.addEventListener("seeked", render);
video.addEventListener("timeupdate", () => { updateTransport(); if (video.paused) render(); });
video.addEventListener("play", () => { $("playBtn").textContent = "❚❚"; tick(); });
video.addEventListener("pause", () => { $("playBtn").textContent = "▶"; render(); });
video.addEventListener("error", () => {
  $("fileMeta").textContent += " · This browser can't preview this format. You can still process it, but you can't place edits here. Try Safari, or upload an MP4.";
});

// While playing, jump over removed parts so the preview matches the result
function skipCuts() {
  const t = video.currentTime;
  const c = S.edits.find((e) => e.type === "cut" && t >= e.start && t < e.end - 0.02);
  if (c) video.currentTime = Math.min(c.end, duration());
}

function tick() {
  if (!video.paused) skipCuts();
  render();
  updateTransport();
  if (!video.paused && !video.ended) requestAnimationFrame(tick);
}

// ---------- transport ----------
$("playBtn").onclick = () => (video.paused ? video.play() : video.pause());
$("scrubber").addEventListener("input", (e) => {
  video.currentTime = (e.target.value / 1000) * duration();
});

function updateTransport() {
  const d = duration();
  const removed = cutRanges().reduce((sum, [a, b]) => sum + (b - a), 0);
  $("timeLabel").innerHTML = `${fmt(video.currentTime)} / ${fmt(d)}` +
    (removed > 0 ? `<br><span class="final-len">Final ${fmt(d - removed)}</span>` : "");
  if (document.activeElement !== $("scrubber")) {
    $("scrubber").value = d ? (video.currentTime / d) * 1000 : 0;
  }
  const sel = getEdit(S.selected);
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
  if (!S.job?.has_video) return;
  const W = S.job.width, H = S.job.height;
  ctx.clearRect(0, 0, W, H);
  const lw = W / (canvas.width / (window.devicePixelRatio || 1)); // 1 screen px in source px

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
  if (S.mode === "hide") {
    S.drag = { kind: "new", x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    return;
  }
  if (S.mode === "text") {
    const e = addEdit({
      type: "text", text: "Your text", x: Math.round(p.x), y: Math.round(p.y),
      fontSize: Math.max(16, Math.round(S.job.height * 0.055)),
      color: "#ffffff", font: "sans", bg: "dark", bold: true,
    });
    setMode("select");
    // Stop the canvas click from stealing focus back from the text box
    ev.preventDefault();
    const ta = document.querySelector(`.card[data-id="${e.id}"] textarea`);
    ta?.focus();
    ta?.select();
    return;
  }
  const hit = hitTest(p);
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

canvas.addEventListener("pointerup", () => {
  const d = S.drag;
  S.drag = null;
  if (d?.kind === "new") {
    const r = normRect(d);
    if (r.w >= 8 && r.h >= 8) {
      addEdit({ type: "hide", style: "blur", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
      setMode("select");
    }
  }
  render();
});

function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("modeHint").textContent = MODE_HINTS[mode];
  canvas.className = mode === "hide" ? "crosshair" : mode === "text" ? "text" : "";
}
document.querySelectorAll(".tool").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

// ---------- removing parts ----------
$("cutBtn").onclick = addCut;

function addCut() {
  const d = duration();
  if (!d) return;
  video.pause();
  const len = Math.min(3, d / 4);
  let start = video.currentTime;
  if (start + len > d) start = Math.max(0, d - len);
  addEdit({ type: "cut", start: +start.toFixed(2), end: +(start + len).toFixed(2) });
}

// Merged [start, end] ranges of everything marked for removal
function cutRanges() {
  const spans = S.edits.filter((e) => e.type === "cut").map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of spans) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}

function renderCuts() {
  const track = $("cutTrack");
  const d = duration();
  track.innerHTML = "";
  if (!d) return;
  for (const e of S.edits.filter((x) => x.type === "cut")) {
    const el = document.createElement("div");
    el.className = "cut-block" + (e.id === S.selected ? " selected" : "");
    el.style.left = (e.start / d) * 100 + "%";
    el.style.width = ((e.end - e.start) / d) * 100 + "%";
    el.title = `Remove ${fmt(e.start)}–${fmt(e.end)}. Drag the edges to adjust.`;
    el.innerHTML = '<div class="edge l"></div><div class="edge r"></div>';
    el.addEventListener("pointerdown", (ev) => startCutDrag(ev, e));
    track.append(el);
  }
}

function startCutDrag(ev, e) {
  ev.preventDefault();
  ev.stopPropagation();
  video.pause();
  const part = ev.target.classList.contains("l") ? "l" : ev.target.classList.contains("r") ? "r" : "move";
  const el = ev.currentTarget;
  el.setPointerCapture(ev.pointerId);
  const d = duration();
  const trackW = $("cutTrack").getBoundingClientRect().width;
  const x0 = ev.clientX, s0 = e.start, e0 = e.end;
  if (S.selected !== e.id) select(e.id);
  video.currentTime = part === "r" ? e.end : e.start;

  const onMove = (m) => {
    const dt = ((m.clientX - x0) / trackW) * d;
    if (part === "l") e.start = +clamp(s0 + dt, 0, e.end - 0.1).toFixed(2);
    else if (part === "r") e.end = +clamp(e0 + dt, e.start + 0.1, d).toFixed(2);
    else {
      const shift = clamp(dt, -s0, d - e0);
      e.start = +(s0 + shift).toFixed(2);
      e.end = +(e0 + shift).toFixed(2);
    }
    video.currentTime = part === "r" ? e.end : e.start;
    syncCard(e);
  };
  const onUp = () => {
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    renderCuts();
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
}

// Push a changed edit's times into its sidebar card and the timeline
function syncCard(e) {
  const card = document.querySelector(`.card[data-id="${e.id}"]`);
  if (card) {
    card.querySelector('[data-k="start"]').value = e.start;
    card.querySelector('[data-k="end"]').value = e.end;
    card.querySelector(".card-title").textContent = cardTitle(e);
  }
  renderCuts();
  updateTransport();
  render();
}

// ---------- edits ----------
function addEdit(props) {
  const d = duration();
  const start = video.currentTime >= d - 0.05 ? 0 : +video.currentTime.toFixed(1);
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
  S.edits = S.edits.filter((e) => e.id !== id);
  if (S.selected === id) S.selected = null;
  renderList();
  render();
  updateTransport();
}

function select(id) {
  S.selected = id;
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("selected", +c.dataset.id === id));
  renderCuts();
  updateTransport();
  render();
}

function cardTitle(e) {
  const range = `${fmt(e.start)}–${fmt(e.end)}`;
  if (e.type === "cut") return `${range} (${(e.end - e.start).toFixed(1)}s)`;
  if (e.type === "text") return `${(e.text || "").split("\n")[0]} · ${range}`;
  return `${{ blur: "Blur", pixelate: "Pixelate", black: "Black box" }[e.style]} · ${range}`;
}

function renderList() {
  const list = $("editsList");
  list.innerHTML = "";
  $("editCount").textContent = S.edits.length;
  show($("editsEmpty"), S.edits.length === 0);
  renderCuts();

  for (const e of S.edits) {
    const tpl = $({ hide: "hideCardTpl", text: "textCardTpl", cut: "cutCardTpl" }[e.type]).content.cloneNode(true);
    const card = tpl.querySelector(".card");
    card.dataset.id = e.id;
    card.classList.toggle("selected", e.id === S.selected);
    card.querySelector(".times").append($("timesTpl").content.cloneNode(true));
    const title = card.querySelector(".card-title");
    title.textContent = cardTitle(e);

    card.querySelectorAll("[data-k]").forEach((input) => {
      const k = input.dataset.k;
      if (input.type === "checkbox") input.checked = !!e[k];
      else input.value = e[k];
      input.addEventListener("input", () => {
        let v = input.type === "checkbox" ? input.checked : input.value;
        if (input.type === "number") {
          v = parseFloat(v);
          if (Number.isNaN(v)) return;
          if (k === "fontSize") v = clamp(Math.round(v), 8, 400);
          if (k === "start") v = clamp(v, 0, e.end);
          if (k === "end") v = clamp(v, e.start, duration());
        }
        e[k] = v;
        title.textContent = cardTitle(e);
        renderCuts();
        render();
        updateTransport();
      });
    });

    card.querySelectorAll("[data-now]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        const k = btn.dataset.now;
        const t = +video.currentTime.toFixed(2);
        if (k === "start") { e.start = Math.min(t, e.end); }
        else { e.end = Math.max(t, e.start); }
        syncCard(e);
      };
    });

    card.querySelector(".del").onclick = (ev) => { ev.stopPropagation(); deleteEdit(e.id); };
    card.addEventListener("mousedown", () => {
      if (S.selected === e.id) return;
      select(e.id);
      if (!isActive(e)) video.currentTime = e.start;
    });
    list.append(tpl);
  }
}

document.addEventListener("keydown", (ev) => {
  if (!S.job?.has_video || $("editorView").classList.contains("hidden")) return;
  if (ev.target.closest("input, textarea, select")) return;
  if (ev.key === " ") { ev.preventDefault(); video.paused ? video.play() : video.pause(); }
  else if ((ev.key === "Delete" || ev.key === "Backspace") && S.selected) { ev.preventDefault(); deleteEdit(S.selected); }
  else if (ev.key === "Escape") { select(null); setMode("select"); }
  else if (ev.key === "v") setMode("select");
  else if (ev.key === "h") setMode("hide");
  else if (ev.key === "t") setMode("text");
  else if (ev.key === "x") addCut();
  else if (ev.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - (ev.shiftKey ? 1 : 1 / 30));
  else if (ev.key === "ArrowRight") video.currentTime = Math.min(duration(), video.currentTime + (ev.shiftKey ? 1 : 1 / 30));
});

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
    denoise: S.job.has_audio && $("denoise").checked,
    atten_lim: strength ? parseInt(strength, 10) : null,
    edits: S.job.has_video ? edits : [],
    cuts: S.job.has_video ? cuts : [],
  };
}

$("processBtn").onclick = async () => {
  show($("procError"), false);
  show($("resultPanel"), false);
  video.pause();
  $("processBtn").disabled = true;
  try {
    await api(`/api/jobs/${S.job.id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    show($("procProgress"));
    setProgress("Waiting in queue", null);
    poll();
  } catch (err) {
    procFailed(err.message);
  }
};

function setProgress(stage, pct) {
  $("procStage").textContent = stage || "Working…";
  const bar = $("procBar").parentElement;
  bar.classList.toggle("indeterminate", pct == null);
  $("procBar").style.width = pct == null ? "" : Math.round(pct * 100) + "%";
  $("procPct").textContent = pct == null ? "" : Math.round(pct * 100) + "%";
}

function poll() {
  clearTimeout(S.pollTimer);
  S.pollTimer = setTimeout(async () => {
    if (!S.job) return;
    try {
      const j = await api(`/api/jobs/${S.job.id}`);
      if (j.status === "done") return processDone(j);
      if (j.status === "error") return procFailed(j.error);
      setProgress(j.stage, j.progress);
      poll();
    } catch (err) {
      procFailed(err.message);
    }
  }, 800);
}

function procFailed(msg) {
  $("processBtn").disabled = false;
  show($("procProgress"), false);
  $("procError").textContent = msg;
  show($("procError"));
}

function processDone(job) {
  $("processBtn").disabled = false;
  $("processBtn").textContent = "Process again";
  show($("procProgress"), false);
  const isAudio = job.output.endsWith(".wav");
  const player = isAudio ? $("resultAudio") : $("resultVideo");
  show($("resultVideo"), !isAudio);
  show($("resultAudio"), isAudio);
  S.resultSrc = `/api/jobs/${S.job.id}/result?t=${Date.now()}`;
  S.compareOriginal = false;
  player.src = S.resultSrc;
  $("compareBtn").textContent = "Play original";
  $("downloadBtn").href = `/api/jobs/${S.job.id}/result?download=1`;
  show($("resultPanel"));
  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// A/B toggle between the original and cleaned file at the same playback position
$("compareBtn").onclick = () => {
  const player = $("resultVideo").classList.contains("hidden") ? $("resultAudio") : $("resultVideo");
  const t = player.currentTime;
  const playing = !player.paused;
  S.compareOriginal = !S.compareOriginal;
  player.src = S.compareOriginal ? `/api/jobs/${S.job.id}/source` : S.resultSrc;
  $("compareBtn").textContent = S.compareOriginal ? "Play cleaned" : "Play original";
  player.addEventListener("loadedmetadata", () => {
    player.currentTime = t;
    if (playing) player.play();
  }, { once: true });
};

// ---------- reset ----------
$("newFileBtn").onclick = async () => {
  if (S.edits.length && !confirm("Start over with a new file? Your edits will be lost.")) return;
  clearTimeout(S.pollTimer);
  const id = S.job?.id;
  S.job = null;
  video.removeAttribute("src"); video.load();
  $("audio").removeAttribute("src");
  $("resultVideo").removeAttribute("src");
  $("resultAudio").removeAttribute("src");
  $("processBtn").textContent = "Process";
  $("processBtn").disabled = false;
  show($("editorView"), false);
  show($("newFileBtn"), false);
  show($("uploadView"));
  show($("uploadProgress"), false);
  show(dropZone);
  $("uploadBar").style.width = "0";
  $("fileInput").value = "";
  if (id) api(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
};
