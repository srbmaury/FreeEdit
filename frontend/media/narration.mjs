import {requestJson} from "../shared/api-client.mjs";

const byId = id => document.getElementById(id);
const dialog = byId("narrationDialog");
const form = byId("narrationForm");
const generate = byId("generateNarrationBtn");
const status = byId("narrationStatus");
const player = byId("narrationAudio");
let audioUrl;
let available = false;
let generating = false;

async function checkSetup() {
  generate.disabled = true;
  try {
    const setup = await requestJson("/api/tts");
    available = setup.available;
    byId("narrationText").maxLength = setup.max_chars;
    status.textContent = available ? "" : "Local narration needs setup. Run ./scripts/setup-tts.sh on the FreeEdit server.";
  } catch {
    available = false;
    status.textContent = "Could not check local narration. Reopen this panel to retry.";
  }
  generate.disabled = !available || generating;
}

byId("openNarrationBtn").addEventListener("click", () => {
  dialog.showModal();
  checkSetup();
});
document.querySelector('[data-dialog="narrationDialog"]').addEventListener("click", checkSetup);
dialog.addEventListener("close", () => player.pause());

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!available || generating) return;
  generating = true;
  generate.disabled = true;
  player.pause();
  status.textContent = "Generating narration on this machine…";
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        text: byId("narrationText").value,
        voice: byId("narrationVoice").value,
        speed: byId("narrationSpeed").valueAsNumber,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.detail || "Could not generate narration.");
    }
    const wav = await response.blob();
    if (wav.type !== "audio/wav" || !wav.size) throw new Error("No playable audio was returned.");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(wav);
    player.src = audioUrl;
    byId("downloadNarration").href = audioUrl;
    byId("narrationResult").classList.remove("hidden");
    status.textContent = "Narration ready.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    generating = false;
    generate.disabled = !available;
  }
});
