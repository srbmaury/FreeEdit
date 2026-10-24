"use strict";

// Reframe is non-destructive; crop coordinates are saved with the project.
const reframeDefaults = () => ({aspect: "original", zoom: 1, focus_x: .5, focus_y: .5});
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
  checkpoint();
  S.reframe = next;
  syncReframeControls();
  refreshExportState();
  render();
}
for (const id of ["reframeAspect", "reframeZoom", "reframeX", "reframeY"]) {
  $(id).addEventListener("change", updateReframe);
  if (id !== "reframeAspect") $(id).addEventListener("input", () => {
    // Live feedback while dragging without filling undo history every pixel.
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
