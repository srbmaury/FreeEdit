"use strict";
function useAudioRegionRange() {
  if(!S.job)return;
  const range=rangeSelection.range;
  const start=range?.start ?? Math.min(sourcePlayer().currentTime||0,Math.max(0,duration()-.1));
  $("audioRegionStart").value=+start.toFixed(3);
  $("audioRegionEnd").value=+(range?.end ?? Math.min(duration(),start+1)).toFixed(3);
}
function addAudioRegion(mute=false) {
  if(!S.job || (!S.job.has_audio && !presenterProject()?.source.has_audio)) {
    $("audioRegionStatus").textContent="Add a recording with audio first.";return;
  }
  const region={type:"audio",start:$("audioRegionStart").valueAsNumber,end:$("audioRegionEnd").valueAsNumber,
    volume:mute?0:$("audioRegionVolume").valueAsNumber/100,fade:$("audioRegionFade").valueAsNumber};
  const error=EditorModel.validateAudioRegion(region,duration());
  if(error){$("audioRegionStatus").textContent=error;return;}
  sourcePlayer().pause();
  if(S.reviewing)setReview(false);
  if(!addEdit(region))return;
  sourcePlayer().currentTime=region.start;
  $("audioRegionStatus").textContent="Added. Drag the Volume timeline block or its edges to change timing; select it to edit volume and fades.";
}
$("audioRegionUseRange").onclick=useAudioRegionRange;
$("addMuteRegion").onclick=()=>addAudioRegion(true);
$("addVolumeRegion").onclick=()=>addAudioRegion(false);
$("audioRegionPreview").onclick=()=>$("resultPreviewBtn").click();
window.addEventListener("freeedit:workspace",event=>{
  if(event.detail==="open"){
    useAudioRegionRange();$("audioRegionVolume").value=50;$("audioRegionFade").value=.05;
    $("audioRegionStatus").textContent="";
  }
});
