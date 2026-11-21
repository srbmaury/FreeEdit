"use strict";

const backgroundPlayer = $("backgroundPreviewPlayer");
const backgroundHelp = "Preview a silent, 3-second sample from the playhead. Cuts, text, and privacy masks are applied during export.";

function resetBackground() {
  S.background = {mode: "off", blur: 16, color: "#e5e7eb", image: null, region: null, preset: "studio"};
  backgroundPlayer.pause();
  backgroundPlayer.removeAttribute("src"); backgroundPlayer.load();
  $("backgroundPanel").open = false;
  syncBackgroundControls();
  show(backgroundPlayer, false);
  $("backgroundStatus").textContent = backgroundHelp;
}

function getBackgroundSettings() {
  const bg = S.background;
  if (!S.job?.has_video || !bg || bg.mode === "off") return null;
  return {mode: bg.mode, preset: bg.preset || "custom", blur: bg.blur, color: bg.color,
    image: bg.mode === "image" ? bg.image : null, region: bg.region ? {...bg.region} : null};
}

function syncBackgroundControls() {
  const bg = S.background;
  if (!bg) return;
  $("backgroundMode").value = bg.mode;
  $("backgroundBlur").value = bg.blur;
  $("backgroundColor").value = bg.color;
  $("backgroundArea").value = bg.region ? "camera" : "full";
  $("backgroundImagePreset").value = bg.preset || "custom";
  show($("backgroundControls"), bg.mode !== "off");
  show($("backgroundBlurField"), bg.mode === "blur");
  show($("backgroundColorField"), bg.mode === "color");
  show($("backgroundImageField"), bg.mode === "image");
  show($("cameraAreaControls"), !!bg.region);
  for (const key of ["x", "y", "w", "h"]) {
    $("camera" + key.toUpperCase()).value = bg.region?.[key] || 0;
  }
  $("backgroundPreviewBtn").disabled = !!S.operation;
}

function invalidateBackgroundPreview() {
  backgroundPlayer.pause(); show(backgroundPlayer, false);
  $("backgroundStatus").textContent = backgroundHelp;
}

function backgroundChanged() {
  invalidateBackgroundPreview(); refreshExportState(); render();
}

function presetBackground(name) {
  const colors = {studio: ["#dde5ed", "#9daec2"], twilight: ["#29274b", "#9e679d"], forest: ["#c2d6c9", "#43695d"]}[name];
  const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 960, 540);
  gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors[1]);
  context.fillStyle = gradient; context.fillRect(0, 0, 960, 540);
  return canvas.toDataURL("image/png");
}

$("backgroundMode").onchange = event => {
  checkpoint();
  S.background.mode = event.target.value;
  if (S.background.mode === "image" && !S.background.image) S.background.image = presetBackground("studio");
  if (S.background.mode === "off") setMode("select");
  syncBackgroundControls(); backgroundChanged();
};
$("backgroundBlur").onchange = event => { checkpoint(); S.background.blur = Number(event.target.value); backgroundChanged(); };
$("backgroundColor").onchange = event => { checkpoint(); S.background.color = event.target.value; backgroundChanged(); };
$("backgroundImagePreset").onchange = event => {
  if (event.target.value === "custom") return;
  checkpoint(); S.background.preset = event.target.value;
  S.background.image = presetBackground(event.target.value); backgroundChanged();
};
$("uploadBackgroundBtn").onclick = () => $("backgroundImageInput").click();
$("backgroundImageInput").onchange = async event => {
  const file = event.target.files[0]; event.target.value = "";
  const jobId = S.job?.id;
  if (!file) return;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 ** 2) throw new Error("Choose a PNG, JPEG, or WebP image under 10 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      if (S.job?.id !== jobId) return;
      const canvas = document.createElement("canvas");
      let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      let image;
      do {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        image = canvas.toDataURL("image/png"); scale *= 0.8;
      } while (image.length > 850000 && canvas.width > 128 && canvas.height > 128);
      if (image.length > 900000) throw new Error("This image is too detailed. Choose a smaller image.");
      checkpoint(); S.background.image = image; S.background.preset = "custom";
      syncBackgroundControls(); backgroundChanged();
    } finally { bitmap.close(); }
  } catch (error) { $("backgroundStatus").textContent = error.message; }
};

$("backgroundArea").onchange = event => {
  checkpoint();
  const {width, height} = S.job;
  const x = Math.floor(width * 2 / 3), y = Math.floor(height * 2 / 3);
  S.background.region = event.target.value === "full" ? null : {x, y, w: width - x, h: height - y};
  if (!S.background.region) setMode("select");
  syncBackgroundControls(); backgroundChanged();
};
$("drawCameraAreaBtn").onclick = () => {
  if (S.reviewing) setReview(false);
  video.pause(); setMode(S.mode === "background" ? "select" : "background");
  $("stage").scrollIntoView({block: "nearest", behavior: "smooth"});
};
for (const key of ["x", "y", "w", "h"]) {
  const input = $("camera" + key.toUpperCase());
  input.oninput = event => {
    const r = S.background.region;
    if (!r || event.target.value === "") return;
    const value = Number(event.target.value);
    const limit = key === "x" || key === "w" ? S.job.width : S.job.height;
    if (!Number.isInteger(value) || value < (key === "w" || key === "h" ? 8 : 0) ||
        value > limit - (key === "x" || key === "y" ? 8 : 0)) return;
    checkpoint(); r[key] = value;
    r.w = Math.min(r.w, S.job.width - r.x); r.h = Math.min(r.h, S.job.height - r.y);
    // Preserve partially typed input; normalize the fields when focus leaves.
    backgroundChanged();
  };
  input.onchange = syncBackgroundControls;
}

function drawCameraRegion(context, lineWidth) {
  const region = getBackgroundSettings()?.region;
  if (!region) return;
  context.save(); context.lineWidth = 2 * lineWidth;
  context.strokeStyle = getComputedStyle(canvas).getPropertyValue("--accent");
  context.setLineDash([6 * lineWidth, 4 * lineWidth]);
  context.strokeRect(region.x, region.y, region.w, region.h); context.restore();
}

$("backgroundPreviewBtn").onclick = async () => {
  if (!S.job || S.operation || !getBackgroundSettings()) return;
  if (S.reviewing) setReview(false);
  sourcePlayer().pause(); $("noiseSamplePlayer").pause();
  invalidateBackgroundPreview();
  const start = Math.min(sourcePlayer().currentTime || 0, Math.max(0, duration() - 0.1));
  setBusy("background");
  $("backgroundStatus").textContent = "Processing sample… Cancel is available in the Export panel.";
  show($("procError"), false); show($("procProgress")); setProgress("Preparing background preview…", null);
  try {
    await api(`/api/jobs/${S.job.id}/background-preview`, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({start, background: getBackgroundSettings()})});
    poll();
  } catch (error) {
    if (!error.status || error.status === 409) poll();
    else backgroundPreviewDone({error: error.message});
  }
};

function backgroundPreviewDone(result) {
  setBusy(null); show($("procProgress"), false);
  $("backgroundStatus").textContent = result.error || `Processed sample ${fmt(result.start)}–${fmt(result.start + result.duration)} · silent`;
  show(backgroundPlayer, !result.error);
  if (!result.error) backgroundPlayer.src = `/api/jobs/${S.job.id}/background-preview?t=${Date.now()}`;
}
backgroundPlayer.addEventListener("play", () => {
  for (const player of [video, $("audio"), $("resultVideo"), $("resultAudio"), $("noiseSamplePlayer")]) player.pause();
});
for (const player of [video, $("audio"), $("resultVideo"), $("resultAudio"), $("noiseSamplePlayer")]) {
  player.addEventListener("play", () => backgroundPlayer.pause());
}
