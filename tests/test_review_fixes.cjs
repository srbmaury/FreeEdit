const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('frontend/editor-model.js','utf8'),context);
const model = vm.runInContext('EditorModel',context);

test('limits reject the next cut, overlay, zoom or combined edit without rejecting valid boundaries',()=>{
  const cuts=Array.from({length:100},()=>({type:'cut'}));
  assert.equal(model.limitError(cuts),null);
  assert.match(model.limitError([...cuts,{type:'cut'}]),/100 cuts/);
  const overlays=Array.from({length:100},()=>({type:'text'}));
  assert.match(model.limitError([...overlays,{type:'hide'}]),/100 masks/);
  assert.match(model.limitError(Array.from({length:21},()=>({type:'reframe'}))),/20 timed/);
  const valid=[...cuts,...overlays.slice(0,80),...Array.from({length:20},()=>({type:'reframe'}))];
  assert.equal(model.limitError(valid),null);
  assert.match(model.limitError([...valid,{type:'text'}]),/200 edits/);
});

test('manual rejection leaves edits, identity and undo untouched',()=>{
 const code=fs.readFileSync('frontend/editor-edits.js','utf8');
 const functions=code.slice(code.indexOf('function admitEdits('),code.indexOf('\nfunction deleteEdit('));
 const S={edits:Array.from({length:100},()=>({type:'cut'})),nextId:101};
 let message;
 const c=vm.createContext({S,EditorModel:model,showProjectMessage:(title,text)=>{message=text;},commitEdit:()=>{throw Error('must not mutate');}});
 vm.runInContext(functions,c);
 assert.equal(vm.runInContext('addEdit({type:"cut"})',c),null);
 assert.equal(S.edits.length,100);assert.equal(S.nextId,101);assert.match(message,/100 cuts/);
});

test('recovery keeps submitted signature/ranges instead of newer edits, and fails closed without submission identity',async()=>{
 const exportRules=await import('../frontend/export-state.mjs');
 const code=fs.readFileSync('frontend/projects.js','utf8');
 const fn=code.slice(code.indexOf('async function locateProjectSource('),code.indexOf('\n$("projectSourceInput")'));
 for(const matching of [true,false]) {
  const S={job:{id:'abcdef123456'}};
  const job={id:S.job.id,media:{duration:10},status:'processing',operation:'export',export_submission_id:'server-id'};
  const submission={jobId:job.id,submissionId:matching?'server-id':'old-id',signature:'submitted-document',ranges:[[0,2],[3,10]]};
  const c=vm.createContext({S,projects:{pending:null},exportRules,editorReady:Promise.resolve(),api:async()=>job,fetch:async()=>({ok:true}),AbortSignal,projectMediaMatches:()=>true,openEditor:()=>{},projectSourceReady:()=>{},restoreResultPreviewSubmission:()=>{},saveRecovery:()=>{},setBusy:()=>{},show:()=>{},$:()=>({}),setProgress:()=>{},poll:()=>{}});
  vm.runInContext(fn,c);c.project={source:{name:'recording'}};c.projects.pending=c.project;c.recovery={jobId:job.id,exportSubmission:submission};
  await vm.runInContext('locateProjectSource(project,recovery)',c);
  assert.equal(S.exportSignature,matching?'submitted-document':'');
  assert.equal(S.submittedRanges.length,matching?2:0);
 }
});

test('completed export recovery restores the result and saves identity only after restoration',async()=>{
 const exportRules=await import('../frontend/export-state.mjs');
 const code=fs.readFileSync('frontend/projects.js','utf8');
 const fn=code.slice(code.indexOf('async function locateProjectSource('),code.indexOf('\n$("projectSourceInput")'));
 const S={job:{id:'abcdef123456'},exportSubmission:null};
 const job={id:S.job.id,media:{duration:10},status:'done',operation:'export',output:'output.mp4',export_submission_id:'server-id'};
 const submission={jobId:job.id,submissionId:'server-id',signature:'submitted-document',ranges:[[0,10]]};
 const saves=[];let restored=0;
 const c=vm.createContext({S,projects:{pending:null},exportRules,editorReady:Promise.resolve(),api:async()=>job,fetch:async()=>({ok:true}),AbortSignal,
  projectMediaMatches:()=>true,openEditor:()=>{},projectSourceReady:(_,options)=>{assert.equal(options.save,false);},
  restoreResultPreviewSubmission:()=>{},processDone:()=>{restored++;},saveRecovery:()=>{saves.push(S.exportSubmission?.submissionId);}});
 vm.runInContext(fn,c);c.project={source:{name:'recording'}};c.projects.pending=c.project;c.recovery={jobId:job.id,exportSubmission:submission};
 await vm.runInContext('locateProjectSource(project,recovery)',c);
 assert.equal(restored,1);assert.deepEqual(saves,['server-id']);
});

test('recovered previews retain known signatures and show unknown submissions as stale',async()=>{
 const exportRules=await import('../frontend/export-state.mjs');
 const source=fs.readFileSync('frontend/result-preview.js','utf8');
 const functions=source.slice(source.indexOf('function restoreResultPreviewSubmission('),source.indexOf('\nfunction rangePlayer('));
 for(const matching of [true,false]) {
  const elements=new Map();let opened=false;
  const c=vm.createContext({exportRules,S:{job:{id:'job'}},previewSubmission:null,pendingResultSample:null,
   setBusy:()=>{},show:()=>{},fmt:String,editSignature:()=>"submitted-preview",switchResultRange:()=>{},refreshResultPreview:()=>{},
   $:id=>{if(!elements.has(id))elements.set(id,{showModal:()=>{opened=true;}});return elements.get(id);}});
  vm.runInContext(functions,c);
  c.saved={id:'job',submissionId:matching?'preview-id':'old-id',signature:'submitted-preview'};
  c.job={id:'job',operation:'result-preview',status:'processing',result_preview_submission_id:'preview-id'};
  vm.runInContext('restoreResultPreviewSubmission(saved,job)',c);
  c.sample={file:'sample.mp4',start:0,end:5,ranges:[[0,5]]};
  vm.runInContext('resultPreviewDone(sample)',c);
  assert.equal(opened,true);
  assert.match(elements.get('resultPreviewDescription').textContent,matching?/Export settings/:/could not be verified/);
  assert.equal(vm.runInContext('resultSample.signature',c),matching?'submitted-preview':'');
 }
});

test('completed preview recovery restores the pending preview before showing its result',async()=>{
 const exportRules=await import('../frontend/export-state.mjs');
 const code=fs.readFileSync('frontend/projects.js','utf8');
 const fn=code.slice(code.indexOf('async function locateProjectSource('),code.indexOf('\n$("projectSourceInput")'));
 const job={id:'abcdef123456',media:{duration:10},status:'uploaded',operation:'result-preview',
  result_preview_submission_id:'preview-id',result_preview:{file:'sample.mp4',ranges:[[0,5]]}};
 const order=[];
 const c=vm.createContext({S:{job},projects:{pending:null},exportRules,editorReady:Promise.resolve(),api:async()=>job,
  fetch:async()=>({ok:true}),AbortSignal,projectMediaMatches:()=>true,openEditor:()=>{},
  projectSourceReady:()=>{},restoreResultPreviewSubmission:()=>{order.push('restore');},
  resultPreviewDone:()=>{order.push('display');},saveRecovery:()=>{order.push('save');}});
 vm.runInContext(fn,c);c.project={source:{name:'recording'}};c.projects.pending=c.project;
 c.recovery={jobId:job.id,previewSubmission:{id:job.id,submissionId:'preview-id',signature:'settings'}};
 await vm.runInContext('locateProjectSource(project,recovery)',c);
 assert.deepEqual(order,['restore','display','save']);
});

test('late recovery never replaces a newer upload, project or editing session',async()=>{
 const exportRules=await import('../frontend/export-state.mjs');
 const code=fs.readFileSync('frontend/projects.js','utf8');
 const fn=code.slice(code.indexOf('async function locateProjectSource('),code.indexOf('\n$("projectSourceInput")'));
 for(const supersede of ['upload','project','editor']) {
  let resolve;const reply=new Promise(r=>{resolve=r;});let opened=false;
  const S={job:null,pendingUpload:null};const projects={pending:null};
  const c=vm.createContext({S,projects,exportRules,editorReady:Promise.resolve(),api:()=>reply,
   fetch:async()=>({ok:true}),AbortSignal,projectMediaMatches:()=>true,openEditor:()=>{opened=true;},
   showProjectMessage:()=>{throw Error('stale lookup must not show relink dialog');}});
  vm.runInContext(fn,c);c.project={source:{name:'old'}};projects.pending=c.project;c.recovery={jobId:'abcdef123456'};
  const pending=vm.runInContext('locateProjectSource(project,recovery)',c);
  await new Promise(r=>setImmediate(r));
  if(supersede==='upload')S.pendingUpload={name:'new.mp4'};
  if(supersede==='project')projects.pending={source:{name:'new'}};
  if(supersede==='editor')S.job={id:'new'};
  resolve({id:'abcdef123456',media:{duration:10},status:'uploaded'});
  await pending;assert.equal(opened,false,supersede);
 }
});
