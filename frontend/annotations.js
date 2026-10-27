"use strict";

// Annotations share a single edit type and project timeline. Rasterized assets
// are used by both the browser preview and final FFmpeg overlay.
const annotationImages = new Map();
function annotationImage(edit){
  if(!edit.image)return null;
  let value=annotationImages.get(edit.image);
  if(!value){
    value=new Image();value.src=edit.image;value.onload=()=>render();
    annotationImages.set(edit.image,value);
    if(annotationImages.size>128)annotationImages.delete(annotationImages.keys().next().value);
  }
  return value.complete&&value.naturalWidth?value:null;
}
const ANNOTATION_ICON_PATHS = Object.freeze({
  check:"M5 12l4 4L19 6",
  warning:"M12 3 2 21h20L12 3z M12 9v5 M12 17h.01",
  star:"M12 2l3.1 6.3 7 .99-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2l-5-4.9 7-.99L12 2z",
  info:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 10v6 M12 7h.01",
  lightbulb:"M9 17h6 M10 20h4 M9 14a7 7 0 1 1 6 0l-1 3h-4l-1-3z",
  heart:"M20 9c0 5-8 11-8 11S4 14 4 9a4.5 4.5 0 0 1 8-2 4.5 4.5 0 0 1 8 2z"
});
function iconPreviewSvg(name) {
  const path=ANNOTATION_ICON_PATHS[name] || ANNOTATION_ICON_PATHS.check;
  return '<svg viewBox="0 0 24 24" role="img" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="'+path+'"/></svg>';
}
function drawIconPath(c, name, size) {
  c.save();
  c.scale(size/24,size/24);
  c.translate(-12,-12);
  c.strokeStyle="#ffffff";
  c.lineWidth=2.2;
  c.stroke(new Path2D(ANNOTATION_ICON_PATHS[name] || ANNOTATION_ICON_PATHS.check));
  c.restore();
}
function paintAnnotation(c,e,x,y,t=video.currentTime,animated=true){
  const state=animated?AnnotationModel.animationState(e,t):{alpha:1,dx:0};
  c.save();
  c.globalAlpha=e.opacity*state.alpha;
  if(e.kind==="spotlight"){
    // Even-odd fill leaves the aperture transparent, revealing the complete
    // composition beneath it without sampling or duplicating video pixels.
    const ox=x-e.x,oy=y-e.y,W=S.job.width,H=S.job.height;
    c.fillStyle=e.color;c.beginPath();c.rect(ox,oy,W,H);
    const angle=e.rotation*Math.PI/180;
    c.moveTo(x+e.w/2+state.dx+e.w/2*Math.cos(angle),y+e.h/2+e.w/2*Math.sin(angle));
    c.ellipse(x+e.w/2+state.dx,y+e.h/2,e.w/2,e.h/2,angle,0,Math.PI*2);
    c.fill("evenodd");c.restore();return;
  }
  c.translate(x+e.w/2+state.dx,y+e.h/2);
  c.rotate(e.rotation*Math.PI/180);
  const w=e.w,h=e.h;
  c.strokeStyle=e.color;c.fillStyle=e.color;
  c.lineWidth=Math.max(3,Math.min(w,h)*.07);
  c.lineCap="round";c.lineJoin="round";
  if(e.kind==="click"){
    c.beginPath();c.ellipse(0,0,w*.43,h*.43,0,0,Math.PI*2);
    c.save();c.globalAlpha*=.18;c.fill();c.restore();c.stroke();
    c.beginPath();c.arc(0,0,Math.min(w,h)*.07,0,Math.PI*2);c.fill();
  } else if(e.kind==="drawing"){
    DrawingModel.paint(c,e);
  } else if(e.kind==="image"){
    const img=annotationImage(e);if(img)c.drawImage(img,-w/2,-h/2,w,h);
  } else if(e.kind==="shape"){
    if(e.shape==="ellipse"){c.beginPath();c.ellipse(0,0,w*.47,h*.47,0,0,Math.PI*2);c.stroke();}
    else c.strokeRect(-w*.47,-h*.47,w*.94,h*.94);
  } else if(e.kind==="arrow"){
    c.beginPath();c.moveTo(-w*.46,h*.3);c.lineTo(w*.36,-h*.3);
    c.lineTo(w*.04,-h*.3);c.moveTo(w*.36,-h*.3);c.lineTo(w*.30,h*.05);c.stroke();
  } else if(e.kind==="callout"){
    c.beginPath();c.roundRect(-w/2,-h/2,w,h,Math.min(20,h*.20));c.fill();
    c.beginPath();c.moveTo(-w*.3,h/2);c.lineTo(-w*.17,h/2+Math.min(h*.15,15));c.lineTo(-w*.12,h/2);c.fill();
    c.fillStyle="#ffffff";c.textAlign="center";c.textBaseline="middle";
    c.font=`600 ${Math.max(12,Math.min(28,h*.31))}px sans-serif`;
    const label=e.text||"Callout";c.fillText(label.slice(0,40),0,0,w*.90);
  } else {
    c.beginPath();c.arc(0,0,Math.min(w,h)*.44,0,Math.PI*2);c.fill();
    drawIconPath(c,e.icon,Math.min(w,h)*.54);
  }
  c.restore();
}
async function prepareAnnotationAssets(){
  for(const e of S.edits){
    if(e.type!=="annotation"||e.kind!=="image"||!e.image)continue;
    const img=annotationImage(e);
    if(img)continue;
    const loading=annotationImages.get(e.image);
    try{await loading.decode();}catch{throw Error("Annotation image could not be decoded. Replace the image and retry.");}
  }
}
function annotationPayload(e){
  const bounds=AnnotationModel.rasterBounds(e,S.job.width,S.job.height);
  const c=document.createElement("canvas");
  const scale=e.kind==="spotlight"?Math.min(1,1024/Math.max(bounds.w,bounds.h)):1;
  c.width=Math.max(1,Math.round(bounds.w*scale));c.height=Math.max(1,Math.round(bounds.h*scale));
  const context=c.getContext("2d");context.scale(c.width/bounds.w,c.height/bounds.h);
  paintAnnotation(context,e,e.x-bounds.x,e.y-bounds.y,e.start,false);
  return {type:"annotation",start:e.start,end:e.end,x:bounds.x,y:bounds.y,
    ...(e.kind==="spotlight"?{canvas_size:[S.job.width,S.job.height]}:{}),
    image:c.toDataURL("image/png"),animation:e.animation,transition:e.transition,
    shift:e.animationShift ?? Math.max(8,Math.round(Math.min(90,e.w*.4)))};
}
// The selected visual tool is transient UI state. Only placed annotations
// belong in the editor document and are saved in projects/undo history.
const annotationPicker = {
  kind: "icon", icon: "check", shape: "rectangle",
  preset: null, animation: "none", pendingImage: null, pendingAspect: 1.5,
};
const annotationKinds = [
  {value:"icon",label:"Icons",symbol:"check"},
  {value:"shape",label:"Shapes",svg:'<rect x="4" y="4" width="16" height="16" rx="2"/>'},
  {value:"arrow",label:"Arrows",svg:'<path d="M4 17 19 6M11 6h8v8"/>'},
  {value:"callout",label:"Callouts",svg:'<path d="M4 4h16v13H9l-5 4V4z M8 9h8M8 13h5"/>'},
  {value:"spotlight",label:"Cursor spotlight",svg:'<circle cx="12" cy="12" r="5"/><path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5"/>'},
  {value:"click",label:"Click highlight",svg:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'},
  {value:"image",label:"Images",svg:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 3 3 4-5 6 7"/>'}
];
const annotationIconLabels = {
  check:"Check", warning:"Warning", star:"Star",
  info:"Information", lightbulb:"Idea", heart:"Heart"
};
const annotationShapes = [
  {value:"rectangle",label:"Rectangle",svg:'<rect x="3" y="5" width="18" height="14" rx="2"/>'},
  {value:"ellipse",label:"Circle",svg:'<circle cx="12" cy="12" r="9"/>'}
];
const annotationPresetLabels = {
  success:"Success", warning:"Warning", tip:"Tip",
  step:"Step", highlight:"Highlight"
};
function annotationTileSymbol(symbol,svg) {
  if(symbol)return iconPreviewSvg(symbol);
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg>';
}
function createAnnotationChoice(container, group, value, label, graphic, handler) {
  const button=document.createElement("button");
  button.type="button";
  button.className="annotation-choice";
  button.dataset.choiceGroup=group;
  button.dataset.choiceValue=value;
  button.setAttribute("aria-label",label);
  button.setAttribute("aria-pressed","false");
  const symbol=document.createElement("span");
  symbol.className="annotation-choice-graphic";
  // Graphics are authored SVG paths only, never user-supplied markup.
  symbol.innerHTML=graphic;
  const name=document.createElement("span");
  name.className="annotation-choice-title";
  name.textContent=label;
  button.append(symbol,name);
  button.onclick=handler;
  container.append(button);
  return button;
}
function makeAnnotationChoiceGroups() {
  for(const kind of annotationKinds) {
    const graphic=annotationTileSymbol(kind.symbol,kind.svg);
    createAnnotationChoice($("annotationTypePicker"),"kind",kind.value,kind.label,graphic,()=>{
      if(kind.value==="image" && !annotationPicker.pendingImage){
        $("annotationUploadInput").click();
        return;
      }
      annotationPicker.kind=kind.value;annotationPicker.preset=null;
      if(["spotlight","click"].includes(kind.value))annotationPicker.animation="fade";
      armAnnotationPlacement();
    });
  }
  for(const icon of AnnotationModel.ICONS) {
    createAnnotationChoice($("annotationIconPicker"),"icon",icon,annotationIconLabels[icon],
      iconPreviewSvg(icon),()=>{
        annotationPicker.kind="icon";annotationPicker.icon=icon;
        annotationPicker.preset=null;armAnnotationPlacement();
      });
  }
  for(const shape of annotationShapes) {
    createAnnotationChoice($("annotationShapePicker"),"shape",shape.value,shape.label,
      annotationTileSymbol(null,shape.svg),()=>{
        annotationPicker.kind="shape";annotationPicker.shape=shape.value;
        annotationPicker.preset=null;armAnnotationPlacement();
      });
  }
  for(const [preset,value] of Object.entries(AnnotationModel.PRESETS)){
    let graphic=preset==="success" ? iconPreviewSvg("check")
      :preset==="warning" ? iconPreviewSvg("warning")
      :preset==="highlight" ? annotationTileSymbol(null,annotationShapes[0].svg)
      :annotationTileSymbol(null,annotationKinds.find(item=>item.value==="callout").svg);
    createAnnotationChoice($("annotationPresetPicker"),"preset",preset,annotationPresetLabels[preset],
      graphic,()=>{
        annotationPicker.preset=preset;
        annotationPicker.kind=value.kind;
        if(value.icon)annotationPicker.icon=value.icon;
        if(value.shape)annotationPicker.shape=value.shape;
        armAnnotationPlacement();
      });
  }
  for(const animation of AnnotationModel.ANIMATIONS) {
    const name=animation==="none"?"None":animation==="fade"?"Fade":"Slide";
    createAnnotationChoice($("annotationAnimationPicker"),"animation",animation,name,
      animation==="none" ? annotationTileSymbol(null,'<path d="M5 12h14"/>')
      :animation==="fade" ? annotationTileSymbol(null,'<circle cx="12" cy="12" r="8" opacity=".5"/>')
      : annotationTileSymbol(null,'<path d="M4 12h16m-6-6 6 6-6 6"/>'),()=>{
        annotationPicker.animation=animation;
        refreshAnnotationPicker();
      });
  }
  refreshAnnotationPicker();
}
function refreshAnnotationPicker(){
  for(const button of $("annotationsPanel").querySelectorAll("[data-choice-group]")){
    const group=button.dataset.choiceGroup;
    button.disabled=group==="animation" && button.dataset.choiceValue==="slide" && annotationPicker.kind==="spotlight";
    const value=group==="kind" ? annotationPicker.kind :
      group==="icon" ? annotationPicker.icon :
      group==="shape" ? annotationPicker.shape :
      group==="preset" ? annotationPicker.preset :
      annotationPicker.animation;
    button.setAttribute("aria-pressed",String(value===button.dataset.choiceValue));
  }
  show($("annotationIconSection"),annotationPicker.kind==="icon");
  show($("annotationShapeSection"),annotationPicker.kind==="shape");
  const label=annotationPicker.kind==="image"?"logo":annotationPicker.kind==="spotlight"?"spotlight":annotationPicker.kind==="click"?"click highlight":annotationPicker.kind;
  $("addAnnotationBtn").textContent="Place "+label+" at center";
  $("annotationUploadBtn").classList.toggle("has-upload",!!annotationPicker.pendingImage);
  $("annotationUploadBtn").querySelector("strong").textContent=
    annotationPicker.pendingImage ? "Logo ready — replace image" : "Upload image or logo";
  const uploadNote=$("annotationUploadBtn").querySelector("small");
  uploadNote.textContent=annotationPicker.pendingImage ? "Click the video to place it" : "PNG, JPG or WebP · up to 750 KB";
}
function annotationDefaultTimesFromPlayhead(){
  const d=duration();if(!d)return;
  const playhead=Math.max(0,Math.min(sourcePlayer().currentTime||0,d-.1));
  const start=Math.max(0,Math.min(playhead,Math.max(0,d-.1)));
  $("annotationStart").value=start.toFixed(2);
  $("annotationEnd").value=Math.min(d,start+(annotationPicker.kind==="click"?.7:3)).toFixed(2);
}
function armAnnotationPlacement(){
  if(!S.job?.has_video)return;
  sourcePlayer().pause();
  annotationDefaultTimesFromPlayhead();
  refreshAnnotationPicker();
  setMode("annotation");
  $("annotationMessage").textContent="Click anywhere on the video to place the selected "+annotationPicker.kind+".";
}
function createAnnotationEditAt(x,y){
  if(!S.job?.has_video)return null;
  const start=$("annotationStart").valueAsNumber;
  const end=$("annotationEnd").valueAsNumber;
  const e=AnnotationModel.defaultEdit(annotationPicker.kind,S.job.width,S.job.height,
    start,end,annotationPicker.preset);
  e.icon=annotationPicker.icon;
  e.shape=annotationPicker.shape;
  e.animation=annotationPicker.animation;
  // Slide applies to local sprites; a full-frame spotlight uses Fade or None.
  if(e.kind==="spotlight" && e.animation==="slide")e.animation="fade";
  if(e.kind==="image"){
    if(!annotationPicker.pendingImage){
      $("annotationMessage").textContent="Upload a logo or picture first.";
      $("annotationUploadInput").click();
      return null;
    }
    e.image=annotationPicker.pendingImage;
    // Preserve the natural aspect ratio when initially stamping a logo.
    e.h=Math.max(16,Math.min(S.job.height,
      Math.round(e.w/annotationPicker.pendingAspect)));
  }
  e.x=Math.max(0,Math.min(Math.round(x-e.w/2),Math.max(0,S.job.width-e.w)));
  e.y=Math.max(0,Math.min(Math.round(y-e.h/2),Math.max(0,S.job.height-e.h)));
  const error=AnnotationModel.validate(e,duration(),S.job.width,S.job.height);
  if(error){$("annotationMessage").textContent=error;return null;}
  if(!admitEdits([e]))return null;
  e.id=S.nextId++;
  return e;
}
function positionExistingAnnotationAt(edit,x,y){
  if(!edit || edit.type!=="annotation" || !S.job?.has_video)return;
  const nextX=Math.max(0,Math.min(Math.round(x-edit.w/2),Math.max(0,S.job.width-edit.w)));
  const nextY=Math.max(0,Math.min(Math.round(y-edit.h/2),Math.max(0,S.job.height-edit.h)));
  if(edit.x===nextX && edit.y===nextY)return;
  commitEdit("annotation:position",()=>{
    edit.x=nextX;edit.y=nextY;
  });
}
function placeAnnotationAt(x,y){
  const e=createAnnotationEditAt(x,y);
  if(!e)return null;
  commitEdit("annotation:add",state=>{state.edits.push(e);state.selected=e.id;});
  // Always make the placed annotation visible, even if the user entered a
  // custom time range that does not include the current playback position.
  const t=sourcePlayer().currentTime;
  if(t<e.start||t>=e.end ||
     (e.animation!=="none" && t<e.start+Math.min(e.transition,(e.end-e.start)/2))){
    // On a paused frame, show the visible end of the entrance animation,
    // rather than leaving a just-placed fading icon invisible.
    sourcePlayer().currentTime=AnnotationModel.visibleTime(e);
  }
  $("annotationMessage").textContent="Placed. Drag or resize it on the video, or edit its settings under Edits.";
  render();
  return e;
}
async function readAnnotationFile(file){
  if(!file)throw Error("Choose a picture to continue.");
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>750000)
    throw Error("Use a PNG, JPG or WebP under 750 KB.");
  const image=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(Error("Could not read this image."));
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(Error("This image cannot be decoded."));
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
  if(image.width*image.height>16000000)
    throw Error("This picture is too large; choose one under 16 megapixels.");
  const canvas=document.createElement("canvas");
  let scale=Math.min(1,900/image.width,900/image.height);
  for(let attempt=0;attempt<5;attempt++){
    canvas.width=Math.max(1,Math.round(image.width*scale));
    canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL("image/png");
    if(data.length<=900000){
      // Cache the already-decoded PNG before arming placement. Otherwise an
      // uploaded logo can appear blank on the very first canvas paint while
      // a second Image object is decoded asynchronously.
      const decoded=new Image();
      decoded.src=data;
      await decoded.decode();
      annotationImages.set(data,decoded);
      return {data,aspect:image.width/image.height};
    }
    scale*=.75;
  }
  throw Error("This picture is too detailed to save as an overlay. Use a smaller image.");
}
async function loadAnnotationImage(edit,file){
  if(!file)return;
  try{
    const {data,aspect}=await readAnnotationFile(file);
    if(!S.job || !S.edits.includes(edit))return;
    const height=Math.max(16,Math.min(S.job.height,Math.round(edit.w/aspect)));
    const y=Math.min(edit.y,Math.max(0,S.job.height-height));
    const error=AnnotationModel.validate({...edit,image:data,h:height,y},duration(),S.job.width,S.job.height);
    if(error)throw Error(error);
    commitEdit("annotation:image",()=>{
      edit.image=data;
      edit.h=height;
      edit.y=y;
    });
    $("annotationMessage").textContent="Image updated. Drag or resize it directly on the recording.";
  }catch(error){$("annotationMessage").textContent=error.message;}
}
// Editing an existing annotation is separate from the creation palette.
// Always update the saved edit, not the pending style for the next annotation.
const animationStyleVisuals = Object.freeze({
  none: '<path d="M5 12h14"/>',
  fade: '<circle cx="12" cy="12" r="8" opacity=".5"/>',
  slide: '<path d="M4 12h16m-6-6 6 6-6 6"/>'
});
function changeAnnotationAnimation(edit, animation) {
  if(!S.job || !S.edits.includes(edit) ||
     !AnnotationModel.ANIMATIONS.includes(animation) || edit.kind==="spotlight" && animation==="slide")return;
  if(edit.animation!==animation){
    commitEdit("annotation:animation", state=>{
      const current=state.edits.find(item=>item.id===edit.id);
      if(current)current.animation=animation;
      state.selected=edit.id;
    });
  }else if(S.selected!==edit.id)select(edit.id);
  const current=getEdit(edit.id);
  if(!current)return;
  // Moving the playhead to an actual transition frame confirms the change
  // visually, even when the original playhead was outside this edit's range.
  sourcePlayer().pause();
  sourcePlayer().currentTime=AnnotationModel.previewTime(current);
  render();
}
function buildAnnotationAnimationControls(container,edit) {
  if(!container)return;
  container.replaceChildren();
  for(const animation of AnnotationModel.ANIMATIONS.filter(value=>edit.kind!=="spotlight"||value!=="slide")){
    const graphic=annotationTileSymbol(null,animationStyleVisuals[animation]);
    const label=animation==="none"?"None":animation==="fade"?"Fade":"Slide";
    const button=createAnnotationChoice(container,"animation",animation,label,graphic,()=>{
      changeAnnotationAnimation(edit,animation);
    });
    // A pointerdown on the containing edit card normally seeks to its start,
    // where a fade is fully transparent. Do not hijack this style control.
    button.addEventListener("pointerdown",event=>event.stopPropagation());
    button.setAttribute("aria-pressed",String(edit.animation===animation));
  }
}
function buildAnnotationInspectorChoices(container,edit,field){
  if(!container)return;
  container.replaceChildren();
  const options=field==="icon" ?
    AnnotationModel.ICONS.map(name=>({value:name,label:annotationIconLabels[name],svg:iconPreviewSvg(name)})) :
    annotationShapes.map(item=>({value:item.value,label:item.label,svg:annotationTileSymbol(null,item.svg)}));
  for(const option of options){
    const button=createAnnotationChoice(container,field,option.value,option.label,option.svg,()=>{
      if(!S.edits.includes(edit))return;
      commitEdit("annotation:style",()=>{edit[field]=option.value;});
    });
    button.setAttribute("aria-pressed",String(edit[field]===option.value));
  }
}
$("annotationUploadBtn").onclick=()=>$("annotationUploadInput").click();
$("annotationUploadInput").onchange=async event=>{
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file)return;
  try{
    const {data,aspect}=await readAnnotationFile(file);
    annotationPicker.pendingImage=data;
    annotationPicker.pendingAspect=aspect;
    annotationPicker.kind="image";
    annotationPicker.preset=null;
    armAnnotationPlacement();
  }catch(error){$("annotationMessage").textContent=error.message;}
};
$("addAnnotationBtn").onclick=()=>{
  if(!S.job?.has_video)return;
  const e=placeAnnotationAt(S.job.width/2,S.job.height/2);
  if(e){setMode("select");select(e.id);}
};
makeAnnotationChoiceGroups();
window.addEventListener("freeedit:workspace",event=>{
  if(event.detail!=="open")return;
  if(S.job?.has_video)annotationDefaultTimesFromPlayhead();
  refreshAnnotationPicker();
});
