// Backend: single source of truth for today's prompt count.
// Content scripts and the popup never write storage directly — they message
// this worker, which does the read-modify-write. Keeps multiple claude.ai
// tabs (and popup + content script) from racing each other.

const DEFAULT_DAILY_CAP = 10; // max prompts/day; adjustable later via the popup

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getDailyCap() {
  const { dailyCap } = await chrome.storage.sync.get("dailyCap");
  return dailyCap ?? DEFAULT_DAILY_CAP;
}

async function getTodayEntry() {
  const key = todayKey();
  const store = await chrome.storage.local.get(key);
  return store[key] ?? { count: 0, bonus: 0 };
}

async function getState() {
  const [entry, cap] = await Promise.all([getTodayEntry(), getDailyCap()]);
  // `bonus` is prompts earned today via a minigame — added on top of the
  // configured cap, not saved into it, so it never carries over to
  // tomorrow and never touches the user's actual daily-limit setting.
  const effectiveCap = cap + (entry.bonus ?? 0);
  const remaining = Math.max(effectiveCap - entry.count, 0);
  return {
    date: todayKey(),
    count: entry.count,
    cap: effectiveCap,
    remaining,
    fraction: effectiveCap > 0 ? remaining / effectiveCap : 0,
    capped: remaining <= 0,
  };
}

async function recordPrompt() {
  const key = todayKey();
  const entry = await getTodayEntry();
  await chrome.storage.local.set({ [key]: { ...entry, count: entry.count + 1 } });
  return getState();
}

// Called when a minigame is won — grants exactly one extra prompt for
// today. The overlay in games.js re-checks state after every send, so
// this bonus naturally covers exactly one send before capped goes true
// again ("unlock grants exactly one prompt, then the overlay returns").
async function earnPrompt() {
  const key = todayKey();
  const entry = await getTodayEntry();
  await chrome.storage.local.set({ [key]: { ...entry, bonus: (entry.bonus ?? 0) + 1 } });
  return getState();
}

async function resetToday() {
  await chrome.storage.local.remove(todayKey());
  return getState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "RECORD_PROMPT":
        sendResponse(await recordPrompt());
        break;
      case "EARN_PROMPT":
        sendResponse(await earnPrompt());
        break;
      case "GET_STATE":
        sendResponse(await getState());
        break;
      case "RESET_TODAY":
        sendResponse(await resetToday());
        break;
      default:
        sendResponse({ error: `unknown message type: ${message?.type}` });
    }
  })();
  return true; // keep the message channel open for the async sendResponse
});

console.log("[water] background worker started");
