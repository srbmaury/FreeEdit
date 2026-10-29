const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function context(){
  const elements=new Map();
  const ctx=vm.createContext({structuredClone,S:{job:{id:'test'},edits:[]},window:{addEventListener(){}},
    $:id=>{if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id);},api:async()=>{throw Error('Failed');}});
  vm.runInContext(fs.readFileSync('frontend/clips.js','utf8'),ctx);
  vm.runInContext(`renderSequenceClips=()=>{};sequenceClips=[{id:'a',duration:5},{id:'b',duration:5},{id:'c',duration:5}];sequenceTransitions=[{type:'cut',duration:0},{type:'crossfade',duration:1}];`,ctx);
  return ctx;
}
test('blocked removal preserves transitions and accounts for crossfade overlap',()=>{
  const ctx=context();
  vm.runInContext(`S.edits=[{end:20}];removeSequenceClip(0);`,ctx);
  assert.equal(vm.runInContext('sequenceTransitions.length',ctx),2);
  vm.runInContext(`sequenceTransitions=[{type:'crossfade',duration:1},{type:'cut',duration:0}];S.edits=[{end:9.5}];removeSequenceClip(2);`,ctx);
  assert.match(vm.runInContext('$("sequenceStatus").textContent',ctx),/cannot be removed/);
  assert.equal(vm.runInContext('sequenceTransitions.length',ctx),2);
});
test('failed rebuild does not commit proposed transitions',async()=>{
  const ctx=context();
  await vm.runInContext(`rebuildSequence(['a','b','c'],[{type:'crossfade',duration:2},{type:'cut',duration:0}])`,ctx);
  assert.equal(vm.runInContext('sequenceTransitions[0].type',ctx),'cut');
  assert.equal(vm.runInContext('sequenceTransitions[1].duration',ctx),1);
});
