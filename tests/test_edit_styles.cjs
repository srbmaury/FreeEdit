const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({structuredClone});
vm.runInContext(fs.readFileSync('frontend/editor-model.js','utf8')+';globalThis.model=EditorModel;',context);
const model=context.model;
test('paste appearance preserves text, timing, placement and identity',()=>{
  const source={id:1,type:'text',text:'source',x:1,y:2,start:0,end:2,fontSize:30,color:'#ff0000',font:'mono',bg:'dark',bold:true};
  const target={...source,id:2,text:'target',x:40,y:50,start:3,end:5,fontSize:12,color:'#ffffff'};
  const result=model.pastedStyle(target,model.styleProperties(source));
  assert.equal(result.text,'target');assert.equal(result.x,40);assert.equal(result.id,2);assert.equal(result.start,3);
  assert.equal(result.fontSize,30);assert.equal(result.color,'#ff0000');assert.equal(target.fontSize,12);
  assert.equal(model.pastedStyle({...target,type:'hide'},model.styleProperties(source)),null);
});
test('group appearance preserves paths and transfers individual stroke styles independently',()=>{
  const source={type:'annotation',kind:'drawing',color:'#ff0000',opacity:.5,strokes:[{points:[[0,0],[1,1]],color:'#ff0000',opacity:1,strokeWidth:.1}]};
  const target={...structuredClone(source),strokes:[{points:[[1,0],[0,1]],color:'#00ff00',opacity:.8,strokeWidth:.02}]};
  const result=model.pastedStyle(target,model.styleProperties(source));
  assert.deepEqual(result.strokes[0].points,target.strokes[0].points);
  assert.equal(result.strokes[0].color,'#ff0000');assert.equal(result.strokes[0].strokeWidth,.1);
  result.strokes[0].points[0][0]=.5;assert.equal(target.strokes[0].points[0][0],1);
  assert.equal(model.pastedStyle({...target,strokes:[]},model.styleProperties(source)),null);
});
