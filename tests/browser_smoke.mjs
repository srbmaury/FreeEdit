import assert from "node:assert/strict";
import { chromium } from "playwright";

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
  await page.locator(".workspace-rail button").filter({hasText:"Export"}).click();
  await page.locator("#processBtn").click();
  await page.locator("#resultPanel:not(.hidden)").waitFor({timeout:120000});
  assert.equal(await page.locator("#downloadBtn").getAttribute("href") !== "#",true);
  assert.deepEqual(errors,[],"Browser JavaScript errors: "+errors.join("; "));
  console.log("Browser upload → timed zoom → Edits inspector → FFmpeg export: PASS");
} finally {
  await browser.close();
}
