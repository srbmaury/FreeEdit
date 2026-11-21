"use strict";

// Pure annotation model: the same geometry, timing and animation rules are used
// by canvas preview, the export rasterizer and project-file validation.
const AnnotationModel = (() => {
  const KINDS = Object.freeze(["icon", "shape", "arrow", "callout", "image", "drawing", "spotlight", "click"]);
  const SHAPES = Object.freeze(["rectangle", "ellipse"]);
  const ICONS = Object.freeze(["check", "warning", "star", "info", "lightbulb", "heart"]);
  const ANIMATIONS = Object.freeze(["none", "fade", "slide"]);
  const PRESETS = Object.freeze({
    success: {kind:"icon",icon:"check",color:"#22c55e"},
    warning: {kind:"icon",icon:"warning",color:"#f59e0b"},
    tip: {kind:"callout",text:"Tip: click here",color:"#2563eb"},
    step: {kind:"callout",text:"Step 1",color:"#7c3aed"},
    highlight: {kind:"shape",shape:"rectangle",color:"#facc15"}
  });
  function defaultEdit(kind, width, height, start, end, preset=null) {
    const theme = preset && PRESETS[preset] || {};
    const chosen = theme.kind || kind;
    let w = Math.min(Math.round(width*.30),chosen==="callout"?280:chosen==="arrow"?180:chosen==="image"?240:chosen==="shape"?190:96);
    let h = chosen==="callout" ? 78 : chosen==="shape" ? 120 : chosen==="arrow" ? 85 : chosen==="image" ? 160 : 96;
    const cursor = chosen==="spotlight" || chosen==="click";
    if(cursor) w=h=Math.max(16,Math.round(Math.min(width,height)*(chosen==="spotlight"?.35:.18)));
    return {
      type:"annotation",kind:chosen,icon:"check",shape:"rectangle",text:"Your callout",image:null,
      x:Math.max(0,Math.round((width-w)/2)),y:Math.max(0,Math.round((height-h)/2)),
      w:Math.max(32,w),h:Math.max(32,Math.min(h,height)),
      color:chosen==="spotlight"?"#000000":chosen==="click"?"#facc15":"#635bff",opacity:chosen==="spotlight"?.55:1,rotation:0,animation:cursor?"fade":"none",transition:cursor?.15:.35,
      start,end,...theme
    };
  }
  function validate(edit, duration, width, height) {
    if(!edit || edit.type!=="annotation" || !KINDS.includes(edit.kind) ||
       !Number.isFinite(duration)||duration<=0 ||
       ![edit.start,edit.end,edit.x,edit.y,edit.w,edit.h,edit.opacity,edit.rotation,edit.transition].every(Number.isFinite) ||
       edit.start<0 || edit.end>duration+.005 || edit.end<=edit.start ||
       edit.x< -width || edit.y< -height || edit.x>width || edit.y>height ||
       edit.w<16 || edit.w>Math.min(width*2,4096) || edit.h<16 || edit.h>Math.min(height*2,4096) ||
       edit.opacity<(edit.kind==="drawing"?0:.1) || edit.opacity>1 || edit.rotation< -180 || edit.rotation>180 ||
       edit.transition<0 || edit.transition>1.5 ||
       !ANIMATIONS.includes(edit.animation) ||
       typeof edit.color!=="string" || !/^#[0-9a-f]{6}$/i.test(edit.color) ||
       typeof edit.text!=="string" || edit.text.length>120 ||
       !SHAPES.includes(edit.shape) || !ICONS.includes(edit.icon)) return "Invalid annotation properties.";
    if(edit.kind==="spotlight" && edit.animation==="slide")return "Spotlights support Fade or None animation.";
    if(edit.kind==="image" && (typeof edit.image!=="string" ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(edit.image) ||
        edit.image.length>900000)) return "Choose a PNG, JPG or WebP image under the overlay size limit.";
    if(edit.animationShift!==undefined && (edit.kind!=="drawing" || !Number.isFinite(edit.animationShift) || edit.animationShift<0 || edit.animationShift>90))
      return "Invalid drawing animation.";
    if(edit.kind==="drawing") {
      if(!DrawingModel.valid(edit))return "Invalid drawing stroke.";
      const bounds=DrawingModel.bounds(edit);
      if(bounds.w>8192 || bounds.h>8192 || bounds.w*bounds.h>8_000_000)
        return "This drawing is too large to export. Draw a smaller area or reduce its size or rotation.";
    }
    return null;
  }
  const ease = t => t;
  function animationState(edit,time) {
    const d=Math.min(edit.transition,(edit.end-edit.start)/2);
    if(edit.animation==="none" || d<=0) return {alpha:1,dx:0};
    const enter=Math.max(0,Math.min(1,(time-edit.start)/d));
    const exit=Math.max(0,Math.min(1,(edit.end-time)/d));
    const visibility=Math.min(enter,exit);
    return edit.animation==="fade" ? {alpha:visibility,dx:0} :
      {alpha:1,dx:Math.round((1-ease(visibility))*-(edit.animationShift ?? Math.min(90,edit.w*.4)))};
  }
  function visibleTime(edit) {
    if (edit.animation === "none" || edit.transition <= 0) return edit.start;
    return edit.start + Math.min(edit.transition, (edit.end-edit.start)/2);
  }
  // A representative frame while changing animation styles in the inspector.
  // Mid-transition makes Fade and Slide visibly different on a paused video.
  function previewTime(edit) {
    const length=Math.max(0,edit.end-edit.start);
    if (!length) return edit.start;
    const transition=edit.animation === "none" ? 0 :
      Math.min(edit.transition, length/2);
    return edit.start + (transition > 0 ?
      transition/2 : Math.min(.1,length/2));
  }
  function rasterBounds(edit, width, height) {
    if(edit.kind==="spotlight") {
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error("Spotlight needs video dimensions.");
      return {x:0,y:0,w:width,h:height};
    }
    if(edit.kind==="drawing")return DrawingModel.bounds(edit);
    // Square bounds keep rotated corners from being clipped in final export.
    const size=Math.ceil(Math.hypot(edit.w,edit.h))+4;
    return {x:Math.round(edit.x+(edit.w-size)/2),
      y:Math.round(edit.y+(edit.h-size)/2),w:size,h:size};
  }
  return Object.freeze({KINDS,SHAPES,ICONS,ANIMATIONS,PRESETS,defaultEdit,validate,animationState,visibleTime,previewTime,rasterBounds});
})();
