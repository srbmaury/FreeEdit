"use strict";

// Unified selection, edit inspector, keyboard shortcuts and editing actions.
function addTextAt(x, y) {
  return addEdit({type: "text", text: "Your text", x: Math.round(x), y: Math.round(y),
    fontSize: Math.max(16, Math.round(S.job.height * 0.055)),
    color: "#ffffff", font: "sans", bg: "dark", bold: true});
}
$("placeEditBtn").onclick = () => {
  const {width, height} = S.job;
  if (S.mode === "hide") {
    addEdit({type: "hide", style: "black", x: Math.floor(width / 4), y: Math.floor(height / 3),
      w: Math.max(8, Math.floor(width / 2)), h: Math.max(8, Math.floor(height / 5))});
  } else if (S.mode === "text") addTextAt(width / 3, height / 2);
  setMode("select");
};

function setMode(mode) {
  S.mode = mode;
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "mode" }));
  $("drawCameraAreaBtn").setAttribute("aria-pressed", String(mode === "background"));
  $("drawCameraAreaBtn").textContent = mode === "background" ? "Cancel area selection" : "Draw camera area";
  show($("placeEditBtn"), mode !== "select" && mode !== "background" && !!S.job?.has_video);
  document.querySelectorAll(".tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
  $("modeHint").textContent = MODE_HINTS[mode];
  canvas.className = (mode === "hide" || mode === "background") ? "crosshair" : mode === "text" ? "text" : "";
}
function chooseSelectTool() {
  if (S.reviewing) setReview(false);
  setMode("select");
  // An explicit Select action must reveal the edits inspector, even when
  // selection mode is already active (the default after uploading).
  window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "select-tool"}));
}
document.querySelectorAll(".tool").forEach((b) => (b.onclick = () => {
  if (b.dataset.mode === "select") chooseSelectTool();
  else setMode(b.dataset.mode);
}));

// ---------- removing parts ----------
$("cutBtn").onclick = addCut;

function addCut() {
  if (!S.job || !duration()) return;
  sourcePlayer().pause();
  if (S.reviewing) setReview(false);
  setMode("select");
  window.dispatchEvent(new CustomEvent("freeedit:workspace", {detail: "cut"}));
}

// Merged [start, end] ranges of everything marked for removal
function cutRanges(edits = S.edits) { return EditorModel.cutRanges(edits); }

// Push a changed edit's times into its sidebar card and the timeline
function syncCard(e) {
  const card = document.querySelector(`.card[data-id="${e.id}"]`);
  if (card) {
    card.querySelector('[data-k="start"]').value = e.start;
    card.querySelector('[data-k="end"]').value = e.end;
    card.querySelector(".card-title").textContent = cardTitle(e);
  }
  editorStore.dispatch("edit:drag", () => {});
}

// ---------- edits ----------
function addEdit(props) {
  const d = duration();
  const start = sourcePlayer().currentTime >= d - 0.05 ? 0 : +sourcePlayer().currentTime.toFixed(1);
  const e = {id:S.nextId++,start,end:+d.toFixed(2),...props};
  if (e.type === "text") { const m = textMetrics(e); e.w=m.w;e.h=m.h; }
  commitEdit("edit:add", state => {state.edits.push(e);state.selected=e.id;});
  return e;
}

function deleteEdit(id) {
  if (!getEdit(id)) return;
  commitEdit("edit:delete", state => {
    state.edits=state.edits.filter(e=>e.id!==id);
    if(state.selected===id)state.selected=null;
  });
  window.dispatchEvent(new CustomEvent("freeedit:workspace",{detail:"selection"}));
}

function select(id) {
  stopReviewLoop();
  S.selected = id;
  if (typeof syncZoomSelection === "function") syncZoomSelection();
  window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "selection" }));
  document.querySelectorAll(".card").forEach((c) => {
    const selected = +c.dataset.id === id;
    c.classList.toggle("selected", selected);
    c.querySelector(".card-title")?.setAttribute("aria-expanded", String(selected));
  });
  renderTimeline();
  updateTransport();
  render();
}

function cardTitle(e) {
  const range = `${fmt(e.start)}–${fmt(e.end)}`;
  if (e.type === "cut") return `${range} (${(e.end - e.start).toFixed(1)}s)`;
  if (e.type === "reframe") return `Reframe ${e.zoom.toFixed(2)}× · ${range}`;
  if (e.type === "text") return `${(e.text || "").split("\n")[0]} · ${range}`;
  return `${{ blur: "Blur", pixelate: "Pixelate", black: "Solid cover" }[e.style]} · ${range}`;
}

function renderList() {
  if (S.selected) window.dispatchEvent(new CustomEvent("freeedit:workspace", { detail: "selection" }));
  const list = $("editsList");
  list.innerHTML = "";
  $("editCount").textContent = S.edits.length;
  show($("editsEmpty"), S.edits.length === 0);
  renderTimeline();

  for (const e of EditorModel.sorted(S.edits).filter(e=>e.type!=="reframe")) {
    const tpl = $({ hide: "hideCardTpl", text: "textCardTpl", cut: "cutCardTpl" }[e.type]).content.cloneNode(true);
    const card = tpl.querySelector(".card");
    card.dataset.id = e.id;
    card.dataset.start = e.start;
    card.classList.toggle("selected", e.id === S.selected);
    card.querySelector(".times").append($("timesTpl").content.cloneNode(true));
    const title = card.querySelector(".card-title");
    title.textContent = cardTitle(e);
    title.setAttribute("aria-expanded", String(e.id === S.selected));
    title.onclick = () => { select(e.id); sourcePlayer().currentTime = e.start; };

    card.querySelectorAll("[data-k]").forEach((input) => {
      const k = input.dataset.k;
      if (input.type === "checkbox") input.checked = !!e[k];
      else input.value = e[k];
      input.addEventListener("focus", checkpoint);
      if (input.type === "number") input.addEventListener("change", () => { input.value = e[k]; });
      input.addEventListener("input", () => {
        let v = input.type === "checkbox" ? input.checked : input.value;
        if (input.type === "number") {
          v = parseFloat(v);
          if (Number.isNaN(v)) return;
          if (["x", "y", "w", "h"].includes(k)) {
            const axis = ["x", "w"].includes(k) ? S.job.width : S.job.height;
            if (k === "w" || k === "h") v = clamp(Math.round(v), 8, axis - e[k === "w" ? "x" : "y"]);
            else v = clamp(Math.round(v), 0, axis - (e.type === "hide" ? e[k === "x" ? "w" : "h"] : 1));
          }
          if (k === "fontSize") v = clamp(Math.round(v), 8, 400);
          if (k === "start") v = clamp(v, 0, e.end);
          if (k === "end") v = clamp(v, e.start, duration());
        }
        commitEdit("edit:property", () => { e[k] = v; }, false);
        title.textContent = cardTitle(e);
      });
    });

    card.querySelectorAll("[data-now]").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        checkpoint();
        const k = btn.dataset.now;
        const t = +sourcePlayer().currentTime.toFixed(2);
        if (k === "start") { e.start = Math.min(t, e.end); }
        else { e.end = Math.max(t, e.start); }
        syncCard(e);
      };
    });

    if (e.type === "cut") {
      card.querySelector(".del").textContent = "Delete cut";
      card.querySelector(".del").setAttribute("aria-label", "Delete cut");
    }
    card.querySelector(".del").onclick = (ev) => { ev.stopPropagation(); deleteEdit(e.id); };
    card.addEventListener("pointerdown", () => {
      if (S.selected === e.id) return;
      select(e.id);
      sourcePlayer().currentTime = e.start;
    });
    list.append(tpl);
  }
  if (typeof renderZoomSelectList === "function") renderZoomSelectList();
}

document.addEventListener("keydown", (ev) => {
  if (document.querySelector("dialog[open]")) return;
  if (!S.job || $("editorView").classList.contains("hidden")) return;
  if (ev.target.closest("input, textarea, select")) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); restoreHistory(ev.shiftKey); return; }
  if (S.reviewing) return;
  if (ev.key === " " && ev.target.closest("button, a")) return;
  if (ev.key === " ") { ev.preventDefault(); sourcePlayer().paused ? sourcePlayer().play() : sourcePlayer().pause(); }
  else if ((ev.key === "Delete" || ev.key === "Backspace") && S.selected) { ev.preventDefault(); deleteEdit(S.selected); }
  else if (ev.key === "Escape") { select(null); setMode("select"); }
  else if (ev.key.toLowerCase() === "v" && S.job.has_video) chooseSelectTool();
  else if (ev.key === "h" && S.job.has_video) setMode("hide");
  else if (ev.key === "t" && S.job.has_video) setMode("text");
  else if (ev.key === "x") addCut();
  else if (ev.key === "ArrowLeft") sourcePlayer().currentTime = Math.max(0, sourcePlayer().currentTime - (ev.shiftKey ? 1 : 1 / 30));
  else if (ev.key === "ArrowRight") sourcePlayer().currentTime = Math.min(duration(), sourcePlayer().currentTime + (ev.shiftKey ? 1 : 1 / 30));
});

