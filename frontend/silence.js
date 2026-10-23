"use strict";

$("detectSilenceBtn").onclick = async () => {
  const inputs = [$("silenceThreshold"), $("silenceDuration"), $("silencePadding")];
  if (!inputs.every(input => input.reportValidity())) return;
  const id = S.job.id;
  setBusy("silence");
  show($("retryPausesBtn"), false);
  S.silenceSettings = {threshold_db: +inputs[0].value, min_duration: +inputs[1].value, padding: +inputs[2].value};
  $("silenceStatus").textContent = "Detecting pauses…";
  show($("procError"), false);
  show($("procProgress"));
  setProgress("Waiting to detect pauses", null);
  try {
    await api(`/api/jobs/${id}/silence`, {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(S.silenceSettings),
    });
    if (S.job?.id === id) poll();
  } catch (error) {
    if (S.job?.id !== id) return;
    if (!error.status) poll();
    else silenceDone({error: error.message});
  }
};

function silenceDone(result) {
  setBusy(null);
  show($("procProgress"), false);
  if (result.error) {
    $("silenceStatus").textContent = result.error;
    return;
  }
  S.suggestions = result.segments.map(segment => ({...segment, selected: false}));
  const settings = result.settings || S.silenceSettings;
  const threshold = settings.threshold_db;
  const nextThreshold = Math.min(-15, threshold + 5);
  const noResults = S.suggestions.length === 0;
  show($("retryPausesBtn"), noResults && nextThreshold > threshold);
  $("retryPausesBtn").textContent = `Try ${nextThreshold} dB`;
  $("retryPausesBtn").onclick = () => {
    $("silenceThreshold").value = nextThreshold;
    $("detectSilenceBtn").click();
  };
  $("silenceStatus").textContent = noResults
    ? `No quiet sections met ${threshold} dB for ${settings.min_duration} seconds. Background noise can keep pauses above this level. Try a higher threshold and listen before applying cuts.`
    : `${S.suggestions.length} suggested pause${S.suggestions.length === 1 ? "" : "s"} at ${threshold} dB. Listen before choosing cuts.${result.truncated ? " Showing the first 100; increase minimum pause length to find fewer." : ""}`;
  renderSilenceReview();
}

function renderSilenceReview() {
  show($("silenceReview"), S.suggestions.length > 0);
  const list = $("silenceList");
  list.replaceChildren();
  S.suggestions.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "pause-row";
    const label = document.createElement("label");
    label.className = "check";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = segment.selected;
    check.onchange = () => { segment.selected = check.checked; updateSilenceSelection(); };
    label.append(check, ` ${fmt(segment.start)}–${fmt(segment.end)}`);
    const preview = document.createElement("button");
    preview.className = "mini";
    preview.textContent = "Listen";
    preview.setAttribute("aria-label", `Listen around pause ${index + 1}`);
    preview.onclick = () => {
      setReview(false);
      const player = sourcePlayer();
      player.currentTime = Math.max(0, segment.start - 0.5);
      S.auditionUntil = Math.min(duration(), segment.end + 0.5);
      player.play().catch(() => {});
    };
    row.append(label, preview);
    list.append(row);
  });
  updateSilenceSelection();
}

function updateSilenceSelection() {
  const selected = S.suggestions.filter(s => s.selected);
  const length = ranges => ranges.reduce((sum, [a, b]) => sum + b - a, 0);
  const saved = length(cutRanges([...S.edits, ...selected.map(s => ({...s, type: "cut"}))])) - length(cutRanges());
  $("silenceSaved").textContent = `${selected.length} selected · ${saved.toFixed(1)} additional seconds saved.`;
  $("applyPausesBtn").disabled = selected.length === 0;
  renderTimeline();
}

$("selectPausesBtn").onclick = () => { S.suggestions.forEach(s => s.selected = true); renderSilenceReview(); };
$("clearPausesBtn").onclick = () => { S.suggestions.forEach(s => s.selected = false); renderSilenceReview(); };
$("applyPausesBtn").onclick = () => {
  const selected = S.suggestions.filter(s => s.selected);
  if (selected.length + S.edits.filter(e => e.type === "cut").length > 100) {
    $("silenceStatus").textContent = "Keep at most 100 cuts. Select fewer pauses or remove existing cuts.";
    return;
  }
  checkpoint();
  S.edits.push(...selected.map(({start, end}) => ({id: S.nextId++, type: "cut", start, end})));
  S.suggestions = S.suggestions.filter(s => !s.selected);
  S.selected = S.edits.at(-1)?.id;
  setReview(false);
  renderSilenceReview(); renderList(); render(); updateTransport();
  $("silenceStatus").textContent = "Selected pauses marked for removal. Adjust them in Edits, or choose Undo to keep them.";
};
