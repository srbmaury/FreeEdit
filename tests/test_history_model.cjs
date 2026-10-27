const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('frontend/history-model.js','utf8'),context);
const history=vm.runInContext('HistoryModel',context);

test('image-heavy history shares assets and restores independent documents',()=>{
 const image='data:image/png;base64,'+'a'.repeat(600000);
 const undo=[];
 const document={edits:[{image,x:0}],background:{image}};
 for(let x=0;x<100;x++){
   document.edits[0].x=x;
   history.push(undo,history.capture(document,undo));
 }
 assert.equal(undo.length,100);
 assert.equal(undo[0].assets.length,1);
 assert.ok(history.bytes(undo)<1_300_000,'100 steps retain one PNG, not 100 JSON copies');
 const restored=history.read(undo[0]);
 assert.equal(restored.edits[0].image,image);
 assert.equal(restored.background.image,image);
 assert.equal(restored.edits[0].x,0);
 restored.edits[0].x=999;
 assert.equal(history.read(undo[0]).edits[0].x,0);
 assert.equal(history.read(undo.at(-1)).edits[0].x,99);
});

test('replacement images, redo and divergent edits preserve snapshot identity',()=>{
 const undo=[],redo=[];
 const before=history.capture({image:'data:image/png;base64,AAA',x:1});
 const after=history.capture({image:'data:image/png;base64,BBB',x:1},[before]);
 assert.equal(history.same(before,after),false);
 history.push(undo,before);
 history.push(undo,history.capture(history.read(before),undo));
 assert.equal(undo.length,1,'identical focus checkpoints coalesce');
 history.push(redo,after,undo);
 assert.equal(history.read(undo.pop()).image,'data:image/png;base64,AAA');
 assert.equal(history.read(redo.pop()).image,'data:image/png;base64,BBB');
});

test('combined byte and entry budgets retain recent steps and reject oversized history',()=>{
 const undo=[],redo=[];
 for(let index=0;index<20;index++){
   history.push(undo,history.capture({index,text:'x'.repeat(100)}),redo,{maxEntries:5,maxBytes:2000});
 }
 assert.ok(undo.length<=5);
 assert.ok(history.bytes(undo)<=2000);
 assert.equal(history.read(undo.at(-1)).index,19);
 history.push(redo,history.capture({index:20}),undo,{maxEntries:3,maxBytes:2000});
 assert.ok(undo.length+redo.length<=3);
 assert.equal(history.read(redo.at(-1)).index,20);
 history.push(undo,history.capture({text:'x'.repeat(2000)}),redo,{maxBytes:1000});
 assert.equal(undo.length+redo.length,0,'an oversized snapshot cannot bypass the budget');
});

test('budget pruning preserves nearby redo when the undo stack is much longer',()=>{
 const undo=Array.from({length:5},(_,index)=>history.capture({index}));
 const redo=[];
 history.push(redo,history.capture({index:5}),undo,{maxEntries:5});
 assert.equal(redo.length,1);
 assert.equal(history.read(redo[0]).index,5);
 assert.equal(history.read(undo[0]).index,1,'discard the farthest undo step');
});
