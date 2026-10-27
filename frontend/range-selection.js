"use strict";

// Draft source-time selection. It does not change the project until applied.
const rangeSelection = {range: null, suppressClick: false};
const rangeActions = document.createElement("div");
rangeActions.className = "range-actions hidden";
rangeActions.setAttribute("role", "group");
rangeActions.setAttribute("aria-label", "Selected timeline range");
const rangeLabel = document.createElement("span");
rangeLabel.setAttribute("role", "status");
rangeActions.append(rangeLabel);
$("transport").insertBefore(rangeActions, $("transport").querySelector(".timeline-shell"));
const rangeHighlight = document.createElement("div");
rangeHighlight.className = "range-selection hidden";
rangeHighlight.setAttribute("aria-hidden", "true");
$("timelineContent").append(rangeHighlight);
function displayRangeSelection() {
  const range = rangeSelection.range;
  show(rangeActions, !!range); show(rangeHighlight, !!range);
  if (!range) return;
  rangeLabel.textContent = `${fmt(range.start)}–${fmt(range.end)} · ${(range.end-range.start).toFixed(2)}s selected`;
  positionTimelineBlock(rangeHighlight, range);
  rangeActions.querySelector('[data-action="reframe"]').disabled = !S.job?.has_video;
  rangeActions.querySelector('[data-action="audio"]').disabled = !S.job?.has_audio && !presenterProject()?.source.has_audio;
}
function clearRangeSelection() {
  rangeSelection.range = null; displayRangeSelection();
}
for (const [action, label] of [["cut", "Cut range"], ["reframe", "Reframe range"], ["audio", "Set volume"], ["preview", "Play range"], ["clear", "Clear"]]) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "mini"; button.dataset.action = action; button.textContent = label;
  button.onclick = () => {
    const range = rangeSelection.range;
    if (!range) return;
    if (action === "clear") return clearRangeSelection();
    if (action === "preview") {
      sourcePlayer().currentTime = range.start; S.auditionUntil = range.end;
      sourcePlayer().play().catch(() => { S.auditionUntil = null; }); return;
    }
    if (action === "audio") {
      $("audioRegionStart").value = range.start.toFixed(3);
      $("audioRegionEnd").value = range.end.toFixed(3);
      window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "audio-regions"}));
      requestAnimationFrame(() => $("audioRegionVolume").focus());
      return;
    }
    if (action === "cut") {
      window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "cut"}));
      $("cutFrom").value = range.start.toFixed(3); $("cutTo").value = range.end.toFixed(3);
      $("cutTo").dispatchEvent(new Event("input", {bubbles: true}));
    } else {
      $("reframeStart").value = range.start.toFixed(3); $("reframeEnd").value = range.end.toFixed(3);
      $("reframePortionGroup").open = true;
      window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "reframe-settings"}));
    }
  };
  rangeActions.append(button);
}
const rangeSurface = $("timelineContent");
rangeSurface.addEventListener("pointerdown", event => {
  if (!S.job || S.reviewing || event.button !== 0 || event.target.closest(".timeline-block, .pause-marker, input")) return;
  if (!event.target.closest("#waveformTrack, #timelineRuler")) return;
  const bounds = rangeSurface.getBoundingClientRect();
  const timeAt = x => clamp((x - bounds.left) / bounds.width * duration(), 0, duration());
  const tick = event.target.closest("#timelineRuler button[data-time]");
  const origin = event.clientX, start = timeAt(origin), before = rangeSelection.range;
  let dragged = false;
  rangeSurface.setPointerCapture(event.pointerId);
  const move = next => {
    if (next.pointerId !== event.pointerId) return;
    if (!dragged && Math.abs(next.clientX-origin) < 5) return;
    if (!dragged) { sourcePlayer().pause(); S.auditionUntil = null; dragged = true; }
    const end = timeAt(next.clientX);
    rangeSelection.range = {start: Math.min(start,end), end: Math.max(start,end)};
    displayRangeSelection();
  };
  const finish = next => {
    if (next.pointerId !== event.pointerId) return;
    rangeSurface.removeEventListener("pointermove", move);
    rangeSurface.removeEventListener("pointerup", finish);
    rangeSurface.removeEventListener("pointercancel", finish);
    if (dragged) {
      if (next.type === "pointercancel") rangeSelection.range = before;
      else if (rangeSelection.range.end-rangeSelection.range.start < .05) rangeSelection.range = null;
      rangeSelection.suppressClick = true;
      setTimeout(() => { rangeSelection.suppressClick = false; }, 0);
      displayRangeSelection();
    } else if (next.type !== "pointercancel") {
      sourcePlayer().currentTime = tick ? Number(tick.dataset.time) : start;
    }
  };
  rangeSurface.addEventListener("pointermove", move);
  rangeSurface.addEventListener("pointerup", finish);
  rangeSurface.addEventListener("pointercancel", finish);
});
rangeSurface.addEventListener("click", event => {
  if (rangeSelection.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
function markRangeEdge(edge) {
  const time = clamp(sourcePlayer().currentTime, 0, duration());
  const previous = rangeSelection.range || {start: 0, end: duration()};
  const range = edge === "start"
    ? {start: time, end: previous.end > time ? previous.end : duration()}
    : {start: previous.start < time ? previous.start : 0, end: time};
  if (range.end - range.start < .05) return;
  sourcePlayer().pause(); S.auditionUntil = null;
  rangeSelection.range = range;
  displayRangeSelection();
}
document.addEventListener("keydown", event => {
  if (!S.job || S.reviewing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
      event.target.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
  const key = event.key.toLowerCase();
  if (key === "i" || key === "o") {
    event.preventDefault();
    markRangeEdge(key === "i" ? "start" : "end");
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !event.target.closest("input, textarea, select") && !document.querySelector("dialog[open]")) clearRangeSelection();
});
window.addEventListener("freeedit:workspace", event => { if (event.detail === "open") clearRangeSelection(); });

// Smart Focus uses the existing crop model: place the target crop's center at
// a clicked source point, clamping naturally at the recording's edges.
let pickingFocus = false;
let focusTarget = null;
for (const [container, target] of [["reframePortionGroup", "draft"], ["selectedZoomPanel", "selected"]]) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "ghost focus-picker";
  button.textContent = "Pick focus in video";
  button.onclick = () => {
    pickingFocus = true; focusTarget = target;
    sourcePlayer().pause();
    $("modeHint").textContent = "Click the video to center the zoom. Escape cancels.";
    canvas.classList.add("crosshair");
    $("stageWrap").scrollIntoView({block: "nearest", behavior: "smooth"});
  };
  const panel = $(container);
  (target === "draft" ? panel.querySelector(".reframe-group-body") : panel).append(button);
}
function stopFocusPicking() {
  pickingFocus = false; focusTarget = null; canvas.classList.remove("crosshair");
  $("modeHint").textContent = MODE_HINTS[S.mode];
}
canvas.addEventListener("pointerdown", event => {
  if (!pickingFocus) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const p = toSource(event);
  const section = focusTarget === "selected" ? selectedReframe() : {
    zoom: Number($("reframeSectionZoom").value), focus_x: .5, focus_y: .5
  };
  if (!section) { stopFocusPicking(); return; }
  const crop = freeeditCropRect(S.job.width, S.job.height, {...S.reframe, ...section});
  const x = S.job.width === crop.w ? .5 : clamp((p.x-crop.w/2)/(S.job.width-crop.w), 0, 1);
  const y = S.job.height === crop.h ? .5 : clamp((p.y-crop.h/2)/(S.job.height-crop.h), 0, 1);
  if (focusTarget === "selected") {
    commitEdit("edit:update-reframe", state => {
      const selected = state.edits.find(edit=>edit.id===section.id);
      selected.focus_x = +x.toFixed(2); selected.focus_y = +y.toFixed(2);
    });
    syncZoomSelection();
  } else {
    $("reframeSectionX").value = x.toFixed(2); $("reframeSectionY").value = y.toFixed(2);
  }
  stopFocusPicking(); render();
}, true);
document.addEventListener("keydown", event => { if (event.key === "Escape" && pickingFocus) stopFocusPicking(); });
window.addEventListener("freeedit:workspace", event => {
  if (["open", "mode", "selection", "zoom-selection"].includes(event.detail) && pickingFocus) stopFocusPicking();
});
