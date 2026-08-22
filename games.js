// "Earn a prompt back" minigames — shown once the daily cap (plus any
// earned bonus) is used up. Kept in its own file for the same reason as
// aquarium.js: shares content.js's execution context (currentState,
// findComposer, anchorRectFor, extensionEnabled, updateBucket) without
// message passing or changes to the already-working core.
//
// The panel floats in the gap above the composer — between the end of the
// conversation and the top of the prompt box — rather than covering the
// composer itself. Stretching it to match the composer's exact box (an
// earlier version of this) visually broke the real input underneath it,
// which isn't what this is for. It still calls composer.blur() once when
// it appears as a mild nudge, but this isn't a hard block on typing/
// sending — a content script can't truly intercept claude.ai's own submit
// handling, only sit near it.

const GAMES = ["multiplication", "memory"];
let activeGame = null; // "multiplication" | "memory" | null while the overlay is up

function gamesIsEnabled() {
  return typeof extensionEnabled === "undefined" || extensionEnabled;
}

function isCurrentlyCapped() {
  return typeof currentState !== "undefined" && !!currentState && currentState.capped;
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
  `;
  document.head.appendChild(style);
}

// ---- Overlay shell ----

function injectOverlay() {
  if (document.getElementById("water-overlay")) return;
  const el = document.createElement("div");
  el.id = "water-overlay";
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "50",
    display: "none",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    // question box.PNG frames the whole panel now, not individual tiles —
    // stretched to fill since it's meant to work as a resizable frame.
    backgroundImage: `url(${numberAssetUrl(ANSWER_BOX_FILE)})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat",
    padding: "16px",
    overflow: "auto",
    pointerEvents: "auto",
  });
  document.body.appendChild(el);
}

const OVERLAY_WIDTH = 380;
const OVERLAY_HEIGHT = 240;
const OVERLAY_GAP_ABOVE_COMPOSER = 16;

function positionOverlay() {
  const el = document.getElementById("water-overlay");
  const composer = findComposer();
  if (!el || !composer) return;
  const rect = anchorRectFor(composer);
  if (!rect) return;
  const width = Math.min(OVERLAY_WIDTH, rect.width);
  el.style.width = `${width}px`;
  el.style.height = `${OVERLAY_HEIGHT}px`;
  el.style.left = `${rect.left + (rect.width - width) / 2}px`;
  el.style.top = `${rect.top - OVERLAY_HEIGHT - OVERLAY_GAP_ABOVE_COMPOSER}px`;
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

function showOverlay() {
  injectOverlay();
  const el = document.getElementById("water-overlay");
  el.style.display = "flex";
  positionOverlay();
  startOverlayPositionLoop();

  const composer = findComposer();
  if (composer && document.activeElement === composer) composer.blur();

  if (!activeGame) {
    activeGame = GAMES[Math.floor(Math.random() * GAMES.length)];
    if (activeGame === "multiplication") startMultiplicationGame(el);
    else startMemoryGame(el);
  }
}

function hideOverlay() {
  const el = document.getElementById("water-overlay");
  if (el) {
    el.style.display = "none";
    el.innerHTML = "";
  }
  activeGame = null;
  stopOverlayPositionLoop();
}

function earnPromptAndClose() {
  chrome.runtime.sendMessage({ type: "EARN_PROMPT" }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state && typeof updateBucket === "function") updateBucket(state);
    hideOverlay();
  });
}

// ---- Multiplication game ----
// 10 questions, times tables 2-12. Wrong answer swaps in a fresh problem
// at the same question count rather than restarting — no punishment
// spiral. Problem is rendered with the teammate's pixel digit/operator
// sprites; the answer itself is a plain number input for reliability.

// "question box.PNG" is the visual for the ANSWER slot specifically (the
// blank you fill in) — not a frame around every problem digit. Problem
// digits/operators render as plain glyphs, no per-tile box.
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
    <div style="font-size:13px;color:#2a5f8f;">Solve 10 to earn a prompt (<span id="mg-progress">1</span>/${TOTAL_QUESTIONS})</div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div id="mg-problem" style="display:flex;gap:4px;align-items:center;"></div>
      <input id="mg-answer" type="number" inputmode="numeric" />
      <button id="mg-submit" class="primary">Check</button>
    </div>
    <div id="mg-feedback" style="font-size:12px;color:#888;min-height:16px;"></div>
  `;

  const problemEl = root.querySelector("#mg-problem");
  const progressEl = root.querySelector("#mg-progress");
  const answerEl = root.querySelector("#mg-answer");
  const feedbackEl = root.querySelector("#mg-feedback");
  answerEl.style.backgroundImage = `url(${numberAssetUrl(ANSWER_BOX_FILE)})`;

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
    <div style="font-size:13px;color:#2a5f8f;">Remember which tiles have the fish</div>
    <div id="mem-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;"></div>
    <button id="mem-submit" class="primary" disabled>Check</button>
    <div id="mem-feedback" style="font-size:12px;color:#888;min-height:16px;"></div>
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

// ---- Drive the overlay off the same state content.js already tracks ----

injectGameStyles();

setInterval(() => {
  if (!gamesIsEnabled()) {
    hideOverlay();
    return;
  }
  if (isCurrentlyCapped()) showOverlay();
  else hideOverlay();
}, 500);

console.log("[games] injected");
