"use strict";

(() => {
  const key = "freeedit.appearance";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const choices = ["system", "light", "dark"];
  let preference = "system";
  try {
    const saved = localStorage.getItem(key);
    if (choices.includes(saved)) preference = saved;
  } catch { /* Appearance still works when browser storage is unavailable. */ }

  function apply() {
    const theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const picker = document.getElementById("appearanceSelect");
    if (picker) picker.value = preference;
    window.dispatchEvent(new Event("freeedit:themechange"));
  }

  apply();
  document.addEventListener("DOMContentLoaded", () => {
    const picker = document.getElementById("appearanceSelect");
    picker.value = preference;
    picker.addEventListener("change", () => {
      preference = picker.value;
      try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this session. */ }
      apply();
    });
  });
  system.addEventListener("change", () => { if (preference === "system") apply(); });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    preference = choices.includes(event.newValue) ? event.newValue : "system";
    apply();
  });
})();
