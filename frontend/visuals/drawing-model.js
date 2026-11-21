"use strict";

// Strokes use normalized coordinates inside an annotation's source-space bounds.
// Resizing, rotation, project files and export all use the same vector geometry.
const DrawingModel = (() => {
  const MAX_POINTS = 2048;
  const MAX_STROKES = 100;
  const MAX_GROUP_POINTS = 20000;
  const isGroup = edit => Array.isArray(edit.strokes);
  function validStroke(value) {
    return Array.isArray(value.points) && value.points.length > 0 && value.points.length <= MAX_POINTS &&
      (value.closed===undefined || value.closed===true && value.points.length>=3) &&
      Number.isFinite(value.strokeWidth) && value.strokeWidth > 0 && value.strokeWidth <= 1 &&
      value.points.every(p => Array.isArray(p) && p.length === 2 &&
        p.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  }
  function valid(edit) {
    if(edit.fill!==undefined && (!isGroup(edit) || !edit.strokes.every(s=>s?.closed===true) ||
      typeof edit.fill!=="string" ||
      !(/^#[0-9a-f]{6}$/i.test(edit.fill) ||
        edit.fill.length<=900000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(edit.fill))))return false;
    if(edit.strokes===undefined)return validStroke(edit);
    return isGroup(edit) && edit.points===undefined && edit.strokes.length>0 && edit.strokes.length<=MAX_STROKES &&
      edit.strokes.reduce((n,s)=>n+(Array.isArray(s?.points)?s.points.length:MAX_GROUP_POINTS+1),0)<=MAX_GROUP_POINTS &&
      edit.strokes.every(s=>s && validStroke(s) && s.strokes===undefined &&
        typeof s.color==="string" && /^#[0-9a-f]{6}$/i.test(s.color) &&
        Number.isFinite(s.opacity) && s.opacity>=0 && s.opacity<=1);
  }
  function worldStrokes(edit) {
    const angle=edit.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    return (isGroup(edit)?edit.strokes:[edit]).map(s=>({
      points:s.points.map(([x,y])=>{
        const dx=(x-.5)*edit.w,dy=(y-.5)*edit.h;
        return {x:edit.x+edit.w/2+dx*cos-dy*sin,y:edit.y+edit.h/2+dx*sin+dy*cos};
      }),
      width:s.strokeWidth*Math.min(edit.w,edit.h),closed:s.closed,
      color:s.color,opacity:isGroup(edit)?s.opacity*edit.opacity:edit.opacity
    }));
  }
  function fillable(edit) {
    if(edit.kind==="shape")return true;
    return (isGroup(edit)?edit.strokes:[edit]).every(s=>{
      if(s.closed)return true;
      if(s.points.length<3)return false;
      const [x,y]=s.points[0],[endX,endY]=s.points.at(-1);
      const gap=Math.hypot((x-endX)*edit.w,(y-endY)*edit.h);
      const tolerance=Math.max(8,s.strokeWidth*Math.min(edit.w,edit.h));
      if(gap>tolerance)return false;
      const far=s.points.find(([px,py])=>Math.hypot((px-x)*edit.w,(py-y)*edit.h)>tolerance);
      if(!far)return false;
      const dx=(far[0]-x)*edit.w,dy=(far[1]-y)*edit.h;
      return s.points.some(([px,py])=>Math.abs(dx*(py-y)*edit.h-dy*(px-x)*edit.w)>Math.hypot(dx,dy));
    });
  }
  function shapeStroke(edit) {
    const points=edit.shape==="ellipse"
      ? Array.from({length:128},(_,i)=>{
        const angle=i*Math.PI/64;
        return [.5+.47*Math.cos(angle),.5+.47*Math.sin(angle)];
      })
      : [[.03,.03],[.97,.03],[.97,.97],[.03,.97]];
    return {...edit,points,closed:true,strokeWidth:Math.max(3/Math.min(edit.w,edit.h),.07)};
  }
  function group(edits) {
    const strokes=edits.flatMap(e=>worldStrokes(e.kind==="shape"?shapeStroke(e):e));
    const left=[],top=[],right=[],bottom=[];
    for(const s of strokes)for(const p of s.points){
      left.push(p.x-s.width/2);right.push(p.x+s.width/2);
      top.push(p.y-s.width/2);bottom.push(p.y+s.width/2);
    }
    // Avoid spreading large point arrays into the JavaScript argument stack.
    const min=values=>values.reduce((a,b)=>Math.min(a,b),Infinity);
    const max=values=>values.reduce((a,b)=>Math.max(a,b),-Infinity);
    const x=Math.floor(min(left))-2,y=Math.floor(min(top))-2;
    const w=Math.max(16,Math.ceil(max(right))-x+2),h=Math.max(16,Math.ceil(max(bottom))-y+2);
    return {x,y,w,h,strokes:strokes.map(s=>({
      points:s.points.map(p=>[(p.x-x)/w,(p.y-y)/h]),
      strokeWidth:s.width/Math.min(w,h),color:s.color,opacity:s.opacity,
      ...(s.closed?{closed:true}:{})
    }))};
  }
  function stroke(points, lineWidth) {
    const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
    const pad=lineWidth/2+2;
    const x=Math.min(...xs)-pad, y=Math.min(...ys)-pad;
    const w=Math.max(16,Math.max(...xs)-x+pad), h=Math.max(16,Math.max(...ys)-y+pad);
    return {x,y,w,h,strokeWidth:lineWidth/Math.min(w,h),
      points:points.map(p=>[(p.x-x)/w,(p.y-y)/h])};
  }
  const localPoints=(s,edit)=>s.points.map(([x,y])=>[(x-.5)*edit.w,(y-.5)*edit.h]);
  function trace(c,points,closed) {
    c.moveTo(...points[0]);
    for(let i=1;i<points.length;i++)c.lineTo(...points[i]);
    if(closed)c.closePath();
  }
  function paintFill(c,edit,image) {
    if(!edit.fill || edit.fill[0]!=="#" && !image)return;
    c.save();
    c.beginPath();
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const s of edit.strokes){
      const points=localPoints(s,edit);
      let area=0;
      points.forEach(([x,y],i)=>{
        const [nextX,nextY]=points[(i+1)%points.length];
        area+=x*nextY-y*nextX;
        left=Math.min(left,x);top=Math.min(top,y);
        right=Math.max(right,x);bottom=Math.max(bottom,y);
      });
      // Match contour winding so overlapping shapes stay filled.
      trace(c,area<0?points.reverse():points,true);
    }
    if(image){
      c.clip();
      const scale=Math.max((right-left)/image.naturalWidth,(bottom-top)/image.naturalHeight);
      const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      c.drawImage(image,(left+right-w)/2,(top+bottom-h)/2,w,h);
    }else{
      c.fillStyle=edit.fill;
      c.fill();
    }
    c.restore();
  }
  function paint(c,edit,image) {
    paintFill(c,edit,image);
    for(const s of isGroup(edit)?edit.strokes:[edit]) {
      c.save();
      if(isGroup(edit)){c.globalAlpha*=s.opacity;c.strokeStyle=s.color;c.fillStyle=s.color;}
      c.lineWidth=s.strokeWidth*Math.min(edit.w,edit.h);
      c.lineCap="round";c.lineJoin="round";
      c.beginPath();
      const points=localPoints(s,edit);
      if(points.length===1){
        c.arc(points[0][0],points[0][1],c.lineWidth/2,0,Math.PI*2);c.fill();
      }else{
        trace(c,points,s.closed);
        c.stroke();
      }
      c.restore();
    }
  }
  function distance(p,a,b) {
    const dx=b.x-a.x,dy=b.y-a.y;
    const t=dx||dy?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy))):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }
  function hitIndex(edit,p,tolerance) {
    const strokes=worldStrokes(edit);
    for(let i=strokes.length-1;i>=0;i--){
      const s=strokes[i],radius=tolerance+s.width/2;
      if(s.opacity>0&&s.points.some((point,j)=>distance(p,s.points[j?j-1:s.closed?s.points.length-1:0],point)<=radius))return i;
    }
    return -1;
  }
  const hit=(edit,p,tolerance)=>hitIndex(edit,p,tolerance)>=0;
  function bounds(edit) {
    const angle=edit.rotation*Math.PI/180;
    // Inspector width changes may extend caps beyond the original point bounds.
    const pad=Math.max(...(isGroup(edit)?edit.strokes:[edit]).map(s=>s.strokeWidth))*Math.min(edit.w,edit.h);
    const w=Math.ceil(Math.abs(Math.cos(angle))*(edit.w+pad)+Math.abs(Math.sin(angle))*(edit.h+pad))+4;
    const h=Math.ceil(Math.abs(Math.sin(angle))*(edit.w+pad)+Math.abs(Math.cos(angle))*(edit.h+pad))+4;
    return {x:Math.round(edit.x+(edit.w-w)/2),y:Math.round(edit.y+(edit.h-h)/2),w,h};
  }
  return Object.freeze({MAX_POINTS,MAX_STROKES,MAX_GROUP_POINTS,isGroup,valid,stroke,paint,hit,hitIndex,bounds,worldStrokes,group,fillable});
})();
