"use strict";

// Presentation-only shell. Original nodes, IDs, listeners, and API flows stay intact.
(() => {
  const byId = id => document.getElementById(id);
  const editor = document.querySelector(".editor");
  const side = editor.querySelector(".side");
  const cleanup = side.querySelector(".audio-cleanup");
  const noise = cleanup.querySelector(".panel");
  const pauses = byId("silencePanel");
  const edits = byId("editsPanel");
  const exportPanel = byId("exportPanel");
  const rail = document.createElement("nav");
  rail.className = "workspace-rail";
  rail.setAttribute("aria-label", "Editing tasks");
  const icons = {
    Videos: '<rect x="2" y="4" width="16" height="14" rx="2"/><path d="m18 9 4-3v10l-4-3"/><rect x="10" y="12" width="6" height="4" rx="1"/>',
    Audio: '<path d="m11 5-6 4H2v6h3l6 4Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    Pauses: '<path d="M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4"/>',
    Reframe: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>',
    Captions: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M6 11h5m2 0h5M6 15h8m2 0h2"/>',
    Background: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="9" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>',
    Cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
    Text: '<path d="M4 6V3h16v3M12 3v18m-4 0h8"/>',
    'Hide area': '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 18 16-12M3 12l9-7m0 14 9-7"/>',
    Export: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>'
  };
  const panes = {};
  for (const [name, node] of [["videos", byId("videosPanel")], ["cut", byId("cutDraftPanel")], ["edits", edits], ["audio", noise], ["pauses", pauses], ["background", byId("backgroundPanel")], ["reframe", byId("reframePanel")], ["captions", byId("captionsPanel")], ["export", exportPanel]]) {
    const pane = document.createElement("section");
    pane.id = `workspace-${name}`;
    pane.className = "workspace-pane";
    pane.setAttribute("aria-label", `${name} settings`);
    pane.append(node);
    side.append(pane);
    panes[name] = pane;
  }
  cleanup.remove();
  editor.prepend(rail);
  const tasks = [
    ["videos", "Videos"], ["audio", "Audio"], ["pauses", "Pauses"],
    ["background", "Background"], ["reframe", "Reframe"], ["captions", "Captions"], ["cut", "Cut", "cut"], ["edits", "Text", "text"], ["edits", "Hide area", "hide"],
    ["export", "Export"]
  ];
  let current = "edits";
  function activate(pane, mode) {
    if (pane === "reframe" && S.job?.has_video) sourcePlayer().pause();
    current = pane;
    side.classList.toggle("is-edit-inspector", pane === "edits");
    side.setAttribute("aria-label", `${pane === "edits" ? "Edit" : pane.charAt(0).toUpperCase() + pane.slice(1)} settings`);
    if (pane === "background") byId("backgroundPanel").open = true;
    if (pane === "pauses" && S.job) renderSilenceReview();
    for (const [name, node] of Object.entries(panes)) node.hidden = name !== pane;
    for (const button of rail.querySelectorAll("button")) {
      const active = button.dataset.pane === pane && (pane !== "edits" || button.dataset.mode === (mode || "select"));
      button.setAttribute("aria-pressed", String(active));
    }
    syncHeading();
    if (S.job) requestAnimationFrame(layoutStage);
  }
  for (const [pane, label, mode] of tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[label]}</svg><span>${label}</span>`;
    button.dataset.pane = pane;
    if (mode) button.dataset.mode = mode;
    button.setAttribute("aria-controls", panes[pane].id);
    button.onclick = () => {
      if (!S.job) return;
      if (S.reviewing && pane !== "export") setReview(false);
      if (mode === "cut") { addCut(); return; }
      if (mode) setMode(mode);
      activate(pane, mode);
    };
    rail.append(button);
  }
  const previewHeading = document.querySelector(".preview-heading");
  previewHeading.append(byId("toolbar"));
  const previewInfo = document.createElement("details");
  previewInfo.className = "preview-info";
  const infoButton = document.createElement("summary");
  infoButton.textContent = "ⓘ";
  infoButton.setAttribute("aria-label", "About the editing preview");
  const infoText = document.createElement("p");
  infoText.textContent = "Use the processed samples in Audio, Background, or Videos to check those effects. Export to review all edits together.";
  previewInfo.append(infoButton, infoText);
  previewHeading.querySelector(".workspace-title").parentElement.append(previewInfo);
  // The timeline spans the preview and inspector instead of competing for preview space.
  editor.append(byId("transport"));
  const actions = document.createElement("div");
  actions.className = "workspace-actions";
  actions.append(byId("undoBtn"), byId("redoBtn"));
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "primary";
  exportButton.textContent = "Export…";
  exportButton.onclick = () => { activate("export"); byId("exportPreset").focus(); };
  actions.append(exportButton);
  actions.classList.add("hidden");
  const topbar = document.querySelector(".topbar");
  const filename = document.createElement("span");
  filename.className = "workspace-filename hidden";
  topbar.insertBefore(filename, byId("newFileBtn"));
  topbar.insertBefore(actions, byId("appMenu"));
  const syncEditor = () => {
    const active = !byId("editorView").classList.contains("hidden");
    actions.classList.toggle("hidden", !active);
    filename.classList.toggle("hidden", !active);
    document.body.classList.toggle("editing", active);
    filename.textContent = S.job?.filename || "";
    filename.title = filename.textContent;
  };
  new MutationObserver(syncEditor).observe(byId("editorView"), {attributes: true, attributeFilter: ["class"]});
  syncEditor();
  const note = document.createElement("p");
  note.className = "workspace-retention small";
  const retention = byId("retentionNote");
  const syncRetention = () => { note.textContent = retention.textContent; };
  new MutationObserver(syncRetention).observe(retention, {childList: true, characterData: true, subtree: true});
  syncRetention();
  side.append(byId("procProgress"), byId("procError"), byId("procReference"), byId("recoverFileBtn"));
  const footer = document.createElement("footer");
  footer.className = "workspace-footer";
  const save = document.createElement("button");
  save.type = "button"; save.className = "ghost"; save.textContent = "Save project…";
  save.onclick = () => byId("saveProjectBtn").click();
  const projectActions = document.createElement("div");
  projectActions.className = "workspace-project-actions";
  const sourceReminder = document.createElement("span");
  sourceReminder.className = "small";
  sourceReminder.textContent = "Keep the original recording";
  projectActions.append(sourceReminder, save);
  footer.append(note, projectActions);
  editor.append(footer);
  const timelineTitle = document.createElement("div");
  timelineTitle.className = "timeline-heading";
  timelineTitle.innerHTML = '<strong>Timeline</strong><span>Original timing</span>';
  byId("transport").prepend(timelineTitle);
  const heading = document.createElement("div");
  heading.className = "inspector-heading"; heading.textContent = "Edit settings";
  side.prepend(heading);
  const labels = {videos: "Videos", cut: "Cut", edits: "Your edits", audio: "Audio", pauses: "Pauses", background: "Background", reframe: "Reframe", captions: "Captions", export: "Export"};
  const syncHeading = () => { heading.textContent = current === "edits" && S.selected != null ? "Edit properties" : labels[current]; };
  window.addEventListener("freeedit:workspace", event => {
    const reason = event.detail;
    if (reason === "videos") activate("videos");
    if (reason === "cut") {
      const length = Math.min(3, duration() / 4);
      const start = Math.min(sourcePlayer().currentTime || 0, Math.max(0, duration() - length));
      byId("cutFrom").value = start.toFixed(2);
      byId("cutTo").value = Math.min(duration(), start + length).toFixed(2);
      byId("cutFrom").max = byId("cutTo").max = String(duration());
      activate("cut"); updateCutDraft(); byId("cutFrom").focus();
    }
    if (reason === "open") activate("edits");
    if (reason === "selection") activate("edits", S.mode);
    if (reason === "zoom-selection") activate("edits", "select");
    if (reason === "reframe-settings") activate("reframe");
    if (reason === "select-tool") {
      // Rebuild from current settings, not the last ordinary text/mask edit.
      renderList();
      activate("edits", "select");
      byId("modeHint").textContent = "Select an edit to adjust it.";

    }
    if (reason === "mode") {
      if (S.mode === "background") activate("background");
      // Select is a preview tool, not a task. Keep the Videos inspector visible
      // while positioning the presenter, and preserve other active inspectors.
      else if (S.mode === "select") activate(current);
      else activate("edits", S.mode);
    }
    if (reason === "export") activate("export");
    if (reason === "open") {
      for (const button of rail.querySelectorAll("button")) {
        const visual = button.dataset.mode === "hide" || button.dataset.mode === "text" || ["background", "videos", "reframe", "captions"].includes(button.dataset.pane);
        button.disabled = visual && !S.job.has_video ||
          ["audio", "pauses"].includes(button.dataset.pane) && !S.job.has_audio;
      }
    }
  });
  function updateCutDraft() {
    const start = byId("cutFrom").valueAsNumber;
    const end = byId("cutTo").valueAsNumber;
    let error = "";
    if (!Number.isFinite(start) || !Number.isFinite(end)) error = "Enter both times.";
    else if (start < 0 || end > duration() + 0.005) error = "Keep both times inside the recording.";
    else if (end <= start) error = "To must be later than From.";
    else if (cutRanges([...S.edits, {type: "cut", start, end}]).reduce((sum, [a, b]) => sum + b - a, 0) >= duration() - 0.05) error = "Keep some of the recording outside your cuts.";
    byId("addCutRangeBtn").disabled = !!error;
    byId("cutDraftStatus").textContent = error || `${fmt(start)}–${fmt(end)} · ${(end - start).toFixed(1)} seconds selected for removal`;
    return !error;
  }
  for (const id of ["cutFrom", "cutTo"]) byId(id).addEventListener("input", updateCutDraft);
  for (const [button, field] of [["cutFromNow", "cutFrom"], ["cutToNow", "cutTo"]]) {
    byId(button).onclick = () => { byId(field).value = sourcePlayer().currentTime.toFixed(2); updateCutDraft(); };
  }
  byId("addCutRangeBtn").onclick = () => {
    if (!updateCutDraft()) return;
    const edit = addEdit({type: "cut", start: byId("cutFrom").valueAsNumber, end: Math.min(duration(), byId("cutTo").valueAsNumber)});
    activate("edits"); select(edit.id);
  };
  activate(current);
})();
