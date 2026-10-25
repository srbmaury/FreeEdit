"use strict";

const appMenu = document.getElementById("appMenu");
// Inline icons remain available offline and follow the selected theme.
const menuIconPaths = [
  '<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  '<path d="M3 8V4h6l2 3h10v4M3 8h18l-3 12H3Z"/>',
  '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  '<path d="M4 8h16l2 11H2ZM4 8l3-5h10l3 5"/><path d="M6 15h2m8 0h2"/>',
  '<path d="m4 13 5 5L20 6"/>',
  '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  '<path d="m8 5-7 7 7 7m8-14 7 7-7 7m-2-16-4 20"/>',
  '<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/><path d="M8 10h8m-8 4h5"/>'
];
appMenu.querySelectorAll("nav button, nav a").forEach((item, index) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = menuIconPaths[index];
  item.prepend(svg);
});
appMenu.querySelector("nav").addEventListener("keydown", event => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.target.tagName === "SELECT") return;
  const items = [...appMenu.querySelectorAll("nav button:not(:disabled), nav a, nav select")];
  const index = items.indexOf(document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  event.preventDefault(); items[next].focus();
});
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
  if (event.key === "Escape" && appMenu.open) {
    appMenu.open = false;
    appMenu.querySelector("summary").focus();
  }
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

const storageUsage = document.getElementById("storageUsage");
const cleanupButton = document.getElementById("cleanupStorageBtn");
const formatBytes = bytes => bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`;
async function refreshStorage() {
  storageUsage.textContent = "Checking temporary storage…";
  cleanupButton.disabled = true;
  try {
    const info = await api(`/api/storage?keep=${encodeURIComponent(S.job?.id || "")}`);
    storageUsage.textContent = `${formatBytes(info.used_bytes)} in ${info.files} temporary recording${info.files === 1 ? "" : "s"} · ${formatBytes(info.free_bytes)} disk space available. ${formatBytes(info.reclaimable_bytes)} available for cleanup.`;
    cleanupButton.disabled = !info.reclaimable_bytes;
  } catch (error) { storageUsage.textContent = error.message; }
}
appMenu.querySelector('[data-dialog="storageDialog"]').addEventListener("click", refreshStorage);
cleanupButton.onclick = async () => {
  if (!confirm("Delete other inactive recordings and exports on this server? Your open recording and active processing will be kept. This cannot be undone.")) return;
  cleanupButton.disabled = true;
  try {
    const info = await api(`/api/storage/cleanup?keep=${encodeURIComponent(S.job?.id || "")}`, {method: "POST"});
    await refreshStorage();
    storageUsage.textContent = `Freed ${formatBytes(info.removed_bytes)}. ${storageUsage.textContent}`;
  } catch (error) { storageUsage.textContent = error.message; cleanupButton.disabled = false; }
};

// Native dialogs trap focus; explicitly restore the triggering control on close.
for (const dialog of document.querySelectorAll("dialog")) {
  let returnFocus = null;
  // Capture before showModal moves focus into the dialog.
  const showModal = dialog.showModal.bind(dialog);
  dialog.showModal = () => { returnFocus = document.activeElement; showModal(); };
  dialog.addEventListener("close", () => {
    if (returnFocus?.isConnected && !returnFocus.closest(".hidden")) {
      const menu = returnFocus.closest("details");
      (menu && !menu.open ? menu.querySelector("summary") : returnFocus).focus();
    }
    returnFocus = null;
  });
}
