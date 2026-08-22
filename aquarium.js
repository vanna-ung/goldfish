// EXPERIMENTAL — aquarium background for the chat area only. Kept in its
// own file, deliberately separate from content.js's proven detection/
// bucket/sass logic, so this can be ripped out (or manifest.json's
// content_scripts entry trimmed back to just "content.js") without
// touching anything stable if it doesn't work out.
//
// Multiple files in one manifest content_scripts entry share the same JS
// execution context (like separate <script> tags on one page), so this
// reads `lastPhase` and `extensionEnabled` directly from content.js — no
// message passing needed, and no changes to content.js required.
//
// Scoping: verified live that claude.ai renders the sidebar and the chat
// area as SEPARATE elements — <aside class="dframe-sidebar"> sits on top
// (z-index 20) of <main class="dframe-content">, which spans the full
// width underneath it. That means clearing main's own background and
// inserting the aquarium as its first child scopes everything to the chat
// area automatically: the sidebar is a different element entirely and is
// never touched by this. (An earlier whole-page attempt tried clearing
// <body>'s background instead — that did nothing, because body isn't
// actually where the opaque paint happens; three separate panels are.
// Scoping to just `main` avoids needing to know or touch any of that.)
const CHAT_MAIN_SELECTOR = "main.dframe-content";

// phase 1 = water occupies most of the chat area (line near the top,
// "still mostly full"); phase 5 = water only in the bottom fifth ("nearly
// drained by one big prompt"). Numbers are top-of-water as a % of main's
// own height, not the viewport.
const AQUARIUM_WATER_TOP_BY_PHASE = { 1: 10, 2: 27.5, 3: 45, 4: 62.5, 5: 80 };
const AQUARIUM_FISH_COUNT_BY_PHASE = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 };

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

function injectAquariumStyles() {
  if (document.getElementById("aquarium-style")) return;
  const style = document.createElement("style");
  style.id = "aquarium-style";
  style.textContent = `
    @keyframes aquarium-swim-right { from { left: -40px; } to { left: 100%; } }
    @keyframes aquarium-swim-left { from { right: -40px; } to { right: 100%; } }
    @keyframes aquarium-sway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
    @keyframes aquarium-wave-scroll { from { background-position-x: 0; } to { background-position-x: 40px; } }
  `;
  document.head.appendChild(style);
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
    // Widened 10% past each side rather than flush with the layer: at a
    // few degrees of tilt (see the mousemove handler below), a
    // flush-width rectangle can swing a top corner past the container's
    // edge. The extra margin keeps it covered at any angle we actually use.
    left: "-10%",
    right: "-10%",
    bottom: "0",
    top: "100%", // starts fully drained — see the fill-up animation below
    background: "linear-gradient(180deg, rgba(126,200,242,0.55) 0%, rgba(74,144,217,0.55) 100%)",
    transition: "top 800ms ease",
    // Pivot at the BOTTOM, not the top: water sloshes with its base
    // anchored and the surface tilting, not the other way around. With a
    // top pivot, tilting right lifts the bottom-left corner away from the
    // container's bottom edge and exposes the backdrop underneath it.
    transformOrigin: "50% 100%",
  });
  layer.appendChild(water);

  // Wave strip riding the surface, scrolling left-to-right continuously —
  // a static top edge otherwise reads as a flat pane of glass, not water.
  const wave = document.createElement("div");
  wave.id = "aquarium-wave";
  Object.assign(wave.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: "-8px",
    height: "16px",
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='16' viewBox='0 0 40 16'%3E%3Cpath d='M0 8 Q10 0 20 8 T40 8 V16 H0 Z' fill='%237ec8f2'/%3E%3C/svg%3E\")",
    backgroundRepeat: "repeat-x",
    backgroundSize: "40px 16px",
    opacity: "0.8",
    animation: "aquarium-wave-scroll 2.5s linear infinite",
  });
  water.appendChild(wave);

  for (let i = 0; i < 3; i++) {
    const frond = document.createElement("div");
    frond.textContent = "〰️";
    Object.assign(frond.style, {
      position: "absolute",
      bottom: "0",
      left: `${10 + i * 30}%`,
      fontSize: "40px",
      transformOrigin: "50% 100%",
      animation: `aquarium-sway ${3 + i}s ease-in-out infinite`,
    });
    water.appendChild(frond);
  }

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

// ---- Mouse tilt ----
// Stand-in for a laptop gyroscope/accelerometer: most laptops don't expose
// device-orientation data to the browser at all (that's a phone API), so
// this uses cursor position instead — same "reactive water" feel, works
// on every machine regardless of hardware.
document.addEventListener("mousemove", (e) => {
  if (!aquariumIsEnabled()) return;
  const main = findChatMain();
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!main || !water) return;
  const rect = main.getBoundingClientRect();
  const fraction = (e.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5 across the chat area
  water.style.transform = `rotate(${fraction * 4}deg)`; // max ~2deg either way, subtle
});

// ---- Swimming fish ----
// Placeholder emoji sprites in the asciiquarium spirit (simple silhouettes
// drifting across at varying depths) — not a port of that project, which
// is a Perl/terminal app with no direct web equivalent, just the same
// visual idea rebuilt for CSS. Count drops as the phase rises.
const AQUARIUM_FISH_EMOJI = ["🐟", "🐠"];

function spawnFish() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;
  const fish = document.createElement("div");
  fish.textContent = AQUARIUM_FISH_EMOJI[Math.floor(Math.random() * AQUARIUM_FISH_EMOJI.length)];
  const goingRight = Math.random() < 0.5;
  Object.assign(fish.style, {
    position: "absolute",
    top: `${15 + Math.random() * 70}%`,
    fontSize: `${20 + Math.random() * 10}px`,
    transform: goingRight ? "scaleX(1)" : "scaleX(-1)",
    animation: `${goingRight ? "aquarium-swim-right" : "aquarium-swim-left"} ${12 + Math.random() * 10}s linear`,
  });
  if (goingRight) fish.style.left = "-40px";
  else fish.style.right = "-40px";
  fish.addEventListener("animationend", () => fish.remove());
  fish.dataset.aquariumFish = "true";
  water.appendChild(fish);
}

function maintainFishPopulation() {
  const water = document.querySelector("#water-aquarium #aquarium-water");
  if (!water) return;
  const target = AQUARIUM_FISH_COUNT_BY_PHASE[aquariumPhase()] ?? 5;
  const current = water.querySelectorAll('[data-aquarium-fish="true"]').length;
  if (current < target) spawnFish();
}

injectAquariumStyles();

setInterval(() => {
  if (!aquariumIsEnabled()) {
    teardownAquarium();
    return;
  }
  const freshlyInjected = injectAquarium();
  if (!freshlyInjected) updateAquariumWaterLevel();
  maintainFishPopulation();
}, 3000);

// First paint doesn't wait for the interval's first tick.
if (aquariumIsEnabled()) {
  injectAquarium();
  maintainFishPopulation();
}

console.log("[aquarium] injected");
