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

// The fishbowl widget (placeholder + "X prompts left" line) is purely a
// "prompts remaining" gauge — never looks at what's being typed, that's
// the fish-reaction's job below. Real fishbowl art was pulled while it's
// being redesigned — plain placeholder box until new art lands.

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
  2: ["getting wordy over there", "hope that's necessary", "Enough to make a thirst trap"],
  3: ["congratulations, you're irrigation", "hope that one was worth it", "Chat, this is a lot of water"],
  4: ["Wivenhoe is watching", "that's a lot of water for one thought", "Touch grass. It's well watered now"],
  5: ["at this point just move to the ocean", "this bowl doesn't stand a chance", "Aura: evaporated"],
};

// Fish-out-of-water reaction, keyed by typing-length phase — gets more
// flabbergasted the longer the pending prompt is. This is the ONLY thing
// that reads prompt size; the fishbowl never does.
//
// Key 0 is the empty-composer resting state (distinct from phase 1, which
// starts as soon as the user types anything).
const REACTION_PHASE_IMAGE_FILES = {
  0: "reaction1.PNG",
  1: "reaction2.PNG",
  2: "reaction2.PNG",
  3: "reaction2.PNG",
  4: "reaction3.png",
  5: "reaction3.png",
};

function reactionAssetUrl(file) {
  return chrome.runtime.getURL(`assets/fish/${file}`);
}

// Separate from phaseForLength() (which drives the sass comment and never
// returns 0) so the empty-composer state can have its own reaction art
// without disturbing sass's phase-1-is-the-resting-state behavior.
function reactionPhaseForLength(len) {
  return len === 0 ? 0 : phaseForLength(len);
}

let currentState = null; // last real state from the backend (bucket)
let lastPhase = 0; // last typing-length phase rendered (sass)
let lastReactionPhase = -1; // last reaction phase rendered (fish); -1 so phase 0 still renders once
let lastComment = "";

// On/off toggle from the popup, persisted so it survives across tabs/reloads.
let extensionEnabled = true;

// ---- Fishbowl ----

// Universal usage fishbowl (assets/usage/0-8.PNG) — driven by
// state.totalPromptsSent, a lifetime count that never resets and is the
// same across every chat (see getTotalPromptsSent() in background.js).
// Separate from the daily cap this widget's text readout below still
// shows; this image purely visualizes cumulative usage.
//
// Stage 0 = nothing sent, ever. Stage 1 = right after the very first
// prompt. Stages 2-8 each need two MORE prompts past the previous stage
// (1 -> 3 -> 5 -> 7 -> 9 -> 11 -> 13 -> 15 total sent). Stage 8 is
// terminal — stays there and shows the ml-used note instead of climbing
// further.
const USAGE_MAX_STAGE = 8;
const ML_PER_PROMPT_DISPLAY = 25; // placeholder estimate, tune whenever

function usageStageFor(totalPromptsSent) {
  const total = totalPromptsSent || 0;
  if (total <= 0) return 0;
  return Math.min(USAGE_MAX_STAGE, 1 + Math.floor((total - 1) / 2));
}

function usageImageUrl(stage) {
  return chrome.runtime.getURL(`assets/usage/${stage}.PNG`);
}

function digitAssetUrl(digit) {
  return chrome.runtime.getURL(`assets/numbers/${digit}.PNG`);
}

// Two separate elements, deliberately: the fishbowl image floats in the
// gap to the LEFT of the composer (mirrors positionFish()'s gap on the
// right), while the "X prompts left" line sits on its own line UNDER the
// composer. They used to be one stacked container; splitting them apart
// is what lets each sit where it visually belongs instead of dragging
// the other along with it.
function injectBucket() {
  if (document.getElementById("water-tracker-bucket")) return;

  const container = document.createElement("div");
  container.id = "water-tracker-bucket";
  container.innerHTML = `
    <div id="water-usage-wrap" style="position: relative; width: 160px; height: 160px;">
      <img id="water-usage-img" width="160" height="160" style="display: block; transition: opacity 250ms ease;" alt="water usage" />
      <div id="water-usage-cap-note" style="display: none; position: absolute; top: 4px; left: 0; right: 0; text-align: center; background: rgba(255,255,255,0.85); border-radius: 6px; padding: 2px 4px;">
        <span id="water-usage-cap-digits" style="display: inline-flex; gap: 1px; vertical-align: middle;"></span>
        <span style="font: 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #2a5f8f; vertical-align: middle;">ml used</span>
      </div>
    </div>
  `;
  Object.assign(container.style, {
    position: "fixed",
    // top/left set live by positionBucket() — see below
    zIndex: 50,
    padding: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  });
  document.body.appendChild(container);

  const readout = document.createElement("div");
  readout.id = "water-readout";
  Object.assign(readout.style, {
    position: "fixed",
    // top/left set live by positionReadout() — see below
    zIndex: 50,
    font: "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    color: "#2a5f8f",
  });
  document.body.appendChild(readout);
}

const BUCKET_GAP_BELOW_COMPOSER = 12;

function positionBucket() {
  const container = document.getElementById("water-tracker-bucket");
  const composer = findComposer();
  if (!container || !composer) return;
  const composerRect = anchorRectFor(composer);
  if (!composerRect) return;

  // Centered in the gap to the LEFT of the composer. On the left there's
  // a sidebar occupying real screen space, so the equivalent gap is
  // bounded by the SIDEBAR's right edge, not the viewport's raw left
  // edge (0) — using 0 would place this on top of/inside the sidebar
  // whenever it's open.
  const sidebar = document.querySelector("aside.dframe-sidebar");
  const leftBoundary = sidebar ? sidebar.getBoundingClientRect().right : 0;
  const gapCenter = (leftBoundary + composerRect.left) / 2;
  const width = container.offsetWidth || 160;

  container.style.left = `${gapCenter - width / 2}px`;

  // Bottom-aligned with the composer's own bottom edge. Tried docking to
  // the aquarium's sand strip instead, but sand sits at the very bottom
  // of the visible chat area regardless of where the composer is — fine
  // for an established chat (composer's already down there too), but it
  // left the fishbowl stranded well below a NEW chat's vertically
  // centered composer. Tracking the composer directly keeps it right
  // where it visually belongs in both layouts.
  container.style.top = `${composerRect.bottom - container.offsetHeight}px`;
}

// While a game screen is up, games.js takes over the readout's styling
// and position (heading, centered above the game panel) via
// setReadoutGameMode(true) — this flag makes positionReadout() below
// stand down so the two don't fight over the element every frame.
// games.js calls setReadoutGameMode(false) again once the panel closes.
let readoutGameMode = false;

function setReadoutGameMode(on) {
  readoutGameMode = on;
  const readout = document.getElementById("water-readout");
  if (!readout) return;
  if (on) {
    readout.style.textAlign = "center";
    readout.style.fontSize = "14px";
    readout.style.fontWeight = "600";
  } else {
    readout.style.textAlign = "";
    readout.style.fontSize = "12px";
    readout.style.fontWeight = "";
    readout.style.width = "";
  }
}

function positionReadout() {
  if (readoutGameMode) return; // games.js positions it above the game panel instead
  const readout = document.getElementById("water-readout");
  const composer = findComposer();
  if (!readout || !composer) return;
  const composerRect = anchorRectFor(composer);
  if (!composerRect) return;

  // Below the composer, left-aligned with its own left edge — same in
  // both a new chat (composer centered) and an established one (docked
  // bottom), since it's always relative to composerRect regardless of
  // where that rect currently sits on screen.
  readout.style.top = `${composerRect.bottom + BUCKET_GAP_BELOW_COMPOSER}px`;
  readout.style.left = `${composerRect.left}px`;
}

let bucketPositionLoopActive = false;
function bucketPositionLoop() {
  if (!bucketPositionLoopActive) return;
  positionBucket();
  positionReadout();
  positionUsageTracker();
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

// Crossfades rather than swapping instantly — covers "animate to 1.png"
// on the very first prompt and reads consistently for every later stage
// change too, not just that first one.
function setUsageStage(stage) {
  const img = document.getElementById("water-usage-img");
  if (!img) return;
  if (img.dataset.stage === String(stage)) return; // already showing this stage
  img.dataset.stage = String(stage);
  const url = usageImageUrl(stage);
  img.style.opacity = "0";
  setTimeout(() => {
    img.src = url;
    requestAnimationFrame(() => {
      img.style.opacity = "1";
    });
  }, 200);
}

// Shared by both digit displays below — the lifetime cap-note and the
// daily usage tracker each render a plain integer as a row of the
// teammate's number sprites.
function renderDigitSprites(container, number, size) {
  container.innerHTML = "";
  String(number)
    .split("")
    .forEach((digit) => {
      const img = document.createElement("img");
      img.src = digitAssetUrl(digit);
      img.width = size;
      img.height = size;
      container.appendChild(img);
    });
}

function renderMlUsedDigits(totalPromptsSent) {
  const digitsEl = document.getElementById("water-usage-cap-digits");
  if (!digitsEl) return;
  renderDigitSprites(digitsEl, (totalPromptsSent || 0) * ML_PER_PROMPT_DISPLAY, 10);
}

// ---- Usage tracker (underneath the fishbowl) ----
// Separate metric from both the daily prompt cap and the lifetime usage
// fishbowl above, though it shares that fishbowl's "ever, everywhere"
// nature: a flat mL-per-prompt rate (background.js's ML_PER_PROMPT_USAGE)
// off totalPromptsSent, universal across chats and days, never resets.
function injectUsageTracker() {
  if (document.getElementById("water-usage-tracker")) return;
  const el = document.createElement("div");
  el.id = "water-usage-tracker";
  el.innerHTML = `
    <span id="water-usage-tracker-digits" style="display: inline-flex; gap: 1px; vertical-align: middle;"></span>
    <span style="font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #2a5f8f; vertical-align: middle;">mL used</span>
  `;
  Object.assign(el.style, {
    position: "fixed",
    // top/left set live by positionUsageTracker() — see below
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    gap: "4px",
  });
  document.body.appendChild(el);
}

function updateUsageTracker(state) {
  injectUsageTracker();
  const digitsEl = document.getElementById("water-usage-tracker-digits");
  if (digitsEl) renderDigitSprites(digitsEl, state.mlUsed ?? 0, 12);
}

function positionUsageTracker() {
  const el = document.getElementById("water-usage-tracker");
  const bucket = document.getElementById("water-tracker-bucket");
  if (!el || !bucket) return;
  const rect = bucket.getBoundingClientRect();
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.bottom + 8}px`;
}

function updateBucket(state) {
  currentState = state;
  injectBucket();
  updateUsageTracker(state);
  const readout = document.getElementById("water-readout");
  if (!readout) return;

  readout.innerHTML = state.capped
    ? "Play the game to get another prompt!"
    : `<strong>${state.remaining}</strong> prompt${state.remaining === 1 ? "" : "s"} left`;

  const stage = usageStageFor(state.totalPromptsSent);
  setUsageStage(stage);
  const capNote = document.getElementById("water-usage-cap-note");
  if (capNote) {
    if (stage >= USAGE_MAX_STAGE) {
      renderMlUsedDigits(state.totalPromptsSent);
      capNote.style.display = "block";
    } else {
      capNote.style.display = "none";
    }
  }

  // A real send clears the composer — re-enter phase 1 for the next
  // prompt rather than hiding, since phase 1 is the resting state now.
  const composer = findComposer();
  updatePhaseUI(effectiveTypingLength(composer), composer);
}

// ---- Fish placeholder + sass comment (typing-length phase) ----

const DEFAULT_REACTION_SIZE = 150;
// Per-file display size (box side length, px) — reaction2 reads bigger
// on screen than reaction3, independent of their native pixel dimensions.
const REACTION_IMAGE_SIZE = {
  "reaction2.PNG": 220,
};

function injectFish() {
  if (document.getElementById("water-fish")) return;
  const el = document.createElement("img");
  el.id = "water-fish";
  el.alt = "fish reaction";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: 50,
    width: `${DEFAULT_REACTION_SIZE}px`,
    height: `${DEFAULT_REACTION_SIZE}px`,
    // reaction2/reaction3 are different native pixel sizes and aspect
    // ratios — "contain" keeps each rendering without stretching its own
    // proportions to fill the (possibly per-file-sized) box.
    objectFit: "contain",
    display: "none",
  });
  document.body.appendChild(el);
}

function renderFishPlaceholder(phase) {
  const el = document.getElementById("water-fish");
  if (!el) return;
  const file = REACTION_PHASE_IMAGE_FILES[phase] ?? REACTION_PHASE_IMAGE_FILES[0];
  el.src = reactionAssetUrl(file);
  const size = REACTION_IMAGE_SIZE[file] ?? DEFAULT_REACTION_SIZE;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
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

// Vertical offset from composerRect.top, per reaction file — reaction2
// renders at 220px (see REACTION_IMAGE_SIZE) instead of the 150px
// default, so anchoring it at the same +8 offset as the others left it
// hanging noticeably further down past the composer. Shifting it up
// keeps it reading as anchored near the composer's top edge like the
// rest. Purely a function of composerRect, so it applies the same way
// in both new and established chats.
const REACTION_IMAGE_TOP_OFFSET = {
  "reaction2.PNG": -60,
};
const DEFAULT_REACTION_TOP_OFFSET = 8;

function positionFish(composerRect) {
  const el = document.getElementById("water-fish");
  if (!el || !composerRect) return;
  // Centered in the leftover horizontal space to the right of the
  // composer, not just offset from its edge.
  const gapCenter = (composerRect.right + window.innerWidth) / 2;
  const fishWidth = el.offsetWidth || 36;
  el.style.left = `${gapCenter - fishWidth / 2}px`;
  const file = REACTION_PHASE_IMAGE_FILES[lastReactionPhase] ?? REACTION_PHASE_IMAGE_FILES[0];
  const topOffset = REACTION_IMAGE_TOP_OFFSET[file] ?? DEFAULT_REACTION_TOP_OFFSET;
  el.style.top = `${composerRect.top + topOffset}px`;
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
  lastReactionPhase = -1;
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
  }

  const reactionPhase = reactionPhaseForLength(len);
  if (reactionPhase !== lastReactionPhase) {
    lastReactionPhase = reactionPhase;
    renderFishPlaceholder(reactionPhase);
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
  const readout = document.getElementById("water-readout");
  const usageTracker = document.getElementById("water-usage-tracker");
  const fish = document.getElementById("water-fish");
  const sass = document.getElementById("water-sass");
  if (bucket) bucket.remove();
  if (readout) readout.remove();
  if (usageTracker) usageTracker.remove();
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
    if (state) updateBucket(state); // includes state.mlUsed — see updateUsageTracker()
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

// A large paste/attachment renders as a chip with its own "Remove" (X)
// button near its top-left corner — verified live via
// button[aria-label="Remove"] — which the sass comment (also anchored
// near the composer's top-left, see positionSass) can end up covering
// since both want the same corner. Rather than hunt down and hardcode
// that button's exact selector, just drop the sass comment's z-index
// below normal page content while hovering any attachment chip, so
// whatever claude.ai renders there — Remove button or otherwise — wins.
document.addEventListener("mouseover", (e) => {
  if (!e.target.closest(ATTACHMENT_SELECTOR)) return;
  const sass = document.getElementById("water-sass");
  if (sass) sass.style.zIndex = "1";
});

document.addEventListener("mouseout", (e) => {
  const chip = e.target.closest(ATTACHMENT_SELECTOR);
  if (!chip) return;
  if (chip.contains(e.relatedTarget)) return; // moved within the same chip, not away from it
  const sass = document.getElementById("water-sass");
  if (sass) sass.style.zIndex = "50";
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
