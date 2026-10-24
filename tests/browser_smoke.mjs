import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:8765/",{waitUntil:"domcontentloaded"});
  await assert.doesNotReject(async()=>page.locator("#chooseFileBtn").waitFor());
  await page.locator("#fileInput").setInputFiles("/tmp/freeedit-ci-sample.mp4");
  await page.locator("#editorView:not(.hidden)").waitFor({timeout:30000});
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
    buffer:Buffer.from("1\\n00:00:00,800 --> 00:00:01,300\\nSample caption\\n")
  });
  await page.locator("#captionStatus").getByText(/Imported 1/).waitFor();
  await page.locator("#toolbar [data-mode=select]").click();
  const list=await page.locator("#editsList").innerText();
  assert.match(list,/Reframe/);
  assert.match(list,/Sample caption/);
  assert.equal(await page.locator("#zoomTrack .timeline-block.zoom").count(),1);

  // V2 projects store all timed edits together; no separate reframe sections
  // remain in scene settings. Round-trip through the actual validator.
  const [download]=await Promise.all([
    page.waitForEvent("download"),
    page.locator("#saveProjectBtn").evaluate(node=>node.click())
  ]);
  const document=JSON.parse(await readFile(await download.path(),"utf8"));
  assert.equal(document.version,2);
  for(const type of ["cut","hide","text","reframe"]) {
    assert.ok(document.edits.some(edit=>edit.type===type),"Missing "+type);
  }
  assert.ok(!("sections" in (document.settings.reframe||{})));
  await page.evaluate(doc=>applyProject(validateProject(doc)),document);
  assert.equal(await page.locator("#zoomTrack .timeline-block.zoom").count(),1);
  assert.match(await page.locator("#editsList").innerText(),/Reframe/);

  await page.locator(".workspace-rail button").filter({hasText:"Export"}).click();
  await page.locator("#processBtn").click();
  await page.locator("#resultPanel:not(.hidden)").waitFor({timeout:120000});
  assert.equal(await page.locator("#downloadBtn").getAttribute("href") !== "#",true);
  assert.deepEqual(errors,[],"Browser JavaScript errors: "+errors.join("; "));
  console.log("Browser upload → all edit types → v2 project reload → FFmpeg export: PASS");
} finally {
  await browser.close();
}
