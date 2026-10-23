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
