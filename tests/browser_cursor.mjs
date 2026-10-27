import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
const engine=process.env.FREEEDIT_TEST_ENGINE || 'chrome';
const browser=await ({chrome:chromium,firefox,webkit}[engine]).launch({headless:true,...(engine==='chrome'?{channel:'chrome'}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(process.env.FREEEDIT_TEST_URL || 'http://127.0.0.1:8765/');
  await page.locator('#fileInput').setInputFiles('/tmp/freeedit-ci-sample.mp4');
  await page.locator('#editorView:not(.hidden)').waitFor();
  await page.waitForFunction(()=>video.readyState>=2);
  await page.locator('.workspace-rail button').filter({hasText:/^Annotations$/}).click();
  await page.getByRole('button',{name:'Cursor spotlight',exact:true}).click();
  assert.equal(await page.locator('#annotationAnimationPicker button[data-choice-value="slide"]').isDisabled(),true);
  await page.locator('#addAnnotationBtn').click();
  await page.waitForFunction(()=>S.edits.length===1 && !video.seeking);
  const spotlight=await page.evaluate(()=>{
    render();const e=S.edits[0];
    return {kind:e.kind,outer:[...ctx.getImageData(0,0,1,1).data],
      center:[...ctx.getImageData(Math.floor((e.x+e.w/2)*canvas.width/S.job.width),Math.floor((e.y+e.h/2)*canvas.height/S.job.height),1,1).data]};
  });
  assert.equal(spotlight.kind,'spotlight');assert.ok(spotlight.outer[3]>120&&spotlight.outer[3]<160);assert.equal(spotlight.center[3],0);
  await page.locator('.card.selected').getByRole('button',{name:'Duplicate',exact:true}).click();
  assert.equal(await page.evaluate(()=>S.edits.length),2);
  await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>S.edits.length),1);
  await page.locator('.workspace-rail button').filter({hasText:/^Annotations$/}).click();
  await page.getByRole('button',{name:'Click highlight',exact:true}).click();
  assert.ok(await page.evaluate(()=>Number($('annotationEnd').value)-Number($('annotationStart').value)<=.71));
  const bounds=await page.locator('#overlay').boundingBox();
  await page.mouse.click(bounds.x+bounds.width*.7,bounds.y+bounds.height*.5);
  await page.waitForFunction(()=>S.edits.length===2 && !video.seeking);
  assert.equal(await page.evaluate(()=>getEdit(S.selected).kind),'click');
  assert.match(await page.locator('#annotationTrack').innerText(),/Spotlight/);
  assert.match(await page.locator('#annotationTrack').innerText(),/Click highlight/);
  const saved=await page.evaluate(async()=>{
    const validated=await validateProject(projectDocument());applyProject(validated);
    return S.edits.map(e=>e.kind);
  });
  assert.deepEqual(saved,['spotlight','click']);
  const payload=await page.evaluate(()=>{$('denoise').checked=false;return buildPayload();});
  assert.deepEqual(payload.edits[0].canvas_size,[320,180]);
  assert.equal(payload.edits[1].canvas_size,undefined);
  const large=await page.evaluate(async()=>{
    const previous=S.job;
    try {
      S.job={...S.job,width:7680,height:4320};
      const edit=AnnotationModel.defaultEdit('spotlight',7680,4320,0,2),payload=annotationPayload(edit);
      const img=new Image();img.src=payload.image;await img.decode();
      return {width:img.width,height:img.height,size:payload.canvas_size};
    } finally {S.job=previous;}
  });
  assert.ok(large.width<=1024&&large.height<=1024);assert.deepEqual(large.size,[7680,4320]);
  const jobId=await page.evaluate(()=>S.job.id);
  const response=await page.request.post(new URL(`/api/jobs/${jobId}/process`,page.url()).href,{data:payload});
  assert.ok(response.ok(),await response.text());
  await page.waitForFunction(async id=>{
    const job=await (await fetch(`/api/jobs/${id}`)).json();
    if(job.status==='error')throw new Error(job.error);
    return job.status==='done';
  },jobId,{timeout:60000});
  await page.evaluate(()=>{select(S.edits[1].id);video.currentTime=AnnotationModel.visibleTime(S.edits[1]);});
  await page.waitForFunction(()=>!video.seeking);
  await page.screenshot({path:'/tmp/freeedit-cursor-effects.png'});
  assert.deepEqual(errors,[]);
  console.log('Cursor spotlight and click highlight: placement, alpha, timing, undo, project restore, bounded assets and export: PASS');
} finally {await browser.close();}
