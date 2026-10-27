import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.FREEEDIT_TEST_ENGINE || 'chrome';
const browser=await ({chrome:chromium,firefox,webkit}[engine]).launch({headless:true,...(engine==='chrome'?{channel:'chrome'}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(process.env.FREEEDIT_TEST_URL || 'http://127.0.0.1:8765/');
  await page.locator('#fileInput').setInputFiles('/tmp/freeedit-ci-sample.mp4');
  await page.locator('#editorView:not(.hidden)').waitFor();
  await page.waitForFunction(()=>video.readyState>=2);
  await page.evaluate(()=>{video.currentTime=0;addTextAt(20,25);});
  await page.locator('.card.selected').getByRole('button',{name:'Duplicate',exact:true}).click();
  const duplicate=await page.evaluate(()=>{
    const [a,b]=S.edits;return {ids:[a.id,b.id],a:EditorModel.editableProperties(a),b:EditorModel.editableProperties(b)};
  });
  assert.notEqual(...duplicate.ids);assert.deepEqual(duplicate.a,duplicate.b);
  await page.evaluate(()=>{
    const [a,b]=S.edits;a.color='#ff0000';a.fontSize=32;b.text='Different content';b.x=60;b.start=.2;
    copyEditStyle(a.id);pasteEditStyle(b.id);
  });
  const pasted=await page.evaluate(()=>({...S.edits[1]}));
  assert.equal(pasted.color,'#ff0000');assert.equal(pasted.text,'Different content');assert.equal(pasted.x,60);assert.equal(pasted.start,.2);
  await page.evaluate(()=>restoreHistory());
  assert.equal(await page.evaluate(()=>S.edits[1].color),'#ffffff');
  await page.evaluate(()=>restoreHistory(true));
  assert.equal(await page.evaluate(()=>S.edits[1].color),'#ff0000');
  await page.locator('.workspace-rail button').filter({hasText:/^Reframe$/}).click();
  await page.locator('#reframeWholeGroup summary').click();
  await page.locator('#canvasFramePanel summary').click();
  assert.equal(await page.evaluate(()=>reframeGuideSection()),null);
  await page.locator('#canvasEnabled').check();
  await page.locator('#canvasAspect').selectOption('square');
  await page.locator('#canvasColor').fill('#123456');
  await page.locator('#canvasColor').dispatchEvent('change');
  // Leave Reframe's source crop guide to inspect the finished composition.
  await page.locator('.workspace-rail button').filter({hasText:/^Text$/}).click();
  await page.waitForFunction(()=>!document.getElementById('reframePreviewCanvas').hidden);
  const framed=await page.evaluate(()=>{
    const c=document.getElementById('reframePreviewCanvas'), g=CanvasModel.geometry(S.job.width,S.job.height,S.framing);
    const bounds=canvas.getBoundingClientRect();
    const p=toSource({clientX:bounds.left+(g.x+g.iw*.5)/g.w*bounds.width,clientY:bounds.top+(g.y+g.ih*.5)/g.h*bounds.height});
    return {pixel:[...c.getContext('2d').getImageData(0,0,1,1).data],ratio:bounds.width/bounds.height,p};
  });
  assert.deepEqual(framed.pixel,[18,52,86,255]);assert.ok(Math.abs(framed.ratio-1)<.01);
  assert.ok(Math.abs(framed.p.x-160)<1);assert.ok(Math.abs(framed.p.y-90)<1);
  await page.evaluate(()=>{
    const base=AnnotationModel.defaultEdit('drawing',320,180,0,3);
    const stroke={...base,x:20,y:20,w:60,h:30,points:[[.1,.1],[.8,.8]],strokeWidth:.05};
    const group=addEdit({...base,...DrawingModel.group([stroke,{...stroke,x:90,color:'#00ff00'}])});
    duplicateEdit(group.id);
    const copy=getEdit(S.selected);
    if(copy.id===group.id || copy.strokes===group.strokes)throw new Error('Drawing duplicate shares identity or strokes');
    const old=group.strokes[0].points[0][0];copy.strokes[0].points[0][0]+=.01;
    if(group.strokes[0].points[0][0]!==old)throw new Error('Drawing paths share mutable state');
  });
  await page.locator('.workspace-rail button').filter({hasText:/^Reframe$/}).click();
  // A detailed image fits the upload limit but expands far beyond the PNG
  // asset budget. It should be resized, rather than silently failing to apply.
  const detailed=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=1000;
    const ctx=c.getContext('2d'), pixels=ctx.createImageData(c.width,c.height);
    let seed=12345;
    for(let i=0;i<pixels.data.length;i+=4){
      for(let k=0;k<3;k++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+k]=seed>>>24;}
      pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);return c.toDataURL('image/png').split(',')[1];
  });
  assert.ok(detailed.length>900000);
  await page.locator('#canvasImage').setInputFiles({name:'detailed.png',mimeType:'image/png',buffer:Buffer.from(detailed,'base64')});
  await page.waitForFunction(()=>S.framing.image && $('canvasStatus').textContent.startsWith('Background image added'));
  assert.ok(await page.evaluate(()=>S.framing.image.length<=900000));
  assert.equal(await page.evaluate(()=>reframeGuideSection()),null);
  await page.locator('#canvasImageRemove').click();
  const png=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=8;c.height=8;
    const ctx=c.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,8,8);return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#canvasImage').setInputFiles({name:'background.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>!!S.framing.image);
  await page.waitForFunction(()=>{
    const c=$('reframePreviewCanvas');
    const pixel=c.getContext('2d').getImageData(0,0,1,1).data;
    return !$('workspace-reframe').hidden && !c.hidden && pixel[0]===0 && pixel[1]===255 && pixel[2]===0;
  });
  await page.locator('#canvasImageRemove').click();
  assert.equal(await page.evaluate(()=>S.framing.image),null);
  await page.evaluate(()=>restoreHistory());
  assert.ok(await page.evaluate(()=>S.framing.image));
  const saved=await page.evaluate(async()=>{
    const document=projectDocument();
    const validated=await validateProject(document);
    applyProject(validated);
    return {framing:S.framing,edits:S.edits.length,payload:buildPayload()};
  });
  assert.equal(saved.framing.aspect,'square');assert.equal(saved.edits,4);
  assert.deepEqual(saved.payload.framing,saved.framing);
  await page.evaluate(()=>{$('denoise').checked=false;});
  const payload=await page.evaluate(()=>buildPayload());
  const jobId=await page.evaluate(()=>S.job.id);
  const response=await page.request.post(new URL(`/api/jobs/${jobId}/process`,page.url()).href,{data:payload});
  assert.ok(response.ok(),await response.text());
  await page.waitForFunction(async id=>{
    const response=await fetch(`/api/jobs/${id}`);const job=await response.json();
    if(job.status==='error')throw new Error(job.error);
    return job.status==='done';
  },jobId,{timeout:60000});
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{chooseSelectTool();select(S.edits[0].id);});
  await page.screenshot({path:'/tmp/freeedit-features.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/freeedit-features-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile layout overflows');
  console.log('Duplicate, style paste, undo/redo, framed preview, hit-testing, project restore and export: PASS');
} finally {await browser.close();}
