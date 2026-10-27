"use strict";

let sequenceClips = [];
let sequenceBusy = false;
let sequenceOriginalMedia = null;
let sequenceTransitions = [];

function renderSequenceClips() {
  const list = $("sequenceClips");
  if (!list || !S.job?.has_video) return;
  const clips = sequenceClips.length ? sequenceClips : [{id:"source", name:S.job.filename, duration:S.job.duration}];
  const locked = sequenceBusy || !!S.operation || S.reviewing;
  list.replaceChildren();
  clips.forEach((clip, index) => {
    const row = document.createElement("div"); row.className = "sequence-clip";
    const title = document.createElement("span"); title.textContent = `${index + 1}. ${clip.name} · ${fmt(clip.duration)}`;
    const controls = document.createElement("div"); controls.className = "sequence-clip-actions";
    for (const [label, direction, disabled] of [["↑", -1, index === 0], ["↓", 1, index === clips.length - 1]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = "mini";
      button.textContent = label; button.setAttribute("aria-label", `${direction < 0 ? "Move earlier" : "Move later"}: ${clip.name}`);
      button.disabled = disabled || locked;
      button.onclick = () => changeSequenceOrder(index, index + direction);
      controls.append(button);
    }
    const remove = document.createElement("button"); remove.type="button"; remove.className="mini ghost"; remove.textContent="Remove";
    remove.disabled = clips.length <= 1 || locked; remove.onclick = () => removeSequenceClip(index);
    controls.append(remove); row.append(title, controls); list.append(row);
  });
  $("addSequenceClipBtn").disabled = locked || clips.length >= 8;
  renderSequenceTransitions(locked);
}

function renderSequenceTransitions(locked = false) {
  const host = $("sequenceTransitions"); if (!host) return;
  host.replaceChildren();
  for (let i = 0; i < Math.max(0, sequenceClips.length - 1); i++) {
    const row = document.createElement("div"); row.className = "sequence-transition";
    const label = document.createElement("label"); label.textContent = `Between ${i + 1} and ${i + 2}`;
    const select = document.createElement("select");
    for (const [value, title] of [["cut","Cut"],["crossfade","Crossfade"]]) { const option = document.createElement("option"); option.value=value; option.textContent=title; select.append(option); }
    const transition = sequenceTransitions[i] || {type:"cut",duration:0}; select.value=transition.type;
    const duration = document.createElement("input"); duration.type="number"; duration.min="0.1"; duration.max="2"; duration.step="0.1"; duration.value=String(transition.duration || 0.5); duration.setAttribute("aria-label",`Crossfade duration between clips ${i+1} and ${i+2}`);
    const update = () => { duration.disabled = locked || select.value === "cut"; };
    select.disabled=locked; select.onchange=()=>{ sequenceTransitions[i]={type:select.value,duration:select.value==="crossfade"?Number(duration.value):0}; update(); rebuildSequence(sequenceClips.map(c=>c.id)); };
    duration.onchange=()=>{ sequenceTransitions[i]={type:select.value,duration:Number(duration.value)}; rebuildSequence(sequenceClips.map(c=>c.id)); };
    label.append(select); row.append(label,duration); host.append(row); update();
  }
}

function sequenceDuration(clips) { return clips.reduce((total, clip) => total + clip.duration, 0); }
function refreshSequenceSource(data) {
  const currentTime = sourcePlayer().currentTime || 0;
  const previous = new Map(sequenceClips.map(clip => [clip.id, clip]));
  sequenceClips = data.clips.map((clip, index) => ({...clip, identity:clip.identity || previous.get(clip.id)?.identity || (index === 0 ? projects.source : null)}));
  S.job.sequence_clips = data.clips.map(({id,name,duration})=>({id,name,duration}));
  S.job.sequence_transitions = sequenceTransitions;
  if (sequenceClips[0]?.identity) projects.source = sequenceClips[0].identity;
  if (sequenceOriginalMedia && sequenceClips[0]) sequenceOriginalMedia.duration = sequenceClips[0].duration;
  Object.assign(S.job, {duration:data.duration, has_video:data.has_video, has_audio:data.has_audio,
    width:data.width, height:data.height, audio_channels:data.audio_channels, frame_rate:data.frame_rate, waveform:data.waveform});
  video.pause(); $("audio").pause();
  if (typeof clearRangeSelection === "function") clearRangeSelection();
  S.suggestions = []; resetSilenceRange(); show($("silenceReview"), false);
  $("silenceStatus").textContent = "Clip sequence changed. Detect pauses again to refresh suggestions.";
  S.exportSignature = null; S.exportSubmission = null; S.submittedRanges = [];
  show($("resultPanel"), false); resetResultPreview();
  const source = `/api/jobs/${S.job.id}/source?t=${Date.now()}`;
  video.src = source; video.load();
  video.addEventListener("loadedmetadata", () => { video.currentTime = Math.min(currentTime, data.duration); render(); updateTransport(); renderTimeline(); layoutStage(); }, {once:true});
  $("fileMeta").textContent = `${sequenceClips.length} clips · ${fmt(data.duration)} · ${data.width}×${data.height}${data.has_audio ? "" : " · no audio"}`;
  renderSequenceClips(); renderTimeline(); renderWaveform(); refreshExportState();
}

async function rebuildSequence(order) {
  if (sequenceBusy || !S.job) return;
  sequenceBusy = true; renderSequenceClips(); $("sequenceStatus").textContent = "Updating clip sequence…";
  try {
    const result = await api(`/api/jobs/${S.job.id}/clips/order`, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({order,transitions:sequenceTransitions})});
    refreshSequenceSource(result); $("sequenceStatus").textContent = "Sequence updated. Timeline edits use the new clip order.";
  } catch (error) { $("sequenceStatus").textContent = error.message; }
  finally { sequenceBusy = false; renderSequenceClips(); }
}
function changeSequenceOrder(from, to) {
  const next = [...sequenceClips]; [next[from], next[to]] = [next[to], next[from]];
  sequenceTransitions = next.slice(1).map((_,i)=>sequenceTransitions[Math.min(i,sequenceTransitions.length-1)] || {type:"cut",duration:0}); rebuildSequence(next.map(clip => clip.id));
}
function removeSequenceClip(index) {
  const next = sequenceClips.filter((_, i) => i !== index);
  sequenceTransitions = next.slice(1).map((_,i)=>sequenceTransitions[i] || {type:"cut",duration:0});
  const remainingDuration = sequenceDuration(next);
  if (S.edits.some(edit => edit.end > remainingDuration + .005)) {
    $("sequenceStatus").textContent = "This clip cannot be removed because existing edits extend past the shortened sequence. Remove or shorten those edits first.";
    return;
  }
  const presenterSettings = typeof getPresenterSettings === "function" ? getPresenterSettings() : null;
  if (presenterSettings && presenterSettings.offset + presenterSettings.trim_end - presenterSettings.trim_start > remainingDuration + .005) {
    $("sequenceStatus").textContent = "This clip cannot be removed because the presenter inset extends past the shortened sequence. Adjust or remove the presenter first.";
    return;
  }
  rebuildSequence(next.map(clip => clip.id));
}

$("addSequenceClipBtn").onclick = () => $("sequenceClipInput").click();
$("sequenceClipInput").addEventListener("change", async event => {
  const files = [...event.target.files]; event.target.value = "";
  if (!files.length || !S.job || sequenceBusy || S.operation || S.reviewing) return;
  sequenceBusy = true; renderSequenceClips();
  let addError = null;
  for (const file of files) {
    if (sequenceClips.length >= 8) { addError = "A sequence can contain up to 8 clips."; break; }
    if (LIMITS.max_upload_mb && file.size > LIMITS.max_upload_mb * 1024 ** 2) { addError = `${file.name} exceeds the upload size limit.`; break; }
    $("sequenceStatus").textContent = `Adding ${file.name}…`;
    try {
      const identity = await fingerprintSource(file);
      const response = await fetch(`/api/jobs/${S.job.id}/clips?filename=${encodeURIComponent(file.name)}`, {method:"POST", headers:{"Content-Type":"application/octet-stream"}, body:file});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Could not add ${file.name}.`);
      data.clips = data.clips.map((clip, index) => ({...clip, identity:index === 0 ? projects.source : (index === data.clips.length - 1 ? identity : sequenceClips[index]?.identity)}));
      sequenceTransitions.push({type:"cut",duration:0}); S.job.sequence_transitions = sequenceTransitions;
      refreshSequenceSource(data);
    } catch (error) { addError = error.message; break; }
  }
  $("sequenceStatus").textContent = addError || (sequenceClips.length ? `${sequenceClips.length} clips · sequence ready.` : "");
  sequenceBusy = false; renderSequenceClips();
});
window.addEventListener("freeedit:workspace", event => {
  if (event.detail === "open") {
    sequenceClips = (S.job?.sequence_clips || []).map(clip => ({id:clip.id, name:clip.name, duration:clip.duration}));
    sequenceTransitions = S.job?.sequence_transitions || sequenceClips.slice(1).map(()=>({type:"cut",duration:0}));
    sequenceOriginalMedia = {...S.job, duration:sequenceClips[0]?.duration || S.job?.duration};
    renderSequenceClips();
  }
});
