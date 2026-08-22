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
  return store[key] ?? { count: 0, bonus: 0, tokensIn: 0, tokensOut: 0 };
}

// mL-used-today estimate: content.js can't see real token counts (no
// tokenizer available client-side), so it approximates both directions
// from character counts and reports the estimated token deltas here.
// This constant converts that estimated token total into the "X mL used
// today" figure — a placeholder ratio (same spirit as content.js's
// ML_PER_PROMPT_DISPLAY for the other usage fishbowl), tune whenever
// there's a better number to use.
const ML_PER_TOKEN = 0.08;

// Lifetime count, never reset — a plain (non-dated) storage key, unlike
// the daily entries. Drives the usage fishbowl (assets/usage/0-8.PNG)
// specifically, which is deliberately independent of the daily cap: it's
// "how much have you used, ever, everywhere" not "how many are left
// today," so it stays the same across chats and across days.
async function getTotalPromptsSent() {
  const { totalPromptsSent } = await chrome.storage.local.get("totalPromptsSent");
  return totalPromptsSent ?? 0;
}

async function getState() {
  const [entry, cap, totalPromptsSent] = await Promise.all([
    getTodayEntry(),
    getDailyCap(),
    getTotalPromptsSent(),
  ]);
  // `bonus` is prompts earned today via a minigame — added on top of the
  // configured cap, not saved into it, so it never carries over to
  // tomorrow and never touches the user's actual daily-limit setting.
  const effectiveCap = cap + (entry.bonus ?? 0);
  const remaining = Math.max(effectiveCap - entry.count, 0);
  const tokensToday = (entry.tokensIn ?? 0) + (entry.tokensOut ?? 0);
  return {
    date: todayKey(),
    count: entry.count,
    cap: effectiveCap,
    remaining,
    fraction: effectiveCap > 0 ? remaining / effectiveCap : 0,
    capped: remaining <= 0,
    totalPromptsSent,
    mlUsedToday: Math.round(tokensToday * ML_PER_TOKEN),
  };
}

async function recordPrompt() {
  const key = todayKey();
  const entry = await getTodayEntry();
  const total = await getTotalPromptsSent();
  await chrome.storage.local.set({
    [key]: { ...entry, count: entry.count + 1 },
    totalPromptsSent: total + 1,
  });
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

// tokensIn/tokensOut are estimates content.js derives from character
// counts (see estimateTokens() there) — one prompt sent, one message
// received back, accumulated into today's running total.
async function recordUsage(tokensIn, tokensOut) {
  const key = todayKey();
  const entry = await getTodayEntry();
  await chrome.storage.local.set({
    [key]: {
      ...entry,
      tokensIn: (entry.tokensIn ?? 0) + (tokensIn || 0),
      tokensOut: (entry.tokensOut ?? 0) + (tokensOut || 0),
    },
  });
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
      case "RECORD_USAGE":
        sendResponse(await recordUsage(message.tokensIn, message.tokensOut));
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
