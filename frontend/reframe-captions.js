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
  const aspectNames = {original:"Original", wide:"16:9", vertical:"9:16", square:"1:1"};
  $("reframeWholeSummary").textContent = `${aspectNames[r.aspect]} · ${Number(r.zoom).toFixed(2)}×`;
  // Whole-video settings remain independent of the next timed section.
  $("reframeX").disabled = false;
  $("reframeY").disabled = false;
  if (S.job?.has_video) requestAnimationFrame(layoutStage);
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
  const previous = S.reframe || reframeDefaults();
  if (previous.aspect !== next.aspect || previous.zoom !== next.zoom ||
      previous.focus_x !== next.focus_x || previous.focus_y !== next.focus_y) checkpoint();
  S.reframe = {...next, sections:S.reframe?.sections || []};
  syncReframeControls();
  renderZoomSelectList();
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
    $("reframeWholeSummary").textContent = $("reframeWholeSummary").textContent.split(" · ")[0] + " · " + next.zoom.toFixed(2) + "×";
    renderZoomSelectList();
    refreshExportState();
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

// One refresh path for every reframe mutation: inspector, timeline,
// preview, undo/export signature and browser recovery stay in sync.
function refreshReframeWorkspace() {
  renderReframeSections();
  renderList(); // also repopulates the shared Reframe/Edits list
  renderTimeline();
  render();
  refreshExportState();
}

function renderReframeSections() {
  const list = $("reframeSections");
  if (!list) return;
  list.replaceChildren();
  const sections = S.reframe?.sections || [];
  for (const [index, section] of sections.entries()) {
    const row = document.createElement("div");
    row.className = "reframe-section";
    const label = document.createElement("span");
    label.textContent = `${fmt(section.start)}–${fmt(section.end)} · ${section.zoom.toFixed(2)}× · ${section.transition.toFixed(2)}s easing`;
    const seek = document.createElement("button");
    seek.type = "button"; seek.textContent = "Edit";
    seek.onclick = () => selectZoom(index);
    const remove = document.createElement("button");
    remove.type = "button"; remove.textContent = "Remove";
    remove.onclick = () => {
      checkpoint();
      S.reframe.sections = S.reframe.sections.filter(item=>item!==section);
      S.selectedZoom=null;refreshReframeWorkspace();
    };
    row.append(label,seek,remove);
    list.append(row);
  }
  if (!sections.length) list.textContent = "No portions added. Whole-video settings apply throughout.";
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
  const zoom = Number($("reframeSectionZoom").value);
  checkpoint();
  const section = {start,end:Math.min(duration(),end),transition,
    zoom, focus_x:Number($("reframeSectionX").value),focus_y:Number($("reframeSectionY").value)};
  sections.push(section);
  sections.sort((a,b)=>a.start-b.start);
  S.selectedZoom = sections.indexOf(section);
  refreshReframeWorkspace();
  // Seek into the middle where the zoom is fully applied, so clicking Add
  // yields immediate, visible feedback even when playback was elsewhere.
  const middle = start + (end - start) / 2;
  sourcePlayer().currentTime = middle;
  render();
  status.textContent = `Added Reframe from ${fmt(start)} to ${fmt(end)}. Select it in Edits or on the timeline to adjust it.`;
  selectZoom(S.selectedZoom);
};
$("reframeSectionZoom").oninput = () => {
  $("reframeSectionZoomLabel").textContent = Number($("reframeSectionZoom").value).toFixed(2) + "×";
  render();
};
for (const id of ["reframeSectionX", "reframeSectionY"]) $(id).addEventListener("input", render);
for (const [button, field] of [["reframeStartNow", "reframeStart"], ["reframeEndNow", "reframeEnd"]]) {
  $(button).onclick = () => { $(field).value = sourcePlayer().currentTime.toFixed(2); };
}
window.addEventListener("freeedit:workspace",event=>{
  if(event.detail==="open"){
    $("reframeWholeGroup").open = $("reframePortionGroup").open = false;
    $("reframeStatus").textContent="";
    $("reframeSectionZoom").value=1.8;
    $("reframeSectionZoomLabel").textContent="1.80×";
    $("reframeSectionX").value=$("reframeSectionY").value=.5;
    $("reframeStart").max=$("reframeEnd").max=duration();
    $("reframeStart").value=0;
    $("reframeEnd").value=Math.min(3,duration());
    renderReframeSections();
  } else if(event.detail==="reframe-restore"){S.selectedZoom=null;renderReframeSections();renderList();renderTimeline();}
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
  sourcePlayer().pause();
  S.selected=null;
  S.selectedZoom=index;
  document.querySelectorAll(".card.selected").forEach(card=>card.classList.remove("selected"));
  sourcePlayer().currentTime=(zoomSections()[index].start+zoomSections()[index].end)/2;
  syncZoomSelection();renderZoomSelectList();renderTimeline();layoutStage();updateTransport();
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"zoom-selection"}));
}
function renderZoomSelectList() {
  const list = $("editsList");
  if (!list) return;
  // Use the SAME visible list as cuts, text, masks and captions. The old
  // separate zoom container was removed, leaving zoom edits invisible.
  list.querySelectorAll(".zoom-edit-row").forEach(row => row.remove());
  const sections = zoomSections();
  const config = S.reframe;
  const wholeVideo = !!config && (
    config.aspect !== "original" ||
    config.zoom > 1.001
  );
  $("editCount").textContent = S.edits.length + sections.length + Number(wholeVideo);
  show($("editsEmpty"), S.edits.length === 0 && sections.length === 0 && !wholeVideo);

  // Aspect ratio / whole-recording zoom is an actual edit too, even if the
  // user did not add a timed section. Select it to reopen Reframe controls.
  if (wholeVideo) {
    const row = document.createElement("div");
    row.className = "zoom-edit-row";
    row.dataset.start = "0";
    const button = document.createElement("button");
    button.type = "button";
    const aspectNames = {original: "Original", wide: "16:9", vertical: "9:16", square: "1:1"};
    const zoomDetail = " · Whole video · " + config.zoom.toFixed(2) + "×";
    button.textContent = "Reframe · " + (aspectNames[config.aspect] || "Original") + zoomDetail;
    button.title = "Open Reframe settings for the whole video";
    button.onclick = () => {
      $("reframeWholeGroup").open = true;
      window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "reframe-settings"}));
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini reframe-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove whole-video Reframe");
    remove.onclick = () => {
      checkpoint();
      S.reframe = {...reframeDefaults(), sections: zoomSections()};
      syncReframeControls(); refreshReframeWorkspace();
    };
    row.append(button, remove);
    list.append(row);
  }

  sections.forEach((section, index) => {
    const row = document.createElement("div");
    row.className = "zoom-edit-row";
    row.dataset.start = String(section.start);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(S.selectedZoom === index));
    button.textContent = "Reframe · " + fmt(section.start) + "–" + fmt(section.end) +
      " · " + section.zoom.toFixed(2) + "×";
    button.onclick = () => selectZoom(index);
    row.append(button);
    list.append(row);
  });
  // All items have numeric start times. Keep every edit in original timeline
  // order, including when there are no ordinary cards to anchor the list.
  [...list.children]
    .sort((a, b) => Number(a.dataset.start || 0) - Number(b.dataset.start || 0))
    .forEach(el => list.append(el));
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
    b.textContent="Reframe "+section.zoom.toFixed(2)+"×";
    b.setAttribute("aria-label","Select zoom section "+fmt(section.start)+" to "+fmt(section.end));
    b.onclick=()=>selectZoom(index);
    track.append(b);
  });
}
for(const [id,key] of Object.entries({selectedZoomStart:"start",selectedZoomEnd:"end",selectedZoomStrength:"zoom",selectedZoomX:"focus_x",selectedZoomY:"focus_y",selectedZoomTransition:"transition"})){
  const input = $(id);
  const sliding = input.type === "range";
  if (sliding) input.addEventListener("change", () => { delete input.dataset.dragging; });
  input.addEventListener(sliding ? "input" : "change",()=>{
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
    if (!sliding || !input.dataset.dragging) checkpoint();
    if (sliding) input.dataset.dragging = "1";
    S.reframe.sections=sorted;S.selectedZoom=sorted.indexOf(updated);
    refreshReframeWorkspace();
  });
}
$("selectedZoomRemove").onclick=()=>{
  const index=S.selectedZoom;if(index==null)return;
  checkpoint();S.reframe.sections.splice(index,1);S.selectedZoom=null;
  refreshReframeWorkspace();
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"zoom-selection"}));
};

// Render the *actual* cropped recording + overlays while playing; the
// underlying source video remains intact for hit-testing and export.
const reframePreview=document.createElement("canvas");
reframePreview.id="reframePreviewCanvas";
reframePreview.setAttribute("aria-hidden","true");
reframePreview.hidden=true;
$("stage").append(reframePreview);
const reframeCtx=reframePreview.getContext("2d",{alpha:false});
// Show a draft before Add, or the selected saved portion, on the full source.
// Playback returns to the cropped result. Guides never enter exports.
function reframeGuideSection() {
  if (!S.job?.has_video || !video.paused || S.reviewing) return null;
  if ($("workspace-reframe") && !$("workspace-reframe").hidden) {
    if ($("reframeWholeGroup").open) return S.reframe;
    if (!$("reframePortionGroup").open) return null;
    return {zoom: Number($("reframeSectionZoom").value),
      focus_x: Number($("reframeSectionX").value), focus_y: Number($("reframeSectionY").value)};
  }
  return S.selectedZoom != null && !$("workspace-edits")?.hidden &&
    !$("selectedZoomPanel").classList.contains("hidden") ? zoomSections()[S.selectedZoom] : null;
}
for (const id of ["reframeWholeGroup", "reframePortionGroup"]) $(id).addEventListener("toggle", layoutStage);
for (const event of ["play", "pause"]) video.addEventListener(event, layoutStage);
function updateReframePreview(rect){
  if(!S.job?.has_video||!rect||video.readyState<2){
    reframePreview.hidden=true;return;
  }
  if(reframePreview.width!==canvas.width||reframePreview.height!==canvas.height){
    reframePreview.width=canvas.width;reframePreview.height=canvas.height;
  }
  // Render the same video region to the full preview. The overlay gets the
  // identical crop so text and masks retain their original pixel positions.
  reframeCtx.clearRect(0,0,reframePreview.width,reframePreview.height);
  try {
    const section = reframeGuideSection();
    if (section) {
      const width = reframePreview.width, height = reframePreview.height;
      const target = freeeditCropRect(S.job.width, S.job.height, {...S.reframe, ...section});
      const x = target.x / S.job.width * width, y = target.y / S.job.height * height;
      const w = target.w / S.job.width * width, h = target.h / S.job.height * height;
      reframeCtx.drawImage(video, 0, 0, width, height);
      reframeCtx.drawImage(canvas, 0, 0, width, height);
      reframeCtx.beginPath();
      reframeCtx.rect(0, 0, width, height);
      reframeCtx.rect(x, y, w, h);
      reframeCtx.fillStyle = "rgba(0,0,0,.5)";
      reframeCtx.fill("evenodd");
      const px = window.devicePixelRatio || 1;
      reframeCtx.setLineDash([7 * px, 5 * px]);
      reframeCtx.lineWidth = 4 * px;
      reframeCtx.strokeStyle = "#17142f";
      reframeCtx.strokeRect(x, y, w, h);
      reframeCtx.lineWidth = 2 * px;
      reframeCtx.strokeStyle = "#c4b5fd";
      reframeCtx.strokeRect(x, y, w, h);
      reframeCtx.setLineDash([]);
      reframePreview.hidden = false;
      return;
    }
    reframeCtx.drawImage(video,rect.x,rect.y,rect.w,rect.h,0,0,reframePreview.width,reframePreview.height);
    reframeCtx.drawImage(canvas,rect.x*canvas.width/S.job.width,rect.y*canvas.height/S.job.height,rect.w*canvas.width/S.job.width,rect.h*canvas.height/S.job.height,0,0,reframePreview.width,reframePreview.height);
    reframePreview.hidden=false;
  } catch {
    reframePreview.hidden=true;
  }
}
