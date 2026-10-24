"use strict";

// Reframe is non-destructive; crop coordinates are saved with the project.
const reframeDefaults = () => ({aspect: "original", zoom: 1, focus_x: .5, focus_y: .5, sections: []});
function syncReframeControls() {
  const r = S.reframe || reframeDefaults();
  $("reframeAspect").value = r.aspect;
  $("reframeZoom").value = r.zoom;
  $("reframeX").value = r.focus_x;
  $("reframeY").value = r.focus_y;
  $("reframeZoomLabel").textContent = Number(r.zoom).toFixed(2) + "×";
  $("reframeX").disabled = r.aspect === "original" && r.zoom === 1;
  $("reframeY").disabled = r.aspect === "original" && r.zoom === 1;
}
function updateReframe() {
  if (!S.job?.has_video) return;
  const next = {
    aspect: $("reframeAspect").value,
    zoom: Number($("reframeZoom").value),
    focus_x: Number($("reframeX").value),
    focus_y: Number($("reframeY").value)
  };
  try { freeeditCropRect(S.job.width, S.job.height, next); }
  catch (error) { $("modeHint").textContent = error.message; return; }
  if (JSON.stringify(S.reframe) !== JSON.stringify(next)) checkpoint();
  S.reframe = {...next, sections:S.reframe?.sections || []};
  syncReframeControls();
  refreshExportState();
  render();
}
for (const id of ["reframeAspect", "reframeZoom", "reframeX", "reframeY"]) {
  $(id).addEventListener("change", event => {
    updateReframe();
    delete event.target.dataset.dragging;
  });
  if (id !== "reframeAspect") $(id).addEventListener("input", event => {
    // Record a single undo step at the start of the drag, before mutating.
    if (!event.target.dataset.dragging) { checkpoint(); event.target.dataset.dragging = "1"; }
    const previous = S.reframe || reframeDefaults();
    const next = {...previous, zoom:Number($("reframeZoom").value), focus_x:Number($("reframeX").value), focus_y:Number($("reframeY").value)};
    S.reframe = next;
    $("reframeZoomLabel").textContent = next.zoom.toFixed(2) + "×";
    render();
  });
}
$("reframeReset").onclick = () => {
  checkpoint();
  S.reframe = reframeDefaults();
  renderReframeSections();
  syncReframeControls();
  refreshExportState();
  render();
};
$("captionImportBtn").onclick = () => $("captionInput").click();
$("captionInput").onchange = async event => {
  const input = event.target, file = input.files?.[0];
  input.value = "";
  if (!file || !S.job?.has_video) return;
  try {
    if (file.size > 1000000) throw new Error("Choose an SRT file under 1 MB.");
    const cues = freeeditParseSrt(await file.text(), duration());
    if (S.edits.filter(edit => edit.type !== "cut").length + cues.length > 100) {
      throw new Error("The project can contain at most 100 text and mask overlays. Remove some edits first.");
    }
    checkpoint();
    const fontSize = Math.max(16, Math.round(S.job.height * .045));
    for (const cue of cues) {
      const caption = {id:S.nextId++, type:"text", start:cue.start, end:cue.end,
        text:cue.text, fontSize, font:"sans", bg:"dark", color:"#ffffff", bold:true,
        x:0, y:0};
      // Position captions above the bottom edge; user can move and edit them.
      const size = textMetrics(caption);
      caption.w = size.w; caption.h = size.h;
      caption.x = Math.round(Math.max(0, (S.job.width - size.w) / 2));
      caption.y = Math.round(Math.max(0, S.job.height - size.h - S.job.height * .06));
      S.edits.push(caption);
    }
    S.selected = S.edits.at(-cues.length).id;
    renderList(); render(); updateTransport(); refreshExportState();
    $("captionStatus").textContent = `Imported ${cues.length} editable captions. Select one on the timeline to adjust its text or timing.`;
    window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail:"selection"}));
  } catch (error) {
    $("captionStatus").textContent = error.message;
  }
};

function renderReframeSections() {
  const list = $("reframeSections");
  if (!list) return;
  list.replaceChildren();
  const sections = S.reframe?.sections || [];
  for (const section of sections) {
    const row = document.createElement("div");
    row.className = "reframe-section";
    const label = document.createElement("span");
    label.textContent = `${fmt(section.start)}–${fmt(section.end)} · ${section.zoom.toFixed(2)}× · ${section.transition.toFixed(2)}s easing`;
    const seek = document.createElement("button");
    seek.type = "button"; seek.textContent = "Preview";
    seek.onclick = () => {
      sourcePlayer().currentTime = Math.min(duration(),section.start+Math.max(.05,section.transition));
      render();
    };
    const remove = document.createElement("button");
    remove.type = "button"; remove.textContent = "Remove";
    remove.onclick = () => {
      checkpoint();
      S.reframe.sections = S.reframe.sections.filter(item=>item!==section);
      renderReframeSections(); render(); refreshExportState();
    };
    row.append(label,seek,remove);
    list.append(row);
  }
  if (!sections.length) list.textContent = "No timed sections: current crop applies to the whole recording.";
}
$("reframeAddSection").onclick = () => {
  if (!S.job?.has_video) return;
  const start = $("reframeStart").valueAsNumber, end = $("reframeEnd").valueAsNumber;
  const transition = $("reframeTransition").valueAsNumber;
  const status = $("reframeStatus");
  const sections = S.reframe.sections || (S.reframe.sections = []);
  if (![start,end,transition].every(Number.isFinite) ||
      start<0 || end>duration()+.005 || end<=start ||
      transition<0 || transition>1.5 || sections.length>=20) {
    status.textContent = "Enter a start and end within the video. Maximum 20 sections.";
    return;
  }
  if (sections.some(s => start<s.end && end>s.start)) {
    status.textContent = "Zoom sections cannot overlap.";
    return;
  }
  const zoom = Number($("reframeZoom").value);
  if (zoom <= 1.001) {
    status.textContent = "Choose Zoom above 1.00× first (try 1.80×). A 1.00× section cannot visibly zoom.";
    $("reframeZoom").focus();
    return;
  }
  checkpoint();
  sections.push({start,end:Math.min(duration(),end),transition,
    zoom, focus_x:Number($("reframeX").value),focus_y:Number($("reframeY").value)});
  sections.sort((a,b)=>a.start-b.start);
  renderReframeSections(); refreshExportState();
  // Seek into the middle where the zoom is fully applied, so clicking Add
  // yields immediate, visible feedback even when playback was elsewhere.
  const middle = start + (end - start) / 2;
  sourcePlayer().currentTime = middle;
  render();
  status.textContent = `Added ${zoom.toFixed(2)}× zoom from ${fmt(start)} to ${fmt(end)}. Previewing the section now; play across its boundaries for smooth transitions.`;
};
window.addEventListener("freeedit:workspace",event=>{
  if(event.detail==="open"){
    $("reframeStart").value=0;
    $("reframeEnd").value=Math.min(3,duration());
    renderReframeSections();
  } else if(event.detail==="reframe-restore") renderReframeSections();
});
