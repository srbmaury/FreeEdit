import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { readFile, mkdir } from "node:fs/promises";

const engine=process.env.FREEEDIT_TEST_ENGINE || "chrome";
const browserType={chrome:chromium,firefox,webkit}[engine];
assert.ok(browserType,"Use FREEEDIT_TEST_ENGINE=chrome, firefox or webkit");
const browser = await browserType.launch({headless: true,
  ...(process.env.FREEEDIT_TEST_BROWSER ? {executablePath:process.env.FREEEDIT_TEST_BROWSER}
    : engine==='chrome' ? {channel:process.env.FREEEDIT_TEST_CHANNEL || "chrome"} : {})});
const page = await browser.newPage({viewport:{width:1440,height:900}});
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);
// Bound asynchronous page.evaluate calls as well as Playwright's own waits.
const deadline=setTimeout(()=>{
  console.error("Browser smoke test exceeded its five-minute deadline");
  process.exitCode=1;
  void browser.close();
},300000);
await page.context().tracing.start({screenshots:true,snapshots:true});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
try {
  console.log("Smoke browser:",browser.version());
  const codecs=await page.evaluate(()=>{
    const player=document.createElement('video');
    return {video:player.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      audio:player.canPlayType('audio/mp4; codecs="mp4a.40.2"')};
  });
  assert.ok(codecs.video && codecs.audio,"Smoke browser must decode H.264/AAC; install Chrome with Playwright");
  console.log("Smoke: upload and audio history");
  await page.goto("http://127.0.0.1:8765/",{waitUntil:"domcontentloaded"});
  console.log("Smoke: IndexedDB recovery, large snapshots and failed writes");
  const storage=await page.evaluate(async()=>{
    const {createRecoveryStore}=await import('./recovery-store.mjs');
    const name='freeedit-smoke-'+crypto.randomUUID();
    const store=createRecoveryStore({name});
    const original={image:'data:image/png;base64,'+'a'.repeat(6*1024*1024),edit:1};
    const writing=store.write(original);
    original.edit=2;
    await writing;
    const large=await store.read();
    const put=IDBObjectStore.prototype.put;
    let quota=false;
    try {
      IDBObjectStore.prototype.put=()=>{throw new DOMException('Test quota','QuotaExceededError');};
      await store.write({edit:3});
    } catch { quota=true; }
    finally { IDBObjectStore.prototype.put=put; }
    const preserved=(await store.read()).edit;
    await Promise.all([store.write({edit:4}),store.clear(),store.write({edit:5})]);
    const ordered=(await store.read()).edit;
    await store.clear();
    const cleared=(await store.read())===undefined;
    await new Promise((resolve,reject)=>{
      const request=indexedDB.deleteDatabase(name);
      request.onsuccess=resolve;request.onerror=()=>reject(request.error);
    });
    return {length:large.image.length,edit:large.edit,quota,preserved,ordered,cleared};
  });
  assert.equal(storage.length,6*1024*1024+'data:image/png;base64,'.length);
  assert.equal(storage.edit,1,'Queued storage must own its snapshot');
  assert.ok(storage.quota && storage.cleared);
  assert.equal(storage.preserved,1,'An aborted save must preserve the last good snapshot');
  assert.equal(storage.ordered,5,'A late clear must not erase a newer queued save');
  await assert.doesNotReject(async()=>page.locator("#chooseFileBtn").waitFor());
  await page.locator("#fileInput").setInputFiles("/tmp/freeedit-ci-sample.mp4");
  await page.locator("#editorView:not(.hidden)").waitFor({timeout:30000});
  await page.waitForFunction(()=>{
    const player=document.getElementById('video');
    if(player.error)throw Error('Uploaded source failed to decode: '+player.error.code);
    return player.readyState>=2;
  });
  const transportBounds=await page.locator('#transport').boundingBox();
  const waveformBounds=await page.locator('#waveformTrack').boundingBox();
  assert.ok(transportBounds.y<900 && waveformBounds.y+waveformBounds.height<=900,
    "Playback and initial timeline must fit beside the desktop inspector");
  await page.locator('.workspace-rail button').filter({hasText:'Audio'}).click();
  await page.locator('#denoise').uncheck();
  await page.locator('#audioFinishControls summary').click();
  await page.locator('#audioFadeIn').fill('0.5');
  await page.locator('#audioFadeIn').dispatchEvent('change');
  await page.locator('#undoBtn').click();
  assert.equal(await page.locator('#audioFadeIn').inputValue(),'0');
  await page.locator('#redoBtn').click();
  assert.equal(await page.locator('#audioFadeIn').inputValue(),'0.5');
  await page.locator(".workspace-rail button").filter({hasText:"Reframe"}).click();
  await page.locator("#reframePortionGroup summary").click();
  await page.locator("#reframeStart").fill("0.5");
  await page.locator("#reframeEnd").fill("2.5");
  await page.locator("#reframeAddSection").click();
  await page.locator("#workspace-edits:not([hidden])").waitFor({timeout:10000});
  await page.locator("#editsList .zoom-edit-row").first().waitFor();
  assert.match(await page.locator("#editsList").innerText(),/Reframe.*0:00\.5/);
  assert.equal(await page.locator("#zoomTrack .timeline-block.zoom").count(),1);
  await page.locator("#editsList .zoom-edit-row button").first().click();
  assert.equal(await page.locator("#selectedZoomPanel").isVisible(),true);
  await page.locator("#selectedZoomTransition").fill("0.2");
  await page.locator("#selectedZoomTransition").dispatchEvent("change");
  assert.equal(await page.locator("#zoomTrack .timeline-block.zoom").count(),1);

  // Other feature types must share the same timeline document and remain
  // intact when Reframe is selected, updated, saved and restored.
  await page.locator(".workspace-rail button").filter({hasText:"Cut"}).click();
  await page.locator("#cutFrom").fill("0.1");
  await page.locator("#cutTo").fill("0.4");
  await page.locator("#addCutRangeBtn").click();
  await page.locator(".workspace-rail button").filter({hasText:"Text"}).click();
  await page.locator("#placeEditBtn").click();
  await page.locator(".workspace-rail button").filter({hasText:"Hide area"}).click();
  await page.locator("#placeEditBtn").click();
  await page.locator(".workspace-rail button").filter({hasText:"Captions"}).click();
  await page.locator("#captionInput").setInputFiles({
    name:"sample.srt",mimeType:"text/plain",
    buffer:Buffer.from("1\n00:00:00,800 --> 00:00:01,300\nSample caption\n")
  });
  // Import deliberately opens the Edits inspector, hiding Captions panel.
  await page.waitForFunction(() => document.getElementById("captionStatus")?.textContent.includes("Imported 1"));
  await page.locator("#toolbar [data-mode=select]").click();
  const list=await page.locator("#editsList").innerText();
  assert.match(list,/Reframe/);
  assert.match(list,/Sample caption/);
  assert.equal(await page.locator("#zoomTrack .timeline-block.zoom").count(),1);

  // Edits must use the full inspector height, with one scroll container.
  // Regression for the old 42vh inner list limit that hid edit properties.
  const desktopLayout=await page.evaluate(()=>{
    const side=document.querySelector(".editor > .side");
    const edits=document.getElementById("editsList");
    const listStyle=getComputedStyle(edits);
    const sideStyle=getComputedStyle(side);
    const filler=document.createElement("div");
    filler.style.height="1400px";
    filler.setAttribute("aria-hidden","true");
    edits.append(filler);
    const parentCanScroll=side.scrollHeight>side.clientHeight+100;
    filler.scrollIntoView({block:"end"});
    const sidebarScrolled=side.scrollTop>100;
    filler.remove();
    side.scrollTop=0;
    return {listMaxHeight:listStyle.maxHeight,listOverflow:listStyle.overflowY,
      sideOverflow:sideStyle.overflowY,sideHeight:side.clientHeight,
      parentCanScroll,sidebarScrolled,viewportHeight:innerHeight};
  });
  assert.equal(desktopLayout.listMaxHeight,"none");
  assert.equal(desktopLayout.listOverflow,"visible");
  assert.equal(desktopLayout.sideOverflow,"auto");
  assert.ok(desktopLayout.sideHeight >= desktopLayout.viewportHeight*.75,
    "Edits inspector must fill the available desktop viewport");
  assert.ok(desktopLayout.parentCanScroll && desktopLayout.sidebarScrolled,
    "Long edits scroll the inspector rather than a 42vh nested list");

  await page.setViewportSize({width:390,height:780});
  const mobileLayout=await page.evaluate(()=>{
    const side=document.querySelector(".editor > .side");
    const edits=document.getElementById("editsList");
    return {listMaxHeight:getComputedStyle(edits).maxHeight,
      listOverflow:getComputedStyle(edits).overflowY,
      sideOverflow:getComputedStyle(side).overflowY};
  });
  assert.equal(mobileLayout.listMaxHeight,"none");
  assert.equal(mobileLayout.listOverflow,"visible");
  assert.equal(mobileLayout.sideOverflow,"visible");
  await page.setViewportSize({width:1440,height:900});

  // A visual tile arms click-to-place; one click on the actual preview must
  // create a visible icon at the clicked source coordinates.
  console.log("Smoke: annotations and animation controls");
  await page.locator(".workspace-rail button").filter({hasText:"Annotations"}).click();
  assert.equal(await page.locator("#annotationTypePicker .annotation-choice").count(),7);
  assert.equal(await page.locator("#annotationIconPicker .annotation-choice").count(),6);
  await page.locator('#annotationIconPicker [data-choice-value="star"]').click();
  assert.equal(await page.evaluate(()=>S.mode),"annotation");
  const overlay=page.locator("#overlay");
  const size=await overlay.boundingBox();
  assert.ok(size && size.width>20 && size.height>20);
  await overlay.click({position:{x:size.width*.72,y:size.height*.40}});
  const iconPlaced=await page.evaluate(()=>{
    const e=S.edits.find(edit=>edit.type==="annotation"&&edit.kind==="icon");
    if(!e)return null;
    // Canvas backing pixels include display scaling and devicePixelRatio.
    const px=Math.min(canvas.width-1,Math.floor((e.x+e.w/2)*canvas.width/S.job.width));
    const py=Math.min(canvas.height-1,Math.floor((e.y+e.h/2)*canvas.height/S.job.height));
    const pixel=ctx.getImageData(px,py,1,1).data;
    return {id:e.id,icon:e.icon,visible:isActive(e),x:e.x,y:e.y,alpha:pixel[3]};
  });
  assert.ok(iconPlaced && iconPlaced.visible, "Clicked icon must be visible at the playhead");
  assert.equal(iconPlaced.icon,"star");
  assert.ok(iconPlaced.alpha>0,"Icon must draw into the video overlay");
  assert.equal(await page.locator("#annotationTrack .timeline-block.annotation").count(),1);

  // Clicking an empty point with an existing annotation selected repositions
  // that annotation instead of silently deselecting or hiding it.
  await overlay.click({position:{x:size.width*.10,y:size.height*.80}});
  const movedIcon=await page.evaluate(id=>{
    const e=getEdit(id);
    return e&&{x:e.x,y:e.y,selected:S.selected===id,active:isActive(e)};
  },iconPlaced.id);
  assert.ok(movedIcon?.selected && movedIcon?.active,"Selected annotation stays visible after reposition");
  assert.ok(movedIcon.x!==iconPlaced.x||movedIcon.y!==iconPlaced.y,"Click repositions the selected annotation");

  await page.locator('#editsList [data-annotation-choices="icon"] [data-choice-value="check"]').first().click();
  assert.equal(await page.evaluate(()=>S.edits.find(e=>e.type==="annotation").icon),"check");
  // Switching None -> Fade -> Slide -> Fade must change the existing
  // annotation, not just the defaults for the next one. The inspector must
  // indicate the selected style and preview a representative animation frame.
  const starCard=page.locator('#editsList .card[data-id="'+iconPlaced.id+'"]');
  const chooseAnimation=async(style)=>{
    await starCard.locator('.annotation-inspector-animation [data-choice-value="'+style+'"]').click();
    await page.waitForFunction(({id,style})=>{
      const edit=getEdit(id);
      return edit?.animation===style &&
        Math.abs(sourcePlayer().currentTime-AnnotationModel.previewTime(edit))<.08;
    },{id:iconPlaced.id,style});
    assert.equal(await starCard.locator(
      '.annotation-inspector-animation [data-choice-value="'+style+'"]'
    ).getAttribute("aria-pressed"),"true");
  };
  await chooseAnimation("fade");
  const fadeVisual=await page.evaluate(id=>{
    const edit=getEdit(id);
    return AnnotationModel.animationState(edit,sourcePlayer().currentTime);
  },iconPlaced.id);
  assert.ok(fadeVisual.alpha>.1&&fadeVisual.alpha<.9,"Fade preview must show partial transparency");
  await chooseAnimation("slide");
  const slideVisual=await page.evaluate(id=>{
    const edit=getEdit(id);
    return AnnotationModel.animationState(edit,sourcePlayer().currentTime);
  },iconPlaced.id);
  assert.equal(slideVisual.alpha,1);
  assert.ok(slideVisual.dx<0,"Slide preview must show actual movement");
  await chooseAnimation("fade");
  assert.equal(await page.evaluate(id=>getEdit(id)?.animation,iconPlaced.id),"fade");
  // Selecting the saved edit from Edits should seek to a fully visible frame.
  await starCard.locator(".card-title").click();
  await page.waitForFunction(id=>{
    const edit=getEdit(id);
    return edit && Math.abs(sourcePlayer().currentTime-AnnotationModel.visibleTime(edit))<.08 &&
      AnnotationModel.animationState(edit,sourcePlayer().currentTime).alpha>.9;
  },iconPlaced.id);

  // Upload is a primary action, not buried under a dropdown. The uploaded
  // image becomes the next click-placement tool and remains in project JSON.
  await page.locator(".workspace-rail button").filter({hasText:"Annotations"}).click();
  const logoBase64=await page.evaluate(()=>{
    const c=document.createElement("canvas");c.width=64;c.height=32;
    const p=c.getContext("2d");p.fillStyle="#27b984";p.fillRect(0,0,64,32);
    p.fillStyle="#fff";p.fillRect(10,9,44,14);
    return c.toDataURL("image/png").split(",")[1];
  });
  const [chooser]=await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#annotationUploadBtn").click()
  ]);
  await chooser.setFiles({name:"demo-logo.png",mimeType:"image/png",
    buffer:Buffer.from(logoBase64,"base64")});
  await page.locator("#annotationUploadBtn.has-upload").waitFor();
  assert.equal(await page.evaluate(()=>S.mode),"annotation");
  const size2=await overlay.boundingBox();
  await overlay.click({position:{x:size2.width*.33,y:size2.height*.62}});
  const logoPlaced=await page.evaluate(()=>{
    const e=S.edits.find(edit=>edit.type==="annotation"&&edit.kind==="image");
    return e && {id:e.id,visible:isActive(e),image:e.image};
  });
  assert.ok(logoPlaced?.visible, "Uploaded logo must appear immediately after the video click");
  assert.ok(logoPlaced.image.startsWith("data:image/png;base64,"));
  assert.equal(await page.locator("#annotationTrack .timeline-block.annotation").count(),2);
  await page.locator('#editsList .card[data-id="'+logoPlaced.id+'"] .annotation-image-preview').waitFor();
  assert.ok(await page.locator('#editsList .card[data-id="'+logoPlaced.id+'"] .annotation-image-preview').isVisible());
  // PNG-backed edits must survive the asset-sharing history codec intact.
  await page.locator('#undoBtn').click();
  assert.equal(await page.locator('#annotationTrack .timeline-block.annotation').count(),1);
  await page.locator('#redoBtn').click();
  assert.equal(await page.locator('#annotationTrack .timeline-block.annotation').count(),2);
  assert.equal(await page.evaluate(id=>getEdit(id).image,logoPlaced.id),logoPlaced.image);

  console.log("Smoke: freehand pen, highlighter, eraser and history");
  await page.locator('.workspace-rail button').filter({hasText:/^Draw$/}).click();
  await page.locator('#drawingStart').fill('0.5');
  await page.locator('#drawingEnd').fill('3');
  await page.locator('#drawingColor').fill('#ef4444');
  const drawGesture=async(points)=>{
    const box=await overlay.boundingBox();
    await page.mouse.move(box.x+box.width*points[0][0],box.y+box.height*points[0][1]);
    await page.mouse.down();
    for(const [x,y] of points.slice(1))await page.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:5});
    await page.mouse.up();
  };
  await drawGesture([[.60,.75],[.7,.65],[.85,.75]]);
  const drawing=await page.evaluate(()=>{
    const e=S.edits.find(e=>e.kind==='drawing');
    return e&&structuredClone(e);
  });
  assert.ok(drawing?.points.length>2,'A gesture retains editable vector points');
  assert.equal(drawing.start,.5);assert.equal(drawing.end,3);
  assert.equal(await page.locator('#workspace-draw').isVisible(),true);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),0);
  await page.locator('#redoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),1);
  await page.locator('[data-drawing-tool="highlighter"]').click();
  await drawGesture([[.2,.75],[.4,.75]]);
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').at(-1).opacity),.35);
  // A canceled gesture is discarded; a tap creates a dot that can be undone.
  await page.locator('[data-drawing-tool="pen"]').click();
  const cancelBox=await overlay.boundingBox();
  await page.mouse.move(cancelBox.x+cancelBox.width*.9,cancelBox.y+cancelBox.height*.2);
  await page.mouse.down();
  await overlay.dispatchEvent('pointercancel',{pointerId:await page.evaluate(()=>S.drag.pointerId)});
  await page.mouse.up();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),2);
  await overlay.click({position:{x:cancelBox.width*.9,y:cancelBox.height*.2}});
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').at(-1).points.length),1);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),2);
  // Erase by proximity to a stroke, then undo the entire erase operation.
  await page.locator('[data-drawing-tool="eraser"]').click();
  const drawBox=await overlay.boundingBox();
  await overlay.click({position:{x:drawBox.width*.3,y:drawBox.height*.75}});
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),1);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),2);
  await page.locator('#drawingClearBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),0);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),2);
  await page.locator('#drawingDoneBtn').click();
  assert.equal(await page.locator('#workspace-edits').isVisible(),true);
  const drawingCard=page.locator('#editsList .card[data-id="'+drawing.id+'"]');
  await drawingCard.locator('.card-title').click();
  await drawingCard.locator('.drawing-stroke-input').fill('12');
  await drawingCard.locator('.drawing-stroke-input').dispatchEvent('change');
  assert.equal(await page.evaluate(id=>{const e=getEdit(id);return e.strokeWidth*Math.min(e.w,e.h);},drawing.id),12);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(id=>{const e=getEdit(id);return e.strokeWidth*Math.min(e.w,e.h);},drawing.id),6);
  // The same painter must produce a non-empty transparent export PNG.
  const drawingRaster=await page.evaluate(async()=>{
    const e=S.edits.find(e=>e.kind==='drawing');
    const payload=annotationPayload(e),bounds=AnnotationModel.rasterBounds(e);
    const image=new Image();image.src=payload.image;await image.decode();
    const raster=document.createElement('canvas');raster.width=image.width;raster.height=image.height;
    const c=raster.getContext('2d');c.drawImage(image,0,0);
    const [x,y]=e.points[Math.floor(e.points.length/2)];
    const pixel=Array.from(c.getImageData(Math.floor(e.x+x*e.w-bounds.x),Math.floor(e.y+y*e.h-bounds.y),1,1).data);
    return {image:payload.image,start:payload.start,end:payload.end,pixel};
  });
  assert.ok(drawingRaster.image.startsWith('data:image/png;base64,'));
  assert.equal(drawingRaster.start,.5);assert.equal(drawingRaster.end,3);
  assert.deepEqual(drawingRaster.pixel,[239,68,68,255],'Export PNG must contain the painted pen color');

  console.log("Smoke: drawing groups, shared transforms, erasing and ungrouping");
  await page.locator('.workspace-rail button').filter({hasText:/^Draw$/}).click();
  await page.locator('#drawingGroupChoices input[type=checkbox]').nth(0).check();
  await page.locator('#drawingGroupChoices input[type=checkbox]').nth(1).check();
  await page.locator('#drawingGroupBtn').click();
  const group=await page.evaluate(()=>structuredClone(S.edits.find(e=>e.kind==='drawing'&&e.strokes)));
  assert.equal(group.strokes.length,2);
  const groupPixels=await page.evaluate(async()=>{
    const e=S.edits.find(e=>e.strokes),bounds=AnnotationModel.rasterBounds(e),payload=annotationPayload(e);
    const image=new Image();image.src=payload.image;await image.decode();
    const raster=document.createElement('canvas');raster.width=image.width;raster.height=image.height;
    const c=raster.getContext('2d');c.drawImage(image,0,0);
    return e.strokes.map(s=>{
      const [x,y]=s.points[Math.floor(s.points.length/2)];
      return Array.from(c.getImageData(Math.floor(e.x+x*e.w-bounds.x),Math.floor(e.y+y*e.h-bounds.y),1,1).data);
    });
  });
  assert.deepEqual(groupPixels[0],[239,68,68,255]);
  assert.ok(Math.abs(groupPixels[1][3]-89)<=1,'Highlighter opacity survives grouping and raster export');
  assert.equal(await page.locator('#workspace-edits').isVisible(),true);
  let groupCard=page.locator('#editsList .card[data-id="'+group.id+'"]');
  assert.equal(await groupCard.locator('.drawing-ungroup-btn').isVisible(),true);
  await groupCard.locator('[data-k="start"]').fill('0.6');
  await groupCard.locator('[data-k="end"]').fill('2.8');
  await groupCard.locator('.geometry summary').click();
  const oldX=await groupCard.locator('[data-k="x"]').inputValue();
  await groupCard.locator('[data-k="x"]').fill(String(Number(oldX)+2));
  const oldWidth=await groupCard.locator('[data-k="w"]').inputValue();
  await groupCard.locator('[data-k="w"]').fill(String(Number(oldWidth)*.9));
  const transformed=await page.evaluate(id=>structuredClone(getEdit(id)),group.id);
  assert.ok(transformed.w<group.w);assert.ok(transformed.x>group.x);
  assert.equal(transformed.start,.6);assert.equal(transformed.end,2.8);
  assert.equal(JSON.stringify(transformed.strokes),JSON.stringify(group.strokes));
  // Whole-group transforms retain all vectors and one shared timeline interval.
  await groupCard.locator('.drawing-ungroup-btn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),2);
  const ungrouped=await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').map(e=>({start:e.start,end:e.end,color:e.color,opacity:e.opacity})));
  assert.ok(ungrouped.every(e=>e.start===.6&&e.end===2.8));
  assert.deepEqual(ungrouped.map(e=>e.color),['#ef4444','#facc15']);
  assert.equal(ungrouped[1].opacity,.35);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),1);
  assert.equal(await page.evaluate(()=>S.edits.find(e=>e.strokes)?.strokes.length),2);
  // Erasing within a group removes one member, rather than the whole group.
  await page.locator('.workspace-rail button').filter({hasText:/^Draw$/}).click();
  await page.locator('[data-drawing-tool="eraser"]').click();
  await page.evaluate(()=>new Promise(resolve=>{
    video.addEventListener('seeked',resolve,{once:true});
    video.currentTime=S.edits.find(e=>e.strokes).start+.2;
  }));
  const erasePoint=await page.evaluate(()=>{
    const e=S.edits.find(e=>e.strokes),s=DrawingModel.worldStrokes(e)[1];
    const p=s.points[Math.floor(s.points.length/2)];
    const crop=freeeditCropRect(S.job.width,S.job.height,freeeditReframeAt(EditorModel.exportReframe(S.reframe,S.edits),video.currentTime));
    return {x:(p.x-crop.x)/crop.w,y:(p.y-crop.y)/crop.h};
  });
  const eraseBox=await overlay.boundingBox();
  await overlay.click({position:{x:eraseBox.width*erasePoint.x,y:eraseBox.height*erasePoint.y}});
  assert.equal(await page.evaluate(()=>S.edits.find(e=>e.strokes)?.strokes.length),1);
  await page.locator('#undoBtn').click();
  assert.equal(await page.evaluate(()=>S.edits.find(e=>e.strokes)?.strokes.length),2);
  await page.locator('#drawingDoneBtn').click();
  const savedGroup=await page.evaluate(()=>structuredClone(S.edits.find(e=>e.strokes)));

  // V2 projects store all timed edits together; no separate reframe sections
  // remain in scene settings. Round-trip through the actual validator.
  console.log("Smoke: project round-trip");
  const [download]=await Promise.all([
    page.waitForEvent("download"),
    page.locator("#saveProjectBtn").evaluate(node=>node.click())
  ]);
  const document=JSON.parse(await readFile(await download.path(),"utf8"));
  assert.equal(document.version,2);
  for(const type of ["cut","hide","text","reframe","annotation"]) {
    assert.ok(document.edits.some(edit=>edit.type===type),"Missing "+type);
  }
  assert.equal(document.edits.filter(e=>e.kind==='drawing').length,1);
  assert.deepEqual(document.edits.find(e=>e.kind==='drawing').strokes,savedGroup.strokes);
  assert.ok(!("sections" in (document.settings.reframe||{})));
  await page.evaluate(async doc=>applyProject(await validateProject(doc)),document);
  assert.equal(await page.locator("#zoomTrack .timeline-block.zoom").count(),1);
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),1);
  assert.match(await page.locator("#editsList").innerText(),/Reframe/);

  console.log("Smoke: FFmpeg export and recovery");
  await page.locator(".workspace-rail button").filter({hasText:"Export"}).click();
  await page.locator("#processBtn").click();
  await page.locator("#resultPanel:not(.hidden)").waitFor({timeout:120000});
  assert.equal(await page.locator("#downloadBtn").getAttribute("href") !== "#",true);
  await page.waitForFunction(()=>projects.pendingSignature===null && !!projects.signature);
  // A finished export must remain available after a new editor context.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#resumeProjectBtn').click();
  await page.locator('#resultPanel:not(.hidden)').waitFor({timeout:30000});
  assert.equal(await page.locator('#downloadBtn').isVisible(),true);
  assert.equal(await page.evaluate(()=>S.edits.filter(e=>e.kind==='drawing').length),1);
  await page.waitForFunction(()=>{
    const player=document.getElementById('resultVideo');
    if(player.error)throw Error('Recovered result failed to load: '+player.error.code);
    return player.readyState>=1 && Number.isFinite(player.duration) && player.duration>0;
  },null,{timeout:15000});
  assert.deepEqual(errors,[],"Browser JavaScript errors: "+errors.join("; "));
  console.log("Browser upload → all edit types → v2 project reload → FFmpeg export: PASS");
} catch(error) {
  const artifacts=process.env.FREEEDIT_TEST_ARTIFACTS || "/tmp/freeedit-browser-artifacts";
  await mkdir(artifacts,{recursive:true});
  await page.screenshot({path:artifacts+"/failure.png",timeout:5000}).catch(()=>{});
  await page.context().tracing.stop({path:artifacts+"/trace.zip"}).catch(()=>{});
  console.error("Browser errors:",errors);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser.close();
}
