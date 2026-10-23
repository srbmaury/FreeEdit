"use strict";

const appMenu = document.getElementById("appMenu");
appMenu.querySelectorAll("[data-dialog]").forEach(button => {
  button.onclick = () => {
    appMenu.open = false;
    document.getElementById(button.dataset.dialog).showModal();
  };
});
document.addEventListener("click", event => {
  if (!appMenu.contains(event.target)) appMenu.open = false;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") appMenu.open = false;
});

// Diagnostics are on demand, rather than another permanent editor panel.
document.getElementById("diagnosticsBtn").onclick = async () => {
  appMenu.open = false;
  const dialog = document.getElementById("diagnosticsDialog");
  const results = document.getElementById("diagnosticsResults");
  results.textContent = "Checking media tools, noise reduction, and temporary storage…";
  dialog.showModal();
  try {
    const info = await api("/api/diagnostics");
    results.replaceChildren();
    for (const check of info.checks) {
      const item = document.createElement("p");
      const title = document.createElement("strong");
      title.textContent = `${check.ready ? "✓" : "!"} ${check.name}`;
      const message = document.createElement("span");
      message.textContent = check.message;
      item.className = "diagnostic-check";
      item.append(title, message);
      results.append(item);
    }
  } catch { results.textContent = "Could not check setup. Check that the FreeEdit server is running and try again."; }
};
