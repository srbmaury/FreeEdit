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
