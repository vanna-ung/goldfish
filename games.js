// "Earn a prompt back" minigames + composer blocking, shown once the
// daily cap (plus any earned bonus) is used up. Kept in its own file for
// the same reason as aquarium.js: shares content.js's execution context
// (currentState, findComposer, anchorRectFor, extensionEnabled,
// updateBucket) and aquarium.js's (findChatMain, spawnSwimmer, spawnBubble,
// AQUARIUM_FISH_FILES) without message passing or changes to either
// already-working file.
//
// Two-part system:
// 1. A persistent, invisible blocker sits exactly over the composer
//    whenever capped — pointer-events:auto, so clicks/focus can't reach
//    the real composer or send button underneath. This is the actual
//    block; a content script still can't truly intercept claude.ai's own
//    submit handling, only physically cover it, but full DOM coverage is
//    enough to stop clicking or typing in.
// 2. A full aquarium-scene backdrop (reusing aquarium.js's fish/bubble
//    spawning against its own container) covers the whole chat area with
//    the game panel centered on top — fish/bubbles visibly cross behind
//    the panel since it's a separate, higher z-index element. The user
//    can exit this back to the composer-blocker-only state via the X on
//    the panel, but the composer stays blocked either way; clicking the
//    blocker re-summons the full backdrop+panel.

const GAMES = ["multiplication", "memory"];
let activeGame = null; // "multiplication" | "memory" | null while the panel has content
let gameOverlayDismissed = false; // true = user hit the X; composer stays blocked regardless

function gamesIsEnabled() {
  return typeof extensionEnabled === "undefined" || extensionEnabled;
}

function isCurrentlyCapped() {
  return typeof currentState !== "undefined" && !!currentState && currentState.capped;
}

function gamesChatMain() {
  return typeof findChatMain === "function" ? findChatMain() : null;
}

// ---- Styles ----

function injectGameStyles() {
  if (document.getElementById("games-style")) return;
  const style = document.createElement("style");
  style.id = "games-style";
  style.textContent = `
    #water-overlay { font-family: system-ui, sans-serif; }
    #water-overlay .tile {
      display: flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: 8px; cursor: pointer;
      background: #fff; border: 2px solid #4a90d9; user-select: none; font-size: 18px;
    }
    #water-overlay .tile.selected { background: #bfe4fb; }
    #water-overlay .tile.revealed-fish { background: #bfe4fb; }
    #water-overlay button.primary {
      background: #d97757; color: #fff; border: none; border-radius: 6px;
      padding: 8px 16px; font-size: 14px; cursor: pointer;
    }
    #water-overlay button.primary:disabled { opacity: 0.5; cursor: default; }
    #water-overlay input[type="number"] {
      width: 40px; height: 28px; font-size: 16px; padding: 0; text-align: center;
      border: none; border-bottom: 2px solid #4a90d9; background: transparent;
      -moz-appearance: textfield;
    }
    #water-overlay input[type="number"]::-webkit-outer-spin-button,
    #water-overlay input[type="number"]::-webkit-inner-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    #water-overlay-exit {
      position: absolute; top: 10px; right: 16px; width: 24px; height: 24px;
      border-radius: 50%; border: none; background: rgba(74,144,217,0.15);
      color: #2a5f8f; font-size: 14px; line-height: 1; cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

// ---- Composer blocker (persistent while capped, regardless of whether
// the full backdrop+panel is currently shown or dismissed) ----

function injectComposerBlocker() {
  if (document.getElementById("water-composer-blocker")) return;
  const el = document.createElement("div");
  el.id = "water-composer-blocker";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "49",
    display: "none",
    cursor: "pointer",
    pointerEvents: "auto",
    background: "transparent",
  });
  el.addEventListener("click", () => {
    gameOverlayDismissed = false;
    refreshCappedUI();
  });
  document.body.appendChild(el);
}

function positionComposerBlocker() {
  const el = document.getElementById("water-composer-blocker");
  const composer = findComposer();
  if (!el || !composer) return;
  const rect = anchorRectFor(composer);
  if (!rect) return;
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

let blockerPositionLoopActive = false;
function blockerPositionLoop() {
  if (!blockerPositionLoopActive) return;
  positionComposerBlocker();
  requestAnimationFrame(blockerPositionLoop);
}
function startBlockerPositionLoop() {
  if (blockerPositionLoopActive) return;
  blockerPositionLoopActive = true;
  requestAnimationFrame(blockerPositionLoop);
}
function stopBlockerPositionLoop() {
  blockerPositionLoopActive = false;
}

// ---- Aquarium-scene backdrop ----
// Reuses aquarium.js's spawnSwimmer()/spawnBubble(), which both accept an
// explicit container as of this feature — same fish/bubble art and
// movement, just spawned into this backdrop instead of the aquarium's own
// water div.

function injectBackdrop() {
  if (document.getElementById("water-big-overlay")) return;
  const el = document.createElement("div");
  el.id = "water-big-overlay";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "48",
    display: "none",
    overflow: "hidden",
    pointerEvents: "auto",
    background: "linear-gradient(180deg, #7ec8f2 0%, #4a90d9 100%)",
  });
  document.body.appendChild(el);
}

function positionBackdrop() {
  const el = document.getElementById("water-big-overlay");
  const main = gamesChatMain();
  if (!el || !main) return;
  const rect = main.getBoundingClientRect();
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

const BACKDROP_FISH_TARGET = 4;
const BACKDROP_BUBBLE_TARGET = 4;

function maintainBackdropCreatures() {
  const el = document.getElementById("water-big-overlay");
  if (!el || el.style.display === "none") return;
  if (typeof spawnSwimmer !== "function" || typeof spawnBubble !== "function") return;

  const fishFiles = typeof AQUARIUM_FISH_FILES !== "undefined" ? AQUARIUM_FISH_FILES : ["fish1.PNG"];
  const currentFish = el.querySelectorAll('[data-aquarium-fish="true"]').length;
  for (let i = currentFish; i < BACKDROP_FISH_TARGET; i++) {
    spawnSwimmer({ files: fishFiles, dataAttr: "aquariumFish", sizeRange: [40, 70], topRange: [10, 75], container: el });
  }
  const currentBubbles = el.querySelectorAll('[data-aquarium-bubble="true"]').length;
  for (let i = currentBubbles; i < BACKDROP_BUBBLE_TARGET; i++) {
    spawnBubble(el);
  }
}

let backdropPositionLoopActive = false;
function backdropPositionLoop() {
  if (!backdropPositionLoopActive) return;
  positionBackdrop();
  requestAnimationFrame(backdropPositionLoop);
}
function startBackdropPositionLoop() {
  if (backdropPositionLoopActive) return;
  backdropPositionLoopActive = true;
  requestAnimationFrame(backdropPositionLoop);
}
function stopBackdropPositionLoop() {
  backdropPositionLoopActive = false;
}

// ---- Game panel — centered over the backdrop, fish/bubbles cross behind
// it since it's a separate, higher z-index element ----

function injectOverlay() {
  if (document.getElementById("water-overlay")) return;
  const el = document.createElement("div");
  el.id = "water-overlay";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "50",
    display: "none",
    // question box.PNG frames the whole panel, stretched to fill since
    // it's meant to work as a resizable frame.
    backgroundImage: `url(${numberAssetUrl(ANSWER_BOX_FILE)})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    padding: "10px 16px",
    overflow: "auto",
    pointerEvents: "auto",
  });

  // Separate content container, not `el` itself — startXGame() below sets
  // innerHTML wholesale each time, which would otherwise wipe the exit
  // button out along with the old game's markup.
  const content = document.createElement("div");
  content.id = "water-overlay-content";
  Object.assign(content.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
  });
  el.appendChild(content);

  const exitBtn = document.createElement("button");
  exitBtn.id = "water-overlay-exit";
  exitBtn.textContent = "✕";
  exitBtn.setAttribute("aria-label", "Close");
  exitBtn.addEventListener("click", () => {
    gameOverlayDismissed = true;
    refreshCappedUI();
  });
  el.appendChild(exitBtn);

  document.body.appendChild(el);
}

const OVERLAY_WIDTH = 380;

// Centered within the chat area (main's box), not anchored to the
// composer — "the question in the middle" of the aquarium scene, not a
// popover pinned to the prompt box. Height hugs the actual content
// instead of a fixed value (see the note in the previous version of this
// function) so the panel doesn't sit inside a lot of empty space for the
// shorter multiplication game.
function positionOverlay() {
  const el = document.getElementById("water-overlay");
  const main = gamesChatMain();
  if (!el || !main) return;
  const rect = main.getBoundingClientRect();
  const width = Math.min(OVERLAY_WIDTH, rect.width - 32);
  el.style.width = `${width}px`;
  const height = el.offsetHeight || 120;
  el.style.left = `${rect.left + (rect.width - width) / 2}px`;
  el.style.top = `${rect.top + (rect.height - height) / 2}px`;
}

let overlayPositionLoopActive = false;
function overlayPositionLoop() {
  if (!overlayPositionLoopActive) return;
  positionOverlay();
  requestAnimationFrame(overlayPositionLoop);
}
function startOverlayPositionLoop() {
  if (overlayPositionLoopActive) return;
  overlayPositionLoopActive = true;
  requestAnimationFrame(overlayPositionLoop);
}
function stopOverlayPositionLoop() {
  overlayPositionLoopActive = false;
}

// ---- Orchestration ----

function showBackdropAndPanel() {
  injectBackdrop();
  injectOverlay();
  injectComposerBlocker();

  const backdrop = document.getElementById("water-big-overlay");
  const panel = document.getElementById("water-overlay");
  const blocker = document.getElementById("water-composer-blocker");
  if (backdrop) backdrop.style.display = "block";
  if (panel) panel.style.display = "block";
  if (blocker) blocker.style.display = "none";

  stopBlockerPositionLoop();
  positionBackdrop();
  positionOverlay();
  startBackdropPositionLoop();
  startOverlayPositionLoop();

  const composer = findComposer();
  if (composer && document.activeElement === composer) composer.blur();

  const content = document.getElementById("water-overlay-content");
  if (!activeGame && content) {
    activeGame = GAMES[Math.floor(Math.random() * GAMES.length)];
    if (activeGame === "multiplication") startMultiplicationGame(content);
    else startMemoryGame(content);
  }
}

function showBlockerOnly() {
  injectComposerBlocker();

  const backdrop = document.getElementById("water-big-overlay");
  const panel = document.getElementById("water-overlay");
  const blocker = document.getElementById("water-composer-blocker");
  if (backdrop) backdrop.style.display = "none";
  if (panel) panel.style.display = "none";
  if (blocker) blocker.style.display = "block";

  stopBackdropPositionLoop();
  stopOverlayPositionLoop();
  positionComposerBlocker();
  startBlockerPositionLoop();
}

function hideEverything() {
  const backdrop = document.getElementById("water-big-overlay");
  const panel = document.getElementById("water-overlay");
  const blocker = document.getElementById("water-composer-blocker");
  if (backdrop) backdrop.style.display = "none";
  if (panel) panel.style.display = "none";
  if (blocker) blocker.style.display = "none";
  const content = document.getElementById("water-overlay-content");
  if (content) content.innerHTML = "";
  activeGame = null;
  stopBackdropPositionLoop();
  stopOverlayPositionLoop();
  stopBlockerPositionLoop();
}

function refreshCappedUI() {
  if (!gamesIsEnabled()) {
    hideEverything();
    return;
  }
  if (!isCurrentlyCapped()) {
    hideEverything();
    gameOverlayDismissed = false; // reset for the next time it's hit
    return;
  }
  if (gameOverlayDismissed) {
    showBlockerOnly();
  } else {
    showBackdropAndPanel();
  }
}

function earnPromptAndClose() {
  chrome.runtime.sendMessage({ type: "EARN_PROMPT" }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state && typeof updateBucket === "function") updateBucket(state);
    gameOverlayDismissed = false;
    hideEverything();
  });
}

// ---- Multiplication game ----
// 10 questions, times tables 2-12. Wrong answer swaps in a fresh problem
// at the same question count rather than restarting — no punishment
// spiral. Problem is rendered with the teammate's pixel digit/operator
// sprites; the answer itself is a plain number input for reliability.

// "question box.PNG" is the visual for the ANSWER slot specifically (the
// blank you fill in) and, larger, the frame for the whole panel — not a
// frame around every problem digit. Problem digits/operators render as
// plain glyphs, no per-tile box.
const NUMBER_ASSET_FILES = {
  "0": "0.PNG", "1": "1.PNG", "2": "2.PNG", "3": "3.PNG", "4": "4.PNG",
  "5": "5.PNG", "6": "6.PNG", "7": "7.PNG", "8": "8.PNG", "9": "9.PNG",
  x: "x.PNG", "=": "=.PNG",
};
const ANSWER_BOX_FILE = "question box.PNG";

function numberAssetUrl(file) {
  // encodeURIComponent for the "question box.PNG" filename's space — safe
  // here since `file` is always a bare filename, never contains a slash.
  return chrome.runtime.getURL(`assets/numbers/${encodeURIComponent(file)}`);
}

function renderProblemTiles(container, n1, n2) {
  container.innerHTML = "";
  const chars = [...String(n1), "x", ...String(n2), "="];
  chars.forEach((ch) => {
    const glyphFile = NUMBER_ASSET_FILES[ch];
    if (!glyphFile) return;
    const img = document.createElement("img");
    img.src = numberAssetUrl(glyphFile);
    img.alt = ch;
    img.width = 24;
    img.height = 24;
    container.appendChild(img);
  });
}

function startMultiplicationGame(root) {
  const TOTAL_QUESTIONS = 10;
  let questionIndex = 0;
  let n1, n2;

  root.innerHTML = `
    <div style="font-size:13px;color:#2a5f8f;text-align:center;">Solve 10 to earn a prompt (<span id="mg-progress">1</span>/${TOTAL_QUESTIONS})</div>
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;">
      <div id="mg-problem" style="display:flex;gap:4px;align-items:center;"></div>
      <input id="mg-answer" type="number" inputmode="numeric" />
      <button id="mg-submit" class="primary">Check</button>
    </div>
    <div id="mg-feedback" style="font-size:12px;color:#888;min-height:16px;text-align:center;"></div>
  `;

  const problemEl = root.querySelector("#mg-problem");
  const progressEl = root.querySelector("#mg-progress");
  const answerEl = root.querySelector("#mg-answer");
  const feedbackEl = root.querySelector("#mg-feedback");

  function nextQuestion() {
    n1 = 2 + Math.floor(Math.random() * 11); // 2-12
    n2 = 2 + Math.floor(Math.random() * 11);
    renderProblemTiles(problemEl, n1, n2);
    progressEl.textContent = String(questionIndex + 1);
    answerEl.value = "";
    answerEl.focus();
  }

  function checkAnswer() {
    if (Number(answerEl.value) === n1 * n2) {
      questionIndex++;
      if (questionIndex >= TOTAL_QUESTIONS) {
        feedbackEl.textContent = "Solved them all!";
        earnPromptAndClose();
        return;
      }
      feedbackEl.textContent = "Correct!";
    } else {
      feedbackEl.textContent = "Not quite — try this one instead.";
    }
    nextQuestion();
  }

  root.querySelector("#mg-submit").addEventListener("click", checkAnswer);
  answerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkAnswer();
  });

  nextQuestion();
}

// ---- Memory / fish game ----
// 6 tiles, 3 flash a fish briefly, then hide. User clicks back the ones
// that had a fish. Wrong guess reshuffles and re-flashes — same
// no-punishment-spiral rule as the multiplication game.

function startMemoryGame(root) {
  const TILE_COUNT = 6;
  const FISH_COUNT = 3;
  const REVEAL_MS = 2000;
  let fishIndices = new Set();
  let selected = new Set();
  let revealing = true;

  root.innerHTML = `
    <div style="font-size:13px;color:#2a5f8f;text-align:center;">Remember which tiles have the fish</div>
    <div id="mem-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;"></div>
    <button id="mem-submit" class="primary" disabled>Check</button>
    <div id="mem-feedback" style="font-size:12px;color:#888;min-height:16px;text-align:center;"></div>
  `;

  const gridEl = root.querySelector("#mem-grid");
  const submitEl = root.querySelector("#mem-submit");
  const feedbackEl = root.querySelector("#mem-feedback");

  function shuffleFish() {
    fishIndices = new Set();
    while (fishIndices.size < FISH_COUNT) {
      fishIndices.add(Math.floor(Math.random() * TILE_COUNT));
    }
  }

  function renderTiles() {
    gridEl.innerHTML = "";
    for (let i = 0; i < TILE_COUNT; i++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      const showFish = revealing ? fishIndices.has(i) : selected.has(i);
      if (showFish) {
        tile.textContent = "🐟";
        tile.classList.add(revealing ? "revealed-fish" : "selected");
      }
      if (!revealing) {
        tile.addEventListener("click", () => {
          if (selected.has(i)) selected.delete(i);
          else selected.add(i);
          renderTiles();
          submitEl.disabled = selected.size !== FISH_COUNT;
        });
      }
      gridEl.appendChild(tile);
    }
  }

  function startRound() {
    shuffleFish();
    selected = new Set();
    revealing = true;
    renderTiles();
    submitEl.disabled = true;
    feedbackEl.textContent = "";
    setTimeout(() => {
      revealing = false;
      renderTiles();
    }, REVEAL_MS);
  }

  submitEl.addEventListener("click", () => {
    const correct = selected.size === fishIndices.size && [...selected].every((i) => fishIndices.has(i));
    if (correct) {
      feedbackEl.textContent = "Got it!";
      earnPromptAndClose();
    } else {
      feedbackEl.textContent = "Not quite — watch again.";
      startRound();
    }
  });

  startRound();
}

// ---- Drive everything off the same state content.js/aquarium.js track ----

injectGameStyles();

setInterval(() => {
  refreshCappedUI();
  maintainBackdropCreatures();
}, 500);

refreshCappedUI();

console.log("[games] injected");
