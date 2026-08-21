# Water Tracker

Chrome extension that tracks the water cost of AI prompts on claude.ai, to nudge more mindful usage.

## Run it locally

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, select this folder
4. Open [claude.ai](https://claude.ai), open DevTools console, confirm `[water] injected` appears

After any code change: click the reload icon on the extension card in `chrome://extensions`, then refresh the claude.ai tab.

## Structure

- `manifest.json` — extension config
- `content.js` — runs inside claude.ai, detects prompts
- `background.js` — service worker
- `popup.html` / `popup.js` — toolbar popup UI
- `games/` — unlock mini-games
- `assets/` — icons, images

## Plan

Full build plan (phases, hour budget, cut list) lives in the team doc — see [docs/PLAN.md](docs/PLAN.md).
