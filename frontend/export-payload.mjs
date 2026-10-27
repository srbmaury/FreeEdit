// Pure document -> API projection. No DOM, global editor state or media players.
export function buildExportPayload(document, adapters) {
  const {job, edits, audio, presenter, presenterHasAudio, reframe, background,
    denoise, strength, preset} = document;
  const videoOutput = job.has_video && preset !== "audio_only";
  const visual = videoOutput ? edits.filter(e => ["hide", "text", "annotation"].includes(e.type)).map(e => {
    const base = {type: e.type, start: e.start, end: e.end};
    if (e.type === "hide") return {...base, style: e.style, x: e.x, y: e.y, w: e.w, h: e.h};
    if (e.type === "annotation") return adapters.annotationPayload(e);
    return {...base, x: Math.round(e.x), y: Math.round(e.y), image: adapters.textToPng(e)};
  }) : [];
  return {
    audio: structuredClone(audio),
    presenter: structuredClone(presenter),
    reframe: videoOutput ? structuredClone(adapters.exportReframe(reframe, edits)) : null,
    background: preset !== "audio_only" ? structuredClone(background) : null,
    denoise: !!((job.has_audio || presenterHasAudio) && denoise),
    atten_lim: strength ? parseInt(strength, 10) : null,
    preset,
    edits: structuredClone(visual),
    cuts: edits.filter(e => e.type === "cut").map(({start, end}) => ({start, end})),
  };
}
