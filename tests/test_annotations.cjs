"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync("frontend/annotation-model.js","utf8"),ctx);
const call=(expr)=>vm.runInContext(expr,ctx);
test("all five annotation types use the same validated time model",()=>{
 for(const kind of ["icon","shape","arrow","callout","image"]){
   const entry=call("AnnotationModel.defaultEdit("+JSON.stringify(kind)+",1280,720,1,3)");
   if(kind==="image")entry.image="data:image/png;base64,iVBORw0KGgo=";
   assert.equal(call("AnnotationModel.validate("+JSON.stringify(entry)+",5,1280,720)"),null,kind);
 }
});
test("invalid annotation ranges, assets and animation are rejected",()=>{
 const edit=call("AnnotationModel.defaultEdit('callout',1280,720,1,3)");
 const valid=(obj)=>call("AnnotationModel.validate("+JSON.stringify(obj)+",4,1280,720)");
 assert.equal(valid(edit),null);
 assert.match(valid({...edit,end:5}),/Invalid/);
 assert.match(valid({...edit,animation:"bounce"}),/Invalid/);
 assert.match(valid({...edit,opacity:-1}),/Invalid/);
 assert.match(valid({...edit,kind:"image",image:"javascript:alert(1)"}),/Choose/);
});
test("animated opacity and slide boundaries are deterministic",()=>{
 const e=call("AnnotationModel.defaultEdit('icon',1280,720,1,3)");
 e.animation="fade";e.transition=.5;
 const at=t=>call("AnnotationModel.animationState("+JSON.stringify(e)+","+t+")");
 assert.equal(at(1).alpha,0);
 assert.equal(at(1.25).alpha,.5);
 assert.equal(at(2).alpha,1);
 assert.equal(at(3).alpha,0);
 e.animation="slide";
 assert.equal(at(1).alpha,1);
 const slide=t=>call("AnnotationModel.animationState("+JSON.stringify(e)+","+t+")");
 assert.ok(slide(1).dx<0);
 assert.ok(Math.abs(slide(2).dx) < 1e-9);
});
test("selecting an animated edit seeks to a fully visible preview frame",()=>{
 const e=call("AnnotationModel.defaultEdit('icon',1280,720,1,3)");
 e.animation="fade";e.transition=.5;
 const at=x=>call("AnnotationModel.visibleTime("+JSON.stringify(x)+")");
 assert.equal(at(e),1.5);
 assert.equal(at({...e,animation:"none"}),1);
 const short={...e,start:1,end:1.4,transition:.8};
 assert.ok(Math.abs(at(short)-1.2)<1e-10);
 const visible=call("AnnotationModel.animationState("+JSON.stringify(e)+","+at(e)+")");
 assert.equal(visible.alpha,1);
});
test("animation switch preview frames distinguish fade and slide",()=>{
 const base=call("AnnotationModel.defaultEdit('icon',1280,720,1,3)");
 const at=edit=>call("AnnotationModel.previewTime("+JSON.stringify(edit)+")");
 assert.ok(at(base)>base.start);
 const fade={...base,animation:"fade",transition:.4};
 const slide={...base,animation:"slide",transition:.4};
 assert.ok(Math.abs(at(fade)-1.2)<1e-10);
 assert.equal(at(fade),at(slide));
 const fadeState=call("AnnotationModel.animationState("+JSON.stringify(fade)+","+at(fade)+")");
 const slideState=call("AnnotationModel.animationState("+JSON.stringify(slide)+","+at(slide)+")");
 assert.ok(fadeState.alpha>.1&&fadeState.alpha<.9);
 assert.equal(fadeState.dx,0);
 assert.equal(slideState.alpha,1);
 assert.ok(slideState.dx<0);
 const backToFade=call("AnnotationModel.animationState("+JSON.stringify(fade)+","+at(fade)+")");
 assert.equal(backToFade.alpha,fadeState.alpha);
});
test("rotated overlay raster fits corners",()=>{
 const edit=call("AnnotationModel.defaultEdit('shape',1280,720,1,3)");
 const bounds=call("AnnotationModel.rasterBounds("+JSON.stringify(edit)+")");
 assert.ok(bounds.w>=edit.w&&bounds.h>=edit.h);
});
