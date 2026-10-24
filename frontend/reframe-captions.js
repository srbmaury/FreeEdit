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
  S.selectedZoom=null;
  renderReframeSections();renderZoomSelectList();renderTimeline();
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
      S.selectedZoom=null;renderReframeSections();renderZoomSelectList();renderTimeline(); render(); refreshExportState();
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
  // 1.00× is the correct default for the entire recording, but it creates
  // an invisible section. Use a useful 1.80× target on the first click.
  const requestedZoom = Number($("reframeZoom").value);
  const zoom = requestedZoom <= 1.001 ? 1.8 : requestedZoom;
  checkpoint();
  sections.push({start,end:Math.min(duration(),end),transition,
    zoom, focus_x:Number($("reframeX").value),focus_y:Number($("reframeY").value)});
  sections.sort((a,b)=>a.start-b.start);
  renderReframeSections(); renderZoomSelectList(); renderTimeline(); refreshExportState();
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
  } else if(event.detail==="reframe-restore"){S.selectedZoom=null;renderReframeSections();renderZoomSelectList();renderTimeline();}
});

function zoomSections() { return S.reframe?.sections || []; }
function syncZoomSelection() {
  const selected=zoomSections()[S.selectedZoom];
  const panel=$("selectedZoomPanel");
  show(panel,!!selected);
  if(!selected)return;
  const values={selectedZoomStart:selected.start,selectedZoomEnd:selected.end,selectedZoomStrength:selected.zoom,
    selectedZoomX:selected.focus_x,selectedZoomY:selected.focus_y,selectedZoomTransition:selected.transition};
  for(const [id,value] of Object.entries(values)) $(id).value=value;
  $("selectedZoomStrengthLabel").textContent=selected.zoom.toFixed(2)+"×";
  $("selectedZoomError").textContent="";
}
function selectZoom(index) {
  if(!zoomSections()[index])return;
  S.selected=null;
  S.selectedZoom=index;
  sourcePlayer().currentTime=(zoomSections()[index].start+zoomSections()[index].end)/2;
  syncZoomSelection();renderZoomSelectList();renderTimeline();render();updateTransport();
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"zoom-selection"}));
}
function renderZoomSelectList() {
  const list=$("zoomEditsList");if(!list)return;
  list.replaceChildren();
  const sections=zoomSections();
  $("editCount").textContent=S.edits.length+sections.length;
  show($("editsEmpty"),S.edits.length===0&&sections.length===0);
  sections.forEach((section,index)=>{
    const row=document.createElement("div");row.className="zoom-edit-row";
    const button=document.createElement("button");
    button.type="button";button.setAttribute("aria-pressed",String(S.selectedZoom===index));
    button.textContent="Zoom "+fmt(section.start)+"–"+fmt(section.end)+" · "+section.zoom.toFixed(2)+"×";
    button.onclick=()=>selectZoom(index);
    row.append(button);list.append(row);
  });
  syncZoomSelection();
}
function renderZoomTimeline(){
  const track=$("zoomTrack"),label=$("zoomLabelTrack");
  if(!track||!S.job)return;
  show(track,S.job.has_video);show(label,S.job.has_video);
  track.replaceChildren();
  zoomSections().forEach((section,index)=>{
    const b=document.createElement("button");b.type="button";
    b.className="timeline-block zoom"+(index===S.selectedZoom?" selected":"");
    b.style.left=(section.start/duration()*100)+"%";
    b.style.width=((section.end-section.start)/duration()*100)+"%";
    b.textContent="Zoom "+section.zoom.toFixed(2)+"×";
    b.setAttribute("aria-label","Select zoom section "+fmt(section.start)+" to "+fmt(section.end));
    b.onclick=()=>selectZoom(index);
    track.append(b);
  });
}
for(const [id,key] of Object.entries({selectedZoomStart:"start",selectedZoomEnd:"end",selectedZoomStrength:"zoom",selectedZoomX:"focus_x",selectedZoomY:"focus_y",selectedZoomTransition:"transition"})){
  $(id).addEventListener("change",()=>{
    const index=S.selectedZoom,old=zoomSections()[index];if(!old)return;
    const value=Number($(id).value),updated={...old,[key]:value};
    const sorted=zoomSections().map((s,i)=>i===index?updated:s).sort((a,b)=>a.start-b.start);
    if(!Number.isFinite(value)||updated.start<0||updated.end>duration()||updated.end<=updated.start||
      updated.zoom<1||updated.zoom>3||updated.focus_x<0||updated.focus_x>1||
      updated.focus_y<0||updated.focus_y>1||updated.transition<0||updated.transition>1.5||
      sorted.some((s,i)=>i>0&&s.start<sorted[i-1].end)){
      $("selectedZoomError").textContent="Invalid time or overlap. Zoom sections cannot overlap.";
      $(id).value=old[key];return;
    }
    checkpoint();S.reframe.sections=sorted;S.selectedZoom=sorted.indexOf(updated);
    renderReframeSections();renderZoomSelectList();renderTimeline();refreshExportState();render();
  });
}
$("selectedZoomRemove").onclick=()=>{
  const index=S.selectedZoom;if(index==null)return;
  checkpoint();S.reframe.sections.splice(index,1);S.selectedZoom=null;
  renderReframeSections();renderZoomSelectList();renderTimeline();refreshExportState();render();
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"zoom-selection"}));
};
