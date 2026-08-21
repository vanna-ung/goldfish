// Backend: single source of truth for today's prompt count / water usage.
// Content scripts and the popup never write storage directly — they message
// this worker, which does the read-modify-write. Keeps multiple claude.ai
// tabs (and popup + content script) from racing each other.

const DEFAULT_DAILY_CAP = 20; // max prompts/day; adjustable later via the popup (Phase 5)
const BASE_ML_PER_PROMPT = 15; // flat placeholder cost; per-character weighting is Phase 3

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
  return store[key] ?? { count: 0, ml: 0 };
}

async function getState() {
  const [entry, cap] = await Promise.all([getTodayEntry(), getDailyCap()]);
  const remaining = Math.max(cap - entry.count, 0);
  return {
    date: todayKey(),
    count: entry.count,
    ml: entry.ml,
    cap,
    remaining,
    fraction: cap > 0 ? remaining / cap : 0,
    capped: remaining <= 0,
  };
}

async function recordPrompt() {
  const key = todayKey();
  const entry = await getTodayEntry();
  await chrome.storage.local.set({
    [key]: {
      count: entry.count + 1,
      ml: entry.ml + BASE_ML_PER_PROMPT,
    },
  });
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
