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
  const panes = {};
  for (const [name, node] of [["edits", edits], ["audio", noise], ["pauses", pauses], ["background", byId("backgroundPanel")], ["export", exportPanel]]) {
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
    ["edits", "Select", "select"], ["audio", "Audio"], ["pauses", "Pauses"],
    ["background", "Background"], ["edits", "Cut", "cut"], ["edits", "Text", "text"], ["edits", "Hide area", "hide"],
    ["export", "Export"]
  ];
  let current = "edits";
  function activate(pane, mode) {
    current = pane;
    if (pane === "background") byId("backgroundPanel").open = true;
    for (const [name, node] of Object.entries(panes)) node.hidden = name !== pane;
    for (const button of rail.querySelectorAll("button")) {
      const active = button.dataset.pane === pane && (pane !== "edits" || button.dataset.mode === (mode || "select"));
      button.setAttribute("aria-pressed", String(active));
    }
    if (S.job) requestAnimationFrame(layoutStage);
  }
  for (const [pane, label, mode] of tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
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
  document.querySelector(".preview-actions").append(actions);
  const note = document.createElement("p");
  note.className = "workspace-retention small";
  const retention = byId("retentionNote");
  const syncRetention = () => { note.textContent = retention.textContent; };
  new MutationObserver(syncRetention).observe(retention, {childList: true, characterData: true, subtree: true});
  syncRetention();
  side.append(byId("procProgress"), byId("procError"), byId("procReference"), byId("recoverFileBtn"), note);
  window.addEventListener("freeedit:workspace", event => {
    const reason = event.detail;
    if (reason === "open") activate("edits");
    if (reason === "selection") activate("edits", S.mode);
    if (reason === "mode") {
      if (S.mode === "background" || current === "background" && S.mode === "select") activate("background");
      else activate("edits", S.mode);
    }
    if (reason === "export") activate("export");
    if (reason === "open") {
      for (const button of rail.querySelectorAll("button")) {
        const visual = button.dataset.mode === "hide" || button.dataset.mode === "text" || button.dataset.pane === "background";
        button.disabled = visual && !S.job.has_video ||
          ["audio", "pauses"].includes(button.dataset.pane) && !S.job.has_audio;
      }
    }
  });
  activate(current);
})();
