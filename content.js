// Runs inside claude.ai. Detects sent prompts, previews their cost before
// send, and renders the depleting water bucket.
//
// TODO (Hour 0 / Phase 1): verify CONFIG selectors against the live
// claude.ai DOM — these are best-guess defaults and are the single biggest
// risk in this plan. Open DevTools, inspect the composer and send button,
// and update the two lines below if the health-check warning fires.
const CONFIG = {
  composerSelector: 'div[contenteditable="true"]',
  sendButtonSelector: 'button[aria-label="Send Message"]',
};

const BUCKET_TOP = 20;
const BUCKET_HEIGHT = 120;

// Side comments bank (from the brainstorm doc), tiered by how much of the
// daily budget the prompt currently being typed would burn on its own.
const SASS_TIERS = [
  { minFraction: 0.2, text: "At this point just move to the ocean" },
  { minFraction: 0.1, text: "Wivenhoe is watching" },
  { minFraction: 0.05, text: "congratulations, you're irrigation" },
  { minFraction: 0.02, text: "hope that one was worth it" },
];

function sassForFraction(fraction) {
  if (fraction == null) return null;
  for (const tier of SASS_TIERS) {
    if (fraction >= tier.minFraction) return tier.text;
  }
  return null;
}

// Last state we got back from the backend, cached only for rendering the
// ghost preview relative to the real level — not relied on for anything
// that needs to survive a reload (that's what chrome.storage is for).
let currentState = null;

// ---- Bucket UI ----

function injectBucket() {
  if (document.getElementById("water-tracker-bucket")) return;

  const container = document.createElement("div");
  container.id = "water-tracker-bucket";
  container.innerHTML = `
    <svg viewBox="0 0 100 150" width="70" height="105">
      <defs>
        <clipPath id="water-clip">
          <rect x="5" y="${BUCKET_TOP}" width="90" height="${BUCKET_HEIGHT}" />
        </clipPath>
      </defs>
      <rect x="5" y="${BUCKET_TOP}" width="90" height="${BUCKET_HEIGHT}" rx="8" fill="none" stroke="#4a90d9" stroke-width="3" />
      <rect id="water-fill" x="5" y="${BUCKET_TOP}" width="90" height="${BUCKET_HEIGHT}" rx="8" fill="#4a90d9" clip-path="url(#water-clip)" style="transition: y 600ms ease, height 600ms ease;" />
      <rect id="water-ghost" x="5" y="${BUCKET_TOP}" width="90" height="0" fill="#a8d8f7" clip-path="url(#water-clip)" style="transition: y 150ms ease, height 150ms ease;" />
    </svg>
    <div id="water-readout" style="font: 12px system-ui, sans-serif; text-align: center; color: #2a5f8f;"></div>
  `;
  Object.assign(container.style, {
    position: "fixed",
    // top-right, next to the incognito/ghost icon — nudge `right` if it
    // ends up overlapping the real icon once checked against the live page
    top: "16px",
    right: "64px",
    zIndex: 999999,
    background: "rgba(255,255,255,0.9)",
    borderRadius: "12px",
    padding: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  });
  document.body.appendChild(container);
}

function updateBucket(state) {
  currentState = state;
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
    : `${Math.round(state.remaining)} mL left today`;

  // A fresh real state supersedes any pending preview.
  updateGhost(null);
  updateSass(null, null);
}

// Renders the sliver of water that would drain if the prompt currently
// being typed were sent right now — a lighter blue sitting on top of the
// current (darker) fill, spanning from the real water line down to the
// projected line after send. What's left underneath stays the current blue.
function updateGhost(preview) {
  const ghost = document.getElementById("water-ghost");
  if (!ghost) return;

  if (!preview || !currentState || preview.cost <= 0) {
    ghost.setAttribute("height", 0);
    return;
  }

  const currentFilled = BUCKET_HEIGHT * Math.max(0, Math.min(1, currentState.fraction));
  const projectedFilled = BUCKET_HEIGHT * Math.max(0, Math.min(1, preview.projectedFraction));
  const sliverHeight = Math.max(currentFilled - projectedFilled, 0);
  const sliverTop = BUCKET_TOP + (BUCKET_HEIGHT - currentFilled);

  ghost.setAttribute("y", sliverTop);
  ghost.setAttribute("height", sliverHeight);
}

function injectSass() {
  if (document.getElementById("water-sass")) return;
  const el = document.createElement("div");
  el.id = "water-sass";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: 999999,
    background: "#2a5f8f",
    color: "#fff",
    font: "12px system-ui, sans-serif",
    padding: "6px 10px",
    borderRadius: "8px",
    maxWidth: "280px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    display: "none",
  });
  document.body.appendChild(el);
}

// Anchored to the top-left corner of the composer, recomputed each time
// since the composer can move (e.g. window resize).
function updateSass(fraction, composerRect) {
  injectSass();
  const el = document.getElementById("water-sass");
  if (!el) return;

  const text = sassForFraction(fraction);
  if (!text || !composerRect) {
    el.style.display = "none";
    return;
  }

  el.textContent = text;
  el.style.display = "block";
  el.style.left = `${composerRect.left}px`;
  el.style.top = `${composerRect.top - el.offsetHeight - 10}px`;
}

function requestState() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state) updateBucket(state);
  });
}

// Bucket goes up first and unconditionally, before any detection wiring
// below — so a selector problem in Phase 1 can never hide the bucket too.
injectBucket();
requestState();

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") requestState();
});

// ---- Detection + live preview ----
//
// Delegated on `document` rather than bound to a queried composer element:
// claude.ai is a SPA that swaps the composer/send button in and out, which
// silently orphans directly-bound listeners. Delegation survives that for
// free, and also survives picking up the wrong one of several matching
// elements (a hidden/duplicate contenteditable, for example).

function findComposer() {
  const candidates = document.querySelectorAll(CONFIG.composerSelector);
  for (const el of candidates) {
    if (el.offsetParent !== null) return el; // prefer a visible match
  }
  return candidates[0] || null;
}

function composerCharCount(composer) {
  return composer ? (composer.innerText || "").length : 0;
}

const DEDUPE_WINDOW_MS = 1000;
let lastRecordedAt = 0;

function recordPromptIfNotDuped() {
  const now = Date.now();
  if (now - lastRecordedAt < DEDUPE_WINDOW_MS) return;
  lastRecordedAt = now;
  const charCount = composerCharCount(findComposer());
  chrome.runtime.sendMessage({ type: "RECORD_PROMPT", charCount }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state) updateBucket(state);
  });
}

let previewScheduled = false;
function schedulePreview() {
  if (previewScheduled) return;
  previewScheduled = true;
  setTimeout(() => {
    previewScheduled = false;
    const composer = findComposer();
    const charCount = composerCharCount(composer);
    if (charCount === 0) {
      updateGhost(null);
      updateSass(null, null);
      return;
    }
    chrome.runtime.sendMessage({ type: "PREVIEW_COST", charCount }, (preview) => {
      if (chrome.runtime.lastError || !preview) return;
      updateGhost(preview);
      const capacityMl = currentState ? currentState.capacityMl : null;
      const fraction = capacityMl ? preview.cost / capacityMl : null;
      updateSass(fraction, composer.getBoundingClientRect());
    });
  }, 150);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (!e.target.closest(CONFIG.composerSelector)) return;
  recordPromptIfNotDuped();
});

document.addEventListener("input", (e) => {
  if (!e.target.closest(CONFIG.composerSelector)) return;
  schedulePreview();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(CONFIG.sendButtonSelector)) return;
  recordPromptIfNotDuped();
});

setTimeout(() => {
  if (!findComposer()) {
    console.warn(
      "[water] composer not found — CONFIG.composerSelector needs updating for the current claude.ai DOM"
    );
  }
}, 5000);

console.log("[water] injected");
