import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverSubmission,retainedRanges,comparisonTime} from '../frontend/export-state.mjs';

test('comparison follows submitted cuts at boundaries, removed gaps and final position',()=>{
  const ranges=retainedRanges(30,[[10,12]]);
  assert.deepEqual(ranges,[[0,10],[12,30]]);
  assert.equal(comparisonTime(ranges,25,false),27);
  assert.equal(comparisonTime(ranges,11,true),10);
  assert.equal(comparisonTime(ranges,10,false),12);
  assert.equal(comparisonTime(ranges,100,false),30);
  assert.equal(comparisonTime(ranges,100,true),28);
  assert.deepEqual(retainedRanges(10,[[0,10]]),[]);
  assert.deepEqual(retainedRanges(10,[[.04,2],[9.98,10]]),[[2,9.98]]);
});
test('recovered identity rejects mismatches and unordered intervals, and owns its interval copy',()=>{
  const job={id:'job',export_submission_id:'submission',media:{duration:30}};
  const saved={jobId:'job',submissionId:'submission',signature:'old-document',ranges:[[0,10],[12,30]]};
  const recovered=recoverSubmission(saved,job);
  recovered.ranges[0][1]=5;
  assert.equal(saved.ranges[0][1],10);
  for (const changes of [{signature:''},{submissionId:'different'},{ranges:[[0,20],[12,30]]},
    {ranges:[[12,30],[0,10]]},{ranges:[[0,Infinity]]},{ranges:[[0,31]]}]) {
    assert.equal(recoverSubmission({...saved,...changes},job),null);
  }
});

test('preview identity is independent from full export identity',async()=>{
  const {recoverPreviewSubmission}=await import('../frontend/export-state.mjs');
  const job={id:'job',export_submission_id:'export',result_preview_submission_id:'preview'};
  const saved={id:'job',submissionId:'preview',signature:'preview-settings'};
  assert.deepEqual(recoverPreviewSubmission(saved,job),saved);
  assert.equal(recoverPreviewSubmission({...saved,submissionId:'export'},job),null);
  assert.equal(recoverPreviewSubmission({...saved,id:'other'},job),null);
  assert.equal(recoverPreviewSubmission({...saved,submissionId:null},job),null);
});
