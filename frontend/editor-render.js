"use strict";

// Canvas rendering, hit-testing and pointer interactions.
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
  // Called on every animation frame during playback. Export signatures,
  // project autosaves and inspector labels are invalidated by actual
  // document/settings mutations, never by a frame paint.
  $("toolbar").dataset.mode = S.mode;
  $("toolbar").classList.toggle("has-edits", S.edits.length > 0 || !!EditorModel.sections(S.edits).length || S.reframe?.zoom > 1 || S.reframe?.aspect && S.reframe.aspect !== "original");
  if (!S.job?.has_video) return;
  const W = S.job.width, H = S.job.height;
  ctx.clearRect(0, 0, W, H);
  const lw = W / (canvas.width / (window.devicePixelRatio || 1)); // 1 screen px in source px

  drawPresenter(ctx);

  for (const e of S.edits) {
    if (e.type !== "hide" && e.type !== "text") continue;
    if (!isActive(e)) {
      if (e.type === "text") { const m = textMetrics(e); e.w = m.w; e.h = m.h; }
      continue;
    }
    if (e.type === "hide") paintHide(e);
    else paintText(ctx, e, e.x, e.y);
  }

  const sel = getEdit(S.selected);
  if (sel && (sel.type === "hide" || sel.type === "text")) {
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
  // The live reframe compositor displays the actual zoomed picture rather
  // than painting a dashed crop guide into the export-style overlay.

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
    const active = reframeGuideSection() || S.reframe && (S.reframe.aspect !== "original" || S.reframe.zoom > 1 || EditorModel.sections(S.edits).length);
    updateReframePreview(active ? freeeditCropRect(W, H, freeeditReframeAt(EditorModel.exportReframe(S.reframe, S.edits), video.currentTime)) : null);
  }
}

function normRect(d) {
  const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
  return { x, y, w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
}

// ---------- canvas interaction ----------
function toSource(ev) {
  const r = canvas.getBoundingClientRect();
  const crop = reframeGuideSection() ? {x: 0, y: 0, w: S.job.width, h: S.job.height}
    : freeeditCropRect(S.job.width, S.job.height, freeeditReframeAt(EditorModel.exportReframe(S.reframe, S.edits), video.currentTime));
  return {
    x: crop.x + clamp((ev.clientX - r.left) / r.width, 0, 1) * crop.w,
    y: crop.y + clamp((ev.clientY - r.top) / r.height, 0, 1) * crop.h,
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
  if (sel && (sel.type === "hide" || sel.type === "text") && inside(sel)) return { edit: sel, part: "move" };
  for (let i = S.edits.length - 1; i >= 0; i--) {
    const e = S.edits[i];
    if ((e.type === "hide" || e.type === "text") && isActive(e) && inside(e)) return { edit: e, part: "move" };
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
  if (d?.kind === "move" || d?.kind === "resize") {
    editorStore.dispatch("edit:drag", () => {});
  }
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
