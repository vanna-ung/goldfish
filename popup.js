const toggle = document.getElementById("enabled-toggle");
const status = document.getElementById("status");

function renderStatus(enabled) {
  status.textContent = enabled ? "On" : "Off";
}

chrome.storage.sync.get("enabled", ({ enabled }) => {
  const isEnabled = enabled ?? true; // on by default
  toggle.checked = isEnabled;
  renderStatus(isEnabled);
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
  renderStatus(toggle.checked);
});

console.log("[water] popup opened");
