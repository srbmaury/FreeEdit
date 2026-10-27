const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('audio changes undo and redo in order with visual edits',()=>{
 const code=fs.readFileSync('frontend/editor-history.js','utf8');
 const functions=code.slice(code.indexOf('let audioHistoryState'),code.indexOf('\n$("undoBtn").onclick'));
 const S={job:{},edits:[],background:null,reframe:{zoom:1},undo:[],redo:[],selected:null};
 let audio={level_speech:false,fade_in:0,fade_out:0};
 const elements={denoise:{checked:true},strength:{value:'18'}};
 const c=vm.createContext({S,$:id=>elements[id],getAudioSettings:()=>({...audio}),presenterProject:()=>null,
  restorePresenter:()=>{},restoreAudioSettings:value=>{audio={...value};},
  editorStore:{dispatch:(_,mutate)=>{mutate(S);vm.runInContext('audioHistoryState=audioHistorySnapshot()',c);}},
  refreshExportState:()=>vm.runInContext('audioHistoryState=audioHistorySnapshot()',c),
  syncReframeControls:()=>{},syncBackgroundControls:()=>{},invalidateBackgroundPreview:()=>{},renderSilenceReview:()=>{}});
 vm.runInContext(fs.readFileSync('frontend/history-model.js','utf8'),c);
 vm.runInContext(functions,c);vm.runInContext('audioHistoryState=audioHistorySnapshot()',c);
 vm.runInContext('checkpoint({type:"focus"})',c);assert.equal(typeof S.undo[0].json,'string');S.undo=[];
 audio.fade_in=2;audio.level_speech=true;vm.runInContext('audioSettingsChanged()',c);
 assert.equal(S.undo.length,1);
 elements.denoise.checked=false;elements.strength.value='30';vm.runInContext('audioSettingsChanged()',c);
 vm.runInContext('checkpoint()',c);S.edits.push({type:'cut',start:1,end:2});
 vm.runInContext('restoreHistory()',c);assert.equal(S.edits.length,0);assert.equal(elements.denoise.checked,false);
 vm.runInContext('restoreHistory()',c);assert.equal(elements.denoise.checked,true);assert.equal(elements.strength.value,'18');assert.equal(audio.fade_in,2);
 vm.runInContext('restoreHistory()',c);assert.equal(audio.fade_in,0);assert.equal(audio.level_speech,false);
 vm.runInContext('restoreHistory(true)',c);assert.equal(audio.fade_in,2);
 vm.runInContext('restoreHistory(true)',c);assert.equal(elements.denoise.checked,false);assert.equal(elements.strength.value,'30');
});
