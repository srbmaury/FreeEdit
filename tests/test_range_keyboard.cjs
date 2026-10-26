const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/range-selection.js','utf8');
const mark = source.slice(source.indexOf('function markRangeEdge('),source.indexOf('\ndocument.addEventListener("keydown"',source.indexOf('function markRangeEdge(')));
test('keyboard range edges preserve a valid interval and do not mutate document edits',()=>{
  const selection={range:null}; const S={edits:[],auditionUntil:4};
  const player={currentTime:3,pause(){}}; let updates=0;
  const context=vm.createContext({rangeSelection:selection,S,sourcePlayer:()=>player,duration:()=>10,
    clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),displayRangeSelection:()=>{updates++;}});
  vm.runInContext(mark,context);
  const run=(edge,t)=>{player.currentTime=t;vm.runInContext(`markRangeEdge('${edge}')`,context);return JSON.parse(JSON.stringify(selection.range));};
  assert.deepEqual(run('start',3),{start:3,end:10});
  assert.deepEqual(run('end',7),{start:3,end:7});
  assert.deepEqual(run('end',2),{start:0,end:2});
  assert.deepEqual(run('start',8),{start:8,end:10});
  assert.deepEqual(run('start',10),{start:8,end:10});
  assert.equal(updates,4); assert.equal(S.auditionUntil,null); assert.deepEqual(S.edits,[]);
});
