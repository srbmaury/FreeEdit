"use strict";

// Undo/redo, payload projection, export queue, processing and review.
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
  S.reframe = restored.reframe || {...EditorModel.DEFAULT_REFRAME};
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
  }), presenter: presenterProject(), background: getBackgroundSettings(), reframe: EditorModel.exportReframe(S.reframe, S.edits), denoise: $("denoise").checked, strength: $("strength").value, preset: $("exportPreset").value });
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
  $("exportSummary").textContent = `${fmt(Math.max(0, duration() - removed))} output · ${S.edits.filter(e => e.type === "cut").length} cuts · ${S.edits.filter(e => e.type === "hide").length} masks · Reframe ${EditorModel.sections(S.edits).length ? EditorModel.sections(S.edits).length + (EditorModel.sections(S.edits).length === 1 ? " portion" : " portions") : S.reframe && (S.reframe.aspect !== "original" || S.reframe.zoom > 1.001) ? "whole video" : "off"} · Noise reduction ${$("denoise").checked ? "on" : "off"}${getBackgroundSettings() && $("exportPreset").value !== "audio_only" ? " · Background " + S.background.mode : ""}`;
  const stale = S.exportSignature !== null && S.exportSignature !== editSignature();
  $("resultNote").textContent = stale ? "Edits changed. Export again to include them; this download is the previous result." : "Rendered export ready to review.";
  $("previewLabel").textContent = S.reviewing ? `${S.compareOriginal ? "Original recording" : "Rendered export"}${stale ? " · edits changed since export" : ""}` : "Editing preview";
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
  const crop = freeeditCropRect(even(S.job.width * scale), even(S.job.height * scale),
    {...S.reframe, zoom: EditorModel.sections(S.edits).length ? 1 : S.reframe.zoom});
  const w = crop.w, h = crop.h;
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
  const edits = S.edits.filter((e) => e.type === "hide" || e.type === "text").map((e) => {
    const base = { type: e.type, start: e.start, end: e.end };
    if (e.type === "hide") return { ...base, style: e.style, x: e.x, y: e.y, w: e.w, h: e.h };
    return { ...base, x: Math.round(e.x), y: Math.round(e.y), image: textToPng(e) };
  });
  const strength = $("strength").value;
  return {
    presenter: getPresenterSettings(),
    reframe: S.job.has_video && $("exportPreset").value !== "audio_only" ? EditorModel.exportReframe(S.reframe, S.edits) : null,
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
  S.undo = []; S.redo = [];
  S.selected = null; S.exportSignature = null;
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
