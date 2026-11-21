"use strict";
function useSpeedSelection() {
  const range=rangeSelection.range;
  if(!range){$("speedStatus").textContent="Select a range on the timeline first, or enter From and To above.";return;}
  $("speedStart").value=range.start.toFixed(3);
  $("speedEnd").value=range.end.toFixed(3);
  $("speedStatus").textContent="";
}
$("speedUseRange").onclick=useSpeedSelection;
for(const [button,field] of [["speedStartNow","speedStart"],["speedEndNow","speedEnd"]]) {
  $(button).onclick=()=>{if(S.job)$(field).value=sourcePlayer().currentTime.toFixed(3);};
}
$("addSpeedRange").onclick=()=>{
  if(!S.job || S.operation)return;
  const edit={type:"speed",start:$("speedStart").valueAsNumber,end:$("speedEnd").valueAsNumber,rate:$("speedRate").valueAsNumber};
  const error=EditorModel.validateSpeed(edit,duration(),S.edits);
  if(error){$("speedStatus").textContent=error;return;}
  sourcePlayer().pause(); if(S.reviewing)setReview(false);
  if(addEdit(edit))$("speedStatus").textContent="Speed applied. Select its Speed block to change or delete it. Preview result to review the rendered timing.";
};
function updatePlaybackSpeed(){
  const player=sourcePlayer();
  const rate=S.reviewing?1:(S.edits.find(e=>e.type==="speed" && e.start<=player.currentTime && player.currentTime<e.end)?.rate ?? 1);
  if(player.playbackRate!==rate)player.playbackRate=rate;
  player.preservesPitch=true;
}
for(const player of [video,$("audio")])for(const event of ["play","seeked","timeupdate"])player.addEventListener(event,updatePlaybackSpeed);
window.addEventListener("freeedit:workspace",event=>{if(event.detail==="open"){$("speedStatus").textContent="";$("speedRate").value=2;$("speedStart").value=0;$("speedEnd").value=duration();$("speedStart").max=$("speedEnd").max=duration();}});
