"use strict";

// Session reset and user interaction with the processing controls.
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
  resetResultPreview();
  restoreAudioSettings();
  resetBackground();
  resetVideos();
  clearTimeout(S.pollTimer);
  const id = S.job?.id;
  stopReviewLoop();
  video.pause(); $("audio").pause(); $("resultVideo").pause(); $("resultAudio").pause();
  S.job = null;
  S.edits = []; S.suggestions = [];
  S.undo = []; S.redo = [];
  S.selected = null; S.exportSignature = null; S.exportSubmission = null;
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
