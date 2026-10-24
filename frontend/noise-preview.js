"use strict";

let noiseSample = null;
const samplePlayer = $("noiseSamplePlayer");

function resetNoisePreview() {
  noiseSample = null;
  samplePlayer.pause();
  samplePlayer.removeAttribute("src");
  samplePlayer.load();
  show($("noiseSample"), false);
}

$("noisePreviewBtn").onclick = async () => {
  if (!S.job || S.operation) return;
  resetNoisePreview();
  if (S.reviewing) setReview(false);
  sourcePlayer().pause();
  $("resultVideo").pause(); $("resultAudio").pause();
  const start = Math.min(sourcePlayer().currentTime || 0, Math.max(0, duration() - 0.1));
  const strength = $("strength").value;
  setBusy("preview");
  show($("procError"), false);
  show($("procProgress"));
  setProgress("Preparing audio sample…", null);
  try {
    await api(`/api/jobs/${S.job.id}/preview`, {method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({start, atten_lim: strength ? Number(strength) : null})});
    poll();
  } catch (error) {
    if (!error.status || error.status === 409) poll();
    else noisePreviewDone({error: error.message});
  }
};

function noisePreviewDone(sample) {
  setBusy(null);
  show($("procProgress"), false);
  show($("noiseSample"));
  $("noiseSampleStatus").textContent = sample.error || `Sample ${fmt(sample.start)}–${fmt(sample.start + sample.duration)} · ${sample.atten_lim == null ? "Strongest reduction" : sample.atten_lim + " dB reduction limit"}`;
  noiseSample = sample.error ? null : sample;
  show(samplePlayer, !!noiseSample);
  show($("sampleOriginalBtn").parentElement, !!noiseSample);
  if (noiseSample) switchNoiseSample("original", false);
}

function switchNoiseSample(variant, preserve = true) {
  if (!noiseSample) return;
  const time = preserve ? samplePlayer.currentTime : 0;
  const playing = preserve && !samplePlayer.paused;
  samplePlayer.pause();
  samplePlayer.onloadedmetadata = () => {
    samplePlayer.currentTime = Math.min(time, samplePlayer.duration || time);
    if (playing) samplePlayer.play().catch(() => {});
  };
  samplePlayer.src = `/api/jobs/${S.job.id}/preview/${variant}?t=${Date.now()}`;
  $("sampleOriginalBtn").setAttribute("aria-pressed", String(variant === "original"));
  $("sampleCleanBtn").setAttribute("aria-pressed", String(variant === "clean"));
}
$("sampleOriginalBtn").onclick = () => switchNoiseSample("original");
$("sampleCleanBtn").onclick = () => switchNoiseSample("clean");
$("strength").addEventListener("change", () => {
  if (noiseSample) $("noiseSampleStatus").textContent += " · Strength changed; create a new sample to hear it.";
});
samplePlayer.addEventListener("play", () => {
  sourcePlayer().pause(); $("resultVideo").pause(); $("resultAudio").pause();
});

for (const player of [video, $("audio"), $("resultVideo"), $("resultAudio")]) {
  player.addEventListener("play", () => samplePlayer.pause());
}
