const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ctx=vm.createContext({structuredClone});
vm.runInContext(fs.readFileSync('frontend/editor-model.js','utf8')+';globalThis.model=EditorModel;',ctx);
const model=ctx.model;
test('speed validation, persistence and payload preserve source timing',async()=>{
 const edit={id:1,type:'speed',start:1,end:3,rate:2};
 assert.equal(model.validateSpeed(edit,4),null);
 assert.ok(model.validateSpeed({...edit,rate:0},4));
 assert.ok(model.validateSpeed({...edit,start:2},4,[edit]));
 assert.equal(model.validateSpeed(edit,4,[edit],1),null);
 const {buildExportPayload}=await import('../frontend/export-payload.mjs');
 const payload=buildExportPayload({job:{has_video:false},edits:[edit],audio:{},preset:'audio_only'},{});
 assert.deepEqual(payload.speed_regions,[{start:1,end:3,rate:2}]);assert.deepEqual(payload.edits,[]);
 const {validateProjectDocument}=await import('../frontend/project-schema.mjs');
 const source={name:'test.wav',size:10,algorithm:'sha256-chunks-4m-v1',fingerprint:'a'.repeat(64),duration:4,width:0,height:0,has_video:false,has_audio:true};
 const project=validateProjectDocument({format:'FreeEdit',version:2,source,edits:[model.editableProperties(edit)],settings:{denoise:false,strength:'',preset:'audio_only'}},{EditorModel:model});
 assert.equal(project.edits[0].rate,2);assert.equal(project.edits[0].start,1);
});
test('original and result comparisons invert speed and cuts and survive recovery',async()=>{
 const {speedRanges,comparisonTime,recoverSubmission}=await import('../frontend/export-state.mjs');
 const ranges=speedRanges([[0,2],[2.5,4]],[{type:'speed',start:1,end:3,rate:2}]);
 assert.deepEqual(ranges,[[0,1,1],[1,2,2],[2.5,3,2],[3,4,1]]);
 assert.equal(comparisonTime(ranges,4,true),2.75);
 for(const t of [.2,1.3,2.7,3.4])assert.ok(Math.abs(comparisonTime(ranges,comparisonTime(ranges,t,true),false)-t)<1e-8);
 assert.ok(recoverSubmission({jobId:'j',submissionId:'s',signature:'x',ranges},{id:'j',export_submission_id:'s',media:{duration:4}}));
});
