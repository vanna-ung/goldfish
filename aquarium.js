// EXPERIMENTAL — aquarium background for the chat area only. Kept in its
// own file, deliberately separate from content.js's proven detection/
// bucket/sass logic, so this can be ripped out (or manifest.json's
// content_scripts entry trimmed back to just "content.js") without
// touching anything stable if it doesn't work out.
//
// Multiple files in one manifest content_scripts entry share the same JS
// execution context (like separate <script> tags on one page), so this
// reads `lastPhase`, `extensionEnabled`, `findComposer`, and
// `anchorRectFor` directly from content.js — no message passing needed,
// no changes to content.js required.
//
// Scoping: verified live that claude.ai renders the sidebar and the chat
// area as SEPARATE elements — <aside class="dframe-sidebar"> sits on top
// (z-index 20) of <main class="dframe-content">, which spans the full
// width underneath it. That means clearing main's own background and
// inserting the aquarium as its first child scopes everything to the chat
// area automatically: the sidebar is a different element entirely and is
// never touched by this.
const CHAT_MAIN_SELECTOR = "main.dframe-content";

// phase 1 = water occupies most of the chat area (line near the top,
// "still mostly full"); phase 5 = water only in the bottom fifth ("nearly
// drained by one big prompt"). Numbers are top-of-water as a % of main's
// own height, not the viewport.
const AQUARIUM_WATER_TOP_BY_PHASE = { 1: 10, 2: 27.5, 3: 45, 4: 62.5, 5: 80 };
const AQUARIUM_FISH_COUNT_BY_PHASE = { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2 };
const AQUARIUM_BUBBLE_TARGET = 10;
const AQUARIUM_FISH_VARIANTS = 3; // fish1.PNG..fish3.PNG
const AQUARIUM_BUBBLE_VARIANTS = 4; // bubble1.PNG..bubble4.PNG

// Cached per chat-main element (see findChatMain) rather than read once at
// script load — claude.ai's SPA can swap in a new <main>, and that fresh
// element's original background needs capturing before we clear it.
const aquariumOriginalBg = new WeakMap();

function aquariumPhase() {
  // `lastPhase` lives in content.js; 0 there means "no composer yet", but
  // the aquarium should still show something reasonable, so floor at 1.
  return typeof lastPhase === "number" && lastPhase > 0 ? lastPhase : 1;
}

function aquariumIsEnabled() {
  return typeof extensionEnabled === "undefined" || extensionEnabled;
}

function findChatMain() {
  return document.querySelector(CHAT_MAIN_SELECTOR);
}

function aquariumAssetUrl(file) {
  return chrome.runtime.getURL(`assets/aquarium/${file}`);
}

// A NEW chat has the composer centered on the page, no ancestor uses
// sticky positioning. An ESTABLISHED chat docks the composer to the
// bottom via a `position: sticky` wrapper partway up the tree — verified
// live on both layouts. Used to decide whether fish/bubbles should be
// swimming (new chat) or the tank should just be still water (scrolling
// through history).
function isEstablishedChat() {
  const composer = typeof findComposer === "function" ? findComposer() : null;
  if (!composer) return false;
  let el = composer.parentElement;
  for (let i = 0; i < 14 && el; i++) {
    if (window.getComputedStyle(el).position === "sticky") return true;
    el = el.parentElement;
  }
  return false;
}

function injectAquariumStyles() {
  if (document.getElementById("aquarium-style")) return;
  const style = document.createElement("style");
  style.id = "aquarium-style";
  style.textContent = `
    @keyframes aquarium-wave-scroll { from { background-position-x: 0; } to { background-position-x: 36px; } }
  `;
  document.head.appendChild(style);
}

// ---- Seaweed ----
// Real art: assets/aquarium/seaweed1.PNG, seaweed2.PNG — four fronds,
// evenly spaced along the bottom, each alternating between the two
// frames every 2s (the two images ARE the sway, not a CSS animation on
// top of them). Wrapped in one container so maintainSeaweedVisibility()
// can show/hide all four as a unit.
const SEAWEED_COUNT = 4;
const SEAWEED_SWITCH_INTERVAL_MS = 2000;

function injectSeaweed(water) {
  const container = document.createElement("div");
  container.id = "aquarium-seaweed";
  Object.assign(container.style, { position: "absolute", inset: "0", pointerEvents: "none" });

  for (let i = 0; i < SEAWEED_COUNT; i++) {
    const frond = document.createElement("img");
    frond.dataset.seaweedFrame = "1";
    frond.src = aquariumAssetUrl("seaweed1.PNG");
    const leftPercent = ((i + 0.5) / SEAWEED_COUNT) * 100; // evenly spaced
    Object.assign(frond.style, {
      position: "absolute",
      bottom: "0",
      left: `${leftPercent}%`,
      transform: "translateX(-50%)",
      width: "48px",
      height: "48px",
    });
    container.appendChild(frond);
  }
  water.appendChild(container);

  const intervalId = setInterval(() => {
    if (!container.isConnected) {
      clearInterval(intervalId); // aquarium was torn down/replaced — stop instead of leaking
      return;
    }
    container.querySelectorAll("img").forEach((frond) => {
      const nextFrame = frond.dataset.seaweedFrame === "1" ? "2" : "1";
      frond.dataset.seaweedFrame = nextFrame;
      frond.src = aquariumAssetUrl(`seaweed${nextFrame}.PNG`);
    });
  }, SEAWEED_SWITCH_INTERVAL_MS);
}

// Same rule as fish/bubbles — only on a fresh/blank chat, not established.
function maintainSeaweedVisibility() {
  const seaweed = document.querySelector("#water-aquarium #aquarium-seaweed");
  if (!seaweed) return;
  seaweed.style.display = isEstablishedChat() ? "none" : "block";
}

// Returns true only when it just created a fresh aquarium (so the caller
// knows NOT to also call updateAquariumWaterLevel() this tick — doing so
// would synchronously jump the water to its target before the fill-up
// animation's requestAnimationFrame callback below ever gets to run).
function injectAquarium() {
  const main = findChatMain();
  if (!main) return false;
  if (main.querySelector(":scope > #water-aquarium")) return false; // already injected into this main

  if (!aquariumOriginalBg.has(main)) {
    aquariumOriginalBg.set(main, window.getComputedStyle(main).backgroundColor);
  }
  main.style.backgroundColor = "transparent";
  if (window.getComputedStyle(main).position === "static") {
    main.style.position = "relative"; // so our absolute layer anchors to main, not some further ancestor
  }

  const layer = document.createElement("div");
  layer.id = "water-aquarium";
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    zIndex: "0",
    overflow: "hidden",
    pointerEvents: "none",
    background: aquariumOriginalBg.get(main), // fills the area above the water line
  });

  const water = document.createElement("div");
  water.id = "aquarium-water";
  Object.assign(water.style, {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    top: "100%", // starts fully drained — see the fill-up animation below
    background: "linear-gradient(180deg, rgba(126,200,242,0.55) 0%, rgba(74,144,217,0.55) 100%)",
    transition: "top 800ms ease",
    // No overflow:hidden here (unlike `layer`, which still clips at
    // main's outer bounds) — the wave below straddles ABOVE water's own
    // top edge on purpose, and water clipping its own children would cut
    // that crest off, making it look tucked under the blue instead of
    // riding on top of it.
  });
  layer.appendChild(water);

  // Wave strip riding the surface, scrolling left-to-right continuously —
  // a static top edge otherwise reads as a flat pane of glass, not water.
  // Straddles water's top edge (half above, half below) so it visibly
  // sits ON the surface rather than being flush with/hidden inside it.
  const wave = document.createElement("div");
  wave.id = "aquarium-wave";
  Object.assign(wave.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: "-32px",
    height: "64px",
    backgroundImage: `url(${aquariumAssetUrl("wave.PNG")})`,
    backgroundRepeat: "repeat-x",
    backgroundSize: "64px 64px",
    animation: "aquarium-wave-scroll 2.5s linear infinite",
  });
  water.appendChild(wave);

  injectSeaweed(water);

  // Liquid-glass panel: a frosted strip sitting ON TOP of the water (and
  // the fish/bubbles inside it) but BEHIND the real chat text — it's a
  // sibling of `water`, appended after it, both inside `layer`, so it
  // paints over the water while `layer` as a whole stays behind main's
  // real content (see positionGlassPanel for sizing/visibility). Fixed
  // vertical span from roughly where phase-1's water line sits down to
  // the composer — it's the tank's glass wall, visible whether or not
  // water currently reaches that high, not a mask that tracks the
  // current water level. Only shown on established chats (see
  // positionGlassPanel) — a blank new chat has no history to protect.
  const glass = document.createElement("div");
  glass.id = "aquarium-glass";
  Object.assign(glass.style, {
    position: "absolute",
    top: `${AQUARIUM_WATER_TOP_BY_PHASE[1]}%`,
    bottom: "0",
    display: "none", // positionGlassPanel() turns this on for established chats
    borderRadius: "28px",
    // Apple "Liquid Glass" approximation: blur + a much lighter
    // saturation boost than before — 180% was amplifying the blue water
    // showing through the blur enough that the panel read as tinted blue
    // rather than clear. Higher white opacity for the same reason: it
    // needs to actually neutralize the blue behind it, not just blur it.
    backdropFilter: "blur(28px) saturate(110%)",
    WebkitBackdropFilter: "blur(28px) saturate(110%)",
    background: "rgba(255,255,255,0.5)",
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.6), inset 0 0 0 1px rgba(255,255,255,0.25), 0 8px 32px rgba(20,60,90,0.18)",
    pointerEvents: "none",
  });
  layer.appendChild(glass);

  main.insertBefore(layer, main.firstChild); // first child = behind all real content

  // Fill-up-on-load: start empty (top: 100%, set above), then on the next
  // frame animate to the real target. A longer transition than the normal
  // 800ms phase-change one, so it reads as a deliberate reveal rather than
  // just another quick update.
  water.style.transition = "top 1800ms ease";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      water.style.top = `${AQUARIUM_WATER_TOP_BY_PHASE[aquariumPhase()] ?? 10}%`;
      setTimeout(() => {
        water.style.transition = "top 800ms ease"; // back to the normal speed for later phase changes
      }, 1800);
    });
  });

  return true;
}

function teardownAquarium() {
  const main = findChatMain();
  if (!main) return;
  const layer = main.querySelector(":scope > #water-aquarium");
  if (layer) layer.remove();
  if (aquariumOriginalBg.has(main)) {
    main.style.backgroundColor = aquariumOriginalBg.get(main);
  }
}

function updateAquariumWaterLevel() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;
  water.style.top = `${AQUARIUM_WATER_TOP_BY_PHASE[aquariumPhase()] ?? 10}%`;
}

// Glass is only shown on established chats — a blank new chat has no
// history behind it to protect. Its left/width track the composer's own
// rect directly (not centered within `main`, which spans the full
// viewport width INCLUDING the portion hidden behind the sidebar — that
// mismatch was why it previously rendered shifted left of the visible
// content). Re-synced periodically rather than every frame; doesn't need
// to be pixel-perfect live.
function positionGlassPanel() {
  const glass = document.querySelector("#water-aquarium #aquarium-glass");
  const layer = document.getElementById("water-aquarium");
  if (!glass || !layer) return;

  if (!isEstablishedChat()) {
    glass.style.display = "none";
    return;
  }

  const composer = typeof findComposer === "function" ? findComposer() : null;
  const rect = composer && typeof anchorRectFor === "function" ? anchorRectFor(composer) : null;
  if (!rect || rect.width <= 0) return;

  const layerRect = layer.getBoundingClientRect();
  glass.style.display = "block";
  glass.style.left = `${rect.left - layerRect.left}px`;
  glass.style.width = `${rect.width}px`;
}

// ---- Swimming fish ----
// Real art: assets/aquarium/fish1.PNG..fish3.PNG. Each fish gets its own
// independent requestAnimationFrame loop (not a CSS keyframe) so it can
// pick a random speed and optionally reverse direction partway across,
// rather than always crossing edge-to-edge in a straight line.

function spawnFish() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  const img = document.createElement("img");
  const variant = 1 + Math.floor(Math.random() * AQUARIUM_FISH_VARIANTS);
  img.src = aquariumAssetUrl(`fish${variant}.PNG`);
  img.dataset.aquariumFish = "true";
  const size = 56 + Math.random() * 40;
  img.width = size;
  img.height = size;
  Object.assign(img.style, {
    position: "absolute",
    top: `${15 + Math.random() * 70}%`,
    pointerEvents: "none",
  });
  water.appendChild(img);

  const containerWidth = water.clientWidth || 400;
  let goingRight = Math.random() < 0.5;
  let x = goingRight ? -size : containerWidth + size;
  const speed = 20 + Math.random() * 35; // px/sec
  const willReverse = Math.random() < 0.35; // some fish turn around mid-swim
  const reverseX = containerWidth * (0.3 + Math.random() * 0.4);
  let hasReversed = false;

  // The source art faces left by default, so travelling right needs the
  // horizontal flip, not the other way — this was backwards before (fish
  // visually swam tail-first).
  img.style.transform = goingRight ? "scaleX(-1)" : "scaleX(1)";
  img.style.left = `${x}px`;

  let lastTime = performance.now();
  function step(now) {
    if (!img.isConnected) return; // removed already (teardown, established chat, etc.)
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    x += (goingRight ? 1 : -1) * speed * dt;

    if (willReverse && !hasReversed && ((goingRight && x >= reverseX) || (!goingRight && x <= reverseX))) {
      goingRight = !goingRight;
      hasReversed = true;
      img.style.transform = goingRight ? "scaleX(-1)" : "scaleX(1)";
    }

    img.style.left = `${x}px`;

    if (x < -size - 20 || x > containerWidth + size + 20) {
      img.remove();
      return;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function maintainFishPopulation() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  // Established chat = just water, no fish (see isEstablishedChat above).
  if (isEstablishedChat()) {
    water.querySelectorAll('[data-aquarium-fish="true"]').forEach((f) => f.remove());
    return;
  }

  // Spawns the whole deficit at once rather than one per tick — with a
  // 3s tick and a target of 10, one-at-a-time meant up to ~30s to reach
  // full population, reading as "barely any fish" right after load.
  const target = AQUARIUM_FISH_COUNT_BY_PHASE[aquariumPhase()] ?? 5;
  const current = water.querySelectorAll('[data-aquarium-fish="true"]').length;
  for (let i = current; i < target; i++) spawnFish();
}

// ---- Rising bubbles ----
// Real art: assets/aquarium/bubble1.PNG..bubble4.PNG. Rise from the
// bottom, shrinking as they go.

function spawnBubble() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  const img = document.createElement("img");
  const variant = 1 + Math.floor(Math.random() * AQUARIUM_BUBBLE_VARIANTS);
  img.src = aquariumAssetUrl(`bubble${variant}.PNG`);
  img.dataset.aquariumBubble = "true";
  const startSize = 28 + Math.random() * 20;
  Object.assign(img.style, {
    position: "absolute",
    left: `${5 + Math.random() * 90}%`,
    bottom: "0px",
    pointerEvents: "none",
  });
  img.width = startSize;
  img.height = startSize;
  water.appendChild(img);

  const containerHeight = water.clientHeight || 300;
  let y = 0;
  const speed = 20 + Math.random() * 25; // px/sec upward
  let lastTime = performance.now();

  function step(now) {
    if (!img.isConnected) return;
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    y += speed * dt;
    const progress = Math.min(1, y / containerHeight);
    const size = Math.max(2, startSize * (1 - progress * 0.7)); // shrinks to ~30% at the top
    img.width = size;
    img.height = size;
    img.style.bottom = `${y}px`;
    img.style.opacity = String(1 - progress * 0.3);

    if (y > containerHeight + 10) {
      img.remove();
      return;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function maintainBubblePopulation() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  // Same rule as fish — established chat is just still water.
  if (isEstablishedChat()) {
    water.querySelectorAll('[data-aquarium-bubble="true"]').forEach((b) => b.remove());
    return;
  }

  const current = water.querySelectorAll('[data-aquarium-bubble="true"]').length;
  for (let i = current; i < AQUARIUM_BUBBLE_TARGET; i++) spawnBubble();
}

injectAquariumStyles();

setInterval(() => {
  if (!aquariumIsEnabled()) {
    teardownAquarium();
    return;
  }
  const freshlyInjected = injectAquarium();
  if (!freshlyInjected) updateAquariumWaterLevel();
  positionGlassPanel();
  maintainFishPopulation();
  maintainBubblePopulation();
  maintainSeaweedVisibility();
}, 3000);

// First paint doesn't wait for the interval's first tick.
if (aquariumIsEnabled()) {
  injectAquarium();
  positionGlassPanel();
  maintainFishPopulation();
  maintainBubblePopulation();
  maintainSeaweedVisibility();
}

console.log("[aquarium] injected");
