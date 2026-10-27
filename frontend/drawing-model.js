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
      Number.isFinite(value.strokeWidth) && value.strokeWidth > 0 && value.strokeWidth <= 1 &&
      value.points.every(p => Array.isArray(p) && p.length === 2 &&
        p.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  }
  function valid(edit) {
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
      width:s.strokeWidth*Math.min(edit.w,edit.h),
      color:s.color,opacity:isGroup(edit)?s.opacity*edit.opacity:edit.opacity
    }));
  }
  function group(edits) {
    const strokes=edits.flatMap(worldStrokes);
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
      strokeWidth:s.width/Math.min(w,h),color:s.color,opacity:s.opacity
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
  function paint(c,edit) {
    for(const s of isGroup(edit)?edit.strokes:[edit]) {
      c.save();
      if(isGroup(edit)){c.globalAlpha*=s.opacity;c.strokeStyle=s.color;c.fillStyle=s.color;}
      c.lineWidth=s.strokeWidth*Math.min(edit.w,edit.h);
      c.lineCap="round";c.lineJoin="round";
      c.beginPath();
      const points=s.points.map(([x,y])=>[(x-.5)*edit.w,(y-.5)*edit.h]);
      if(points.length===1){
        c.arc(points[0][0],points[0][1],c.lineWidth/2,0,Math.PI*2);c.fill();
      }else{
        c.moveTo(...points[0]);
        for(let i=1;i<points.length;i++)c.lineTo(...points[i]);
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
      if(s.opacity>0&&s.points.some((point,j)=>distance(p,s.points[Math.max(0,j-1)],point)<=radius))return i;
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
  return Object.freeze({MAX_POINTS,MAX_STROKES,MAX_GROUP_POINTS,isGroup,valid,stroke,paint,hit,hitIndex,bounds,worldStrokes,group});
})();
