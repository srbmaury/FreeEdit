"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const html=fs.readFileSync("frontend/index.html","utf8");
const app=fs.readFileSync("frontend/app.js","utf8");
const reframe=fs.readFileSync("frontend/reframe-captions.js","utf8");
const drawing=fs.readFileSync("frontend/editor-render.js","utf8");
const exporter=fs.readFileSync("frontend/editor-export.js","utf8");
const projects=fs.readFileSync("frontend/projects.js","utf8");
const projectSchema=fs.readFileSync("frontend/project-schema.mjs","utf8");
const timeline=fs.readFileSync("frontend/timeline.js","utf8");
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync("frontend/editor-model.js","utf8"),ctx);
const evaluate=(expression)=>vm.runInContext(expression,ctx);
const document=[
 {id:1,type:"cut",start:1,end:2},
 {id:2,type:"text",start:4,end:5,text:"Demo"},
 {id:3,type:"reframe",start:2,end:3,zoom:1.8,focus_x:.5,focus_y:.5,transition:.3}
];

test("one timeline document contains all supported edit types",()=>{
  const types=evaluate("EditorModel.TIMELINE_TYPES");
  assert.deepEqual(Array.from(types),["cut","hide","text","reframe","annotation","audio","speed"]);
  assert.deepEqual(Array.from(evaluate("EditorModel.sorted("+JSON.stringify(document)+")"),e=>e.id),[1,3,2]);
  assert.equal(evaluate("EditorModel.byType("+JSON.stringify(document)+",'reframe').length"),1);
});

test("timed Reframe export is derived from unified timeline state",()=>{
 const actual=evaluate("EditorModel.exportReframe({aspect:'square',zoom:1,focus_x:.5,focus_y:.5},"+
  JSON.stringify(document)+")");
 assert.equal(actual.aspect,"square");
 assert.equal(actual.sections.length,1);
 assert.equal(actual.sections[0].start,2);
 assert.equal(actual.sections[0].zoom,1.8);
 assert.equal("id" in actual.sections[0],false);
});

test("Reframe validation rejects overlap, out of bounds and invalid zoom",()=>{
 const valid={...document[2],id:4,start:3,end:4};
 const check=(e,ignore=null)=>evaluate("EditorModel.validateReframe("+JSON.stringify(e)+",10,"+
  JSON.stringify(document)+","+JSON.stringify(ignore)+")");
 assert.equal(check(valid),null);
 assert.match(check({...valid,start:2.5}),/overlap/i);
 assert.match(check({...valid,zoom:4}),/valid/i);
 assert.match(check({...valid,end:11}),/valid/i);
 assert.equal(check({...document[2],zoom:2.5},3),null);
});

test("store dispatch notifies all subscribers and supports unsubscribe",()=>{
 evaluate("var editStore=createEditorStore({edits:[]});var visits=[];var unsub=editStore.subscribe(change=>visits.push(change.reason));");
 evaluate("editStore.dispatch('add',state=>state.edits.push({id:1,type:'cut'}));");
 assert.equal(evaluate("editStore.state.edits.length"),1);
 assert.equal(evaluate("visits.length"),1);
 evaluate("unsub();editStore.dispatch('remove',state=>state.edits.pop());");
 assert.equal(evaluate("visits.length"),1);
 assert.equal(evaluate("editStore.revision"),2);
});

test("unified inspector, timeline and persistence are wired",()=>{
 for(const id of ["editsList","editCount","selectedZoomPanel","selectedZoomStart",
  "selectedZoomEnd","selectedZoomStrength","selectedZoomTransition","zoomTrack"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/script src="editor-model\.js"/);
 assert.match(app,/const editorStore = createEditorStore\(S\)/);
 assert.match(drawing+exporter,/EditorModel\.exportReframe\(S\.reframe, S\.edits\)/);
 assert.match(projects,/version: 2/);
 assert.match(projectSchema,/EditorModel\.TIMELINE_TYPES/);
 assert.match(projects,/validateProjectDocument/);
 assert.match(reframe,/const zoomSections = \(\) => EditorModel\./);
 assert.match(reframe,/selectedReframe\(\)/);
 assert.match(timeline,/renderZoomTimeline\(\)/);
 assert.doesNotMatch(reframe,/S\.selectedZoom/);
});

test("browser and exporter share quintic baseline easing",()=>{
 vm.runInContext(fs.readFileSync("frontend/media-utils.js","utf8"),ctx);
 const config={aspect:"original",zoom:2,focus_x:.7,focus_y:.6,
 sections:[{start:1,end:3,zoom:2.5,focus_x:.7,focus_y:.6,transition:.5}]};
 for(const [t,value] of [[0,2],[1,2],[1.25,2.25],[2,2.5],[2.75,2.25],[3,2],[4,2]]){
  const actual=evaluate("freeeditReframeAt("+JSON.stringify(config)+","+t+").zoom");
  assert.ok(Math.abs(actual-value)<1e-8,"time "+t);
 }
});
