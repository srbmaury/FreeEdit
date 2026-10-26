"use strict";

// Reframe's timed portions are ordinary timeline edits. Only the global crop
// aspect, zoom and focus remain scene settings.
const reframeDefaults = () => ({...EditorModel.DEFAULT_REFRAME});
const zoomSections = () => EditorModel.sorted(EditorModel.byType(S.edits,"reframe"));
const selectedReframe = () => {
  const edit = getEdit(S.selected);
  return edit?.type === "reframe" ? edit : null;
};

function syncReframeControls() {
  const r = S.reframe || reframeDefaults();
  $("reframeAspect").value=r.aspect;
  $("reframeZoom").value=r.zoom;
  $("reframeX").value=r.focus_x;
  $("reframeY").value=r.focus_y;
  $("reframeZoomLabel").textContent=Number(r.zoom).toFixed(2)+"×";
  const names={original:"Original",wide:"16:9",vertical:"9:16",square:"1:1"};
  $("reframeWholeSummary").textContent=names[r.aspect]+" · "+Number(r.zoom).toFixed(2)+"×";
  if(S.job?.has_video) requestAnimationFrame(layoutStage);
}

function reframeSceneFromControls() {
  return {aspect:$("reframeAspect").value,zoom:Number($("reframeZoom").value),
    focus_x:Number($("reframeX").value),focus_y:Number($("reframeY").value)};
}
function updateReframe() {
  if(!S.job?.has_video)return;
  const next=reframeSceneFromControls();
  try { freeeditCropRect(S.job.width,S.job.height,next); }
  catch(error){ $("modeHint").textContent=error.message;return; }
  if(JSON.stringify(S.reframe)===JSON.stringify(next))return;
  commitEdit("scene:reframe",state=>{state.reframe=next;});
  syncReframeControls();
}
for(const id of ["reframeAspect","reframeZoom","reframeX","reframeY"]){
  const input=$(id);
  input.addEventListener("change",event=>{
    if(!event.target.dataset.dragging)updateReframe();
    delete event.target.dataset.dragging;
  });
  if(id!=="reframeAspect")input.addEventListener("input",event=>{
    if(!event.target.dataset.dragging){checkpoint();event.target.dataset.dragging="1";}
    const next=reframeSceneFromControls();
    try {freeeditCropRect(S.job.width,S.job.height,next);}
    catch(error){$("modeHint").textContent=error.message;return;}
    commitEdit("scene:reframe",state=>{state.reframe=next;},false);
    syncReframeControls();
  });
}
$("reframeReset").onclick=()=>{
  commitEdit("reframe:reset",state=>{
    state.reframe=reframeDefaults();
    state.edits=state.edits.filter(edit=>edit.type!=="reframe");
    if(!state.edits.some(edit=>edit.id===state.selected))state.selected=null;
  });
  syncReframeControls();
  syncZoomSelection();
};

$("captionImportBtn").onclick=()=>$("captionInput").click();
$("captionInput").onchange=async event=>{
  const input=event.target,file=input.files?.[0];input.value="";
  if(!file||!S.job?.has_video)return;
  try{
    if(file.size>1000000)throw new Error("Choose an SRT file under 1 MB.");
    const cues=freeeditParseSrt(await file.text(),duration());
    const limit = EditorModel.limitError([...S.edits, ...cues.map(cue => ({...cue, type: "text"}))]);
    if (limit) throw new Error(limit);
    const fontSize=Math.max(16,Math.round(S.job.height*.045));
    const captions=cues.map(cue=>{
      const caption={id:S.nextId++,type:"text",start:cue.start,end:cue.end,
        text:cue.text,fontSize,font:"sans",bg:"dark",color:"#ffffff",bold:true,x:0,y:0};
      const size=textMetrics(caption);
      caption.w=size.w;caption.h=size.h;
      caption.x=Math.round(Math.max(0,(S.job.width-size.w)/2));
      caption.y=Math.round(Math.max(0,S.job.height-size.h-S.job.height*.06));
      return caption;
    });
    commitEdit("captions:import",state=>{
      state.edits.push(...captions);
      state.selected=captions[0].id;
    });
    $("captionStatus").textContent="Imported "+cues.length+" editable captions.";
    window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"selection"}));
  }catch(error){$("captionStatus").textContent=error.message;}
};

function renderReframeSections(){
  const list=$("reframeSections");if(!list)return;
  list.replaceChildren();
  const sections=zoomSections();
  for(const section of sections){
    const row=document.createElement("div");row.className="reframe-section";
    const label=document.createElement("span");
    label.textContent=fmt(section.start)+"–"+fmt(section.end)+" · "+section.zoom.toFixed(2)+"× · "+section.transition.toFixed(2)+"s easing";
    const editButton=document.createElement("button");
    editButton.type="button";editButton.textContent="Edit";
    editButton.onclick=()=>selectZoom(section.id);
    const remove=document.createElement("button");
    remove.type="button";remove.textContent="Remove";
    remove.onclick=()=>deleteEdit(section.id);
    row.append(label,editButton,remove);list.append(row);
  }
  if(!sections.length)list.textContent="No timed portions. Whole-video settings apply throughout.";
}

$("reframeAddSection").onclick=()=>{
  if(!S.job?.has_video)return;
  const section={type:"reframe",id:S.nextId,
    start:$("reframeStart").valueAsNumber,end:$("reframeEnd").valueAsNumber,
    zoom:Number($("reframeSectionZoom").value),
    focus_x:Number($("reframeSectionX").value),
    focus_y:Number($("reframeSectionY").value),
    transition:$("reframeTransition").valueAsNumber};
  const error=EditorModel.validateReframe(section,duration(),S.edits);
  if(error){$("reframeStatus").textContent=error;return;}
  if (!admitEdits([section])) return;
  S.nextId++;
  commitEdit("edit:add-reframe",state=>{
    state.edits.push(section);
    state.selected=section.id;
  });
  sourcePlayer().currentTime=(section.start+section.end)/2;
  $("reframeStatus").textContent="Added "+fmt(section.start)+"–"+fmt(section.end)+
    ". Open Edits to adjust this Reframe.";
  selectZoom(section.id);
};
$("reframeSectionZoom").oninput=()=>{
  $("reframeSectionZoomLabel").textContent=Number($("reframeSectionZoom").value).toFixed(2)+"×";
  render();
};
for(const id of ["reframeSectionX","reframeSectionY"])$(id).addEventListener("input",render);
for(const [button,field]of [["reframeStartNow","reframeStart"],["reframeEndNow","reframeEnd"]])
  $(button).onclick=()=>{$(field).value=sourcePlayer().currentTime.toFixed(2);};

window.addEventListener("freeedit:workspace",event=>{
  if(event.detail==="open"){
    $("reframeWholeGroup").open=$("reframePortionGroup").open=false;
    $("reframeStatus").textContent="";
    $("reframeSectionZoom").value=1.8;
    $("reframeSectionZoomLabel").textContent="1.80×";
    $("reframeSectionX").value=$("reframeSectionY").value=.5;
    $("reframeStart").max=$("reframeEnd").max=duration();
    $("reframeStart").value=0;
    $("reframeEnd").value=Math.min(3,duration());
    renderReframeSections();
  }else if(event.detail==="reframe-restore"){
    renderReframeSections();renderList();
  }
});

function syncZoomSelection(){
  const selected=selectedReframe();
  const panel=$("selectedZoomPanel");
  show(panel,!!selected);
  if(!selected)return;
  for(const [id,value]of Object.entries({
    selectedZoomStart:selected.start,selectedZoomEnd:selected.end,
    selectedZoomStrength:selected.zoom,selectedZoomX:selected.focus_x,
    selectedZoomY:selected.focus_y,selectedZoomTransition:selected.transition
  }))$(id).value=value;
  $("selectedZoomStrengthLabel").textContent=selected.zoom.toFixed(2)+"×";
  $("selectedZoomError").textContent="";
}
function selectZoom(id){
  const edit=getEdit(id);if(edit?.type!=="reframe")return;
  sourcePlayer().pause();
  select(id);
  sourcePlayer().currentTime=(edit.start+edit.end)/2;
  syncZoomSelection();
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"zoom-selection"}));
  layoutStage();
}
function renderZoomSelectList(){
  const list=$("editsList");if(!list)return;
  list.querySelectorAll(".zoom-edit-row").forEach(node=>node.remove());
  const scene=S.reframe,sections=zoomSections();
  const whole=!!scene&&(scene.aspect!=="original"||scene.zoom>1.001);
  $("editCount").textContent=S.edits.length+Number(whole);
  show($("editsEmpty"),S.edits.length===0&&!whole);
  if(whole){
    const row=document.createElement("div");row.className="zoom-edit-row";
    row.dataset.start="0";
    const open=document.createElement("button");open.type="button";
    open.textContent="Whole-video Reframe · "+scene.zoom.toFixed(2)+"× · "+scene.aspect;
    open.onclick=()=>{
      $("reframeWholeGroup").open=true;
      window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"reframe-settings"}));
    };
    const remove=document.createElement("button");remove.type="button";
    remove.className="mini reframe-remove";remove.textContent="Remove";
    remove.onclick=()=>{
      commitEdit("scene:reset-reframe",state=>{state.reframe=reframeDefaults();});
      syncReframeControls();
    };
    row.append(open,remove);list.append(row);
  }
  for(const edit of sections){
    const row=document.createElement("div");row.className="zoom-edit-row";
    row.dataset.start=String(edit.start);
    const button=document.createElement("button");button.type="button";
    button.dataset.editId=String(edit.id);
    button.setAttribute("aria-pressed",String(S.selected===edit.id));
    button.textContent=cardTitle(edit);
    button.onclick=()=>selectZoom(edit.id);
    row.append(button);list.append(row);
  }
  [...list.children].sort((a,b)=>Number(a.dataset.start||0)-Number(b.dataset.start||0))
    .forEach(child=>list.append(child));
  syncZoomSelection();
}
function renderZoomTimeline(){
  const track=$("zoomTrack"),label=$("zoomLabelTrack");
  if(!track||!S.job)return;
  show(track,S.job.has_video);show(label,S.job.has_video);
  track.replaceChildren();
  for(const edit of zoomSections()){
    const block=document.createElement("button");block.type="button";
    block.className="timeline-block zoom"+(S.selected===edit.id?" selected":"");
    block.style.left=(edit.start/duration()*100)+"%";
    block.style.width=((edit.end-edit.start)/duration()*100)+"%";
    block.dataset.editId=String(edit.id);
    block.textContent="Reframe "+edit.zoom.toFixed(2)+"×";
    block.setAttribute("aria-label","Select Reframe "+fmt(edit.start)+" to "+fmt(edit.end));
    for (const side of ["l", "r"]) {
      const handle = document.createElement("span"); handle.className = "edge " + side;
      handle.setAttribute("aria-hidden", "true"); block.append(handle);
    }
    block.title = "Drag to move; drag edges to resize. Select to edit zoom and focus.";
    block.onpointerdown = event => dragReframeSection(event, edit.id);
    block.onclick=()=>selectZoom(edit.id);
    track.append(block);
  }
}

function dragReframeSection(event, id) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const section = getEdit(id), ordered = zoomSections(), index = ordered.indexOf(section);
  const edge = event.target.closest(".edge");
  const part = edge?.classList.contains("l") ? "start" : edge ? "end" : "move";
  const initial = {...section}, origin = event.clientX, width = $("timelineContent").clientWidth;
  selectZoom(id); timeline.dragging = "reframe";
  const target = $("zoomTrack").querySelector(`[data-edit-id="${id}"]`);
  target.setPointerCapture(event.pointerId);
  const left = ordered[index-1]?.end || 0, right = ordered[index+1]?.start ?? duration();
  let moved = false;
  const move = next => {
    if (next.pointerId !== event.pointerId || (!moved && Math.abs(next.clientX-origin) < 3)) return;
    if (!moved) { checkpoint(); moved = true; }
    const dt = (next.clientX-origin)/width*duration(), minLength = Math.min(.1, initial.end-initial.start);
    const updated = {...initial};
    if (part === "start") updated.start = clamp(initial.start+dt, left, initial.end-minLength);
    else if (part === "end") updated.end = clamp(initial.end+dt, initial.start+minLength, right);
    else {
      const delta = clamp(dt, left-initial.start, right-initial.end);
      updated.start = initial.start+delta; updated.end = initial.end+delta;
    }
    updated.start = +updated.start.toFixed(3); updated.end = +updated.end.toFixed(3);
    if (EditorModel.validateReframe(updated, duration(), S.edits, id)) return;
    editorStore.dispatch("edit:drag", state => Object.assign(state.edits.find(edit=>edit.id===id), updated));
    positionTimelineBlock(target, updated); syncZoomSelection();
    sourcePlayer().currentTime = (updated.start+updated.end)/2;
  };
  const finish = next => {
    if (next.pointerId !== event.pointerId) return;
    target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", finish); target.removeEventListener("pointercancel", finish);
    if (next.type === "pointercancel") editorStore.dispatch("edit:drag", state => Object.assign(state.edits.find(edit=>edit.id===id), initial));
    timeline.dragging = null;
    renderReframeSections(); renderZoomSelectList(); renderTimeline(); render();
  };
  target.addEventListener("pointermove", move); target.addEventListener("pointerup", finish); target.addEventListener("pointercancel", finish);
}

for(const [id,key]of Object.entries({
  selectedZoomStart:"start",selectedZoomEnd:"end",selectedZoomStrength:"zoom",
  selectedZoomX:"focus_x",selectedZoomY:"focus_y",selectedZoomTransition:"transition"
})){
  const input=$(id),sliding=input.type==="range";
  if(sliding)input.addEventListener("change",()=>{delete input.dataset.dragging;});
  input.addEventListener(sliding?"input":"change",()=>{
    const old=selectedReframe();if(!old)return;
    const next={...old,[key]:Number(input.value)};
    const error=EditorModel.validateReframe(next,duration(),S.edits,old.id);
    if(error){
      $("selectedZoomError").textContent=error;
      input.value=old[key];return;
    }
    const saveUndo=!sliding||!input.dataset.dragging;
    if(sliding)input.dataset.dragging="1";
    commitEdit("edit:update-reframe",state=>{
      const index=state.edits.findIndex(edit=>edit.id===old.id);
      state.edits[index]=next;
    },saveUndo);
  });
}
$("selectedZoomRemove").onclick=()=>{
  const edit=selectedReframe();if(edit)deleteEdit(edit.id);
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
  return selectedReframe() && !$("workspace-edits")?.hidden &&
    !$("selectedZoomPanel").classList.contains("hidden") ? selectedReframe() : null;
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
