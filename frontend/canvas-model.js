"use strict";
const CanvasModel = (() => {
  function geometry(width, height, settings) {
    const ratio = {wide:16/9, vertical:9/16, square:1}[settings.aspect] || width/height;
    const even = n => Math.max(2, Math.floor(n/2)*2);
    const w = even(Math.min(width, height*ratio)), h = even(w/ratio);
    const pad = Math.min(w,h)*settings.padding/100;
    const scale = Math.min((w-2*pad)/width,(h-2*pad)/height);
    const iw = even(width*scale), ih = even(height*scale);
    return {w,h,iw,ih,x:Math.floor((w-iw)/2),y:Math.floor((h-ih)/2),radius:Math.min(iw,ih)*settings.radius/100};
  }
  return Object.freeze({geometry});
})();
