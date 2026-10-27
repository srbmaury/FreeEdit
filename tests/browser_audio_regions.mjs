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
  await page.locator('.workspace-rail button').filter({hasText:/^Audio$/}).click();
  await page.locator('#denoise').uncheck();
  await page.locator('#audioRegionStart').fill('0.5');await page.locator('#audioRegionEnd').fill('1.5');
  await page.locator('#addMuteRegion').click();
  await page.waitForFunction(()=>S.edits.length===1);
  assert.match(await page.locator('#audioRegionTrack').innerText(),/Mute/);
  assert.match(await page.locator('.card.selected').innerText(),/Mute/);
  await page.locator('.card.selected [data-k="volume"]').fill('25');
  assert.equal(await page.evaluate(()=>S.edits[0].volume),.25);
  assert.match(await page.locator('#audioRegionTrack').innerText(),/25%/);
  await page.locator('.card.selected').getByRole('button',{name:'Duplicate',exact:true}).click();
  assert.equal(await page.evaluate(()=>S.edits.length),2);
  await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>S.edits.length),1);
  await page.evaluate(()=>{rangeSelection.range={start:2,end:3};displayRangeSelection();});
  await page.locator('.workspace-rail button').filter({hasText:/^Audio$/}).click();
  await page.locator('#audioRegionUseRange').click();
  assert.equal(await page.locator('#audioRegionStart').inputValue(),'2');
  await page.locator('#addMuteRegion').click();
  assert.equal(await page.evaluate(()=>S.edits[1].volume),0);
  // Dragging a mute region uses the same original-source timeline as cuts.
  const block=page.locator('#audioRegionTrack .timeline-block').last();
  const b=await block.boundingBox();
  await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();
  await page.mouse.move(b.x+b.width*.5+20,b.y+b.height*.5,{steps:5});await page.mouse.up();
  assert.ok(await page.evaluate(()=>S.edits[1].start>2));
  const loaded=await page.evaluate(async()=>{const p=await validateProject(projectDocument());applyProject(p);return S.edits;});
  assert.equal(loaded.length,2);assert.equal(loaded[0].volume,.25);assert.equal(loaded[1].volume,0);
  const payload=await page.evaluate(()=>buildPayload());assert.equal(payload.audio_regions.length,2);assert.deepEqual(payload.edits,[]);
  // Exercise the actual processed-preview control from Audio.
  await page.evaluate(()=>{clearRangeSelection();video.currentTime=0;});
  await page.locator('.workspace-rail button').filter({hasText:/^Audio$/}).click();
  await page.locator('#audioRegionPreview').click();
  await page.locator('#resultPreviewDialog[open]').waitFor({timeout:60000});
  await page.locator('#resultPreviewDialog button').filter({hasText:'Back to editing'}).click();
  await page.evaluate(()=>{$('exportPreset').value='audio_only';});
  const audioPayload=await page.evaluate(()=>buildPayload());assert.equal(audioPayload.audio_regions.length,2);
  const jobId=await page.evaluate(()=>S.job.id);
  const response=await page.request.post(new URL(`/api/jobs/${jobId}/process`,page.url()).href,{data:audioPayload});
  assert.ok(response.ok(),await response.text());
  await page.waitForFunction(async id=>{
    const job=await (await fetch(`/api/jobs/${id}`)).json();if(job.status==='error')throw new Error(job.error);return job.status==='done';
  },jobId,{timeout:60000});
  assert.deepEqual(errors,[]);
  await page.locator('.workspace-rail button').filter({hasText:/^Audio$/}).click();
  await page.screenshot({path:'/tmp/freeedit-audio-regions.png'});
  console.log('Audio regions: mute, percentage editing, duplication, undo, range selection, drag, project restore, processed preview and audio export: PASS');
} finally {await browser.close();}
