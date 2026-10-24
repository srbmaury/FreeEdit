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
