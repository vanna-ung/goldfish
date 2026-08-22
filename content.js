// Runs inside claude.ai. Detects sent prompts, renders the fishbowl, and
// drives the length-based sass comment + fish art while the user types.
//
// Verified against the live claude.ai DOM (2026-08-21). Both are
// data-testid attributes rather than aria-label text, which is more
// resilient to copy/label changes than the guessed selectors this started
// with — the previous aria-label guess ("Send Message") didn't match the
// real one ("Send message", lowercase m), which is why sends weren't
// being counted.
const CONFIG = {
  composerSelector: '[data-testid="chat-input"]',
  sendButtonSelector: '[data-testid="chat-input-send"]',
};

// ---- Two independent systems ----
//
// 1. Send cap (count-based): how many prompts are left today. Drives the
//    fishbowl's 4 discrete stages. Backed by the daily count in storage.
// 2. Typing-length phase: purely a function of the CURRENT composer text
//    length. Drives the sass comment + fish art placeholder. Entirely
//    client-side — no backend round-trip, since it never persists.

// The fishbowl is purely a "prompts remaining" gauge — one drawing per
// remaining count. It never looks at what's being typed; that's the
// fish-reaction's job below. Real art: assets/fishbowl/0.PNG..10.PNG, one
// per exact remaining count (not scaled to the cap — if the cap is ever
// raised past 10 in settings, remaining is clamped to the 0-10 art range).
const FISHBOWL_MAX_INDEX = 10;

function fishbowlImageUrl(remaining) {
  const index = Math.max(0, Math.min(FISHBOWL_MAX_INDEX, Math.round(remaining)));
  return chrome.runtime.getURL(`assets/fishbowl/${index}.PNG`);
}

// Phase boundaries are intentionally short (100 chars/phase) for demo
// purposes, not tuned to real prompt-length distributions.
const PHASE_BOUNDS = [100, 200, 300, 400, 500];

// Verified live: an uploaded file (or a paste large enough that claude.ai
// converts it into a "PASTED" card) renders as a chip OUTSIDE the
// composer's contenteditable — composer.innerText doesn't grow at all
// when a file is attached, so without this, attaching a 50k-character PDF
// registers as phase 1. Each attachment gets a flat weight added to the
// effective length instead of trying to read the file's actual size.
// 500 chars = an instant phase-5 hit, matching "lecture slides are huge."
const ATTACHMENT_SELECTOR = '[data-testid="file-thumbnail"]';
const ATTACHMENT_LENGTH_WEIGHT = 500;

function attachmentCount() {
  return document.querySelectorAll(ATTACHMENT_SELECTOR).length;
}

function effectiveTypingLength(composer) {
  return composerCharCount(composer) + attachmentCount() * ATTACHMENT_LENGTH_WEIGHT;
}

function phaseForLength(len) {
  // No "hidden" state — an empty composer (len 0) is phase 1, the default
  // resting state, not something to hide until the user starts typing.
  for (let i = 0; i < PHASE_BOUNDS.length; i++) {
    if (len <= PHASE_BOUNDS[i]) return i + 1;
  }
  return PHASE_BOUNDS.length; // clamp anything past 500 to phase 5
}

// Placeholder copy — swap for real lines whenever. Two per phase; one is
// picked at random each time the user crosses INTO that phase (not on
// every keystroke, so it doesn't flicker while typing).
const SASS_PHASES = {
  1: ["still thinking that through yourself?", "not bad, short and sweet"],
  2: ["getting wordy over there", "hope that's necessary"],
  3: ["congratulations, you're irrigation", "hope that one was worth it"],
  4: ["Wivenhoe is watching", "that's a lot of water for one thought"],
  5: ["at this point just move to the ocean", "this bowl doesn't stand a chance"],
};

// Fish-out-of-water reaction, keyed by typing-length phase — gets more
// flabbergasted the longer the pending prompt is. This is the ONLY thing
// that reads prompt size; the fishbowl above never does. Placeholder is a
// color + escalating emoji; swap renderFishPlaceholder()'s body for an
// <img src="assets/fish-reaction/phase-N.png"> once the pixel art lands.
const REACTION_PHASE_COLORS = {
  1: "#bfe4fb",
  2: "#8fd0f5",
  3: "#f5d98f",
  4: "#f2a97e",
  5: "#e8734a",
};
const REACTION_PHASE_EMOJI = {
  1: "🐟",
  2: "😯🐟",
  3: "😮🐟",
  4: "😱🐟",
  5: "🫨🐟",
};

let currentState = null; // last real state from the backend (bucket)
let lastPhase = 0; // last typing-length phase rendered (fish + sass)
let lastComment = "";

// On/off toggle from the popup, persisted so it survives across tabs/reloads.
let extensionEnabled = true;

// ---- Fishbowl ----

function injectBucket() {
  if (document.getElementById("water-tracker-bucket")) return;

  const container = document.createElement("div");
  container.id = "water-tracker-bucket";
  container.innerHTML = `
    <img id="water-fill-img" width="130" height="130" style="display: block;" alt="fishbowl" />
    <div id="water-readout" style="font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: center; color: #2a5f8f;"></div>
  `;
  Object.assign(container.style, {
    position: "fixed",
    // top/left set live by positionBucket() — see below
    zIndex: 50,
    background: "#fcfcfb",
    borderRadius: "12px",
    padding: "8px",
  });
  document.body.appendChild(container);
}

// Verified live: the "Share" button's data-testid only exists on an
// established chat (never found on /new, since there's nothing to share
// yet) — falls back to a fixed top offset there instead.
const SHARE_BUTTON_SELECTOR = '[data-testid="wiggle-controls-actions-share"]';

function positionBucket() {
  const container = document.getElementById("water-tracker-bucket");
  const composer = findComposer();
  if (!container || !composer) return;
  const composerRect = anchorRectFor(composer);
  if (!composerRect) return;

  const shareButton = document.querySelector(SHARE_BUTTON_SELECTOR);
  const top = shareButton ? shareButton.getBoundingClientRect().bottom + 12 : 16;

  // Centered in the leftover horizontal space to the right of the
  // composer — same formula as positionFish() below.
  const gapCenter = (composerRect.right + window.innerWidth) / 2;
  const width = container.offsetWidth || 130;

  container.style.top = `${top}px`;
  container.style.left = `${gapCenter - width / 2}px`;
}

let bucketPositionLoopActive = false;
function bucketPositionLoop() {
  if (!bucketPositionLoopActive) return;
  positionBucket();
  requestAnimationFrame(bucketPositionLoop);
}
function startBucketPositionLoop() {
  if (bucketPositionLoopActive) return;
  bucketPositionLoopActive = true;
  requestAnimationFrame(bucketPositionLoop);
}
function stopBucketPositionLoop() {
  bucketPositionLoopActive = false;
}

function renderFishbowlStage(remaining) {
  const img = document.getElementById("water-fill-img");
  if (!img) return;
  const url = fishbowlImageUrl(remaining);
  if (img.src !== url) img.src = url; // avoid re-triggering a load on every call
}

function updateBucket(state) {
  currentState = state;
  injectBucket();
  const readout = document.getElementById("water-readout");
  if (!readout) return;

  renderFishbowlStage(state.remaining);
  readout.innerHTML = state.capped
    ? "Bucket empty — earn another prompt"
    : `<strong>${state.remaining}</strong> prompt${state.remaining === 1 ? "" : "s"} left`;

  // A real send clears the composer — re-enter phase 1 for the next
  // prompt rather than hiding, since phase 1 is the resting state now.
  const composer = findComposer();
  updatePhaseUI(effectiveTypingLength(composer), composer);
}

// ---- Fish placeholder + sass comment (typing-length phase) ----

function injectFish() {
  if (document.getElementById("water-fish")) return;
  const el = document.createElement("div");
  el.id = "water-fish";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: 50,
    minWidth: "36px",
    height: "36px",
    padding: "0 6px",
    borderRadius: "8px",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    font: "16px system-ui, sans-serif",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(el);
}

function renderFishPlaceholder(phase) {
  const el = document.getElementById("water-fish");
  if (!el) return;
  el.style.background = REACTION_PHASE_COLORS[phase] || REACTION_PHASE_COLORS[1];
  el.textContent = REACTION_PHASE_EMOJI[phase] || REACTION_PHASE_EMOJI[1];
}

function injectSass() {
  if (document.getElementById("water-sass")) return;
  const el = document.createElement("div");
  el.id = "water-sass";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: 50,
    background: "#d97757",
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    padding: "6px 10px",
    borderRadius: "8px",
    maxWidth: "280px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    display: "none",
  });
  document.body.appendChild(el);
}

function positionFish(composerRect) {
  const el = document.getElementById("water-fish");
  if (!el || !composerRect) return;
  // Centered in the leftover horizontal space to the right of the
  // composer, not just offset from its edge.
  const gapCenter = (composerRect.right + window.innerWidth) / 2;
  const fishWidth = el.offsetWidth || 36;
  el.style.left = `${gapCenter - fishWidth / 2}px`;
  el.style.top = `${composerRect.top + 8}px`;
}

function positionSass(composerRect) {
  const el = document.getElementById("water-sass");
  if (!el || !composerRect) return;
  el.style.left = `${composerRect.left}px`;
  // Straddles the box's top edge — half outside, half inside — rather than
  // floating fully above it. Since composerRect.top is recomputed live off
  // the stable anchor every frame (see positionLoop), this alone also
  // covers the box shrinking back to its default height when a big prompt
  // gets deleted: the comment rides the top edge down with it, no separate
  // handling needed for that case.
  el.style.top = `${composerRect.top - el.offsetHeight / 2}px`;
}

// The composer's own contenteditable node grows unbounded and sits inside
// an ancestor that's capped (max-height + overflow-y: auto for the text
// row itself). Once typed content exceeds that cap, the ancestor scrolls
// internally to keep the caret visible — which shifts the COMPOSER's own
// getBoundingClientRect() upward, sometimes far off screen, even though
// the visible box on screen hasn't moved. Verified live on claude.ai: the
// text row wrapper (max-h-96) is a false anchor for this reason, and it
// also sits BELOW any "PASTED" attachment chips that appear above it for
// large pastes — anchoring there puts the comment mid-box, overlapping the
// chips, instead of above the whole thing.
//
// The actually-stable element is the outer bordered/backgrounded box the
// user thinks of as "the prompt box" — found by walking up for the nearest
// ancestor with a real (non-transparent) background color, which reliably
// picks up that outer container in both the plain-typing and paste-chip
// cases, and stops growing once the text row hits its own cap.
function findStableAnchor(composer) {
  let el = composer && composer.parentElement;
  for (let i = 0; i < 10 && el; i++) {
    const bg = window.getComputedStyle(el).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return el;
    }
    el = el.parentElement;
  }
  return composer;
}

function anchorRectFor(composer) {
  if (!composer) return null;
  return findStableAnchor(composer).getBoundingClientRect();
}

// Keeps the fish/comment glued to the composer every frame while either is
// visible, instead of only repositioning on the next debounced keystroke.
// Covers the post-send layout shift (composer jumps to the bottom of the
// screen), window resizes, and the composer growing taller as text wraps —
// all of which otherwise show up as a laggy "catches up eventually."
let positionLoopActive = false;
function positionLoop() {
  if (!positionLoopActive) return;
  const composer = findComposer();
  const rect = anchorRectFor(composer);
  if (rect) {
    positionFish(rect);
    positionSass(rect);
  }
  requestAnimationFrame(positionLoop);
}
function startPositionLoop() {
  if (positionLoopActive) return;
  positionLoopActive = true;
  requestAnimationFrame(positionLoop);
}
function stopPositionLoop() {
  positionLoopActive = false;
}

// Only used when there's truly no composer to anchor to (e.g. right at
// script injection, before the page has hydrated) — otherwise the default
// resting state is phase 1, not hidden. See phaseForLength().
function hidePhaseUI() {
  lastPhase = 0;
  lastComment = "";
  stopPositionLoop();
  const fish = document.getElementById("water-fish");
  const sass = document.getElementById("water-sass");
  if (fish) fish.style.display = "none";
  if (sass) sass.style.display = "none";
}

function updatePhaseUI(len, composer) {
  injectFish();
  injectSass();

  if (!composer) {
    hidePhaseUI();
    return;
  }

  const phase = phaseForLength(len);
  if (phase !== lastPhase) {
    lastPhase = phase;
    const options = SASS_PHASES[phase] || [];
    lastComment = options[Math.floor(Math.random() * options.length)] || "";
    renderFishPlaceholder(phase);
  }

  const fish = document.getElementById("water-fish");
  const sass = document.getElementById("water-sass");
  if (fish) fish.style.display = "flex";
  if (sass && lastComment) {
    sass.textContent = lastComment;
    sass.style.fontSize = composer ? window.getComputedStyle(composer).fontSize : "16px";
    sass.style.display = "block";
  }
  const rect = anchorRectFor(composer);
  positionFish(rect);
  positionSass(rect);
  startPositionLoop();
}

function requestState() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state) updateBucket(state);
  });
}

// Bucket goes up first and unconditionally (once enabled), before any
// detection wiring below — so a selector problem in Phase 1 can never hide
// the bucket too.
function bootUp() {
  injectBucket();
  startBucketPositionLoop();
  requestState();
  // Phase 1 (comment + fish) shows immediately on load, before any typing —
  // not gated behind the user's first keystroke. If the composer isn't
  // hydrated yet, updatePhaseUI's !composer branch hides it for now; the
  // MutationObserver fallback below picks it back up on the next DOM change.
  updatePhaseUI(effectiveTypingLength(findComposer()), findComposer());
}

// Fully removes everything from the DOM (not just hidden) and stops the
// position loops — the "off" state should leave nothing running or visible.
function teardownAll() {
  stopPositionLoop();
  stopBucketPositionLoop();
  lastPhase = 0;
  lastComment = "";
  const bucket = document.getElementById("water-tracker-bucket");
  const fish = document.getElementById("water-fish");
  const sass = document.getElementById("water-sass");
  if (bucket) bucket.remove();
  if (fish) fish.remove();
  if (sass) sass.remove();
}

chrome.storage.sync.get("enabled", ({ enabled }) => {
  extensionEnabled = enabled ?? true; // on by default
  if (extensionEnabled) bootUp();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && extensionEnabled) requestState();
  if (area === "sync" && changes.enabled) {
    extensionEnabled = changes.enabled.newValue ?? true;
    if (extensionEnabled) bootUp();
    else teardownAll();
  }
});

// ---- Detection ----
//
// Delegated on `document` rather than bound to a queried composer element:
// claude.ai is a SPA that swaps the composer/send button in and out, which
// silently orphans directly-bound listeners. Delegation survives that for
// free, and also survives picking up the wrong one of several matching
// elements (a hidden/duplicate contenteditable, for example).

function findComposer() {
  // Prefer whatever's actually focused — the most reliable signal when more
  // than one element matches the selector (a hidden search box, a mention
  // field, etc. can otherwise get picked over the real composer).
  const active = document.activeElement;
  if (active && active.matches && active.matches(CONFIG.composerSelector)) {
    return active;
  }
  const candidates = document.querySelectorAll(CONFIG.composerSelector);
  for (const el of candidates) {
    if (el.offsetParent !== null) return el; // prefer a visible match
  }
  return candidates[0] || null;
}

function composerCharCount(composer) {
  // Trimmed: ProseMirror-style editors (this one included — it's a tiptap
  // instance) can report a length of 1 even when visually empty, a
  // trailing phantom newline. Without trimming, that reads as "phase 1"
  // forever and the comment/fish never hide.
  return composer ? (composer.innerText || "").trim().length : 0;
}

const DEDUPE_WINDOW_MS = 1000;
let lastRecordedAt = 0;

function recordPromptIfNotDuped() {
  const now = Date.now();
  if (now - lastRecordedAt < DEDUPE_WINDOW_MS) return;
  lastRecordedAt = now;
  chrome.runtime.sendMessage({ type: "RECORD_PROMPT" }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state) updateBucket(state);
  });
}

// Takes the composer element explicitly rather than re-querying the DOM —
// re-querying was the bug: if more than one element matches
// CONFIG.composerSelector (a hidden search box, a mention field, etc.),
// an independent lookup can silently land on the wrong one while the user
// types into the real composer. The element the input event actually fired
// on is unambiguous, so use that.
let previewScheduled = false;
let pendingComposer = null;
function schedulePreview(composer) {
  pendingComposer = composer;
  if (previewScheduled) return;
  previewScheduled = true;
  setTimeout(() => {
    previewScheduled = false;
    const len = effectiveTypingLength(pendingComposer);
    updatePhaseUI(len, pendingComposer);
  }, 150);
}

document.addEventListener("keydown", (e) => {
  if (!extensionEnabled) return;
  if (e.key !== "Enter" || e.shiftKey) return;
  if (!e.target.closest(CONFIG.composerSelector)) return;
  recordPromptIfNotDuped();
});

document.addEventListener("input", (e) => {
  if (!extensionEnabled) return;
  const composer = e.target.closest(CONFIG.composerSelector);
  if (!composer) return;
  schedulePreview(composer);
});

document.addEventListener("click", (e) => {
  if (!extensionEnabled) return;
  if (!e.target.closest(CONFIG.sendButtonSelector)) return;
  recordPromptIfNotDuped();
});

// Catch-all for content changes that don't fire a native `input` event —
// some rich-text editors rebuild the DOM on paste without dispatching one,
// which is why a pasted wall of text wasn't triggering anything above.
// Scoped to document.body since we don't know the chat container's exact
// shape, so debounce + dedupe by length to stay cheap even while Claude's
// own responses are streaming and mutating the page constantly.
let lastObservedLen = -1;
let mutationScheduled = false;
new MutationObserver(() => {
  if (mutationScheduled) return;
  mutationScheduled = true;
  setTimeout(() => {
    mutationScheduled = false;
    if (!extensionEnabled) return;
    const composer = findComposer();
    const len = effectiveTypingLength(composer);
    if (len === lastObservedLen) return;
    lastObservedLen = len;
    updatePhaseUI(len, composer);
  }, 200);
}).observe(document.body, { childList: true, subtree: true, characterData: true });

setTimeout(() => {
  if (extensionEnabled && !findComposer()) {
    console.warn(
      "[water] composer not found — CONFIG.composerSelector needs updating for the current claude.ai DOM"
    );
  }
}, 5000);

console.log("[water] injected");
