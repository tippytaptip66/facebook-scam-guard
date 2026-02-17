// Background service worker (minimal for now)
chrome.runtime.onInstalled.addListener(() => {
  const defaults = {
    enabled: true,
    blockHighRisk: true,
    sensitivity: "medium" // low | medium | high
  };
  chrome.storage.sync.set(defaults);
});