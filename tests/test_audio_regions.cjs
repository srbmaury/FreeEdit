const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({structuredClone});
vm.runInContext(fs.readFileSync('frontend/editor-model.js','utf8')+';globalThis.model=EditorModel;',context);
const model=context.model;
test('audio regions are validated timed edits and preserve content on style paste',()=>{
  const edit={type:'audio',id:1,start:1,end:3,volume:0,fade:.05};
  assert.equal(model.validateAudioRegion(edit,4),null);assert.equal(model.isTimedEdit(edit),true);
  for(const update of [{end:5},{volume:-.1},{fade:.5},{start:3}])assert.ok(model.validateAudioRegion({...edit,...update},4));
  const copied=model.pastedStyle({...edit,id:2,start:0,end:1,volume:1},model.styleProperties(edit));
  assert.equal(copied.volume,0);assert.equal(copied.id,2);assert.equal(copied.end,1);
  assert.match(model.limitError(Array.from({length:51},()=>edit)),/50 audio/);
});
test('audio regions survive audio-only payload projection without becoming visual edits',async()=>{
  const {buildExportPayload}=await import('../frontend/export-payload.mjs');
  const edit={id:1,type:'audio',start:1,end:2,volume:.5,fade:.05};
  const payload=buildExportPayload({job:{has_video:false,has_audio:true},edits:[edit],audio:{},preset:'audio_only'},{});
  assert.deepEqual(payload.audio_regions,[{start:1,end:2,volume:.5,fade:.05}]);assert.deepEqual(payload.edits,[]);
});
