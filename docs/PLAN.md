# Water Tracker Extension — 48h Build Plan

**Purpose:** remind users to be more mindful of AI usage, especially when it's not necessary — not to discourage AI use completely. Encourage attempting a task before turning to AI.

**The one rule:** nothing else works if send-detection doesn't. Don't touch the bucket, the games, or the styling until you can reliably count prompts. A beautiful bucket that never fills is a zero.

**Realistic budget:** 48 hours minus ~10 for sleep and ~4 for food/setup/pitch = **~34 working hours.** Plan against 34, not 48.

---

## Features

- Calculates the water cost of a prompt before it's sent
- Prompt limit, similar to a screen-time limit
- Chosen LLM to track: Claude
- Graphic: fishbowl with fish, water depletes per prompt

## Reinforcement design

- **Core mechanism (P0):** effort-based friction — a mini-game/puzzle gate to unlock a prompt once the cap is hit. This is the real behavior-change lever, not shame.
- **Flavor, not punishment:** sassy/escalating comments as usage climbs, the Sonion mascot appearing. Low stakes, funny, good demo moments.
- **Loss-aversion visual:** water level drops / clouds as usage climbs. Symbolic only — no real charges, no payment infra.
- **Cut:** real-money charging (Flora-style) — too much scope/legal complexity for 48h and undermines trust in a demo. Fish → shark either cut or repurposed as comic escalation only, not implying threat.

---

## Hour 0 — Prove the plumbing (target: 30 minutes)

Goal is a console log, nothing more, before designing anything.

```
water-tracker/
  manifest.json
  content.js       ← runs inside claude.ai
  background.js    ← service worker
  popup.html
  popup.js
  games/
  assets/
```

- [ ] Go to `chrome://extensions`, enable Developer mode, click Load unpacked, select the folder
- [ ] Open Claude, open DevTools console, confirm `[water] injected` appears
- [ ] Make an edit, click the reload icon on the extension card, refresh the Claude tab, confirm the change appears

If you can do that loop in under 10 seconds, you're ready — you'll run it a few hundred times.

## Phase 1 — Detection (target: 5 hours) — P0

- [ ] Open DevTools, inspect a user message bubble, find a stable-looking attribute (prefer `data-testid` over class names)
- [ ] Write the `CONFIG` object with every selector in one place
- [ ] `MutationObserver` on the conversation container → `recordPrompt()` on new user messages
- [ ] Backup: `keydown` listener on the composer for Enter-without-Shift
- [ ] Dedupe guard — ignore any trigger within 1000ms of the last
- [ ] Persist to `chrome.storage.local` keyed by date: `{ "2026-08-21": { count: 4, ml: 62 } }`
- [ ] Health check: if no selector matches after 5 seconds, `console.warn` loudly

**Done when:** you send 10 prompts, reload the page, and storage says exactly 10.

## Phase 2 — The bucket (target: 6 hours) — P0

This is your demo. Give it real time.

- [ ] Floating container injected into the page, fixed position, draggable if time allows
- [ ] SVG bucket/bottle outline
- [ ] Water = a `<rect>` inside a `clipPath`; animate its `y` to change the level
- [ ] Sine-wave `<path>` on the surface, animated horizontally so it wobbles
- [ ] Level updates with a CSS transition (~600ms) so it rises visibly, not instantly
- [ ] Numeric readout: today's total + this week's total

**Done when:** you send a prompt and water visibly rises without refreshing anything.

## Phase 3 — Weighting + live preview (target: 4 hours) — P0/P1

- [ ] Cost function: base cost + per-character + per-attachment
- [ ] Read composer text on input and compute cost of the pending prompt
- [ ] Show it as a translucent "ghost" layer above the current water line
- [ ] Detect attachment chips in the composer, add their cost to the ghost
- [ ] Ghost becomes real water on send; clears if the composer empties

**Done when:** pasting a wall of text makes the ghost jump before you press Enter.

## Phase 4 — Comparisons + drain (target: 2 hours) — P1

Cheap, high perceived polish. Do these while tired.

- [ ] Array of equivalents (toilet flush ≈ 6 L, shower minute ≈ 9 L, dishwasher ≈ 15 L, kettle ≈ 1 L)
- [ ] Pick the closest one to the current total, display as "≈ 4 minutes of showering"
- [ ] Rotate the phrasing every 10 seconds
- [ ] Evaporation: on load, subtract a small amount per hour since `lastPromptAt`
- [ ] Settings toggle: cooling-only vs full-lifecycle estimate, with both sources named

## Phase 5 — Cap + block (target: 4 hours) — P0

- [ ] Daily prompt limit in `chrome.storage.sync`, editable in the popup
- [ ] On reaching the cap, overlay the composer with your own panel — do **not** redirect the page
- [ ] Overlay explains why and offers "Earn another prompt"
- [ ] Escalating cost: nth overage prompt costs n puzzles
- [ ] Unlock grants exactly one prompt, then the overlay returns

**Done when:** you hit your cap on stage and the overlay appears instantly.

## Phase 6 — One game (target: 3 hours) — P0

Build one, properly. Maths or memory-grid — 20 to 45 seconds each.

- [ ] Renders in the overlay, not a new tab
- [ ] Generates a fresh problem each time
- [ ] Correct → unlock; wrong → new problem, no punishment spiral
- [ ] Escape hatch: closing the overlay returns you to the blocked state cleanly

**Stretch only:** hand-authored 4×4 mini crosswords as JSON. Don't start before Phase 6 is done.

## Phase 7 — Polish + pitch (target: 6 hours, non-negotiable)

- [ ] Popup: today, this week, streak, settings
- [ ] Empty state — what it looks like at zero prompts
- [ ] Pick a name and make a 32×32 icon
- [ ] Write the pitch and time it
- [ ] Rehearse the demo end to end, twice
- [ ] Reset button so you can re-run the demo from zero

---

## Cut list

If you're behind, cut in this order and don't feel bad:

1. Mini crossword
2. Draggable bucket
3. Trivial-vs-substantive prompt heuristic
4. Weekly view / streaks
5. Evaporation

**Never cut:** detection, bucket animation, cap + overlay, one working game.

## Pre-demo checklist (do this an hour before, not five minutes)

- [ ] Dev button that fires a fake prompt — insurance if detection breaks
- [ ] Seed storage with a realistic week of history so the numbers look lived-in
- [ ] Set your cap to 3 so you can hit it live without sending 40 prompts
- [ ] Test on the actual demo laptop, on the actual wifi
- [ ] Screen-record a working run as a backup
- [ ] Close every other tab, extension, and notification

## Gotchas that eat hours

- **Service worker sleeps.** Never hold state in a variable — write to storage on every change, re-read on wake.
- **Content scripts don't auto-reinject.** Reload the extension *and* refresh the tab, every time.
- **Storage is async.** `await` every `chrome.storage` call or you'll chase phantom bugs.
- **Date rollover.** Compute "today" from local time on every read, not once at load.
- **Injecting too early.** Use `run_at: document_idle` and retry finding the composer on an interval.

## The question a judge will ask

*"Where does the water number come from?"*

Credible per-prompt estimates span roughly 0.26 mL to 500+ mL, because some count only data-centre cooling and others include the water behind electricity generation. Say that plainly, show the toggle, name the sources. Owning the uncertainty is stronger than pretending to a precision nobody has.

## Deployment / demo day

No hosting, no backend, no Chrome Web Store submission needed — this is Developer Mode "Load Unpacked" for the entire lifecycle of the project, including the live demo.

- `chrome://extensions` → enable Developer mode → **Load unpacked** → select the repo folder
- Use a dedicated demo Chrome profile, extension icon pinned to the toolbar
- Keep a zipped snapshot of the last known-good build as a fallback in case day-3 changes break something close to demo time
- Test on the actual demo laptop and wifi before going on stage

## Side comments (bank for copy/flavor text)

- "congratulations, you're irrigation"
- "Wivenhoe is watching"
- "At this point just move to the ocean"
