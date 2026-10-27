"use strict";

const timeline = {zoom: 1, dragging: null};
const timelineRows = [
  {type: "audio", track: "audioRegionTrack", label: "audioRegionLabel"},
  {type: "cut", track: "cutTrack", label: "cutLabel"},
  {type: "hide", track: "maskTrack", label: "maskLabel"},
  {type: "text", track: "textTrack", label: "textLabel"},
  {type: "annotation", track: "annotationTrack", label: "annotationLabel"},
];

function resetTimeline() {
  timeline.zoom = 1;
  timeline.dragging = null;
  $("timelineViewport").scrollLeft = 0;
  $("timelineContent").style.width = "100%";
}

function renderTimeline() {
  if (!S.job || timeline.dragging) return;
  const d = duration();
  if (!d) return;
  renderTimelineRuler();
  $("zoomLabel").textContent = `${timeline.zoom}×`;
  $("zoomOutBtn").disabled = timeline.zoom === 1;
  $("zoomInBtn").disabled = timeline.zoom === 16;
  $("pauseTrack").replaceChildren();
  show($("pauseTrack"), S.job.has_audio && S.suggestions.length > 0);
  show($("pauseLabel"), S.job.has_audio && S.suggestions.length > 0);
  for (const suggestion of S.suggestions) {
    const marker = document.createElement("button");
    marker.className = "pause-marker" + (suggestion.selected ? " selected" : "");
    positionTimelineBlock(marker, suggestion);
    marker.title = `Suggested pause ${fmt(suggestion.start)}–${fmt(suggestion.end)}`;
    marker.setAttribute("aria-label", marker.title);
    marker.setAttribute("aria-pressed", String(suggestion.selected));
    marker.onclick = () => { setPauseSelection(suggestion, !suggestion.selected); renderSilenceReview(); };
    $("pauseTrack").append(marker);
  }
  for (const row of timelineRows) {
    const track = $(row.track);
    track.replaceChildren();
    const visible = row.type === "cut" || (row.type === "audio" && S.edits.some(edit=>edit.type==="audio")) ||
      (S.job.has_video && S.edits.some(edit => edit.type === row.type));
    show(track, visible); show($(row.label), visible);
    if (!visible) continue;
    const laneHeight = window.matchMedia("(max-width: 600px)").matches ? 48 : 32;
    const laneEnds = [];
    const edits = EditorModel.sorted(EditorModel.byType(S.edits, row.type));
    for (const edit of edits) {
      let lane = laneEnds.findIndex(end => end <= edit.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = edit.end;
      const block = document.createElement("button");
      block.className = `timeline-block ${edit.type}${edit.id === S.selected ? " selected" : ""}`;
      block.dataset.editId = edit.id;
      block.style.top = `${lane * laneHeight + 5}px`;
      positionTimelineBlock(block, edit);
      const description = cardTitle(edit);
      block.title = `${description}. Drag to move; drag the edges to change timing.`;
      block.setAttribute("aria-label", description);
      block.setAttribute("aria-pressed", String(edit.id === S.selected));
      const label = document.createElement("span");
      label.className = "block-label";
      label.textContent = edit.type === "audio" ? (edit.volume===0?"Mute":Math.round(edit.volume*100)+"% volume") : edit.type === "text" ? edit.text || "Text" : edit.type === "hide" ? "Mask" : edit.type === "annotation" ? (edit.kind === "drawing" ? (edit.strokes ? "Drawing group" : "Drawing") : edit.kind === "spotlight" ? "Spotlight" : edit.kind === "click" ? "Click highlight" : "Annotation") : "Cut";
      block.append(label);
      for (const edge of ["l", "r"]) {
        const handle = document.createElement("span");
        handle.className = `edge ${edge}`;
        handle.setAttribute("aria-hidden", "true");
        block.append(handle);
      }
      block.onpointerdown = event => startTimelineDrag(event, edit);
      block.onclick = event => {
        select(edit.id);
        sourcePlayer().currentTime = edit.type === "annotation"
          ? AnnotationModel.visibleTime(edit) : edit.start;
        if (event.detail === 0) {
          document.querySelector(`[data-edit-id="${edit.id}"]`)?.focus({preventScroll: true});
        }
      };
      track.append(block);
    }
    const height = `${Math.max(1, laneEnds.length) * laneHeight}px`;
    track.style.height = height;
    $(row.label).style.height = height;
  }
  if (typeof renderZoomTimeline === "function") renderZoomTimeline();
  renderWaveform();
  updateTimelinePlayhead();
}

function positionTimelineBlock(block, interval) {
  block.style.left = `${interval.start / duration() * 100}%`;
  block.style.width = `${(interval.end - interval.start) / duration() * 100}%`;
}

function renderTimelineRuler() {
  if (!S.job) return;
  renderWaveform();
  const ruler = $("timelineRuler");
  ruler.replaceChildren();
  const target = duration() / Math.max(1, $("timelineContent").clientWidth / 85);
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const step = steps.find(value => value >= target) || Math.ceil(target / 3600) * 3600;
  for (let t = 0; t < duration(); t += step) {
    const tick = document.createElement("button");
    const time = t;
    tick.className = "timeline-tick";
    tick.style.left = `${t / duration() * 100}%`;
    tick.textContent = fmt(t);
    tick.setAttribute("aria-label", `Seek to ${fmt(t)}`);
    tick.dataset.time = String(time);
    tick.onclick = () => { sourcePlayer().currentTime = time; };
    ruler.append(tick);
  }
}

function updateTimelinePlayhead() {
  if (!S.job || !duration()) return;
  $("timelinePlayhead").style.left = `${sourcePlayer().currentTime / duration() * 100}%`;
}

function zoomTimeline(zoom) {
  const viewport = $("timelineViewport");
  const position = sourcePlayer().currentTime / duration();
  const screenPosition = clamp(position * $("timelineContent").clientWidth - viewport.scrollLeft, 0, viewport.clientWidth);
  timeline.zoom = clamp(zoom, 1, 16);
  $("timelineContent").style.width = `${timeline.zoom * 100}%`;
  viewport.scrollLeft = position * $("timelineContent").clientWidth - screenPosition;
  renderTimeline();
}
$("zoomInBtn").onclick = () => zoomTimeline(timeline.zoom * 2);
$("zoomOutBtn").onclick = () => zoomTimeline(timeline.zoom / 2);
$("zoomFitBtn").onclick = () => zoomTimeline(1);
let timelineResizeFrame = null;
new ResizeObserver(() => {
  // Rendering changes track heights. Defer that write out of the observer's
  // delivery cycle to avoid WebKit's undelivered-notifications loop.
  if (timelineResizeFrame !== null) return;
  timelineResizeFrame = requestAnimationFrame(() => {
    timelineResizeFrame = null;
    renderTimeline();
  });
}).observe($("timelineViewport"));

function startTimelineDrag(event, edit) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  sourcePlayer().pause();
  const block = event.currentTarget;
  const edge = event.target.closest(".edge");
  const part = edge?.classList.contains("l") ? "start" : edge ? "end" : "move";
  const start = edit.start, end = edit.end, x = event.clientX;
  const width = $("timelineContent").clientWidth;
  timeline.dragging = edit.id;
  select(edit.id);
  block.classList.add("selected");
  block.focus({preventScroll: true});
  block.setPointerCapture(event.pointerId);
  let moved = false;
  const move = next => {
    if (next.pointerId !== event.pointerId) return;
    if (!moved && Math.abs(next.clientX - x) < 3) return;
    if (!moved) { checkpoint(); moved = true; }
    const dt = (next.clientX - x) / width * duration();
    const minLength = Math.min(0.1, end - start);
    if (part === "start") edit.start = +clamp(start + dt, 0, end - minLength).toFixed(3);
    else if (part === "end") edit.end = +clamp(end + dt, start + minLength, duration()).toFixed(3);
    else {
      const shift = clamp(dt, -start, duration() - end);
      edit.start = +(start + shift).toFixed(3);
      edit.end = +(end + shift).toFixed(3);
    }
    positionTimelineBlock(block, edit);
    sourcePlayer().currentTime = part === "end" ? edit.end : edit.start;
    syncCard(edit);
  };
  const finish = next => {
    if (next.pointerId !== event.pointerId) return;
    block.removeEventListener("pointermove", move);
    block.removeEventListener("pointerup", finish);
    block.removeEventListener("pointercancel", finish);
    timeline.dragging = null;
    if (!moved) sourcePlayer().currentTime = edit.start;
    renderTimeline();
  };
  block.addEventListener("pointermove", move);
  block.addEventListener("pointerup", finish);
  block.addEventListener("pointercancel", finish);
}


// Draw only the visible portion, so zooming does not create a huge canvas.
function renderWaveform() {
  if (!S.job) return;
  const visible = S.job.has_audio;
  show($("waveformTrack"), visible);
  show($("waveformLabel"), visible);
  if (!visible) return;
  const peaks = S.job.waveform;
  $("waveformStatus").textContent = peaks?.length ? "" : S.job.waveform === undefined
    ? "Restart the FreeEdit server and reload to enable waveforms."
    : "Waveform could not be generated · editing still works";
  const canvas = $("waveformCanvas");
  const viewport = $("timelineViewport");
  const width = viewport.clientWidth;
  const fullWidth = $("timelineContent").clientWidth;
  if (!width || !fullWidth) return;
  const height = 48;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = height * dpr;
  const context = canvas.getContext("2d");
  context.scale(dpr, dpr);
  const styles = getComputedStyle(canvas);
  context.fillStyle = styles.getPropertyValue("--border");
  context.fillRect(0, height / 2, width, 1);
  if (!peaks?.length) return;
  const scroll = viewport.scrollLeft;
  context.fillStyle = styles.getPropertyValue("--accent");
  for (let x = 0; x < width; x += 2) {
    const first = Math.floor((scroll + x) / fullWidth * peaks.length);
    const last = Math.min(peaks.length, Math.ceil((scroll + x + 2) / fullWidth * peaks.length));
    let peak = 0;
    for (let i = first; i < last; i++) peak = Math.max(peak, peaks[i]);
    const amplitude = peak * (height / 2 - 3);
    if (amplitude) context.fillRect(x, height / 2 - amplitude, 1, Math.max(1, amplitude * 2));
  }
  context.fillStyle = styles.getPropertyValue("--danger");
  context.globalAlpha = 0.18;
  for (const [start, end] of cutRanges()) {
    const left = start / duration() * fullWidth - scroll;
    context.fillRect(left, 0, (end - start) / duration() * fullWidth, height);
  }
}
$("timelineViewport").addEventListener("scroll", renderWaveform, {passive: true});
$("waveformCanvas").onclick = event => {
  const viewport = $("timelineViewport");
  const x = event.clientX - viewport.getBoundingClientRect().left + viewport.scrollLeft;
  sourcePlayer().currentTime = clamp(x / $("timelineContent").clientWidth * duration(), 0, duration());
};
window.addEventListener("freeedit:themechange", renderWaveform);
