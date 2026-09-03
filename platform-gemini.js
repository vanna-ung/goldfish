// Platform adapter for Gemini (gemini.google.com) — same interface as
// platform-claude.js/platform-chatgpt.js, verified live against a
// signed-in session (both a blank new chat and an existing long
// conversation) rather than guessed. See platform-claude.js's header
// for why everything here is a plain top-level const/function.
//
// Angular Material app (mat-*, custom elements like CHAT-WINDOW,
// INFINITE-SCROLLER, HALLUCINATION-DISCLAIMER) with a Quill-based
// (ql-editor) rich-text composer — structurally the most different of
// the three platforms so far, not just different selectors on the same
// shape. Two things worth flagging for whoever touches this next:
//
// 1. No position:sticky anywhere in the composer's ancestor chain at
//    all (checked 16 levels up) — so neither claude.ai's nor ChatGPT's
//    established-chat signal applies here. Uses message-turn count
//    instead (see isEstablishedChat below).
// 2. The composer's own ancestor chain never scrolls (repeatedly tested
//    with scrollTop, always clamps back to 0) — the actual scrolling
//    message list (INFINITE-SCROLLER.chat-history, confirmed via
//    scrollHeight ~35000px on a long chat) lives in a SIBLING subtree,
//    not an ancestor. findChatMain() below returns their nearest common
//    ancestor, confirmed non-scrolling and viewport-stable via the same
//    scrollTop-and-remeasure test used for ChatGPT's fix.
const CONFIG = {
  composerSelector: '[aria-label="Enter a prompt for Gemini"]',
  sendButtonSelector: 'button[aria-label="Send message"]',
};

// NOT independently verified — no file was attached during this DOM
// pass. Best guess only.
const ATTACHMENT_SELECTOR = '[data-test-id*="attachment" i]';

// A single element for both collapsed (52px, icon rail) and expanded
// (288px, full history panel) states — simpler than ChatGPT's sidebar,
// which needed two candidates. Confirmed both widths live by toggling
// it and re-measuring.
const SIDEBAR_SELECTOR = ".sidenav-with-history-container";

function sidebarRightEdge() {
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  return sidebar ? sidebar.getBoundingClientRect().right : 0;
}

// See the file header — this is composer.chat-container, the nearest
// ancestor shared by the composer and the actual scrolling message list
// (a sibling subtree, not a composer ancestor). Confirmed stable/
// viewport-pinned by scrolling the real scroller 10000-15000px via
// scrollTop and re-reading this element's (and a real test layer's)
// getBoundingClientRect() — neither moved.
function findChatMain() {
  const composer = document.querySelector(CONFIG.composerSelector);
  let el = composer && composer.parentElement;
  for (let i = 0; i < 16 && el; i++) {
    if ((el.className + "").includes("chat-container")) return el;
    el = el.parentElement;
  }
  return null;
}

// No position:sticky anywhere near the composer (verified live, see
// file header) — a blank new chat has 0 .conversation-container
// elements (one per user/model turn), an established one has several.
function isEstablishedChat() {
  return document.querySelectorAll(".conversation-container").length > 0;
}

// Verified live: "Gemini is AI and can make mistakes." Only present
// once a chat is established (Gemini doesn't show it on a blank new
// chat), so findDisclaimerText() returning nothing there is expected,
// not a bug.
function findDisclaimerText(main) {
  return [...main.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && /can make mistakes/i.test(el.textContent || "")
  );
}

// No distinct sticky top header/title bar found (unlike claude.ai and
// ChatGPT) — established chats' content starts right near the top, so
// no header-fade offset is needed here. Leaving this undefined would
// fall back to claude.ai's 72px, which would be wrong; 0 is the
// verified-correct value, not a placeholder.
const HEADER_HEIGHT_PX = 0;

// Gemini's composer reads as a rounded capsule, similar to ChatGPT's —
// same pill treatment as a reasonable starting point. Unlike ChatGPT's
// SASS_PADDING (measured against a verified stable-anchor height), this
// hasn't been checked against a live composer overlap yet — revisit if
// the comment box turns out to cover typed text here too.
const SASS_BORDER_RADIUS = "9999px";
const SASS_PADDING = "4px 14px";

// The composer's own width doesn't line up with the wider transcript
// column here, so a glass panel sized exactly to the composer cuts
// across message text at its edges. A first attempt narrowed it, which
// was backwards — measured live (.response-container/.conversation-
// container rects vs the composer's stable-anchor rect): the transcript
// column is 32px WIDER than the composer on each side, symmetrically
// (722px column vs 660px composer, both centered the same). Negative
// inset widens instead of narrows, by exactly that measured amount.
const GLASS_WIDTH_INSET_PX = -32;

// Gemini's "Search chats" results view and its notebooks pages aren't a
// chat — no Gemini composer is rendered — so the left/top trackers
// shouldn't show there. content.js's bucketPositionLoop calls this and
// hides them when it's false. The explicit path guard is belt-and-braces
// for any such route that still mounts a composer; add routes as found.
function isChatPage() {
  if (/\/(search|notebook)/i.test(location.pathname)) return false;
  const composer = document.querySelector(CONFIG.composerSelector);
  if (!composer) return false;
  const rect = composer.getBoundingClientRect();
  return composer.offsetParent !== null && rect.width > 0 && rect.height > 0;
}
