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
    if (!locked && clips.length > 1) {
      row.draggable = true;
      row.ondragstart = event => event.dataTransfer.setData("application/x-freeedit-clip", String(index));
      row.ondragover = event => {
        if (event.dataTransfer.types.includes("application/x-freeedit-clip")) event.preventDefault();
      };
      row.ondrop = event => {
        const source = event.dataTransfer.getData("application/x-freeedit-clip");
        const from = Number(source);
        if (!source || !Number.isInteger(from) || from < 0 || from >= clips.length) return;
        event.preventDefault();
        changeSequenceOrder(from, index);
      };
    }
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
    select.disabled=locked; select.onchange=()=>{ const next=structuredClone(sequenceTransitions); next[i]={type:select.value,duration:select.value==="crossfade"?Number(duration.value):0}; rebuildSequence(sequenceClips.map(c=>c.id),next); };
    duration.onchange=()=>{ const next=structuredClone(sequenceTransitions); next[i]={type:select.value,duration:Number(duration.value)}; rebuildSequence(sequenceClips.map(c=>c.id),next); };
    label.append(select); row.append(label,duration); host.append(row); update();
  }
}

function clipIntervals(clips, transitions) {
  let start = 0;
  return clips.map((clip, index) => {
    const interval = {...clip, start, end: start + clip.duration};
    start = interval.end - (transitions[index]?.duration ?? 0);
    return interval;
  });
}

function mapClipRange(before, after, start, end) {
  const epsilon = 1e-7;
  const overlaps = (clips, a, b) => clips.filter(clip => clip.end > a + epsilon && clip.start < b - epsilon);
  const original = overlaps(before, start, end);
  const first = after.find(clip => clip.id === original[0]?.id);
  if (!first || start < -epsilon || end > before.at(-1).end + epsilon) return null;
  const offset = first.start - original[0].start;
  const mapped = {start: Math.max(0, start + offset), end: Math.min(after.at(-1).end, end + offset)};
  if (mapped.end - mapped.start < end - start - epsilon) return null;
  const target = overlaps(after, mapped.start, mapped.end);
  // Both the footage and the crossfade phase must match across the full range.
  if (original.length !== target.length || original.some((clip, index) =>
    clip.id !== target[index].id || Math.abs(clip.start + offset - target[index].start) > epsilon)) return null;
  return mapped;
}

function planSequenceEdits(before, after, edits, inset) {
  const moved = [];
  for (const edit of edits) {
    const range = mapClipRange(before, after, edit.start, edit.end);
    if (!range) return null;
    moved.push({...edit, ...range});
  }
  let presenterOffset = null;
  if (inset) {
    const range = mapClipRange(before, after, inset.offset, inset.offset + inset.trim_end - inset.trim_start);
    if (!range) return null;
    presenterOffset = range.start;
  }
  return {edits: moved, presenterOffset};
}

function remapSequenceHistory(entries, before, after) {
  return entries.flatMap(entry => {
    const document = HistoryModel.read(entry);
    const plan = planSequenceEdits(before, after, document.edits, document.presenter?.settings);
    if (!plan) return [];
    document.edits = plan.edits;
    if (document.presenter) document.presenter.settings.offset = plan.presenterOffset;
    return [HistoryModel.capture(document, entries)];
  });
}

function renderClipTimeline() {
  const track = $("clipTrack"), label = $("clipLabel");
  const clips = clipIntervals(sequenceClips, sequenceTransitions);
  track.replaceChildren();
  show(track, clips.length > 1);
  show(label, clips.length > 1);
  if (clips.length < 2) return;
  clips.forEach((clip, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline-block clip";
    button.textContent = `${index + 1}. ${clip.name}`;
    button.title = `Seek to clip ${index + 1}: ${clip.name} (${fmt(clip.start)})`;
    button.setAttribute("aria-label", button.title);
    positionTimelineBlock(button, {...clip, end: clips[index + 1]?.start ?? clip.end});
    button.onclick = () => { sourcePlayer().currentTime = clip.start; };
    track.append(button);
  });
}

function refreshSequenceSource(data, currentTime = sourcePlayer().currentTime || 0) {
  const previous = new Map(sequenceClips.map(clip => [clip.id, clip]));
  sequenceClips = data.clips.map((clip, index) => ({...clip, identity:clip.identity || previous.get(clip.id)?.identity || (index === 0 ? projects.source : null)}));
  S.job.sequence_clips = data.clips.map(({id,name,duration})=>({id,name,duration}));
  sequenceTransitions = data.transitions;
  S.job.sequence_transitions = sequenceTransitions;
  S.job.sequence_revision = data.sequence_revision;
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
  const source = `/api/jobs/${S.job.id}/source?revision=${S.job.sequence_revision}`;
  video.src = source; video.load();
  video.addEventListener("loadedmetadata", () => { video.currentTime = Math.min(currentTime, data.duration); render(); updateTransport(); renderTimeline(); layoutStage(); }, {once:true});
  $("fileMeta").textContent = `${sequenceClips.length} clips · ${fmt(data.duration)} · ${data.width}×${data.height}${data.has_audio ? "" : " · no audio"}`;
  renderSequenceClips(); renderTimeline(); renderWaveform(); refreshExportState();
  scheduleProjectSave();
}

async function rebuildSequence(order, transitions = sequenceTransitions) {
  if (sequenceBusy || !S.job || S.operation || S.reviewing) return;
  const job = S.job;
  const before = clipIntervals(sequenceClips, sequenceTransitions);
  const next = order.map(id => sequenceClips.find(clip => clip.id === id));
  if (transitions.some((transition, index) => !Number.isFinite(transition.duration) ||
      transition.duration < 0 || transition.duration > Math.min(2, next[index].duration, next[index + 1].duration))) {
    $("sequenceStatus").textContent = "Choose a transition no longer than either clip (up to 2 seconds).";
    return;
  }
  const after = clipIntervals(next, transitions);
  const inset = getPresenterSettings();
  const plan = planSequenceEdits(before, after, S.edits, inset);
  if (!plan) {
    $("sequenceStatus").textContent = "This change would move an edit or presenter inset onto different footage. Shorten edits at the affected clip joins or remove them first.";
    renderSequenceClips();
    return;
  }
  const undo = remapSequenceHistory(S.undo, before, after);
  const redo = remapSequenceHistory(S.redo, before, after);
  const playhead = sourcePlayer().currentTime;
  const activeClip = before.findLast(clip => clip.start <= playhead && clip.end > playhead);
  const target = after.find(clip => clip.id === activeClip?.id);
  const nextPlayhead = target ? target.start + playhead - activeClip.start : playhead;
  const view = $("editorView");
  sequenceBusy = true;
  sourcePlayer().pause();
  show($("sequenceUpdateNotice"));
  view.inert = true;
  renderSequenceClips();
  $("sequenceStatus").textContent = "Updating clip sequence…";
  try {
    const result = await api(`/api/jobs/${job.id}/clips/order`, {
      method: "PUT", headers: {"Content-Type": "application/json",
        "X-FreeEdit-Sequence-Revision": job.sequence_revision ?? "original"},
      body: JSON.stringify({order, transitions}),
      // Allow time for the server to probe and re-encode the full sequence.
      signal: AbortSignal.timeout(Math.ceil((Math.max(120, after.at(-1).end * 20) + 300) * 1000)),
    });
    if (S.job !== job) return;
    S.edits = plan.edits;
    S.undo = undo;
    S.redo = redo;
    if (inset && plan.presenterOffset !== inset.offset) {
      presenter.settings.offset = plan.presenterOffset;
      syncVideos();
    }
    refreshSequenceSource(result, nextPlayhead);
    renderList();
    renderReframeSections();
    $("sequenceStatus").textContent = "Sequence updated. Timed edits stayed with their footage.";
  } catch (error) {
    if (S.job === job) $("sequenceStatus").textContent = error.message;
  } finally {
    view.inert = false;
    show($("sequenceUpdateNotice"), false);
    sequenceBusy = false;
    renderSequenceClips();
    if (S.job === job) $("sequenceStatus").focus({preventScroll: true});
  }
}

function changeSequenceOrder(from, to) {
  if (from === to) return;
  const next = [...sequenceClips];
  next.splice(to, 0, next.splice(from, 1)[0]);
  rebuildSequence(next.map(clip => clip.id), transitionsForOrder(next));
}

function transitionsForOrder(next) {
  return next.slice(1).map((clip, index) => {
    const previous = sequenceClips.findIndex(item => item.id === next[index].id);
    return sequenceClips[previous + 1]?.id === clip.id
      ? sequenceTransitions[previous] : {type: "cut", duration: 0};
  });
}

function removeSequenceClip(index) {
  const next = sequenceClips.filter((_, i) => i !== index);
  rebuildSequence(next.map(clip => clip.id), transitionsForOrder(next));
}

$("addSequenceClipBtn").onclick = () => $("sequenceClipInput").click();
$("sequenceClipInput").addEventListener("change", async event => {
  const files = [...event.target.files]; event.target.value = "";
  if (!files.length || !S.job || sequenceBusy || S.operation || S.reviewing) return;
  const job = S.job;
  sequenceBusy = true; renderSequenceClips();
  let addError = null;
  for (const file of files) {
    if (sequenceClips.length >= 8) { addError = "A sequence can contain up to 8 clips."; break; }
    if (LIMITS.max_upload_mb && file.size > LIMITS.max_upload_mb * 1024 ** 2) { addError = `${file.name} exceeds the upload size limit.`; break; }
    $("sequenceStatus").textContent = `Adding ${file.name}…`;
    try {
      const identity = await fingerprintSource(file);
      if (S.job !== job) break;
      const response = await fetch(`/api/jobs/${job.id}/clips?filename=${encodeURIComponent(file.name)}`, {method:"POST", headers:{"Content-Type":"application/octet-stream",
        "X-FreeEdit-Sequence-Revision": job.sequence_revision ?? "original"}, body:file});
      const data = await response.json();
      if (S.job !== job) break;
      if (!response.ok) throw new Error(data.detail || `Could not add ${file.name}.`);
      data.clips = data.clips.map((clip, index) => ({...clip, identity:index === 0 ? projects.source : (index === data.clips.length - 1 ? identity : sequenceClips[index]?.identity)}));
      refreshSequenceSource(data);
    } catch (error) { addError = error.message; break; }
  }
  if (S.job === job) $("sequenceStatus").textContent = addError || (sequenceClips.length ? `${sequenceClips.length} clips · sequence ready.` : "");
  sequenceBusy = false; renderSequenceClips();
});
window.addEventListener("freeedit:workspace", event => {
  if (event.detail === "open") {
    sequenceClips = (S.job?.sequence_clips || []).map(clip => ({id:clip.id, name:clip.name, duration:clip.duration}));
    sequenceTransitions = S.job?.sequence_transitions || sequenceClips.slice(1).map(()=>({type:"cut",duration:0}));
    sequenceOriginalMedia = {...S.job, duration:sequenceClips[0]?.duration || S.job?.duration};
    renderSequenceClips();
    renderClipTimeline();
  }
});
