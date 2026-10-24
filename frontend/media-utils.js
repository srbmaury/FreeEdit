"use strict";

// Pure helpers shared by the browser and its Node regression tests.
function freeeditCropRect(width, height, settings) {
  const ratios = {wide: 16 / 9, vertical: 9 / 16, square: 1};
  if (!(width > 0 && height > 0)) throw new Error("Invalid video dimensions.");
  const s = settings || {aspect: "original", zoom: 1, focus_x: .5, focus_y: .5};
  if (!["original", "wide", "vertical", "square"].includes(s.aspect) ||
      !Number.isFinite(s.zoom) || s.zoom < 1 || s.zoom > 3 ||
      ![s.focus_x, s.focus_y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
    throw new Error("Invalid reframe settings.");
  }
  const ratio = ratios[s.aspect] || width / height;
  const availableWidth = Math.min(width, height * ratio);
  const availableHeight = Math.min(height, width / ratio);
  const w = Math.max(2, Math.min(Math.floor(width / 2) * 2, Math.floor(availableWidth / s.zoom / 2) * 2));
  const h = Math.max(2, Math.min(Math.floor(height / 2) * 2, Math.floor(availableHeight / s.zoom / 2) * 2));
  const x = Math.floor((width - w) * s.focus_x / 2) * 2;
  const y = Math.floor((height - h) * s.focus_y / 2) * 2;
  return {x, y, w, h};
}

function freeeditParseSrt(source, duration) {
  if (typeof source !== "string" || source.length > 1000000) throw new Error("Choose an SRT file under 1 MB.");
  const blocks = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  if (!source.trim()) throw new Error("The subtitle file is empty.");
  const cues = [];
  const parseTime = value => {
    const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value);
    if (!match) return NaN;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, "0")) / 1000;
  };
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split("\n");
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const timing = lines.shift()?.trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!timing || !lines.length) throw new Error(`Invalid SRT subtitle at block ${i + 1}.`);
    const start = parseTime(timing[1]), end = parseTime(timing[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Invalid subtitle timing at block ${i + 1}.`);
    }
    if (start >= duration) continue;
    const text = lines.join("\n").replace(/<\/?(?:i|b|u)>/gi, "").trim();
    if (!text) throw new Error(`Empty subtitle at block ${i + 1}.`);
    if (text.length > 240 || text.split("\n").length > 4) {
      throw new Error(`Subtitle ${i + 1} is too long. Split it into shorter cues.`);
    }
    const clippedEnd = Math.min(end, duration);
    if (clippedEnd - start < .05) continue;
    cues.push({start: Math.round(start * 1000) / 1000, end: Math.round(clippedEnd * 1000) / 1000, text});
    if (cues.length > 100) throw new Error("FreeEdit supports at most 100 caption cues per project.");
  }
  if (!cues.length) throw new Error("No subtitles fall within this recording.");
  return cues;
}
