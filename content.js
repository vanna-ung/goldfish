// Runs inside claude.ai. Detects sent prompts and renders the depleting
// water bucket. Detection is composer-based (Enter-to-send / send-button
// click) rather than watching for the message bubble to appear, since it
// doesn't depend on knowing the chat container's DOM shape.
//
// TODO (Hour 0 / Phase 1): verify CONFIG selectors against the live
// claude.ai DOM — these are best-guess defaults and are the single biggest
// risk in this plan. Open DevTools, inspect the composer and send button,
// and update the two lines below if the health-check warning fires.
const CONFIG = {
  composerSelector: 'div[contenteditable="true"]',
  sendButtonSelector: 'button[aria-label="Send Message"]',
};

const DEDUPE_WINDOW_MS = 1000;
let lastRecordedAt = 0;

function findComposer() {
  return document.querySelector(CONFIG.composerSelector);
}

function findSendButton() {
  return document.querySelector(CONFIG.sendButtonSelector);
}

function recordPromptIfNotDuped() {
  const now = Date.now();
  if (now - lastRecordedAt < DEDUPE_WINDOW_MS) return;
  lastRecordedAt = now;
  chrome.runtime.sendMessage({ type: "RECORD_PROMPT" }, (state) => {
    if (state) updateBucket(state);
  });
}

function attachSendListeners() {
  const composer = findComposer();
  if (composer && !composer.dataset.waterBound) {
    composer.dataset.waterBound = "true";
    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) recordPromptIfNotDuped();
    });
  }

  const sendButton = findSendButton();
  if (sendButton && !sendButton.dataset.waterBound) {
    sendButton.dataset.waterBound = "true";
    sendButton.addEventListener("click", recordPromptIfNotDuped);
  }
}

// claude.ai is a SPA that re-renders the composer/send button; re-attach
// when the DOM changes, but debounce since streaming responses mutate the
// page constantly and re-querying on every mutation would be wasteful.
let attachScheduled = false;
function scheduleAttach() {
  if (attachScheduled) return;
  attachScheduled = true;
  setTimeout(() => {
    attachScheduled = false;
    attachSendListeners();
  }, 300);
}
new MutationObserver(scheduleAttach).observe(document.body, {
  childList: true,
  subtree: true,
});
attachSendListeners();

setTimeout(() => {
  if (!findComposer()) {
    console.warn(
      "[water] composer not found — CONFIG.composerSelector needs updating for the current claude.ai DOM"
    );
  }
}, 5000);

// ---- Bucket UI ----

const BUCKET_TOP = 20;
const BUCKET_HEIGHT = 120;

function injectBucket() {
  if (document.getElementById("water-tracker-bucket")) return;

  const container = document.createElement("div");
  container.id = "water-tracker-bucket";
  container.innerHTML = `
    <svg viewBox="0 0 100 150" width="70" height="105">
      <defs>
        <clipPath id="water-clip">
          <rect id="water-rect" x="5" y="${BUCKET_TOP}" width="90" height="${BUCKET_HEIGHT}" />
        </clipPath>
      </defs>
      <rect x="5" y="${BUCKET_TOP}" width="90" height="${BUCKET_HEIGHT}" rx="8" fill="none" stroke="#4a90d9" stroke-width="3" />
      <rect id="water-fill" x="5" y="${BUCKET_TOP}" width="90" height="${BUCKET_HEIGHT}" rx="8" fill="#7ec8f2" clip-path="url(#water-clip)" style="transition: y 600ms ease, height 600ms ease;" />
    </svg>
    <div id="water-readout" style="font: 12px system-ui, sans-serif; text-align: center; color: #2a5f8f;"></div>
  `;
  Object.assign(container.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: 999999,
    background: "rgba(255,255,255,0.9)",
    borderRadius: "12px",
    padding: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  });
  document.body.appendChild(container);
}

function updateBucket(state) {
  injectBucket();
  const waterFill = document.getElementById("water-fill");
  const readout = document.getElementById("water-readout");
  if (!waterFill || !readout) return;

  const fraction = Math.max(0, Math.min(1, state.fraction));
  const filledHeight = BUCKET_HEIGHT * fraction;
  waterFill.setAttribute("y", BUCKET_TOP + (BUCKET_HEIGHT - filledHeight));
  waterFill.setAttribute("height", filledHeight);

  readout.textContent = state.capped
    ? "Bucket empty — earn another prompt"
    : `${state.remaining}/${state.cap} prompts left today`;
}

function requestState() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (state) updateBucket(state);
  });
}

injectBucket();
requestState();

// Stay in sync if another tab (or the popup) changes the count.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") requestState();
});

console.log("[water] injected");
