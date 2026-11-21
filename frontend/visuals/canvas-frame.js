"use strict";
let canvasBackgroundImage = null, canvasBackgroundSource = null;
let canvasImageRequest = 0;
function syncCanvasControls() {
  const f = S.framing;
  $("canvasEnabled").checked = !!f;
  $("canvasFrameControls").hidden = !f;
  if (f) for (const key of ["aspect","padding","radius","shadow","color"])
    $("canvas"+key[0].toUpperCase()+key.slice(1)).value = f[key];
  $("canvasImageRemove").disabled = !f?.image;
}
function frameSettingsFromControls() {
  return {aspect:$("canvasAspect").value, padding:+$("canvasPadding").value,
    radius:+$("canvasRadius").value, shadow:+$("canvasShadow").value,
    color:$("canvasColor").value, image:S.framing?.image || null};
}
$("canvasEnabled").onchange = () => {
  commitEdit("scene:framing", state => {state.framing = $("canvasEnabled").checked ? frameSettingsFromControls() : null;});
};
for (const key of ["Aspect","Padding","Radius","Shadow","Color"]) {
  $("canvas"+key).onchange = () => {
    try {const next=sceneRules.validateFraming(frameSettingsFromControls(),S.job);
      commitEdit("scene:framing",state=>{state.framing=next;});
    } catch {$("canvasStatus").textContent="Use padding and radius from 0 to 25%, and shadow from 0 to 10%.";syncCanvasControls();}
  };
}
$("canvasImage").onchange = async event => {
  const file = event.target.files?.[0]; event.target.value="";
  if (!file || !S.framing) return;
  const jobId = S.job?.id, request = ++canvasImageRequest;
  $("canvasStatus").textContent="Preparing background image…";
  try {
    if (file.size > 8*1024*1024) throw new Error("Choose an image under 8 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width*bitmap.height > 32000000) throw new Error("Choose an image under 32 megapixels.");
      let scale=Math.min(1,1600/bitmap.width,1600/bitmap.height);
      const c=document.createElement("canvas");
      let image;
      // Photos often expand substantially when converted to PNG. Fit the
      // encoded asset budget automatically, preserving alpha and aspect ratio.
      do {
        c.width=Math.max(1,Math.round(bitmap.width*scale));
        c.height=Math.max(1,Math.round(bitmap.height*scale));
        c.getContext("2d").drawImage(bitmap,0,0,c.width,c.height);
        image=c.toDataURL("image/png");
        if(image.length<=900000)break;
        scale*=Math.min(.85,Math.sqrt(900000/image.length)*.9);
      } while(c.width>1 || c.height>1);
      if(image.length>900000)throw new Error("Could not prepare this image. Try a PNG, JPG or WebP file.");
      if(S.job?.id!==jobId || !S.framing || request!==canvasImageRequest)return;
      commitEdit("scene:framing",state=>{state.framing={...state.framing,image};});
      $("canvasStatus").textContent=`Background image added (${c.width} × ${c.height}).`;
    } finally {bitmap.close();}
  } catch(error) {if(request===canvasImageRequest && S.job?.id===jobId)$("canvasStatus").textContent=error.message;}
};
$("canvasImageRemove").onclick=()=>{
  canvasImageRequest++;
  commitEdit("scene:framing",state=>{state.framing={...state.framing,image:null};});
  $("canvasStatus").textContent="Background image removed.";
};
function paintCanvasFrame(c, width, height, drawContent) {
  const f=S.framing, crop=freeeditCropRect(S.job.width,S.job.height,{...S.reframe,zoom:1});
  const g=CanvasModel.geometry(crop.w,crop.h,f), sx=width/g.w, sy=height/g.h;
  c.save(); c.scale(sx,sy);
  c.fillStyle=f.color;c.fillRect(0,0,g.w,g.h);
  if(f.image){
    if(canvasBackgroundSource!==f.image){
      canvasBackgroundSource=f.image;canvasBackgroundImage=new Image();
      canvasBackgroundImage.onload=render;canvasBackgroundImage.src=f.image;
    }
    const img=canvasBackgroundImage;
    if(img.complete && img.naturalWidth){
      const scale=Math.max(g.w/img.width,g.h/img.height);
      c.drawImage(img,(g.w-img.width*scale)/2,(g.h-img.height*scale)/2,img.width*scale,img.height*scale);
    }
  }
  c.shadowColor="rgba(0,0,0,.45)";c.shadowBlur=Math.min(g.w,g.h)*f.shadow/100;
  c.shadowOffsetY=Math.min(g.w,g.h)*f.shadow/200;
  c.fillStyle="#000";c.beginPath();c.roundRect(g.x,g.y,g.iw,g.ih,g.radius);c.fill();
  c.shadowBlur=0;c.shadowOffsetY=0;c.clip();
  drawContent(g);c.restore();
}
editorStore.subscribe(({reason})=>{
  if(reason.startsWith("scene:")||reason==="history:restore"||reason==="project:restore"){
    syncCanvasControls();if(S.job?.has_video)layoutStage();
  }
});
window.addEventListener("freeedit:workspace",event=>{if(event.detail==="upload")syncCanvasControls();});
syncCanvasControls();
