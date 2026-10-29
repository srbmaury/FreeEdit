// Pure export identity and timing rules. The editor adapter owns DOM and polling;
// this module never reads the current document to reconstruct an older export.
export function recoverSubmission(submission, job) {
  if (!submission || submission.jobId !== job.id || submission.submissionId !== job.export_submission_id ||
      typeof submission.submissionId !== "string" || !submission.submissionId ||
      typeof submission.signature !== "string" || !submission.signature ||
      !Array.isArray(submission.ranges) || !submission.ranges.length || submission.ranges.length > 141) return null;
  let previousEnd = -1;
  for (const range of submission.ranges) {
    if (!Array.isArray(range) || ![2,3].includes(range.length) || !range.every(Number.isFinite) ||
        (range.length===3 && (range[2]<.25 || range[2]>4)) || range[0] < 0 || range[0] < previousEnd || range[1] <= range[0] || range[1] > job.media.duration + .05) return null;
    previousEnd = range[1];
  }
  return {jobId: submission.jobId, submissionId: submission.submissionId,
    signature: submission.signature, ranges: submission.ranges.map(range => [...range])};
}

export function retainedRanges(duration, mergedCuts) {
  const cuts = mergedCuts.filter(([start, end]) => end - start > .01);
  if (!cuts.length) return [[0, duration]];
  const keep = []; let position = 0;
  for (const [start, end] of cuts) {
    if (start - position > .05) keep.push([position, start]);
    position = Math.max(position, end);
  }
  if (duration - position > .05) keep.push([position, duration]);
  return keep;
}

export function comparisonTime(ranges, time, fromOriginal) {
  let elapsed = 0;
  for (const [start, end, rate=1] of ranges) {
    if (fromOriginal && time < end) return elapsed + Math.max(0, time - start)/rate;
    if (!fromOriginal && time < elapsed + (end - start)/rate) return start + (time - elapsed)*rate;
    elapsed += (end - start)/rate;
  }
  return fromOriginal ? elapsed : (ranges.at(-1)?.[1] || 0);
}

export function recoverPreviewSubmission(submission, job) {
  if (!submission || submission.id !== job.id ||
      typeof submission.submissionId !== "string" || !submission.submissionId ||
      submission.submissionId !== job.result_preview_submission_id ||
      typeof submission.signature !== "string") return null;
  return {id: submission.id, submissionId: submission.submissionId, signature: submission.signature};
}

export function speedRanges(ranges, edits) {
  const speeds=edits.filter(e=>e.type==="speed");
  if(!speeds.length)return ranges;
  return ranges.flatMap(([a,b])=>{
    const points=[...new Set([a,b,...speeds.flatMap(e=>[e.start,e.end]).filter(t=>t>a && t<b)])].sort((x,y)=>x-y);
    return points.slice(0,-1).map((start,i)=>[start,points[i+1],speeds.find(e=>e.start<=start && start<e.end)?.rate ?? 1]);
  });
}
