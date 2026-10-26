"use strict";

// A bounded render is separate from the downloadable full export.
let resultSample = null;
let pendingResultSample = null;
let previewSubmission = null;
let rangeOriginal = false;
function getAudioSettings() {
  return {level_speech: $("levelSpeech").checked,
    fade_in: clamp(Number($("audioFadeIn").value) || 0, 0, 5),
    fade_out: clamp(Number($("audioFadeOut").value) || 0, 0, 5)};
}
function restoreAudioSettings(settings = {}) {
  $("levelSpeech").checked = !!settings.level_speech;
  $("audioFadeIn").value = settings.fade_in || 0;
  $("audioFadeOut").value = settings.fade_out || 0;
}
function resetResultPreview() {
  resultSample = null; pendingResultSample = null; previewSubmission = null;
  $("resultPreviewDialog").close();
  for (const player of [$("rangePreviewVideo"), $("rangePreviewAudio")]) {
    player.pause(); player.removeAttribute("src"); player.load();
  }
  $("resultPreviewStatus").textContent = "Renders up to 15 seconds from your selection or playhead, using the export settings.";
}
function refreshResultPreview() {
  const stale = resultSample && resultSample.signature !== editSignature();
  if (resultSample && !S.operation) $("resultPreviewStatus").textContent = stale
    ? "Edits changed. Preview again to include them."
    : `Preview ready · ${fmt(resultSample.start)}–${fmt(resultSample.end)} of original timing.`;
  $("audioFinishControls").inert = !!S.operation || getPresenterSettings()?.sound === "muted";
}
for (const id of ["levelSpeech", "audioFadeIn", "audioFadeOut"]) {
  $(id).addEventListener("change", audioSettingsChanged);
}
$("resultPreviewBtn").onclick = async () => {
  if (!S.job || S.operation || !validateVideos()) return;
  if (S.reviewing) setReview(false);
  sourcePlayer().pause();
  $("noiseSamplePlayer").pause();
  const selected = rangeSelection.range;
  const start = selected ? selected.start : Math.min(sourcePlayer().currentTime || 0, Math.max(0, duration() - .1));
  const end = Math.min(duration(), selected?.end ?? start + 15, start + 15);
  const id = S.job.id;
  resultSample = null;
  pendingResultSample = {signature: editSignature(), id, submissionId: null};
  previewSubmission = pendingResultSample;
  saveRecovery();
  window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail:"export"}));
  setBusy("result-preview");
  show($("procError"), false); show($("procProgress"));
  $("resultPreviewStatus").textContent = `Rendering ${fmt(start)}–${fmt(end)}${selected && selected.end > end ? " · first 15 seconds of selection" : ""}…`;
  setProgress("Preparing result preview…", null);
  try {
    const response = await api(`/api/jobs/${id}/result-preview`, {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...buildPayload(), start, end})});
    if (S.job?.id === id) {
      previewSubmission.submissionId = response.submission_id;
      saveRecovery();
      poll();
    }
  } catch (error) {
    if (S.job?.id !== id) return;
    if (!error.status || error.status === 409) {
      if (pendingResultSample) pendingResultSample.signature = "";
      saveRecovery();
      poll();
    }
    else resultPreviewDone({error:error.message});
  }
};
function restoreResultPreviewSubmission(saved, job) {
  const reconnecting = job.operation === "result-preview" && ["queued", "processing", "cancelling"].includes(job.status);
  previewSubmission = exportRules.recoverPreviewSubmission(saved, job) ||
    (reconnecting || saved?.id === job.id ? {id: job.id, signature: "", submissionId: null} : null);
  if (job.operation === "result-preview") {
    // Unknown admission identity stays stale, but the returned sample remains reviewable.
    pendingResultSample = previewSubmission;
  }
}
function resultPreviewDone(sample) {
  setBusy(null); show($("procProgress"), false);
  if (sample.error) { $("resultPreviewStatus").textContent = sample.error; pendingResultSample = null; return; }
  if (!pendingResultSample || pendingResultSample.id !== S.job?.id) return;
  resultSample = {...sample, signature:pendingResultSample.signature, id:S.job.id};
  pendingResultSample = null;
  $("resultPreviewStatus").textContent = `Preview ready · ${fmt(sample.start)}–${fmt(sample.end)} of original timing.`;
  const outputLength = sample.ranges.reduce((total, [a, b]) => total + b - a, 0);
  const settingsNote = resultSample.signature === editSignature() ? "Export settings"
    : resultSample.signature ? "Edits changed since preview" : "Preview settings could not be verified";
  $("resultPreviewDescription").textContent = `${fmt(sample.start)}–${fmt(sample.end)} source · ${fmt(outputLength)} result · ${settingsNote}`;
  show($("rangePreviewVideo"), sample.file.endsWith(".mp4"));
  show($("rangePreviewAudio"), sample.file.endsWith(".wav"));
  rangeOriginal = false;
  switchResultRange(false, false);
  refreshResultPreview();
  $("resultPreviewDialog").showModal();
}
function rangePlayer() { return resultSample.file.endsWith(".wav") ? $("rangePreviewAudio") : $("rangePreviewVideo"); }
function switchResultRange(original, preserve = true) {
  if (!resultSample) return;
  const player = rangePlayer();
  show($("rangePreviewError"), false);
  let sourceTime = resultSample.start;
  if (preserve) {
    if (rangeOriginal) sourceTime = player.currentTime;
    else {
      let elapsed = 0;
      for (const [a,b] of resultSample.ranges) {
        sourceTime = Math.min(b, a + Math.max(0, player.currentTime - elapsed));
        if (player.currentTime <= elapsed + b - a) break;
        elapsed += b-a;
      }
    }
  }
  let target = sourceTime;
  if (!original) {
    target = 0;
    for (const [a,b] of resultSample.ranges) {
      target += clamp(sourceTime-a, 0, b-a);
      if (sourceTime < b) break;
    }
  }
  const playing = preserve && !player.paused;
  player.pause(); rangeOriginal = original;
  player.onloadedmetadata = () => {
    player.currentTime = Math.min(target, player.duration || target);
    if (playing) player.play().catch(() => {});
  };
  player.src = `/api/jobs/${resultSample.id}/${original ? "source" : "result-preview"}?t=${Date.now()}`;
  $("rangeOriginalBtn").setAttribute("aria-pressed", String(original));
  $("rangeResultBtn").setAttribute("aria-pressed", String(!original));
}
$("rangeOriginalBtn").onclick = () => switchResultRange(true);
$("rangeResultBtn").onclick = () => switchResultRange(false);
$("resultPreviewDialog").addEventListener("close", () => {
  $("rangePreviewVideo").pause(); $("rangePreviewAudio").pause();
});
for (const player of [$("rangePreviewVideo"), $("rangePreviewAudio")]) {
  player.addEventListener("error", () => {
    if (!resultSample || !player.getAttribute("src") || !$("resultPreviewDialog").open) return;
    $("rangePreviewError").textContent = rangeOriginal
      ? "This browser cannot play the original recording. Choose Result to review the processed sample."
      : "This preview could not be played. Return to editing and render a new preview, or try Balanced MP4 output.";
    show($("rangePreviewError"));
  });
  player.addEventListener("timeupdate", () => {
    if (rangeOriginal && resultSample && player.currentTime >= resultSample.end) player.pause();
  });
  player.addEventListener("seeking", () => {
    if (rangeOriginal && resultSample && (player.currentTime < resultSample.start || player.currentTime > resultSample.end)) {
      player.currentTime = clamp(player.currentTime, resultSample.start, resultSample.end);
    }
  });
}
