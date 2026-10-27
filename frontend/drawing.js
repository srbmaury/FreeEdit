"use strict";

// Each completed stroke is an annotation, so existing history, recovery, timing,
// movement and export apply without a second document or raster-only asset.
let drawingTool = "pen";
let previousDrawingMode = "select";
const drawingSelection = new Set();
function drawingTimes() {
  const start=$("drawingStart").valueAsNumber,end=$("drawingEnd").valueAsNumber;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration()||end<=start){
    $("drawingMessage").textContent="Choose a start and end inside the recording.";
    return null;
  }
  return {start,end};
}
function drawingStyle() {
  const width=$("drawingWidth").valueAsNumber;
  const opacity=Number($("drawingOpacity").value);
  if(!Number.isFinite(width)||width<1||width>80||!Number.isFinite(opacity)||opacity<.1||opacity>1){
    $("drawingMessage").textContent="Choose a width from 1 to 80 and a valid opacity.";
    return null;
  }
  return {color:$("drawingColor").value,opacity,width};
}
function eraseDrawingAt(point) {
  const tolerance=6*S.job.width/canvas.getBoundingClientRect().width;
  const hit=[...S.edits].reverse().find(e=>e.type==="annotation"&&e.kind==="drawing"&&
    isActive(e,video.currentTime)&&AnnotationModel.animationState(e,video.currentTime).alpha>0&&
    DrawingModel.hit(e,{x:point.x-AnnotationModel.animationState(e,video.currentTime).dx,y:point.y},tolerance));
  if(!hit)return;
  const dx=AnnotationModel.animationState(hit,video.currentTime).dx;
  const index=DrawingModel.hitIndex(hit,{x:point.x-dx,y:point.y},tolerance);
  commitEdit("drawing:erase",state=>{
    if(DrawingModel.isGroup(hit)&&hit.strokes.length>1)hit.strokes.splice(index,1);
    else state.edits=state.edits.filter(e=>e.id!==hit.id);
    state.selected=null;
  });
  $("drawingMessage").textContent="Stroke erased. Undo restores it.";
}
function beginDrawingStroke(point,pointerId) {
  sourcePlayer().pause();
  if(drawingTool==="eraser"){
    S.drag={kind:"drawing",erase:true,pointerId};
    eraseDrawingAt(point);return;
  }
  const times=drawingTimes(),style=drawingStyle();
  if(!times||!style)return;
  if(!admitEdits([{type:"annotation"}]))return;
  if(video.currentTime<times.start||video.currentTime>=times.end)video.currentTime=times.start;
  S.selected=null;
  S.drag={kind:"drawing",pointerId,points:[point],...times,...style};
  $("drawingMessage").textContent="";
  render();
}
function extendDrawingStroke(stroke,point,pointerId) {
  if(stroke.pointerId!==pointerId)return;
  if(stroke.erase){eraseDrawingAt(point);return;}
  const last=stroke.points.at(-1);
  if(Math.hypot(point.x-last.x,point.y-last.y)<Math.max(.5,stroke.width/8))return;
  if(stroke.points.length>=DrawingModel.MAX_POINTS){
    // Keep the whole gesture bounded without truncating its end.
    stroke.points=stroke.points.filter((_,i)=>i%2===0||i===stroke.points.length-1);
  }
  stroke.points.push(point);
}
function drawingEdit(stroke) {
  return {...AnnotationModel.defaultEdit("drawing",S.job.width,S.job.height,stroke.start,stroke.end),
    ...DrawingModel.stroke(stroke.points,stroke.width),color:stroke.color,opacity:stroke.opacity};
}
function paintPendingDrawing(context,stroke) {
  if(!stroke.erase) {
    const edit=drawingEdit(stroke);
    paintAnnotation(context,edit,edit.x,edit.y,stroke.start,false);
  }
}
function finishDrawingStroke(stroke) {
  if(stroke.erase)return;
  const edit=drawingEdit(stroke);
  const error=AnnotationModel.validate(edit,duration(),S.job.width,S.job.height);
  if(error){$("drawingMessage").textContent=error;return;}
  if(!admitEdits([edit]))return;
  edit.id=S.nextId++;
  commitEdit("drawing:add",state=>{state.edits.push(edit);state.selected=null;});
  $("drawingMessage").textContent="Stroke added. Keep drawing, or choose Done drawing to adjust timing and position.";
}
for(const button of $("drawingPanel").querySelectorAll("[data-drawing-tool]")){
  button.onclick=()=>{
    drawingTool=button.dataset.drawingTool;
    for(const choice of $("drawingPanel").querySelectorAll("[data-drawing-tool]"))
      choice.setAttribute("aria-pressed",String(choice===button));
    if(drawingTool==="highlighter"){
      $("drawingWidth").value="24";$("drawingOpacity").value="0.35";$("drawingColor").value="#facc15";
    }else if(drawingTool==="pen"){
      $("drawingWidth").value="6";$("drawingOpacity").value="1";
    }
    setMode("draw");
  };
}
$("drawingDoneBtn").onclick=()=>chooseSelectTool();
$("drawingClearBtn").onclick=()=>{
  const range=drawingTimes();if(!range)return;
  const remove=S.edits.filter(e=>e.type==="annotation"&&e.kind==="drawing"&&e.start<range.end&&e.end>range.start);
  if(!remove.length){$("drawingMessage").textContent="No drawings in this time range.";return;}
  const ids=new Set(remove.map(e=>e.id));
  commitEdit("drawing:clear",state=>{state.edits=state.edits.filter(e=>!ids.has(e.id));state.selected=null;});
  $("drawingMessage").textContent="Drawings cleared from this range. Undo restores them.";
};
window.addEventListener("freeedit:workspace",event=>{
  if(event.detail!=="mode"&&event.detail!=="open")return;
  if(S.mode==="draw"&&previousDrawingMode!=="draw"&&S.job?.has_video){
    const start=Math.min(Math.max(0,video.currentTime||0),Math.max(0,duration()-.1));
    $("drawingStart").value=start.toFixed(2);
    $("drawingEnd").value=Math.min(duration(),start+3).toFixed(2);
    $("drawingMessage").textContent="";
  }
  previousDrawingMode=S.mode;
});


function refreshDrawingGroups() {
  const list=$("drawingGroupChoices");
  list.replaceChildren();
  const drawings=S.edits.filter(e=>e.type==="annotation"&&e.kind==="drawing");
  for(const id of drawingSelection)if(!drawings.some(e=>e.id===id))drawingSelection.delete(id);
  if(!drawings.length){
    const empty=document.createElement("p");empty.className="small";empty.textContent="Draw two strokes to create a group.";list.append(empty);
  }
  drawings.forEach((e,index)=>{
    const label=document.createElement("label"),input=document.createElement("input"),name=document.createElement("span");
    input.type="checkbox";input.value=String(e.id);input.checked=drawingSelection.has(e.id);
    input.setAttribute("aria-label","Select drawing "+(index+1));
    name.textContent=(DrawingModel.isGroup(e)?"Group of "+e.strokes.length+" strokes":"Stroke "+(index+1))+" · "+fmt(e.start)+"–"+fmt(e.end);
    input.onchange=()=>{
      if(input.checked)drawingSelection.add(e.id);else drawingSelection.delete(e.id);
      $("drawingGroupBtn").disabled=drawingSelection.size<2;
    };
    label.append(input,name);list.append(label);
  });
  $("drawingGroupBtn").disabled=drawingSelection.size<2;
}
function groupSelectedDrawings() {
  const selected=S.edits.filter(e=>drawingSelection.has(e.id)&&e.type==="annotation"&&e.kind==="drawing");
  if(selected.length<2)return;
  const count=selected.reduce((n,e)=>n+(DrawingModel.isGroup(e)?e.strokes.length:1),0);
  const pointCount=selected.reduce((n,e)=>n+(DrawingModel.isGroup(e)?e.strokes:[e]).reduce((sum,s)=>sum+s.points.length,0),0);
  if(count>DrawingModel.MAX_STROKES||pointCount>DrawingModel.MAX_GROUP_POINTS){
    $("drawingMessage").textContent="This group is too detailed. Select fewer strokes (up to 100 strokes and 20,000 points).";return;
  }
  const start=Math.min(...selected.map(e=>e.start)),end=Math.max(...selected.map(e=>e.end));
  const group={...AnnotationModel.defaultEdit("drawing",S.job.width,S.job.height,start,end),
    ...DrawingModel.group(selected)};
  // Shared explicit shift preserves slide motion if the group is later ungrouped.
  group.animationShift=Math.max(8,Math.round(Math.min(90,group.w*.4)));
  const error=AnnotationModel.validate(group,duration(),S.job.width,S.job.height);
  if(error){$("drawingMessage").textContent=error;return;}
  const ids=new Set(selected.map(e=>e.id));
  group.id=S.nextId++;
  drawingSelection.clear();
  commitEdit("drawing:group",state=>{
    // Place the group where its uppermost member was, keeping unrelated edits
    // in their existing order. Grouped strokes retain their own paint order.
    const last=state.edits.findLastIndex(e=>ids.has(e.id));
    state.edits=state.edits.flatMap((e,i)=>i===last?[group]:ids.has(e.id)?[]:[e]);
    state.selected=group.id;
  });
  sourcePlayer().pause();sourcePlayer().currentTime=start;
  chooseSelectTool();select(group.id);
}
function ungroupDrawing(group) {
  if(!S.job||!S.edits.includes(group)||!DrawingModel.isGroup(group))return;
  const members=DrawingModel.worldStrokes(group).map(s=>({
    ...AnnotationModel.defaultEdit("drawing",S.job.width,S.job.height,group.start,group.end),
    ...DrawingModel.stroke(s.points,s.width),color:s.color,opacity:s.opacity,
    animation:group.animation,transition:group.transition,
    animationShift:group.animationShift ?? Math.max(8,Math.round(Math.min(90,group.w*.4)))
  }));
  const error=members.map(e=>AnnotationModel.validate(e,duration(),S.job.width,S.job.height)).find(Boolean)||
    EditorModel.limitError([...S.edits.filter(e=>e!==group),...members]);
  if(error){showProjectMessage("Cannot ungroup this drawing",error,null,"OK");return;}
  for(const e of members)e.id=S.nextId++;
  drawingSelection.clear();
  commitEdit("drawing:ungroup",state=>{
    state.edits=state.edits.flatMap(e=>e===group?members:[e]);state.selected=members[0].id;
  });
  select(members[0].id);
}
$("drawingGroupBtn").onclick=groupSelectedDrawings;
editorStore.subscribe(({reason})=>{
  if(reason==="history:restore")drawingSelection.clear();
  refreshDrawingGroups();
});
window.addEventListener("freeedit:workspace",event=>{
  if(event.detail==="open"){drawingSelection.clear();refreshDrawingGroups();}
});
refreshDrawingGroups();
