"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("frontend/index.html", "utf8");
const app = fs.readFileSync("frontend/app.js", "utf8");
const workspace = fs.readFileSync("frontend/workspace.js", "utf8");
const reframe = fs.readFileSync("frontend/reframe-captions.js", "utf8");
const timeline = fs.readFileSync("frontend/timeline.js", "utf8");

test("each reframe inspector and timeline element actually exists in HTML", () => {
  for (const id of ["editsList", "editCount", "editsEmpty", "selectedZoomPanel",
    "selectedZoomStart", "selectedZoomEnd", "selectedZoomStrength",
    "selectedZoomX", "selectedZoomY", "selectedZoomTransition",
    "selectedZoomError", "selectedZoomRemove", "zoomTrack", "zoomLabelTrack"]) {
    assert.match(html, new RegExp('id="' + id + '"'), "Missing " + id);
  }
  // The previous implementation wrote to zoomEditsList, an element that
  // no longer existed, so users always saw an empty Edits inspector.
  assert.doesNotMatch(reframe, /\$\("zoomEditsList"\)/);
  assert.match(reframe, /const list = \$\("editsList"\)/);
});

test("Edits opens with fresh state, including global and timed reframes", () => {
  assert.match(workspace, /reason === "select-tool"[\s\S]*?renderList\(\)/);
  assert.match(reframe, /config\.aspect !== "original"/);
  assert.match(reframe, /config\.zoom > 1\.001/);
  assert.match(reframe, /S\.edits\.length \+ sections\.length \+ Number\(wholeVideo\)/);
  assert.match(reframe, /row\.dataset\.start = String\(section\.start\)/);
  assert.match(reframe, /function selectZoom\(index\)/);
  assert.match(reframe, /function renderZoomTimeline\(/);
  assert.match(timeline, /renderZoomTimeline\(\)/);
});

test("saved project and undo include reframe sections", () => {
  const projects = fs.readFileSync("frontend/projects.js", "utf8");
  assert.match(app, /function snapshot\(\) \{ return JSON\.stringify\(\{[^}]*reframe: S\.reframe/);
  assert.match(projects, /reframe: S\.reframe/);
  assert.match(projects, /reframe\.sections != null/);
});

test("smoothed zoom is 1x at the section boundaries and returns to 1x", () => {
  const script = fs.readFileSync("frontend/media-utils.js", "utf8");
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  const s = {aspect:"original",zoom:2,focus_x:.7,focus_y:.6,
    sections:[{start:1,end:3,zoom:2,focus_x:.7,focus_y:.6,transition:.5}]};
  for (const [time, expected] of [[0,1],[1,1],[1.25,1.5],[2,2],[2.75,1.5],[3,1],[4,1]]) {
    const actual = vm.runInContext("freeeditReframeAt(" + JSON.stringify(s) + "," + time + ").zoom", ctx);
    assert.ok(Math.abs(actual - expected) < 1e-8, "time=" + time + " got " + actual);
  }
});
