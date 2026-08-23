# Goldfish
A mindful companion for your AI habit - Prompt less, think more.

Chrome extension that tracks the water cost of AI prompts, sets a daily prompt limit, and makes you earn more by solving a brain game.

## Run it locally

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, select this folder
4. Open [claude.ai](https://claude.ai), [gemini.google.com](https://gemini.google.com/), or [chatgpt.com](https://chatgpt.com/), then open DevTools console, confirm `[water] injected` appears

After any code change: click the reload icon on the extension card in `chrome://extensions`, then refresh the claude.ai tab.

## Structure

- `manifest.json` — extension config
- `content.js` — runs inside claude.ai, detects prompts
- `background.js` — service worker
- `popup.html` / `popup.js` — toolbar popup UI
- `games/` — unlock mini-games
- `assets/` — icons, images
