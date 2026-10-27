const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('frontend/projects.js','utf8');
const save=source.slice(source.indexOf('async function saveRecovery()'),source.indexOf('\n$("saveProjectBtn").onclick'));

function editor(write){
 const projects={signature:null,pendingSignature:null,recoveryRevision:0};
 const S={job:{id:'current',waveform:[]},exportSubmission:null};
 const status={textContent:''};
 let document={edits:[{text:'first'}]};
 const context=vm.createContext({projects,S,structuredClone,previewSubmission:null,
   projectDocument:()=>document,ownsRecovery:()=>true,$:()=>status,
   recoveryStore:Promise.resolve({write})});
 vm.runInContext(save,context);
 return {projects,S,status,context,setDocument:value=>{document=value;},save:()=>vm.runInContext('saveRecovery()',context)};
}

test('autosave captures its document before async storage and ignores superseded completion',async()=>{
 const writes=[];const completions=[];
 const app=editor(snapshot=>{writes.push(snapshot);return new Promise(resolve=>completions.push(resolve));});
 const first=app.save();await new Promise(resolve=>setImmediate(resolve));
 app.setDocument({edits:[{text:'second'}]});
 const second=app.save();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(writes[0].project.edits[0].text,'first');
 assert.equal(writes[1].project.edits[0].text,'second');
 completions[1]();await second;
 const current=app.projects.signature;
 completions[0]();await first;
 assert.equal(app.projects.signature,current);
 assert.match(current,/second/);
});

test('quota failures stay visible and a later successful save can recover',async()=>{
 let fail=true;
 const app=editor(async()=>{if(fail)throw Error('quota');});
 await app.save();
 assert.match(app.status.textContent,/Save project/);
 assert.equal(app.projects.signature,null);
 assert.equal(app.projects.pendingSignature,null);
 fail=false;await app.save();
 assert.match(app.status.textContent,/Saved in this browser/);
});

test('a late save cannot mark a replacement recording as saved',async()=>{
 let complete;
 const app=editor(()=>new Promise(resolve=>{complete=resolve;}));
 const pending=app.save();await new Promise(resolve=>setImmediate(resolve));
 app.S.job={id:'replacement'};app.status.textContent='New recording';
 complete();await pending;
 assert.equal(app.status.textContent,'New recording');
 assert.equal(app.projects.signature,null);
});

test('undoing to the saved document supersedes a pending different snapshot',async()=>{
 const writes=[];let release;
 const app=editor(async snapshot=>{writes.push(snapshot);});
 await app.save();
 app.setDocument({edits:[{text:'second'}]});
 app.context.recoveryStore=Promise.resolve({write:snapshot=>{
   writes.push(snapshot);return new Promise(resolve=>{release=resolve;});
 }});
 const pending=app.save();await new Promise(resolve=>setImmediate(resolve));
 app.setDocument({edits:[{text:'first'}]});
 app.context.recoveryStore=Promise.resolve({write:async snapshot=>{writes.push(snapshot);}});
 await app.save();release();await pending;
 assert.equal(writes.at(-1).project.edits[0].text,'first');
 assert.match(app.projects.signature,/first/);
});
