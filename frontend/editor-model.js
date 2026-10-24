"use strict";

// Single timeline-document contract. Cut, mask, text/caption and timed Reframe
// all have the same identity and original-source [start, end] interval.
// Whole-video reframe, background and presenter remain scene-level settings.
const EditorModel = (() => {
  const TIMELINE_TYPES = Object.freeze(["cut", "hide", "text", "reframe"]);
  const DEFAULT_REFRAME = Object.freeze({aspect: "original", zoom: 1, focus_x: .5, focus_y: .5});

  function isTimedEdit(edit) {
    return !!edit && TIMELINE_TYPES.includes(edit.type);
  }
  function sorted(edits) {
    return [...edits].sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);
  }
  function byType(edits, type) {
    return edits.filter(edit => edit.type === type);
  }
  function sections(edits) {
    return sorted(byType(edits, "reframe")).map(({start, end, zoom, focus_x, focus_y, transition}) =>
      ({start, end, zoom, focus_x, focus_y, transition}));
  }
  function exportReframe(scene, edits) {
    return {...DEFAULT_REFRAME, ...scene, sections: sections(edits)};
  }
  function validateReframe(value, duration, edits, ignoreId = null) {
    if (!value || !Number.isFinite(duration) || duration <= 0 ||
        ![value.start, value.end, value.zoom, value.focus_x, value.focus_y, value.transition].every(Number.isFinite) ||
        value.start < 0 || value.end > duration + .005 || value.end <= value.start ||
        value.zoom < 1 || value.zoom > 3 ||
        value.focus_x < 0 || value.focus_x > 1 || value.focus_y < 0 || value.focus_y > 1 ||
        value.transition < 0 || value.transition > 1.5) {
      return "Choose a valid time, zoom, focus and transition inside the video.";
    }
    const others = byType(edits, "reframe").filter(edit => edit.id !== ignoreId);
    if (others.length >= 20) return "FreeEdit supports at most 20 timed Reframe edits.";
    if (others.some(edit => value.start < edit.end && value.end > edit.start)) {
      return "Timed Reframe edits cannot overlap.";
    }
    return null;
  }
  function cutRanges(edits) {
    const spans = byType(edits, "cut").map(({start, end}) => [start,end]).sort((a,b) => a[0]-b[0]);
    const merged = [];
    for (const [start,end] of spans) {
      if (merged.length && start <= merged[merged.length-1][1]) {
        merged[merged.length-1][1] = Math.max(end,merged[merged.length-1][1]);
      } else merged.push([start,end]);
    }
    return merged;
  }
  function editableProperties(edit) {
    if (!isTimedEdit(edit)) throw new TypeError("Invalid timeline edit type");
    const {id, ...properties} = edit;
    // Text dimensions are derived from content, font and size in the editor.
    if (properties.type === "text") {
      delete properties.w;
      delete properties.h;
    }
    return properties;
  }
  return Object.freeze({TIMELINE_TYPES, DEFAULT_REFRAME, isTimedEdit, sorted, byType,
    sections, exportReframe, validateReframe, cutRanges, editableProperties});
})();

// One mutation path for document edits. Frontend modules never need to know
// which inspector, timeline or export widget depends on their change.
// Directly-mutated media/playback state stays outside this document store.
function createEditorStore(initial) {
  const listeners = new Set();
  const state = initial;
  let revision = 0;
  return Object.freeze({
    state,
    get revision() { return revision; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(reason, mutation) {
      if (typeof mutation !== "function") throw new TypeError("Expected an editor mutation function");
      const result = mutation(state);
      revision++;
      for (const listener of [...listeners]) listener({reason, revision, state});
      return result;
    }
  });
}
