const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({});
for(const path of ['drawing-model','annotation-model','editor-model','history-model'])
  vm.runInContext(fs.readFileSync(`frontend/${path}.js`,'utf8'),context);
const {DrawingModel,AnnotationModel,EditorModel,HistoryModel}=vm.runInContext('({DrawingModel,AnnotationModel,EditorModel,HistoryModel})',context);
function edit(){return {...AnnotationModel.defaultEdit('drawing',1280,720,1,3),
  ...DrawingModel.stroke([{x:100,y:100},{x:200,y:150},{x:300,y:100}],8)};}

test('drawing bounds include rounded caps; dots and normalized points are valid',()=>{
  const e=edit();
  assert.equal(AnnotationModel.validate(e,5,1280,720),null);
  const half=e.strokeWidth*Math.min(e.w,e.h)/2;
  for(const [x,y] of e.points){assert.ok(x*e.w>=half&&y*e.h>=half);assert.ok(x*e.w<=e.w-half&&y*e.h<=e.h-half);}
  const dot={...e,...DrawingModel.stroke([{x:0,y:0}],80)};
  assert.equal(AnnotationModel.validate(dot,5,1280,720),null);
  assert.equal(dot.points.length,1);
});

test('drawing validation bounds geometry, point counts, widths and raster memory',()=>{
  const e=edit();
  for(const changes of [{points:[]},{points:[[NaN,0]]},{points:[[1.1,0]]},
    {points:[[0]]},{points:Array(2049).fill([0,0])},{strokeWidth:Infinity},{strokeWidth:0},
    {w:4096,h:4096},{w:3000,h:2000,rotation:45}]){
    assert.ok(AnnotationModel.validate({...e,...changes},5,4096,4096),JSON.stringify(changes).slice(0,100));
  }
});

test('eraser follows actual segments after moving, resizing and rotating',()=>{
  const e={...edit(),x:500,y:200,w:400,h:100,rotation:90};
  const [x,y]=e.points[1];
  const point={x:e.x+e.w/2-(y-.5)*e.h,y:e.y+e.h/2+(x-.5)*e.w};
  assert.equal(DrawingModel.hit(e,point,2),true);
  assert.equal(DrawingModel.hit(e,{x:0,y:0},2),false);
  const bounds=AnnotationModel.rasterBounds(e);
  assert.ok(bounds.w>=e.h&&bounds.h>=e.w);
});

test('vector drawings survive history and project validation without shared point arrays',async()=>{
  const {validateProjectDocument}=await import('../frontend/project-schema.mjs');
  const e=edit();
  const document={format:'FreeEdit',version:2,source:{name:'demo.mp4',size:10,
    algorithm:'sha256-chunks-4m-v1',fingerprint:'a'.repeat(64),duration:5,width:1280,height:720,has_video:true,has_audio:true},
    edits:[e],settings:{denoise:false,strength:'18',preset:'balanced',background:null,presenter:null,reframe:null}};
  const restored=HistoryModel.read(HistoryModel.capture(document));
  const saved=validateProjectDocument(restored,{EditorModel,AnnotationModel});
  assert.equal(JSON.stringify(saved.edits[0].points),JSON.stringify(e.points));
  saved.edits[0].points[0][0]=0;
  assert.notEqual(saved.edits[0].points[0][0],restored.edits[0].points[0][0]);
  restored.edits[0].points=[[2,0]];
  assert.throws(()=>validateProjectDocument(restored,{EditorModel,AnnotationModel}),/invalid/);
});

test('grouping preserves rotated stroke geometry, paint order, colors and opacity',()=>{
  const first={...edit(),rotation:30};
  const second={...edit(),x:400,y:250,w:180,h:90,color:'#facc15',opacity:.35};
  const grouped={...AnnotationModel.defaultEdit('drawing',1280,720,1,3),...DrawingModel.group([first,second])};
  assert.equal(AnnotationModel.validate(grouped,5,1280,720),null);
  const before=[...DrawingModel.worldStrokes(first),...DrawingModel.worldStrokes(second)];
  const after=DrawingModel.worldStrokes(grouped);
  for(let i=0;i<before.length;i++){
    assert.equal(after[i].color,before[i].color);assert.equal(after[i].opacity,before[i].opacity);
    assert.ok(Math.abs(after[i].width-before[i].width)<1e-9);
    before[i].points.forEach((p,j)=>{
      assert.ok(Math.abs(after[i].points[j].x-p.x)<1e-9);
      assert.ok(Math.abs(after[i].points[j].y-p.y)<1e-9);
    });
  }
  const moved=DrawingModel.worldStrokes({...grouped,x:grouped.x+20,y:grouped.y+10});
  assert.ok(Math.abs(moved[1].points[1].x-after[1].points[1].x-20)<1e-9);
  const scaled=DrawingModel.worldStrokes({...grouped,w:grouped.w*1.5,h:grouped.h*1.5});
  assert.ok(Math.abs(scaled[1].width-after[1].width*1.5)<1e-9);
  assert.equal(DrawingModel.hitIndex(grouped,after[1].points[1],1),1);
});

test('group validation rejects nested and oversized data and retains overlay limits',()=>{
  const base=edit(),group={...base,...DrawingModel.group([base,{...base,x:400}])};
  delete group.points;delete group.strokeWidth;
  assert.equal(DrawingModel.valid(group),true);
  assert.equal(DrawingModel.valid({...group,points:[[0,0]]}),false);
  assert.equal(DrawingModel.valid({...group,strokes:[{...group.strokes[0],strokes:[]}]}),false);
  assert.equal(DrawingModel.valid({...group,strokes:[{...group.strokes[0],color:'url(evil)'}]}),false);
  assert.equal(DrawingModel.valid({...group,strokes:Array(101).fill(group.strokes[0])}),false);
  assert.equal(DrawingModel.valid({...group,strokes:Array(10).fill({...group.strokes[0],points:Array(2048).fill([.5,.5])})}),false);
  assert.match(EditorModel.limitError([...Array(99).fill(base),group]),/100/);
});

test('group vectors round-trip through projects, history and ungroup geometry',async()=>{
  const {validateProjectDocument}=await import('../frontend/project-schema.mjs');
  const base=edit();
  const group={...AnnotationModel.defaultEdit('drawing',1280,720,1,3),...DrawingModel.group([base,{...base,x:400,color:'#facc15',opacity:.35}]),rotation:15,opacity:.5,animation:'slide',animationShift:60};
  const document={format:'FreeEdit',version:2,source:{name:'demo.mp4',size:10,
    algorithm:'sha256-chunks-4m-v1',fingerprint:'a'.repeat(64),duration:5,width:1280,height:720,has_video:true,has_audio:true},
    edits:[group],settings:{denoise:false,strength:'18',preset:'balanced',background:null,presenter:null,reframe:null}};
  const restored=HistoryModel.read(HistoryModel.capture(document));
  const saved=validateProjectDocument(restored,{EditorModel,AnnotationModel}).edits[0];
  assert.equal(saved.animationShift,60);
  assert.equal(JSON.stringify(saved.strokes),JSON.stringify(group.strokes));
  saved.strokes[0].points[0][0]=0;
  assert.notEqual(saved.strokes[0].points[0][0],restored.edits[0].strokes[0].points[0][0]);
  for(const s of DrawingModel.worldStrokes(group)){
    const standalone={...base,...DrawingModel.stroke(s.points,s.width),color:s.color,opacity:s.opacity};
    assert.equal(AnnotationModel.validate(standalone,5,1280,720),null);
    const points=DrawingModel.worldStrokes(standalone)[0].points;
    s.points.forEach((p,i)=>assert.ok(Math.hypot(p.x-points[i].x,p.y-points[i].y)<1e-9));
  }
});
