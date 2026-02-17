const enabled = document.getElementById("enabled");
const blockHighRisk = document.getElementById("blockHighRisk");
const sensitivity = document.getElementById("sensitivity");

chrome.storage.sync.get(["enabled", "blockHighRisk", "sensitivity"], (res) => {
  enabled.checked = res.enabled !== undefined ? res.enabled : true;
  blockHighRisk.checked = res.blockHighRisk !== undefined ? res.blockHighRisk : true;
  sensitivity.value = res.sensitivity || "medium";
});

enabled.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabled.checked });
});

blockHighRisk.addEventListener("change", () => {
  chrome.storage.sync.set({ blockHighRisk: blockHighRisk.checked });
});

sensitivity.addEventListener("change", () => {
  chrome.storage.sync.set({ sensitivity: sensitivity.value });
});