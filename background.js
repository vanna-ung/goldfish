// Backend: single source of truth for today's water usage.
// Content scripts and the popup never write storage directly — they message
// this worker, which does the read-modify-write. Keeps multiple claude.ai
// tabs (and popup + content script) from racing each other.

const DEFAULT_DAILY_CAPACITY_ML = 400; // full bucket; adjustable later via the popup (Phase 5)
const BASE_ML_PER_PROMPT = 15; // flat cost every prompt pays
const ML_PER_CHARACTER = 0.05; // placeholder length weighting — tune once real estimates are picked

function costForPrompt(charCount = 0) {
  return BASE_ML_PER_PROMPT + charCount * ML_PER_CHARACTER;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function getDailyCapacityMl() {
  const { dailyCapacityMl } = await chrome.storage.sync.get("dailyCapacityMl");
  return dailyCapacityMl ?? DEFAULT_DAILY_CAPACITY_ML;
}

async function getTodayEntry() {
  const key = todayKey();
  const store = await chrome.storage.local.get(key);
  return store[key] ?? { count: 0, ml: 0 };
}

async function getState() {
  const [entry, capacityMl] = await Promise.all([getTodayEntry(), getDailyCapacityMl()]);
  const remaining = Math.max(capacityMl - entry.ml, 0);
  return {
    date: todayKey(),
    count: entry.count,
    ml: entry.ml,
    capacityMl,
    remaining,
    fraction: capacityMl > 0 ? remaining / capacityMl : 0,
    capped: remaining <= 0,
  };
}

async function recordPrompt(charCount = 0) {
  const key = todayKey();
  const entry = await getTodayEntry();
  const cost = costForPrompt(charCount);
  await chrome.storage.local.set({
    [key]: { count: entry.count + 1, ml: entry.ml + cost },
  });
  return getState();
}

// Read-only projection of what the bucket would look like if the prompt
// currently being typed were sent right now. Uses the same cost formula as
// recordPrompt so the preview never drifts from the real charge.
async function previewCost(charCount = 0) {
  const [entry, capacityMl] = await Promise.all([getTodayEntry(), getDailyCapacityMl()]);
  const cost = costForPrompt(charCount);
  const currentRemaining = Math.max(capacityMl - entry.ml, 0);
  const projectedRemaining = Math.max(capacityMl - (entry.ml + cost), 0);
  return {
    cost,
    currentFraction: capacityMl > 0 ? currentRemaining / capacityMl : 0,
    projectedFraction: capacityMl > 0 ? projectedRemaining / capacityMl : 0,
  };
}

async function resetToday() {
  await chrome.storage.local.remove(todayKey());
  return getState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "RECORD_PROMPT":
        sendResponse(await recordPrompt(message.charCount));
        break;
      case "PREVIEW_COST":
        sendResponse(await previewCost(message.charCount));
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
