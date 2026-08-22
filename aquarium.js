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
const AQUARIUM_WATER_TOP_BY_PHASE = { 1: 0, 2: 27.5, 3: 45, 4: 62.5, 5: 80 };
// The glass panel's own top, independent of water's phase-based level —
// it's the tank's glass wall, sitting partway down the screen (80% of
// the way up) regardless of how full the water currently is. Used to be
// hardcoded to AQUARIUM_WATER_TOP_BY_PHASE[1], which meant "restore
// phase-1 water to 100% full" and "move the glass back down" couldn't be
// asked for independently.
const AQUARIUM_GLASS_TOP_PERCENT = 20;
const AQUARIUM_FISH_COUNT_BY_PHASE = { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2 };
const AQUARIUM_LOBSTER_TARGET = 1; // rare — at most one on screen
const AQUARIUM_LOBSTER_SPAWN_CHANCE = 0.15; // and not guaranteed even when below target
const AQUARIUM_BUBBLE_TARGET = 10;
// Pufferfish shares the same pool/behavior as the regular fish — just
// another variant that can get picked, not a separate creature type.
const AQUARIUM_FISH_FILES = ["fish1.PNG", "fish2.PNG", "fish3.PNG", "fish4.PNG", "fish5.PNG", "pufferfish.PNG"];
const AQUARIUM_LOBSTER_FILES = ["lobster.PNG"];
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
  style.textContent = ``;
  document.head.appendChild(style);
}

// ---- Sand ----
// Real art: assets/aquarium/sand.PNG (new version — no more stacking,
// just one strip along the bottom). Tiled across the full width;
// seaweed is injected after it (see injectAquarium) so it layers on top
// of the sand rather than under it.
const SAND_HEIGHT = 60;

function injectSand(water) {
  const sand = document.createElement("div");
  sand.id = "aquarium-sand";
  Object.assign(sand.style, {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    height: `${SAND_HEIGHT}px`,
    backgroundImage: `url(${aquariumAssetUrl("sand.PNG")})`,
    backgroundRepeat: "repeat-x",
    backgroundSize: `80px ${SAND_HEIGHT}px`,
    backgroundPosition: "bottom",
  });
  water.appendChild(sand);
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
      width: "80px",
      height: "80px",
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
  });
  layer.appendChild(water);

  injectSand(water);
  injectSeaweed(water); // appended after sand, so it layers on top of it

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
    top: `${AQUARIUM_GLASS_TOP_PERCENT}%`,
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
      water.style.top = `${AQUARIUM_WATER_TOP_BY_PHASE[aquariumPhase()] ?? 0}%`;
      setTimeout(() => {
        water.style.transition = "top 800ms ease"; // back to the normal speed for later phase changes
      }, 1800);
    });
  });

  return true;
}

// No stable selector/testid on this one — found the same way it was
// verified live, by its text content.
function findDisclaimerText(main) {
  return [...main.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && /double-check responses/i.test(el.textContent || "")
  );
}

function teardownAquarium() {
  const main = findChatMain();
  if (!main) return;
  const layer = main.querySelector(":scope > #water-aquarium");
  if (layer) layer.remove();
  if (aquariumOriginalBg.has(main)) {
    main.style.backgroundColor = aquariumOriginalBg.get(main);
  }

  const disclaimerText = findDisclaimerText(main);
  if (disclaimerText) {
    const wrapper = disclaimerText.parentElement;
    if (wrapper && aquariumOriginalBg.has(wrapper)) {
      wrapper.style.backgroundColor = aquariumOriginalBg.get(wrapper);
    }
    delete disclaimerText.dataset.aquariumGlassPill;
    Object.assign(disclaimerText.style, {
      display: "",
      padding: "",
      borderRadius: "",
      backdropFilter: "",
      WebkitBackdropFilter: "",
      background: "",
      boxShadow: "",
    });
  }
}

// The disclaimer text ("Claude is AI and can make mistakes...") sits in a
// wrapper with its own opaque bg-surface-1 background — verified live —
// which was blocking the water from showing through underneath it, the
// one gap left even after clearing `main`'s own background. Clears that
// wrapper's background the same way `main`'s was cleared, then styles the
// text itself as a pill-shaped liquid-glass badge (same blur/saturate/
// highlight treatment as the main glass panel) so it stays legible
// sitting directly on the water.
function maintainDisclaimerGlass() {
  const main = findChatMain();
  if (!main) return;
  const disclaimerText = findDisclaimerText(main);
  if (!disclaimerText) return;

  const wrapper = disclaimerText.parentElement;
  if (wrapper) {
    const currentBg = window.getComputedStyle(wrapper).backgroundColor;
    if (currentBg !== "rgba(0, 0, 0, 0)" && currentBg !== "transparent") {
      if (!aquariumOriginalBg.has(wrapper)) {
        aquariumOriginalBg.set(wrapper, currentBg);
      }
      wrapper.style.backgroundColor = "transparent";
    }
  }

  if (disclaimerText.dataset.aquariumGlassPill === "true") return; // already styled
  disclaimerText.dataset.aquariumGlassPill = "true";
  Object.assign(disclaimerText.style, {
    display: "inline-block",
    padding: "4px 14px",
    borderRadius: "9999px",
    backdropFilter: "blur(28px) saturate(110%)",
    WebkitBackdropFilter: "blur(28px) saturate(110%)",
    background: "rgba(255,255,255,0.5)",
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.6), inset 0 0 0 1px rgba(255,255,255,0.25), 0 4px 16px rgba(20,60,90,0.12)",
  });
}

function updateAquariumWaterLevel() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;
  water.style.top = `${AQUARIUM_WATER_TOP_BY_PHASE[aquariumPhase()] ?? 0}%`;
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
  // Stops at the composer's own bottom edge rather than main's — the
  // disclaimer below it already has its own separate pill-glass treatment
  // (see maintainDisclaimerGlass), so the big panel shouldn't also
  // extend down and overlap that area.
  glass.style.bottom = `${layerRect.bottom - rect.bottom}px`;
}

// ---- Swimming creatures (fish + lobster) ----
// Real art: assets/aquarium/fish1-3.PNG, pufferfish.PNG (all one pool —
// pufferfish is a variant, not a separate creature), lobster.PNG. Each
// gets its own independent requestAnimationFrame loop (not a CSS
// keyframe) so it can pick a random speed and optionally reverse
// direction partway across, rather than always crossing edge-to-edge in
// a straight line. Shared by both creature types via `topRange`, which
// is the only thing that differs — lobster stays confined to the bottom
// fourth (bottom-dwelling), fish roam the fuller water column.
function spawnSwimmer({ files, dataAttr, sizeRange, topRange, container }) {
  const water = container || document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  const img = document.createElement("img");
  img.src = aquariumAssetUrl(files[Math.floor(Math.random() * files.length)]);
  img.dataset[dataAttr] = "true";
  const size = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
  img.width = size;
  img.height = size;
  Object.assign(img.style, {
    position: "absolute",
    top: `${topRange[0] + Math.random() * (topRange[1] - topRange[0])}%`,
    pointerEvents: "none",
  });
  water.appendChild(img);

  const containerWidth = water.clientWidth || 400;
  let goingRight = Math.random() < 0.5;
  let x = goingRight ? -size : containerWidth + size;
  const speed = 20 + Math.random() * 35; // px/sec
  const willReverse = Math.random() < 0.35; // some turn around mid-swim
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

function spawnFish() {
  spawnSwimmer({ files: AQUARIUM_FISH_FILES, dataAttr: "aquariumFish", sizeRange: [56, 96], topRange: [15, 85] });
}

function spawnLobster() {
  // Bottom fourth of the water column.
  spawnSwimmer({ files: AQUARIUM_LOBSTER_FILES, dataAttr: "aquariumLobster", sizeRange: [48, 80], topRange: [75, 95] });
}

function maintainFishPopulation() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  // Established chat = just water, no fish (see isEstablishedChat above).
  if (isEstablishedChat()) {
    water.querySelectorAll('[data-aquarium-fish="true"]').forEach((f) => f.remove());
    return;
  }

  // Target tracks the water level (AQUARIUM_WATER_TOP_BY_PHASE, via
  // aquariumPhase()) — not the daily prompt count. The lower the water,
  // the fewer fish.
  const target = AQUARIUM_FISH_COUNT_BY_PHASE[aquariumPhase()] ?? 5;

  // Spawns the whole deficit at once rather than one per tick — with a
  // 3s tick and a target of 10, one-at-a-time meant up to ~30s to reach
  // full population, reading as "barely any fish" right after load.
  const current = water.querySelectorAll('[data-aquarium-fish="true"]').length;
  for (let i = current; i < target; i++) spawnFish();
  if (current > target) {
    [...water.querySelectorAll('[data-aquarium-fish="true"]')]
      .slice(0, current - target)
      .forEach((f) => f.remove());
  }
}

function maintainLobsterPopulation() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;

  if (isEstablishedChat()) {
    water.querySelectorAll('[data-aquarium-lobster="true"]').forEach((l) => l.remove());
    return;
  }

  const current = water.querySelectorAll('[data-aquarium-lobster="true"]').length;
  // Below target doesn't mean it spawns — rolled separately each tick so
  // lobsters feel like an occasional sighting, not a steady presence.
  if (current < AQUARIUM_LOBSTER_TARGET && Math.random() < AQUARIUM_LOBSTER_SPAWN_CHANCE) {
    spawnLobster();
  }
}

// ---- Rising bubbles ----
// Real art: assets/aquarium/bubble1.PNG..bubble4.PNG. Rise from the
// bottom, shrinking as they go.

function spawnBubble(container) {
  const water = container || document.querySelector("#water-aquarium #aquarium-water");
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
  maintainLobsterPopulation();
  maintainSeaweedVisibility();
  maintainDisclaimerGlass();
}, 3000);

// Bubbles get their own faster tick, separate from the shared 3s one
// above — at 3s, a bubble popping right after a tick could sit empty
// for most of that window before being replaced, reading as bubbles
// stopping rather than a continuous rise. 500ms keeps the gap short
// enough that it never reads as empty.
setInterval(() => {
  if (!aquariumIsEnabled()) return;
  maintainBubblePopulation();
}, 500);

// First paint doesn't wait for the interval's first tick.
if (aquariumIsEnabled()) {
  injectAquarium();
  positionGlassPanel();
  maintainFishPopulation();
  maintainLobsterPopulation();
  maintainBubblePopulation();
  maintainSeaweedVisibility();
  maintainDisclaimerGlass();
}

console.log("[aquarium] injected");
