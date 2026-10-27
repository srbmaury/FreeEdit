"use strict";

// FFmpeg payload projection, processing, polling and rendered preview.
// ---------- processing ----------
function textToPng(e) {
  const m = textMetrics(e);
  const c = document.createElement("canvas");
  c.width = m.w; c.height = m.h;
  paintText(c.getContext("2d"), e, 0, 0);
  return c.toDataURL("image/png");
}

function buildPayload() {
  return exportPayloadRules.buildExportPayload({
    job: S.job, edits: S.edits, audio: getAudioSettings(),
    presenter: getPresenterSettings(), presenterHasAudio: !!presenterProject()?.source.has_audio,
    framing: S.framing, reframe: S.reframe, background: getBackgroundSettings(),
    denoise: $("denoise").checked, strength: $("strength").value, preset: $("exportPreset").value,
  }, {exportReframe: EditorModel.exportReframe, textToPng, annotationPayload});
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
  try { await prepareAnnotationAssets(); }
  catch(error) { procFailed(error.message); return; }
  const payload = buildPayload();
  const signature = editSignature();
  const ranges = keptRangesForExport();
  try {
    const submission = await api(`/api/jobs/${id}/process`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (S.job?.id !== id) return;
    S.exportSignature = signature;
    S.submittedRanges = ranges;
    S.exportSubmission = {jobId: id, submissionId: submission.submission_id, signature, ranges};
    saveRecovery();
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
      S.exportSignature = ""; S.submittedRanges = []; S.exportSubmission = null;
      saveRecovery();
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
        if (S.operation === "result-preview") return resultPreviewDone({error: "Preview stopped. Your edits are unchanged."});
        const wasSilence = S.operation === "silence";
        const wasPreview = S.operation === "preview";
        const wasComposition = S.operation === "composition";
        const wasBackground = S.operation === "background";
        setBusy(null); show($("procProgress"), false);
        if (wasComposition) return compositionPreviewDone({error: "Combined preview stopped."});
        if (wasBackground) return backgroundPreviewDone({error: "Background preview stopped."});
        if (wasPreview) return noisePreviewDone({error: "Sample processing stopped."});
        if (wasSilence) return silenceDone({error: "Detection stopped. Your edits are unchanged."});
        else { $("procError").textContent = "Export stopped. Your recording and edits are ready to try again."; show($("procError")); }
        return;
      }
      if (j.status === "cancelling") { setProgress("Stopping…", null); poll(); return; }
      if (S.operation === "result-preview") {
        if (j.result_preview) return resultPreviewDone(j.result_preview);
        if (!["queued", "processing", "cancelling"].includes(j.status)) return resultPreviewDone({error: "Preview was not started. Please retry."});
      } else if (S.operation === "composition") {
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
  if (S.operation === "result-preview") return resultPreviewDone({error: msg});
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
