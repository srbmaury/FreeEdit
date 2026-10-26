"use strict";

// Keep one review page plus selected rows from other pages in memory.
const pauseReview = {analysisId: null, total: 0, offset: 0, limit: 25, indices: new Set(), revision: 0, loading: false};
function pauseCovered(segment) {
  return cutRanges().some(([a, b]) => a <= segment.start && b >= segment.end);
}
function pauseCapacity() { return Math.max(0, 100 - S.edits.filter(edit => edit.type === "cut").length); }
function selectedPauses() { return S.suggestions.filter(segment => segment.selected && !pauseCovered(segment)); }
function setPauseSelection(segment, selected) {
  if (S.operation || pauseReview.loading || pauseCovered(segment)) return false;
  if (selected && !segment.selected && selectedPauses().length >= pauseCapacity()) {
    $("silenceStatus").textContent = "The 100-cut limit is reached by existing cuts and selected pauses. Clear some selections to choose different pauses.";
    return false;
  }
  segment.selected = selected;
  return true;
}


$("detectSilenceBtn").onclick = async () => {
  if (!S.job || S.operation || pauseReview.loading) return;
  ++pauseReview.revision;
  const inputs = [$("silenceThreshold"), $("silenceDuration"), $("silencePadding"), $("silenceFrom"), $("silenceTo")];
  if (!inputs.every(input => input.reportValidity())) return;
  if (+inputs[4].value <= +inputs[3].value) {
    $("silenceStatus").textContent = "Analysis end must be after its start.";
    return;
  }
  const id = S.job.id;
  setBusy("silence");
  show($("retryPausesBtn"), false);
  S.silenceSettings = {threshold_db: +inputs[0].value, min_duration: +inputs[1].value, padding: +inputs[2].value, start: +inputs[3].value, end: +inputs[4].value};
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
    pauseReview.analysisId = null;
    updatePausePager();
    return;
  }
  Object.assign(pauseReview, {analysisId: result.analysis_id, total: result.total,
    offset: 0, limit: result.limit, indices: new Set(result.segments.map(segment => segment.index))});
  S.suggestions = result.segments.map(segment => ({...segment, selected: false}));
  const settings = result.settings || S.silenceSettings;
  const threshold = settings.threshold_db;
  const nextThreshold = Math.min(-15, threshold + 5);
  const noResults = S.suggestions.length === 0;
  show($("retryPausesBtn"), noResults && nextThreshold > threshold);
  $("retryPausesBtn").textContent = `Try ${nextThreshold} dB`;
  $("retryPausesBtn").onclick = () => {
    $("silenceThreshold").value = nextThreshold;
    $("pausePreset").value = "custom";
    $("detectSilenceBtn").click();
  };
  $("silenceStatus").textContent = noResults
    ? `No quiet sections met ${threshold} dB for ${settings.min_duration} seconds. Background noise can keep pauses above this level. Try a higher threshold and listen before applying cuts.`
    : `${result.total} suggested pause${result.total === 1 ? "" : "s"} in ${fmt(result.range?.start || 0)}–${fmt(result.range?.end ?? duration())}. Review 25 at a time; selections stay selected between pages.`;
  renderSilenceReview();
}

function renderSilenceReview() {
  show($("silenceReview"), pauseReview.total > 0);
  const list = $("silenceList");
  list.replaceChildren();
  S.suggestions.filter(segment => pauseReview.indices.has(segment.index)).forEach(segment => {
    const row = document.createElement("div");
    row.className = "pause-row";
    const label = document.createElement("label");
    label.className = "check";
    const check = document.createElement("input");
    check.type = "checkbox";
    const covered = pauseCovered(segment);
    if (covered) segment.selected = false;
    check.checked = segment.selected;
    check.disabled = covered;
    check.onchange = () => {
      setPauseSelection(segment, check.checked);
      check.checked = segment.selected;
      updateSilenceSelection();
    };
    label.append(check, ` ${fmt(segment.start)}–${fmt(segment.end)}`);
    const preview = document.createElement("button");
    preview.className = "mini";
    preview.textContent = "Listen";
    preview.setAttribute("aria-label", `Listen around pause ${segment.index + 1}`);
    preview.onclick = () => {
      setReview(false);
      const player = sourcePlayer();
      player.currentTime = Math.max(0, segment.start - 0.5);
      S.auditionUntil = Math.min(duration(), segment.end + 0.5);
      player.play().catch(() => {});
    };
    row.append(label);
    if (covered) {
      const note = document.createElement("span");
      note.className = "pause-covered"; note.textContent = "Already cut";
      row.append(note);
    }
    row.append(preview);
    list.append(row);
  });
  updateSilenceSelection();
  updatePausePager();
}

function updateSilenceSelection() {
  const selected = selectedPauses();
  const length = ranges => ranges.reduce((sum, [a, b]) => sum + b - a, 0);
  const saved = length(cutRanges([...S.edits, ...selected.map(s => ({...s, type: "cut"}))])) - length(cutRanges());
  $("silenceSaved").textContent = `${selected.length} selected across pages · ${saved.toFixed(1)} seconds saved · ${Math.max(0, pauseCapacity() - selected.length)} cuts available.`;
  $("applyPausesBtn").disabled = selected.length === 0 || selected.length > pauseCapacity();
  renderTimeline();
}

$("selectPausesBtn").onclick = () => {
  let available = pauseCapacity() - selectedPauses().length;
  for (const segment of S.suggestions) {
    if (available <= 0) break;
    if (pauseReview.indices.has(segment.index) && !segment.selected && !pauseCovered(segment)) {
      segment.selected = true; --available;
    }
  }
  renderSilenceReview();
};
$("clearPausesBtn").onclick = () => { S.suggestions.forEach(s => s.selected = false); renderSilenceReview(); };
$("applyPausesBtn").onclick = () => {
  if (S.operation || pauseReview.loading) return;
  const selected = selectedPauses();
  if (selected.length + S.edits.filter(e => e.type === "cut").length > 100) {
    $("silenceStatus").textContent = "Keep at most 100 cuts. Select fewer pauses or remove existing cuts.";
    return;
  }
  if (!admitEdits(selected.map(segment => ({...segment, type: "cut"})))) return;
  const added = selected.map(({start,end}) => ({id:S.nextId++,type:"cut",start,end}));
  commitEdit("pauses:apply", state => {
    state.edits.push(...added);
    state.suggestions = state.suggestions.filter(item => pauseReview.indices.has(item.index)).map(item => ({...item, selected: false}));
    state.selected = added.at(-1)?.id ?? state.selected;
  });
  setReview(false);
  renderSilenceReview();
  $("silenceStatus").textContent = "Selected pauses marked for removal. Adjust them in Edits, or choose Undo to keep them.";
};

const pausePresets = {
  conservative: [-40, 0.8, 0.2],
  balanced: [-35, 0.7, 0.2],
  more: [-30, 0.5, 0.15],
};
$("pausePreset").onchange = () => {
  const values = pausePresets[$("pausePreset").value];
  if (values) ["silenceThreshold", "silenceDuration", "silencePadding"].forEach((id, i) => $(id).value = values[i]);
};
["silenceThreshold", "silenceDuration", "silencePadding"].forEach(id => {
  $(id).addEventListener("input", () => { $("pausePreset").value = "custom"; });
});


function resetSilenceRange(resetResults = true) {
  if (resetResults) {
    ++pauseReview.revision;
    Object.assign(pauseReview, {analysisId: null, total: 0, offset: 0, limit: 25, indices: new Set(), loading: false});
  }
  $("silenceRangeHint").textContent = "Analyze the whole recording, or choose a smaller range for long files.";
  $("silenceFrom").value = "0";
  $("silenceTo").value = duration().toFixed(3);
  $("silenceFrom").max = String(duration());
  $("silenceTo").max = String(duration());
}
$("silenceSelectedRangeBtn").onclick = () => {
  const selected = rangeSelection.range;
  if (!selected) {
    $("silenceRangeHint").textContent = "Drag across the waveform or timeline ruler first, then choose Use selected range.";
    return;
  }
  $("silenceFrom").value = selected.start.toFixed(3);
  $("silenceTo").value = selected.end.toFixed(3);
  $("silenceRangeHint").textContent = `Analyze ${fmt(selected.start)}–${fmt(selected.end)}. Suggestions keep original recording times.`;
};
$("silenceWholeRangeBtn").onclick = () => {
  resetSilenceRange(false);
  $("silenceRangeHint").textContent = "Analyzing the entire recording.";
};


function updatePausePager() {
  const end = Math.min(pauseReview.total, pauseReview.offset + pauseReview.limit);
  $("silencePageStatus").textContent = pauseReview.total
    ? `${pauseReview.offset + 1}–${end} of ${pauseReview.total}` : "No results";
  $("previousPausesBtn").disabled = pauseReview.loading || !pauseReview.analysisId || pauseReview.offset === 0;
  $("nextPausesBtn").disabled = pauseReview.loading || !pauseReview.analysisId || end >= pauseReview.total;
}
async function loadPausePage(offset) {
  if (!S.job || S.operation || pauseReview.loading || !pauseReview.analysisId) return;
  const id = S.job.id, revision = pauseReview.revision;
  pauseReview.loading = true; $("silenceReview").inert = true;
  updatePausePager();
  $("silencePageStatus").textContent = "Loading pauses…";
  try {
    const page = await api(`/api/jobs/${id}/silence-results?analysis_id=${pauseReview.analysisId}&offset=${offset}&limit=${pauseReview.limit}`);
    if (S.job?.id !== id || pauseReview.revision !== revision) return;
    const selected = new Map(selectedPauses().map(segment => [segment.index, segment]));
    const rows = page.segments.map(segment => ({...segment, selected: selected.has(segment.index)}));
    for (const segment of rows) selected.delete(segment.index);
    S.suggestions = [...selected.values(), ...rows];
    Object.assign(pauseReview, {offset: page.offset, total: page.total, indices: new Set(rows.map(segment => segment.index))});
    renderSilenceReview();
    $("silenceList").scrollTop = 0;
  } catch (error) {
    if (S.job?.id === id && pauseReview.revision === revision) {
      $("silenceStatus").textContent = ["TimeoutError", "AbortError"].includes(error.name)
        ? "Loading pauses timed out. Your selections are kept; try the page again."
        : `Could not load pauses. ${error.message} Your selections are kept.`;
    }
  } finally {
    if (S.job?.id === id && pauseReview.revision === revision) {
      pauseReview.loading = false;
      $("silenceReview").inert = !!S.operation;
      updatePausePager();
    }
  }
}
$("previousPausesBtn").onclick = () => loadPausePage(Math.max(0, pauseReview.offset - pauseReview.limit));
$("nextPausesBtn").onclick = () => loadPausePage(pauseReview.offset + pauseReview.limit);
