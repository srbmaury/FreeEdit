import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildExportPayload} from '../frontend/export-payload.mjs';

const document = () => ({
  job: {has_video:true, has_audio:true}, audio:{fade_in:1}, presenter:null,
  presenterHasAudio:false, reframe:{zoom:1}, background:{mode:'blur'},
  denoise:true, strength:'18', preset:'balanced',
  edits:[{id:1,type:'cut',start:1,end:2},
    {id:2,type:'hide',start:0,end:1,x:1,y:2,w:4,h:5,style:'black'},
    {id:3,type:'text',start:2,end:3,x:1.8,y:2.2,text:'hello'},
    {id:4,type:'annotation',start:3,end:4,image:'png'}],
});
const adapters = {exportReframe:scene=>scene, textToPng:()=> 'text-png',
  annotationPayload:edit=>({type:edit.type,start:edit.start,end:edit.end,image:edit.image})};

test('export projection preserves timing and creates independent payload values',()=>{
  const source=document(), before=structuredClone(source);
  const payload=buildExportPayload(source,adapters);
  assert.deepEqual(payload.cuts,[{start:1,end:2}]);
  assert.deepEqual(payload.edits.map(e=>e.type),['hide','text','annotation']);
  assert.equal(payload.edits[1].x,2);
  assert.equal(payload.edits[1].y,2);
  assert.equal(payload.edits[1].image,'text-png');
  assert.equal(payload.atten_lim,18);
  payload.audio.fade_in=99;payload.background.mode='color';payload.reframe.zoom=3;
  assert.deepEqual(source,before);
});

test('audio-only export never rasterizes or exports visual edits',()=>{
  const source=document();source.preset='audio_only';
  const unexpected=()=>{throw Error('visual work must not run');};
  const payload=buildExportPayload(source,{exportReframe:unexpected,textToPng:unexpected,annotationPayload:unexpected});
  assert.deepEqual(payload.edits,[]);
  assert.deepEqual(payload.cuts,[{start:1,end:2}]);
  assert.equal(payload.reframe,null);assert.equal(payload.background,null);
});

test('noise admission follows the selected media audio and explicit user choice',()=>{
  const source=document();source.job.has_audio=false;source.strength='';
  assert.equal(buildExportPayload(source,adapters).denoise,false);
  source.presenterHasAudio=true;
  assert.equal(buildExportPayload(source,adapters).denoise,true);
  source.denoise=false;
  const payload=buildExportPayload(source,adapters);
  assert.equal(payload.denoise,false);assert.equal(payload.atten_lim,null);
});
