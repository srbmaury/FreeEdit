// Pure export identity and timing rules. The editor adapter owns DOM and polling;
// this module never reads the current document to reconstruct an older export.
export function recoverSubmission(submission, job) {
  if (!submission || submission.jobId !== job.id || submission.submissionId !== job.export_submission_id ||
      typeof submission.submissionId !== "string" || !submission.submissionId ||
      typeof submission.signature !== "string" || !submission.signature ||
      !Array.isArray(submission.ranges) || !submission.ranges.length || submission.ranges.length > 101) return null;
  let previousEnd = -1;
  for (const range of submission.ranges) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) ||
        range[0] < 0 || range[0] < previousEnd || range[1] <= range[0] || range[1] > job.media.duration + .05) return null;
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
  for (const [start, end] of ranges) {
    if (fromOriginal && time < end) return elapsed + Math.max(0, time - start);
    if (!fromOriginal && time < elapsed + end - start) return start + time - elapsed;
    elapsed += end - start;
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
