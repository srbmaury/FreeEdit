const {test} = require('node:test');
const assert = require('node:assert/strict');

test('scene validation is independent of UI and rejects out-of-frame regions', async () => {
  const {validateBackground} = await import('../frontend/scene-schema.mjs');
  const source = {has_video:true,width:1280,height:720};
  const bg = {mode:'blur',blur:16,color:'#e5e7eb',region:{x:1200,y:0,w:100,h:100}};
  assert.throws(() => validateBackground(bg,source), /invalid/);
  bg.region.x=100;
  const saved=validateBackground(bg,source);
  saved.region.x=500;
  assert.equal(bg.region.x,100);
  assert.throws(() => validateBackground(bg,{...source,has_video:false}), /invalid/);
});

test('presenter validation rejects unknown sound policy and invalid trim', async () => {
  const {validatePresenterProject} = await import('../frontend/scene-schema.mjs');
  const main={has_video:true,width:1280,height:720,duration:100};
  const value={source:{has_video:true,has_audio:true,name:'camera.mp4',size:100,algorithm:'sha256-chunks-4m-v1',fingerprint:'a'.repeat(64),duration:10,width:320,height:180},settings:{box:{x:0,y:0,w:320,h:180},offset:0,trim_start:0,trim_end:10,main_volume:1,presenter_volume:1,sound:'both',effect:'original'}};
  assert.equal(validatePresenterProject(value,main).settings.sound,'both');
  value.settings.trim_end=20;
  assert.throws(() => validatePresenterProject(value,main), /Invalid presenter/);
  value.settings.trim_end=10;value.settings.sound='unknown';
  assert.throws(() => validatePresenterProject(value,main), /Invalid presenter/);
});
