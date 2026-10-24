"use strict";

// Undo/redo, export signatures and review state.
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
  restorePresenter(restored.presenter, true);
  editorStore.dispatch("history:restore", state => {
    state.edits = restored.edits;
    state.background = restored.background;
    state.reframe = restored.reframe || {...EditorModel.DEFAULT_REFRAME};
    state.selected = null;
  });
  syncReframeControls();
  syncBackgroundControls(); invalidateBackgroundPreview();
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

