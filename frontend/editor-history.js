"use strict";

// Undo/redo, export signatures and review state.
// ---------- history and export review ----------
let audioHistoryState = null;
function audioHistorySnapshot() {
  return {audio: getAudioSettings(), denoise: $("denoise").checked, strength: $("strength").value};
}
function snapshot() {
  return HistoryModel.capture({edits: S.edits, background: S.background, presenter: presenterProject(),
    reframe: S.reframe, ...audioHistorySnapshot()}, [...S.undo, ...S.redo]);
}
function audioSettingsChanged() {
  if (S.job && audioHistoryState) {
    const current = snapshot();
    const previous = HistoryModel.capture({...HistoryModel.read(current), ...audioHistoryState}, [...S.undo, ...S.redo]);
    if (!HistoryModel.same(previous, current)) checkpoint(previous);
  }
  refreshExportState();
}
function checkpoint(current = snapshot()) {
  // Also used directly as a focus listener; DOM events are not snapshots.
  if (!current || typeof current.json !== "string" || !Array.isArray(current.assets)) current = snapshot();
  S.redo = [];
  HistoryModel.push(S.undo, current);
}
function restoreHistory(redo = false) {
  const from = redo ? S.redo : S.undo, to = redo ? S.undo : S.redo;
  const current = snapshot();
  while (from.length && HistoryModel.same(from.at(-1), current)) from.pop();
  if (!from.length) return;
  const restored = HistoryModel.read(from.pop());
  HistoryModel.push(to, current, from);
  restorePresenter(restored.presenter, true);
  restoreAudioSettings(restored.audio);
  $("denoise").checked = restored.denoise;
  $("strength").value = restored.strength;
  editorStore.dispatch("history:restore", state => {
    state.edits = restored.edits;
    state.background = restored.background;
    state.reframe = restored.reframe || {...EditorModel.DEFAULT_REFRAME};
    state.selected = null;
  });
  syncReframeControls();
  syncBackgroundControls(); invalidateBackgroundPreview();
  renderSilenceReview();
}
$("undoBtn").onclick = () => restoreHistory();
$("redoBtn").onclick = () => restoreHistory(true);
function editSignature() {
  return JSON.stringify({ audio: getAudioSettings(), edits: S.edits.map(EditorModel.editableProperties), presenter: presenterProject(), background: getBackgroundSettings(), reframe: EditorModel.exportReframe(S.reframe, S.edits), denoise: $("denoise").checked, strength: $("strength").value, preset: $("exportPreset").value });
}
function refreshExportState() {
  if (!S.job) return;
  audioHistoryState = audioHistorySnapshot();
  if (typeof scheduleProjectSave === "function") scheduleProjectSave();
  updatePresetInfo();
  if (typeof refreshResultPreview === "function") refreshResultPreview();
  $("undoBtn").disabled = !S.undo.length;
  $("redoBtn").disabled = !S.redo.length;
  const removed = cutRanges().reduce((sum, [a, b]) => sum + b - a, 0);
  $("noisePreviewBtn").disabled = !!S.operation || !!getPresenterSettings();
  $("noisePreviewBtn").title = getPresenterSettings() ? "The noise sample uses the main recording. Export to hear noise reduction on the combined sound." : "";
  const cuts = S.edits.filter(e => e.type === "cut").length;
  const masks = S.edits.filter(e => e.type === "hide").length;
  const portions = EditorModel.sections(S.edits).length;
  const reframe = portions ? `${portions} ${portions === 1 ? "portion" : "portions"}`
    : S.reframe && (S.reframe.aspect !== "original" || S.reframe.zoom > 1.001) ? "whole video" : "off";
  const summary = [
    `${fmt(Math.max(0, duration() - removed))} output`,
    `${cuts} ${cuts === 1 ? "cut" : "cuts"}`,
    `${masks} ${masks === 1 ? "mask" : "masks"}`,
    `Reframe ${reframe}`,
    `Noise reduction ${$("denoise").checked ? "on" : "off"}`,
  ];
  if (getBackgroundSettings() && $("exportPreset").value !== "audio_only") summary.push(`Background ${S.background.mode}`);
  $("exportSummary").textContent = summary.join(" · ");
  $("originalPreviewBtn").disabled = !S.submittedRanges.length;
  const stale = S.exportSignature !== null && S.exportSignature !== editSignature();
  $("resultNote").textContent = stale ? "Edits changed. Export again to include them; this download is the previous result." : "Rendered export ready to review.";
  $("previewLabel").textContent = S.reviewing ? `${S.compareOriginal ? "Original recording" : "Rendered export"}${stale ? " · edits changed since export" : ""}` : "Editing preview";
}
$("denoise").addEventListener("change", audioSettingsChanged);
$("strength").addEventListener("change", audioSettingsChanged);
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
  return exportRules.retainedRanges(duration(), cutRanges());
}
function mapComparisonTime(t, fromOriginal) {
  return exportRules.comparisonTime(S.submittedRanges, t, fromOriginal);
}

function setBusy(operation) {
  ++pollRevision;
  clearTimeout(S.pollTimer);
  const wasBusy = !!S.operation;
  S.operation = operation;
  $("processBtn").disabled = !!operation;
  $("resultPreviewBtn").disabled = !!operation;
  $("detectSilenceBtn").disabled = !!operation;
  $("retryPausesBtn").disabled = !!operation;
  $("noisePreviewBtn").disabled = !!operation || !!getPresenterSettings();
  $("backgroundPreviewBtn").disabled = !!operation;
  $("backgroundControls").inert = !!operation;
  $("backgroundMode").disabled = !!operation;
  $("videosPanel").inert = !!operation;
  $("silenceReview").inert = !!operation;
  $("audioFinishControls").inert = !!operation || getPresenterSettings()?.sound === "muted";
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
    $("presetInfo").textContent = "WAV · 48 kHz · uncompressed audio. Video, text, and masks are excluded; cuts, noise reduction, leveling and fades are included.";
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
$("exportPreset").addEventListener("change", audioSettingsChanged);
