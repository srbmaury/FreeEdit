"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync("frontend/media-utils.js", "utf8"), context);
const crop = (w, h, s) => vm.runInContext(`freeeditCropRect(${w},${h},${JSON.stringify(s)})`, context);
const parse = (s, d) => vm.runInContext("freeeditParseSrt(" + JSON.stringify(s) + "," + d + ")", context);

test("original aspect uses the full even-sized source", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(crop(1920,1080,{aspect:"original",zoom:1,focus_x:.5,focus_y:.5}))), {x:0,y:0,w:1920,h:1080});
});
test("vertical reframing stays inside widescreen frame with even dimensions", () => {
  const r = crop(1920,1080,{aspect:"vertical",zoom:1,focus_x:.5,focus_y:.5});
  assert.ok(r.w < r.h && r.x >= 0 && r.y >= 0 && r.x+r.w <= 1920 && r.y+r.h <= 1080);
  assert.equal(r.w%2,0); assert.equal(r.h%2,0);
});
test("zoom and focus move the selected region", () => {
  const left = crop(1280,720,{aspect:"square",zoom:2,focus_x:0,focus_y:0});
  const right = crop(1280,720,{aspect:"square",zoom:2,focus_x:1,focus_y:1});
  assert.equal(left.x,0); assert.ok(right.x > left.x && right.y > left.y);
  assert.equal(left.w,right.w); assert.equal(left.h,right.h);
});
test("invalid reframe values are rejected", () => {
  assert.throws(()=>crop(1920,1080,{aspect:"wide",zoom:0,focus_x:.5,focus_y:.5}),/Invalid/);
});
test("parse SRT numbers, CRLF, BOM, formatting and clipped endings", () => {
  const cues = parse("\uFEFF1\r\n00:00:01,200 --> 00:00:02,500\r\n<i>Hello</i>\r\n\r\n2\r\n00:00:03.000 --> 00:00:05.000\r\nWorld",4);
  assert.equal(cues.length,2); assert.equal(cues[0].text,"Hello");assert.equal(cues[0].start,1.2);assert.equal(cues[1].end,4);
});
test("invalid or excessive SRT is rejected", () => {
  assert.throws(()=>parse("1\n00:00:02,000 --> 00:00:01,000\nOops",5),/Invalid/);
  assert.throws(()=>parse("",5),/empty/);
  assert.throws(()=>parse("1\n00:00:00,000 --> 00:00:02,000\n"+"a".repeat(241),5),/too long/);
});

test("timed zoom eases in and out only inside a selected range", () => {
  const settings={aspect:"wide",zoom:2,focus_x:.7,focus_y:.3,
    sections:[{start:1,end:3,zoom:2.5,focus_x:.8,focus_y:.3,transition:.5}]};
  const value=t=>vm.runInContext("freeeditReframeAt("+JSON.stringify(settings)+","+t+")",context);
  assert.equal(value(0).zoom,2);
  assert.equal(value(1).zoom,2);
  assert.ok(value(1.25).zoom>2 && value(1.25).zoom<2.5);
  assert.equal(value(2).zoom,2.5);
  assert.equal(value(3).zoom,2);
  assert.equal(value(4).zoom,2);
  assert.ok(Math.abs(value(1.25).focus_x-.75)<1e-5);
});
test("short reframe sections meet their peak without leaving the clip", () => {
  const settings={aspect:"original",zoom:1,focus_x:.5,focus_y:.5,
    sections:[{start:1,end:1.2,zoom:2,focus_x:.5,focus_y:.5,transition:.35}]};
  const value=t=>vm.runInContext("freeeditReframeAt("+JSON.stringify(settings)+","+t+")",context);
  assert.equal(value(1).zoom,1);
  assert.ok(Math.abs(value(1.1).zoom-2) < 1e-9);
  assert.equal(value(1.2).zoom,1);
});
