// Pure scene rules shared by project import and live presenter validation.
export function validateBackground(value, source) {
  if (value == null) return null;
  const fail = () => { throw new Error("The project's background settings are invalid."); };
  if (!source.has_video || !["blur", "color", "image"].includes(value.mode) ||
      !Number.isInteger(value.blur) || value.blur < 4 || value.blur > 40 || !/^#[a-f\d]{6}$/i.test(value.color)) fail();
  let region = null;
  if (value.region != null) {
    const r = value.region;
    if (![r.x, r.y, r.w, r.h].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.w < 8 || r.h < 8 ||
        r.x + r.w > source.width || r.y + r.h > source.height) fail();
    region = {x: r.x, y: r.y, w: r.w, h: r.h};
  }
  let image = null;
  if (value.mode === "image") {
    if (typeof value.image !== "string" || value.image.length > 900000 || !value.image.startsWith("data:image/png;base64,")) fail();
    try {
      const binary = atob(value.image.slice(22));
      const bytes = Uint8Array.from(binary.slice(0, 24), c => c.charCodeAt(0));
      const header = new DataView(bytes.buffer);
      const width = header.getUint32(16), height = header.getUint32(20);
      if (binary.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || binary.slice(12, 16) !== "IHDR" ||
          !width || !height || width > 8192 || height > 8192 || width * height > 8000000) fail();
    } catch { fail(); }
    image = value.image;
  }
  const preset = value.preset ?? "custom";
  if (!["studio", "twilight", "forest", "custom"].includes(preset)) fail();
  return {mode: value.mode, preset, blur: value.blur, color: value.color, image, region};
}

export function validatePresenterProject(value, main) {
  if (value == null) return null;
  const fail = () => { throw new Error("Invalid presenter recording or placement in this project."); };
  const source = value.source, s = value.settings, b = s?.box;
  if (!source || !main.has_video || !source.has_video || typeof source.has_audio !== "boolean" ||
      typeof source.name !== "string" || source.name.length > 1024 || !Number.isSafeInteger(source.size) || source.size <= 0 ||
      source.algorithm !== "sha256-chunks-4m-v1" || !/^[a-f0-9]{64}$/.test(source.fingerprint) ||
      ![source.duration, source.width, source.height].every(n => Number.isFinite(n) && n > 0 && n < 1e8) || !s || !b) fail();
  if (![b.x, b.y, b.w, b.h].every(Number.isInteger) || b.x < 0 || b.y < 0 || b.w < 8 || b.h < 8 || b.x + b.w > main.width || b.y + b.h > main.height) fail();
  if (![s.offset,s.trim_start,s.trim_end,s.main_volume,s.presenter_volume].every(Number.isFinite) ||
      s.offset < 0 || s.offset >= main.duration || s.trim_start < 0 || s.trim_end <= s.trim_start || s.trim_end > source.duration + .05 ||
      s.main_volume < 0 || s.main_volume > 2 || s.presenter_volume < 0 || s.presenter_volume > 2 ||
      !["main","presenter","both","muted"].includes(s.sound) || !["original","blur","remove"].includes(s.effect)) fail();
  return {source: {...source}, settings: {box: {...b}, offset:s.offset, trim_start:s.trim_start, trim_end:s.trim_end,
    main_volume:s.main_volume, presenter_volume:s.presenter_volume, sound:s.sound, effect:s.effect}};
}

export function validateFraming(value, source) {
  if(value == null)return null;
  const fail=()=>{throw new Error("The project's canvas framing is invalid.");};
  if(!source.has_video || !["original","wide","vertical","square"].includes(value.aspect) ||
    ![value.padding,value.radius,value.shadow].every(Number.isFinite) ||
    value.padding<0 || value.padding>25 || value.radius<0 || value.radius>25 || value.shadow<0 || value.shadow>10 ||
    !/^#[a-f\d]{6}$/i.test(value.color))fail();
  if(value.image != null)validateBackground({mode:"image",blur:16,color:value.color,image:value.image},source);
  return {aspect:value.aspect,padding:value.padding,radius:value.radius,shadow:value.shadow,color:value.color,image:value.image || null};
}
