"use strict";

const presenterVideo = document.createElement("video");
presenterVideo.muted = true; presenterVideo.playsInline = true; presenterVideo.preload = "auto";
let presenter = null;
const presenterFiles = new Map();
const combinedPlayer = $("compositionPreviewPlayer");

function resetVideos() {
  presenter = null; presenterVideo.pause(); presenterVideo.removeAttribute("src"); presenterVideo.load();
  combinedPlayer.pause(); combinedPlayer.removeAttribute("src"); combinedPlayer.load();
  show(combinedPlayer, false); show($("presenterControls"), false);
  $("presenterName").textContent = "No presenter video added.";
  $("choosePresenterBtn").textContent = "Add presenter video…";
  $("compositionStatus").textContent = "Preview three seconds from the playhead, including your sound choice. Main background effects, cuts, text, and privacy masks are applied in the full export.";
  video.muted = false;
  if(S.job) {
    $("exportPreset").querySelector('[value="audio_only"]').disabled = !S.job.has_audio;
    show($("audioOpts"),S.job.has_audio);show($("noAudio"),!S.job.has_audio);
  }
}
function getPresenterSettings() { return presenter ? structuredClone(presenter.settings) : null; }
function presenterProject() { return presenter ? {source: {...presenter.source}, settings: getPresenterSettings()} : null; }

function restorePresenter(saved, reuse = false) {
  if (!saved) { resetVideos(); return; }
  const ready = reuse && presenterFiles.get(S.job.id) === saved.source.fingerprint;
  presenter = {...structuredClone(saved), ready}; syncVideos();
  if(ready) { presenterVideo.src=`/api/jobs/${S.job.id}/presenter`; return; }
  $("compositionStatus").textContent = `Select the original presenter “${saved.source.name}” to reconnect it. Export is blocked until its contents match.`;
  $("choosePresenterBtn").textContent = "Locate presenter video…";
}
function syncVideos() {
  show($("presenterControls"), !!presenter);
  if (!presenter) return;
  const s = presenter.settings;
  const hasSound = s.sound !== "muted" && (S.job.has_audio || presenter.source.has_audio);
  $("exportPreset").querySelector('[value="audio_only"]').disabled = !hasSound;
  show($("audioOpts"), S.job.has_audio || presenter.source.has_audio);
  show($("noAudio"), !S.job.has_audio && !presenter.source.has_audio);
  $("presenterName").textContent = `${presenter.source.name} · ${fmt(presenter.source.duration)}${presenter.ready ? "" : " · needs original file"}`;
  for (const [id, value] of Object.entries({presenterEffect:s.effect,presenterX:s.box.x,presenterY:s.box.y,presenterOffset:s.offset,presenterFrom:s.trim_start,presenterTo:s.trim_end,compositionSound:s.sound,mainVolume:s.main_volume*100,presenterVolume:s.presenter_volume*100,presenterSize:Math.round(s.box.w/S.job.width*100)})) $(id).value=value;
  show($("compositionVolumes"),s.sound === "both");
  $("compositionSound").querySelector('[value="main"]').disabled = !S.job.has_audio;
  $("compositionSound").querySelector('[value="presenter"]').disabled = !presenter.source.has_audio;
  $("compositionSound").querySelector('[value="both"]').disabled = !S.job.has_audio || !presenter.source.has_audio;
}
function cornerInset() {
  if (!presenter) return;
  const b = presenter.settings.box, corner = $("presenterCorner").value;
  const margin = Math.min(24, Math.floor(Math.min(S.job.width, S.job.height)*.03));
  b.x = corner.endsWith("right") ? Math.max(0,S.job.width-b.w-margin) : margin;
  b.y = corner.startsWith("bottom") ? Math.max(0,S.job.height-b.h-margin) : margin;
  b.x=Math.min(b.x,S.job.width-b.w); b.y=Math.min(b.y,S.job.height-b.h);
}
function resizeInset() {
  const ratio=presenter.source.width/presenter.source.height;
  const w=Math.max(8,Math.round(S.job.width*Number($("presenterSize").value)/100));
  const h=Math.max(8,Math.round(w/ratio));
  const fit=Math.min(1,S.job.height/h,S.job.width/w);
  presenter.settings.box.w=Math.max(8,Math.floor(w*fit));
  presenter.settings.box.h=Math.max(8,Math.floor(h*fit)); cornerInset();
}
$("choosePresenterBtn").onclick=()=>$("presenterInput").click();
$("presenterInput").onchange=async event=>{
  const file=event.target.files[0]; event.target.value="";
  if (!file || !S.job || S.operation) return;
  const jobId=S.job.id;
  if (file.size>LIMITS.max_upload_mb*1024**2) { $("compositionStatus").textContent="Presenter exceeds the upload size limit."; return; }
  const expected=presenter && !presenter.ready ? presenter : null;
  setBusy("presenter-upload");
  try {
    $("compositionStatus").textContent="Checking presenter recording…";
    const identity=await fingerprintSource(file);
    if (expected && (identity.size!==expected.source.size || identity.fingerprint!==expected.source.fingerprint)) throw new Error("Choose the unchanged original presenter recording, or remove the presenter to add a different one.");
    const data=await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open("POST",`/api/jobs/${jobId}/presenter?filename=${encodeURIComponent(file.name)}`);
      xhr.upload.onprogress=event=>{if(event.lengthComputable) $("compositionStatus").textContent=`Uploading presenter… ${Math.round(event.loaded/event.total*100)}%`;};
      xhr.onload=()=>{let body;try{body=JSON.parse(xhr.responseText);}catch{reject(new Error("Presenter upload failed."));return;} xhr.status>=200&&xhr.status<300?resolve(body):reject(new Error(body.detail||"Presenter upload failed."));};
      xhr.onerror=()=>reject(new Error("Connection interrupted. Select the presenter again.")); xhr.send(file);
    });
    if (S.job?.id!==jobId) return;
    const source={...identity,...data.media};
    checkpoint();
    presenterFiles.set(jobId,identity.fingerprint);
    presenter=expected ? {...expected,ready:true} : {source,ready:true,settings:{box:{x:0,y:0,w:100,h:100},offset:0,trim_start:0,trim_end:data.media.duration,effect:"original",sound:S.job.has_audio?"main":data.media.has_audio?"presenter":"muted",main_volume:1,presenter_volume:1}};
    if(!expected) resizeInset();
    presenterVideo.src=`/api/jobs/${jobId}/presenter?t=${Date.now()}`;
    $("choosePresenterBtn").textContent="Replace presenter video…";
    syncVideos(); $("compositionStatus").textContent="Presenter ready. The editor shows placement; use the combined preview to check background effects and sound.";
    refreshExportState(); render();
  } catch(error) {if(S.job?.id===jobId) $("compositionStatus").textContent=error.message;}
  finally {if(S.job?.id===jobId)setBusy(null);}
};
$("removePresenterBtn").onclick=()=>{ checkpoint(); resetVideos(); refreshExportState(); render(); };
function changedVideos() {
  combinedPlayer.pause(); show(combinedPlayer,false); syncVideos();refreshExportState();render();
  $("compositionStatus").textContent="Settings changed. Preview the combined video to check the result.";
}
for(const [id,key] of [["presenterEffect","effect"],["compositionSound","sound"]]) $(id).onchange=event=>{checkpoint();presenter.settings[key]=event.target.value;changedVideos();};
for(const [id,key] of [["presenterOffset","offset"],["presenterFrom","trim_start"],["presenterTo","trim_end"],["mainVolume","main_volume"],["presenterVolume","presenter_volume"]]) $(id).onchange=event=>{checkpoint();presenter.settings[key]=Number(event.target.value)/(id.endsWith("Volume")?100:1);changedVideos();};
for(const key of ["x","y"]) $("presenter"+key.toUpperCase()).onchange=event=>{checkpoint();const b=presenter.settings.box;b[key]=Math.round(clamp(Number(event.target.value)||0,0,(key==="x"?S.job.width-b.w:S.job.height-b.h)));changedVideos();};
$("presenterSize").onchange=()=>{checkpoint();resizeInset();changedVideos();};
$("presenterCorner").onchange=()=>{checkpoint();cornerInset();changedVideos();};
function validateVideos() {
  if(!presenter)return true;
  try {
    if(!presenter.ready)throw new Error("Locate the presenter recording in Videos before exporting.");
    sceneRules.validatePresenterProject(presenterProject(),S.job);
    if($("exportPreset").value === "audio_only" && presenter.settings.sound === "muted") throw new Error("Choose a sound source for an audio-only export.");
    return true;
  } catch(error) {
    $("compositionStatus").textContent=error.message;
    window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"videos"}));return false;
  }
}
function drawPresenter(context) {
  if(!presenter?.ready)return;
  const s=presenter.settings,t=video.currentTime-s.offset;
  if(t<0 || t>=s.trim_end-s.trim_start) {presenterVideo.pause();return;}
  const target=s.trim_start+t;
  if(presenterVideo.playbackRate!==video.playbackRate)presenterVideo.playbackRate=video.playbackRate;
  if(presenterVideo.readyState>=1 && Math.abs(presenterVideo.currentTime-target)>.15 && !presenterVideo.seeking)presenterVideo.currentTime=target;
  if(!video.paused && presenterVideo.paused)presenterVideo.play().catch(()=>{});
  if(video.paused)presenterVideo.pause();
  if(presenterVideo.readyState>=2){
    const b=s.box;context.drawImage(presenterVideo,b.x,b.y,b.w,b.h);
    context.save();context.strokeStyle=getComputedStyle(canvas).getPropertyValue("--accent");
    const line=S.job.width/canvas.getBoundingClientRect().width;context.lineWidth=2*line;
    context.strokeRect(b.x,b.y,b.w,b.h);context.fillStyle=context.strokeStyle;
    context.fillRect(b.x+b.w-8*line,b.y+b.h-8*line,8*line,8*line);context.restore();
  }
}
presenterVideo.addEventListener("seeked",()=>{if(video.paused)render();});
presenterVideo.addEventListener("loadeddata",render);
$("compositionPreviewBtn").onclick=async()=>{
  if(S.operation || !validateVideos())return;
  sourcePlayer().pause(); if(S.reviewing)setReview(false);
  setBusy("composition");show($("procProgress"));show($("procError"),false);
  setProgress("Preparing combined preview…",null);
  try {await api(`/api/jobs/${S.job.id}/composition-preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({start:Math.min(sourcePlayer().currentTime,Math.max(0,duration()-.1)),presenter:getPresenterSettings()})});poll();}
  catch(error){if(!error.status||error.status===409)poll();else compositionPreviewDone({error:error.message});}
};
function compositionPreviewDone(result){
  setBusy(null);show($("procProgress"),false);
  $("compositionStatus").textContent=result.error||`Combined sample ${fmt(result.start)}–${fmt(result.start+result.duration)} · ${presenter.settings.sound} sound`;
  show(combinedPlayer,!result.error);
  if(!result.error)combinedPlayer.src=`/api/jobs/${S.job.id}/composition-preview?t=${Date.now()}`;
}
combinedPlayer.addEventListener("play",()=>{video.pause();$("audio").pause();presenterVideo.pause();});

// Inset placement uses the same source-pixel coordinates as other visual edits.
let insetDrag = null;
canvas.addEventListener("pointerdown", event => {
  // The Select preview tool can open the edits inspector; presenter dragging
  // must still work from there. A hit on the presenter reopens Videos settings.
  if(!presenter?.ready || S.mode!=="select")return;
  const p=toSource(event), b=presenter.settings.box, local=video.currentTime-presenter.settings.offset;
  if(local<0 || local>=presenter.settings.trim_end-presenter.settings.trim_start || p.x<b.x || p.x>b.x+b.w || p.y<b.y || p.y>b.y+b.h)return;
  const handle=18*S.job.width/canvas.getBoundingClientRect().width;
  checkpoint();
  insetDrag={resize:p.x>b.x+b.w-handle && p.y>b.y+b.h-handle,dx:p.x-b.x,dy:p.y-b.y};
  video.pause();canvas.setPointerCapture(event.pointerId);event.stopImmediatePropagation();event.preventDefault();
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"videos"}));
},true);
canvas.addEventListener("pointermove",event=>{
  if(!insetDrag)return;
  const p=toSource(event),b=presenter.settings.box;
  if(insetDrag.resize){
    const ratio=presenter.source.width/presenter.source.height;
    b.w=Math.round(clamp(p.x-b.x,8,Math.min(S.job.width-b.x,(S.job.height-b.y)*ratio)));
    b.h=Math.min(S.job.height-b.y,Math.max(8,Math.round(b.w/ratio)));
  }else{b.x=Math.round(clamp(p.x-insetDrag.dx,0,S.job.width-b.w));b.y=Math.round(clamp(p.y-insetDrag.dy,0,S.job.height-b.h));}
  event.stopImmediatePropagation();syncVideos();refreshExportState();render();
},true);
for(const name of ["pointerup","pointercancel"])canvas.addEventListener(name,event=>{
  if(!insetDrag)return;insetDrag=null;event.stopImmediatePropagation();changedVideos();
},true);
