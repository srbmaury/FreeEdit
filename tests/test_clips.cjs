const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function context() {
  const elements = new Map();
  const ctx = vm.createContext({
    AbortSignal,
    S: {job: {id:'test'}, edits: [], undo: [], redo: []},
    window: {addEventListener() {}},
    $: id => {
      if (!elements.has(id)) elements.set(id, {addEventListener() {}, focus() {}});
      return elements.get(id);
    },
    getPresenterSettings: () => null,
    sourcePlayer: () => ({currentTime: 1, pause() {}}),
    api: async () => { throw Error('Failed'); },
    show() {},
    renderList() {},
    renderReframeSections() {},
  });
  vm.runInContext(fs.readFileSync('frontend/history-model.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('frontend/clips.js', 'utf8'), ctx);
  vm.runInContext(`
    renderSequenceClips = () => {};
    const cut = {type: 'cut', duration: 0}, fade = {type: 'crossfade', duration: 1};
    sequenceClips = ['a','b','c'].map(id => ({id, duration: 5}));
    sequenceTransitions = [cut, cut];
  `, ctx);
  return ctx;
}

test('blocked removal keeps edits and transitions intact', async () => {
  const ctx = context();
  await vm.runInContext(`sequenceTransitions = [fade, cut];
    S.edits = [{start: 9.5, end: 10}]; removeSequenceClip(2);`, ctx);
  assert.match(vm.runInContext('$("sequenceStatus").textContent', ctx), /different footage/);
  assert.equal(vm.runInContext('sequenceTransitions.length', ctx), 2);
});

test('failed rebuild does not commit proposed timing or transitions', async () => {
  const ctx = context();
  await vm.runInContext(`S.edits = [{start: 6, end: 7}];
    rebuildSequence(['b','a','c'], [cut, cut]);`, ctx);
  assert.match(vm.runInContext('$("sequenceStatus").textContent', ctx), /Failed/);
  assert.equal(vm.runInContext('S.edits[0].start', ctx), 6);
  assert.equal(vm.runInContext('$("editorView").inert', ctx), false);
});

test('moving a clip remaps edits, history and playhead after the server accepts the change', async () => {
  const ctx = context();
  ctx.api = async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).order, ['b','a','c']);
    assert.equal(ctx.S.edits[0].start, 1);
    return {};
  };
  await vm.runInContext(`
    S.edits = [{type: 'hide', start: 1, end: 2}];
    S.undo = [HistoryModel.capture({edits: [{type: 'hide', start: 2, end: 3}]})];
    refreshSequenceSource = (_, time) => { S.seek = time; };
    rebuildSequence(['b','a','c'], [cut, cut]);
  `, ctx);
  assert.equal(ctx.S.edits[0].start, 6);
  assert.equal(ctx.S.edits[0].end, 7);
  assert.equal(ctx.S.seek, 6);
  assert.equal(vm.runInContext('HistoryModel.read(S.undo[0]).edits[0].start', ctx), 7);
});

test('an edit spanning a join only moves when the same blend and footage remain together', () => {
  const ctx = context();
  vm.runInContext(`
    const [a,b,c] = sequenceClips;
    const old = clipIntervals([a,b,c], [fade, cut]);
    const unchangedJoin = clipIntervals([c,a,b], [cut, fade]);
    const changedJoin = clipIntervals([a,b,c], [cut, cut]);
    const newNeighbor = clipIntervals([a,c,b], [fade, cut]);
  `, ctx);
  assert.equal(vm.runInContext('mapClipRange(old, unchangedJoin, 3.5, 5.5).start', ctx), 8.5);
  assert.equal(vm.runInContext('mapClipRange(old, changedJoin, 3.5, 5.5)', ctx), null);
  assert.equal(vm.runInContext('mapClipRange(old, newNeighbor, 4, 4.5)', ctx), null);
  assert.equal(vm.runInContext('mapClipRange(old, newNeighbor, 1, 2).start', ctx), 1);
});
