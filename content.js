// Detects sent prompts, renders the fishbowl, and drives the
// length-based sass comment + fish art while the user types. Platform-
// agnostic: CONFIG, ATTACHMENT_SELECTOR, etc. come from the platform
// adapter (platform-claude.js today), loaded before this file — see that
// file's own header for why they're plain shared globals rather than
// something passed in explicitly.

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

// An uploaded file (or a paste large enough that the site converts it
// into a "PASTED" card) renders as a chip OUTSIDE the composer's
// contenteditable on claude.ai — composer.innerText doesn't grow at all
// when a file is attached (ATTACHMENT_SELECTOR, from the platform
// adapter), so without this, attaching a 50k-character PDF registers as
// phase 1. Each attachment gets a flat weight added to the effective
// length instead of trying to read the file's actual size. 500 chars =
// an instant phase-5 hit, matching "lecture slides are huge."
const ATTACHMENT_LENGTH_WEIGHT = 500;

// Scoped to the composer's own stable anchor (the bordered "prompt box"
// container), not the whole page — an unscoped document-wide search
// also matches an ALREADY-SENT message's own rendered attachment
// thumbnail sitting in the chat history, which never goes away. That
// permanently inflated the effective length long after the composer
// itself was empty again, pinning the typing phase (and the aquarium
// water level that tracks it) at whatever the original large/attached
// prompt mapped to.
function attachmentCount(composer) {
  const scope = findStableAnchor(composer) || document;
  return scope.querySelectorAll(ATTACHMENT_SELECTOR).length;
}

function effectiveTypingLength(composer) {
  return composerCharCount(composer) + attachmentCount(composer) * ATTACHMENT_LENGTH_WEIGHT;
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

// Usage fishbowl (assets/usage/0-10.PNG) — driven by state.count, the
// number of prompts sent TODAY (keyed by date in background.js), so it
// empties back to stage 0 at midnight along with the daily cap.
//
// Stage 0 = nothing sent yet today. Stage 1 = right after today's first
// prompt. Each later stage needs two MORE prompts than the previous one
// (1 -> 3 -> 5 -> 7 -> 9 ... sent today). Stage 10 is terminal — stays
// there rather than climbing further. Assets: assets/usage/0.PNG
// through 10.PNG.
const USAGE_MAX_STAGE = 10;

function usageStageFor(promptsToday) {
  const total = promptsToday || 0;
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
// gap to the LEFT of the composer (mirrors the speech stack's gap on the
// right — see positionSpeechStack), while the "X prompts left" line rides
// the composer's top edge (see positionReadout). They used to be one
// stacked container; splitting them apart is what lets each sit where it
// visually belongs instead of dragging the other along with it.
function injectBucket() {
  if (document.getElementById("water-tracker-bucket")) return;

  const container = document.createElement("div");
  container.id = "water-tracker-bucket";
  container.innerHTML = `
    <div id="water-usage-wrap" style="position: relative; width: 160px; height: 160px;">
      <img id="water-usage-img" width="160" height="160" style="display: block; transition: opacity 250ms ease;" alt="water usage" />
    </div>
  `;
  Object.assign(container.style, {
    position: "fixed",
    // top/left set live by positionBucket() — see below
    zIndex: LEFT_WIDGET_Z,
    padding: `${BUCKET_PADDING_PX}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  });
  document.body.appendChild(container);

  const readout = document.createElement("div");
  readout.id = "water-readout";
  // Same pill shape/size the sass comment box uses (see injectSass), but
  // in the usage tracker's dark blue with white text instead of the
  // comment's orange. Digits inside are drawn as number sprites — see
  // renderReadout.
  Object.assign(readout.style, {
    position: "fixed",
    // top/left set live by positionReadout() — see below
    zIndex: 50,
    boxSizing: "border-box",
    background: READOUT_BG,
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    fontSize: `${READOUT_FONT_SIZE}px`,
    padding: READOUT_PADDING,
    borderRadius: READOUT_RADIUS,
    maxWidth: "280px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(readout);
}

// Overridable per platform (READOUT_GAP_BELOW_COMPOSER) — different
// sites' composers resolve to different stable-anchor heights/shapes
// (see findStableAnchor below), so a gap tuned for one can read as too
// far from another's.
const BUCKET_GAP_BELOW_COMPOSER =
  typeof READOUT_GAP_BELOW_COMPOSER !== "undefined" ? READOUT_GAP_BELOW_COMPOSER : 12;

// Padding inside #water-tracker-bucket (see injectBucket) — positionBucket
// subtracts it so the visible fishbowl art, not the padded box, is what
// lines up with the "prompts left" pill.
const BUCKET_PADDING_PX = 8;

// The fishbowl and the "mL used today" box live in the far-left page
// margin, where a peek/expanded sidebar can render over them. Rather than
// fight it with z-index (Claude's hover-peek panel isn't caught by
// sidebarRightEdge(), and low z-index hid them behind page chrome on
// ChatGPT), positionBucket/positionUsageTracker hit-test their own centre
// each frame and hide the widget whenever the sidebar is geometrically on
// top of it — see sidebarOverlapsPoint().
const LEFT_WIDGET_Z = 50;

// Both readouts render as a dark-blue pill (the usage tracker's #2a5f8f)
// with white text and white number sprites, at the sass comment box's
// per-platform shape and text size.
const READOUT_BG = "#2a5f8f";
const READOUT_RADIUS = typeof SASS_BORDER_RADIUS !== "undefined" ? SASS_BORDER_RADIUS : "8px";

// "Prompts left today" pill — compact: small number sprites, tight padding.
const READOUT_PADDING = "3px 7px";
const READOUT_FONT_SIZE = 11;
const READOUT_DIGIT_SIZE = 11;

// "mL used today" pill — the sass comment box's shape/size (unchanged).
const USAGE_PADDING = typeof SASS_PADDING !== "undefined" ? SASS_PADDING : "6px 10px";
const USAGE_FONT_SIZE = 14;
const USAGE_DIGIT_SIZE = 15;

// True when the platform's sidebar element is geometrically on top of
// (x, y) — used to hide the far-left widgets when Claude's hover-peek
// sidebar (or a pinned/expanded one) slides out over them. elementsFrom-
// Point returns the whole hit stack regardless of paint order, so this
// still reports the sidebar even while a widget is painting on top of it.
function sidebarOverlapsPoint(x, y) {
  const sel = typeof SIDEBAR_SELECTOR !== "undefined" ? SIDEBAR_SELECTOR : null;
  if (!sel || !document.elementsFromPoint) return false;
  return document
    .elementsFromPoint(x, y)
    .some((el) => el.closest && el.closest(sel));
}

// Hide the widget (without disturbing its display mode) when the sidebar
// covers its centre; show it otherwise.
function applySidebarOcclusion(el) {
  const r = el.getBoundingClientRect();
  el.style.visibility = sidebarOverlapsPoint(r.left + r.width / 2, r.top + r.height / 2)
    ? "hidden"
    : "";
}

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
  // whenever it's open. sidebarRightEdge() is the platform adapter's
  // call — some sites (ChatGPT) render the sidebar as more than one
  // element depending on expand/collapse state, which a single selector
  // can't capture correctly.
  const leftBoundary = typeof sidebarRightEdge === "function" ? sidebarRightEdge() : 0;
  const gapCenter = (leftBoundary + composerRect.left) / 2;
  const width = container.offsetWidth || 160;

  // Clamp into the visible gap: never let it slide off the left edge or
  // sit under the sidebar, even when the gap is narrower than the
  // fishbowl (small window / wide or pinned sidebar). Better slightly
  // overlapping the chat than gone.
  const bucketLeft = Math.max(gapCenter - width / 2, leftBoundary + 4, 4);
  container.style.left = `${bucketLeft}px`;

  // Vertically: the visible fishbowl art's bottom edge sits on the
  // composer's own bottom edge (the "mL used today" pill goes just below
  // that line — see positionUsageTracker). Subtract the container's
  // bottom padding so it's the art that lines up, not the padded box.
  container.style.top = `${composerRect.bottom - container.offsetHeight + BUCKET_PADDING_PX}px`;

  applySidebarOcclusion(container);
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
    // Centered heading above the game panel. Keeps the blue pill look
    // (games only open from the capped state, whose message reads fine
    // white-on-blue) but lets games.js size it to the panel width.
    readout.style.textAlign = "center";
    readout.style.fontSize = "14px";
    readout.style.fontWeight = "600";
    readout.style.maxWidth = "none";
    readout.style.whiteSpace = "";
  } else {
    readout.style.textAlign = "";
    readout.style.fontSize = `${READOUT_FONT_SIZE}px`;
    readout.style.fontWeight = "";
    readout.style.width = "";
    readout.style.maxWidth = "280px";
    readout.style.whiteSpace = "nowrap";
  }
}

// Some platforms (ChatGPT's "+" attach menu, and similar popovers near
// the composer) can open directly over the readout or sass comment —
// FILE_MENU_SELECTOR is an optional platform-adapter constant so this
// is a no-op wherever it isn't defined (claude.ai has no such menu).
function getOpenFileMenuRect() {
  if (typeof FILE_MENU_SELECTOR === "undefined") return null;
  const menu = document.querySelector(FILE_MENU_SELECTOR);
  if (!menu) return null;
  const rect = menu.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null; // present but not actually open/visible
  return rect;
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function positionReadout() {
  if (readoutGameMode) return; // games.js positions it above the game panel instead
  const readout = document.getElementById("water-readout");
  const composer = findComposer();
  if (!readout || !composer) return;
  const composerRect = anchorRectFor(composer);
  if (!composerRect) return;

  // Straddles the composer's top edge — half above, half over the box —
  // left-aligned with it. Always relative to composerRect, so it reads
  // the same in a new chat (composer centered) and an established one
  // (docked bottom).
  const left = composerRect.left;
  let top = composerRect.top - readout.offsetHeight / 2;

  // If an open file menu would sit on top of that spot, drop the readout
  // below the composer instead of leaving it hidden behind the menu.
  const menuRect = getOpenFileMenuRect();
  if (menuRect) {
    const naturalRect = { left, right: left + readout.offsetWidth, top, bottom: top + readout.offsetHeight };
    if (rectsOverlap(menuRect, naturalRect)) {
      top = composerRect.bottom + BUCKET_GAP_BELOW_COMPOSER;
    }
  }

  readout.style.top = `${top}px`;
  readout.style.left = `${left}px`;
}

// The left/top widgets (fishbowl, "mL used today", "prompts left") only
// make sense on an actual chat screen. A platform adapter can define
// isChatPage() to return false on its non-chat routes (Gemini's "Search
// chats" results and notebooks pages) — the extension's own body-level
// widgets otherwise linger there after an SPA navigation.
function onChatPage() {
  return typeof isChatPage !== "function" || isChatPage();
}

const LEFT_WIDGET_IDS = ["water-tracker-bucket", "water-readout", "water-usage-tracker"];

let bucketPositionLoopActive = false;
function bucketPositionLoop() {
  if (!bucketPositionLoopActive) return;
  if (onChatPage()) {
    // Undo any off-chat-page hide; positionBucket/positionUsageTracker
    // re-apply their own sidebar-occlusion visibility right after.
    for (const id of LEFT_WIDGET_IDS) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = "";
    }
    positionBucket();
    positionReadout();
    positionUsageTracker();
  } else {
    for (const id of LEFT_WIDGET_IDS) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = "hidden";
    }
  }
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

// Shared digit renderer — the usage tracker and the "prompts left"
// readout both draw integers as a row of the teammate's number sprites
// (assets/numbers/). The sprites are black on transparent, so `white`
// flips them to white for use on a dark background (the readout pill).
function appendDigitSprites(container, number, size, white) {
  String(number)
    .split("")
    .forEach((digit) => {
      const img = document.createElement("img");
      img.src = digitAssetUrl(digit);
      img.width = size;
      img.height = size;
      img.style.verticalAlign = "middle";
      if (white) img.style.filter = "brightness(0) invert(1)";
      container.appendChild(img);
    });
}

function renderDigitSprites(container, number, size, white) {
  container.innerHTML = "";
  appendDigitSprites(container, number, size, white);
}

// "<remaining>/<cap> prompts left today", with the two numbers drawn as
// white number sprites. The "/" has no sprite so it stays as text (the
// pill's own white).
function renderReadout(readout, remaining, cap) {
  readout.textContent = "";
  const nums = document.createElement("span");
  Object.assign(nums.style, { display: "inline-flex", alignItems: "center", gap: "1px", verticalAlign: "middle" });
  appendDigitSprites(nums, remaining, READOUT_DIGIT_SIZE, true);
  const slash = document.createElement("span");
  slash.textContent = "/";
  slash.style.margin = "0 3px";
  nums.appendChild(slash);
  appendDigitSprites(nums, cap, READOUT_DIGIT_SIZE, true);
  readout.appendChild(nums);
  const label = document.createElement("span");
  label.textContent = " prompts left today";
  label.style.verticalAlign = "middle";
  readout.appendChild(label);
}

// ---- Usage tracker (underneath the fishbowl) ----
// "<n> mL used today": a flat mL-per-prompt rate (background.js's
// ML_PER_PROMPT_USAGE) times today's send count. Resets to zero at
// midnight, same as the fishbowl above and the daily cap.
function injectUsageTracker() {
  if (document.getElementById("water-usage-tracker")) return;
  const el = document.createElement("div");
  el.id = "water-usage-tracker";
  el.innerHTML = `
    <span id="water-usage-tracker-digits" style="display: inline-flex; align-items: center; gap: 1px; vertical-align: middle;"></span>
    <span style="vertical-align: middle;">mL used today</span>
  `;
  // Same dark-blue pill as the "prompts left" readout (see injectBucket),
  // at the sass comment box's text size.
  Object.assign(el.style, {
    position: "fixed",
    // top/left set live by positionUsageTracker() — see below
    zIndex: LEFT_WIDGET_Z,
    display: "flex",
    alignItems: "center",
    gap: "4px",
    boxSizing: "border-box",
    background: READOUT_BG,
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    fontSize: `${USAGE_FONT_SIZE}px`,
    padding: USAGE_PADDING,
    borderRadius: READOUT_RADIUS,
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(el);
}

function updateUsageTracker(state) {
  injectUsageTracker();
  const digitsEl = document.getElementById("water-usage-tracker-digits");
  if (digitsEl) renderDigitSprites(digitsEl, state.mlUsed ?? 0, USAGE_DIGIT_SIZE, true);
}

function positionUsageTracker() {
  const el = document.getElementById("water-usage-tracker");
  const bucket = document.getElementById("water-tracker-bucket");
  const composer = findComposer();
  if (!el || !bucket || !composer) return;
  const composerRect = anchorRectFor(composer);
  if (!composerRect) return;
  const bucketRect = bucket.getBoundingClientRect();

  // Centered on the fishbowl's own horizontal center (the fishbowl itself
  // is centered in the sidebar->composer gap).
  el.style.left = `${bucketRect.left + bucketRect.width / 2 - el.offsetWidth / 2}px`;

  // Same in every chat state: the box's BOTTOM edge lines up with the
  // prompt box's bottom edge. (Established chats used to compute this off
  // composerRect.top instead, which put the box up where the fishbowl art
  // is and made the two overlap.)
  el.style.top = `${composerRect.bottom - el.offsetHeight}px`;

  applySidebarOcclusion(el);
}

function updateBucket(state) {
  currentState = state;
  injectBucket();
  updateUsageTracker(state);
  const readout = document.getElementById("water-readout");
  if (!readout) return;

  // Denominator is the configured daily cap alone (baseCap), not
  // state.cap (which includes any earned bonus) — a bonus prompt should
  // still read as "x/10", not inflate the denominator to "x/12".
  if (state.capped) {
    readout.textContent = "Play the game to get another prompt!";
  } else {
    renderReadout(readout, state.remaining, state.baseCap ?? state.cap);
  }

  setUsageStage(usageStageFor(state.count));

  // A real send clears the composer — re-enter phase 1 for the next
  // prompt rather than hiding, since phase 1 is the resting state now.
  // updateBucket() runs in RECORD_PROMPT's async callback, which can
  // resolve before claude.ai's own send handler has actually cleared
  // the composer's text yet — reading it right here can still see the
  // just-sent prompt's full length, locking the phase (and the
  // aquarium's water level, which tracks it) at whatever it was for a
  // 500-char prompt instead of resetting to empty. A short follow-up
  // check catches the composer once it's actually settled, in addition
  // to the immediate one for the common case where it's already cleared.
  const composer = findComposer();
  updatePhaseUI(effectiveTypingLength(composer), composer);
  setTimeout(() => {
    const c = findComposer();
    updatePhaseUI(effectiveTypingLength(c), c);
  }, 200);
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
  // Shape/padding come from the platform adapter — matching each site's
  // own composer shape (claude.ai's modest rounded rect vs ChatGPT's
  // near-pill) reads as belonging to the page instead of pasted on.
  // Falls back to claude.ai's original values if an adapter doesn't
  // define them.
  Object.assign(el.style, {
    position: "fixed",
    zIndex: 50,
    background: "#d97757",
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    padding: typeof SASS_PADDING !== "undefined" ? SASS_PADDING : "6px 10px",
    borderRadius: typeof SASS_BORDER_RADIUS !== "undefined" ? SASS_BORDER_RADIUS : "8px",
    maxWidth: "280px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
    display: "none",
  });
  document.body.appendChild(el);
}

// ---- Right-side speech stack: comment box -> bubbles -> fish ----
// The comment now reads as something the fish is saying. Everything to
// the right of the composer is one vertical stack, centered in the gap
// between the composer's right edge and the screen edge, laid out in a
// single pass so the pieces never drift apart:
//
//   [ orange comment box ]   top; grows taller as a long comment wraps
//        (bubble2, large)    trailing bubble nearest the comment
//        (bubble1, small)    trailing bubble nearest the fish
//     [  fish reaction   ]   bottom, bottom-aligned to the composer
//
// Bottom-aligning the fish to the composer (rather than hanging it off
// composerRect.top like before) is what keeps it fully on screen once an
// established chat docks the composer to the very bottom of the viewport.
const BUBBLE_SMALL_FILE = "bubble1.PNG";
const BUBBLE_LARGE_FILE = "bubble2.PNG";
const BUBBLE_SMALL_SIZE = 24;
const BUBBLE_LARGE_SIZE = 30;
const BUBBLE_LARGE_X_NUDGE = 12; // large bubble sits slightly right of the small one / fish
const STACK_ITEM_GAP = 8; // vertical gap between stacked items
const STACK_EDGE_MARGIN = 20; // keep the stack this far off the composer / screen edges
const SASS_MAX_WIDTH = 420; // the comment box never grows wider than this

function injectBubbles() {
  for (const [id, file, size] of [
    ["water-bubble-small", BUBBLE_SMALL_FILE, BUBBLE_SMALL_SIZE],
    ["water-bubble-large", BUBBLE_LARGE_FILE, BUBBLE_LARGE_SIZE],
  ]) {
    if (document.getElementById(id)) continue;
    const el = document.createElement("img");
    el.id = id;
    el.alt = "";
    el.src = reactionAssetUrl(file);
    Object.assign(el.style, {
      position: "fixed",
      zIndex: 50,
      width: `${size}px`,
      height: `${size}px`,
      objectFit: "contain",
      display: "none",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
  }
}

function setSpeechBubblesVisible(visible) {
  for (const id of ["water-bubble-small", "water-bubble-large"]) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "block" : "none";
  }
}

function positionSpeechStack(composerRect) {
  const fish = document.getElementById("water-fish");
  if (!fish || !composerRect) return;
  const sass = document.getElementById("water-sass");
  const bubbleSmall = document.getElementById("water-bubble-small");
  const bubbleLarge = document.getElementById("water-bubble-large");

  // Centered in the gap to the right of the composer — same horizontal
  // placement the fish alone used to have.
  const gapLeft = composerRect.right;
  const gapRight = window.innerWidth;
  const centerX = (gapLeft + gapRight) / 2;

  // Let the comment box fill the middle space rather than stay a fixed
  // one-liner: a long comment just wraps and makes the orange box taller.
  if (sass) {
    const fitted = gapRight - gapLeft - STACK_EDGE_MARGIN * 2;
    sass.style.maxWidth = `${Math.min(SASS_MAX_WIDTH, Math.max(140, fitted))}px`;
  }

  // Walk upward from the composer's bottom edge. `cursor` is always the y
  // of the bottom edge of the next item to place.
  let cursor = composerRect.bottom;

  const fishH = fish.getBoundingClientRect().height || DEFAULT_REACTION_SIZE;
  const fishW = fish.offsetWidth || DEFAULT_REACTION_SIZE;
  fish.style.left = `${centerX - fishW / 2}px`;
  fish.style.top = `${cursor - fishH}px`;
  cursor -= fishH + STACK_ITEM_GAP;

  if (bubbleSmall) {
    bubbleSmall.style.left = `${centerX - BUBBLE_SMALL_SIZE / 2}px`;
    bubbleSmall.style.top = `${cursor - BUBBLE_SMALL_SIZE}px`;
    cursor -= BUBBLE_SMALL_SIZE + STACK_ITEM_GAP;
  }
  if (bubbleLarge) {
    bubbleLarge.style.left = `${centerX - BUBBLE_LARGE_SIZE / 2 + BUBBLE_LARGE_X_NUDGE}px`;
    bubbleLarge.style.top = `${cursor - BUBBLE_LARGE_SIZE}px`;
    cursor -= BUBBLE_LARGE_SIZE + STACK_ITEM_GAP;
  }
  if (sass) {
    const rect = sass.getBoundingClientRect();
    sass.style.left = `${centerX - rect.width / 2}px`;
    sass.style.top = `${cursor - rect.height}px`;

    // Same file-menu dodge as before: if the "+" attach menu opens over
    // the comment, hide it rather than let them overlap. visibility (not
    // display) so it stays independent of updatePhaseUI()'s show/hide.
    const menuRect = getOpenFileMenuRect();
    sass.style.visibility =
      menuRect && rectsOverlap(menuRect, sass.getBoundingClientRect()) ? "hidden" : "";
  }
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
  if (rect) positionSpeechStack(rect);
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
  setSpeechBubblesVisible(false);
}

function updatePhaseUI(len, composer) {
  injectFish();
  injectSass();
  injectBubbles();

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
  setSpeechBubblesVisible(!!lastComment);
  const rect = anchorRectFor(composer);
  positionSpeechStack(rect);
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
  // Also reset here, not just hidePhaseUI() — teardownAll() destroys
  // the #water-fish element outright and bootUp() creates a fresh one
  // with no src set. If lastReactionPhase were left stale (e.g. still
  // 0 from before teardown) and the phase on re-enable is also 0,
  // updatePhaseUI()'s phase !== lastReactionPhase guard would never
  // fire, so renderFishPlaceholder() never runs and the new <img>
  // never gets a src — a broken-image icon instead of the fish.
  lastReactionPhase = -1;
  lastComment = "";
  const bucket = document.getElementById("water-tracker-bucket");
  const readout = document.getElementById("water-readout");
  const usageTracker = document.getElementById("water-usage-tracker");
  const fish = document.getElementById("water-fish");
  const sass = document.getElementById("water-sass");
  const bubbleSmall = document.getElementById("water-bubble-small");
  const bubbleLarge = document.getElementById("water-bubble-large");
  if (bucket) bucket.remove();
  if (readout) readout.remove();
  if (usageTracker) usageTracker.remove();
  if (fish) fish.remove();
  if (sass) sass.remove();
  if (bubbleSmall) bubbleSmall.remove();
  if (bubbleLarge) bubbleLarge.remove();
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

// Long-open tabs: background.js already computes state fresh per day
// (getTodayEntry is keyed by date), but a tab left open across midnight
// keeps showing yesterday's numbers until the next send or storage
// change. Re-pull state when the local date rolls over so the daily cap,
// the usage fishbowl and "mL used today" all visibly reset at midnight.
function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
let lastDateStamp = localDateStamp();
setInterval(() => {
  if (!extensionEnabled) return;
  const now = localDateStamp();
  if (now === lastDateStamp) return;
  lastDateStamp = now;
  requestState();
}, 30000);

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

// ---- Typing speed (read by aquarium.js's pickFishSpeedRange — "the
// faster you type, the faster the fish start to swim") ----
// Smoothed (exponential moving average) chars/sec between keystrokes,
// not the raw instantaneous gap — one slow key in a fast burst
// shouldn't read as "typing slowed down." Gaps over 2s are treated as a
// pause rather than slow typing and don't feed the average at all.
let typingCharsPerSec = 0;
let lastKeystrokeAt = 0;

function recordKeystroke() {
  const now = Date.now();
  if (lastKeystrokeAt > 0) {
    const dt = (now - lastKeystrokeAt) / 1000;
    if (dt > 0 && dt < 2) {
      typingCharsPerSec = typingCharsPerSec * 0.7 + (1 / dt) * 0.3;
    }
  }
  lastKeystrokeAt = now;
}

// Snaps back to 0 within a second of the last keystroke, not just
// between two keystrokes — so fish visibly return to normal speed
// shortly after typing stops, rather than staying boosted from a burst
// that already ended.
function currentTypingSpeed() {
  if (lastKeystrokeAt === 0 || Date.now() - lastKeystrokeAt > 1000) return 0;
  return typingCharsPerSec;
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
  recordKeystroke();
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
      "[water] composer not found — CONFIG.composerSelector (platform adapter) needs updating for the current DOM"
    );
  }
}, 5000);

console.log("[water] injected");
