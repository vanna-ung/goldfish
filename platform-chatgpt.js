// Platform adapter for ChatGPT (chatgpt.com / chat.openai.com) — same
// interface as platform-claude.js, verified live against ChatGPT's own
// DOM (2026-08-22, guest/anonymous session) rather than guessed or
// assumed to match claude.ai's markup. See platform-claude.js's header
// for why everything here is a plain top-level const/function.
//
// One thing that does NOT transfer from claude.ai: "walk up for a
// position:sticky ancestor" as the new-vs-established-chat signal.
// ChatGPT wraps the composer in a sticky container (#thread-bottom-
// container) on a BLANK new chat too — verified live, that ancestor is
// sticky either way — so isEstablishedChat() here uses message count
// instead (see below).
const CONFIG = {
  composerSelector: "#prompt-textarea",
  sendButtonSelector: '[data-testid="send-button"]',
};

// NOT independently verified — no file was attached during the DOM
// pass this adapter is based on, so there was nothing to find a
// selector for. Best guess only; re-check before relying on it for
// attachment-weighted typing length (see ATTACHMENT_LENGTH_WEIGHT in
// content.js).
const ATTACHMENT_SELECTOR = '[data-testid*="attachment" i]';

// The persistent icon-only rail, present whether or not the fuller
// history panel is expanded — verified live as a stable `<nav>` id.
// Signed-in accounts may dock a wider persistent sidebar instead of
// this rail; re-verify with an authenticated session before trusting
// this for the fishbowl's left-gap centering.
const SIDEBAR_SELECTOR = "nav#stage-sidebar-tiny-bar";

const CHAT_MAIN_SELECTOR = "main#main";

// A blank new chat has 0 rendered messages; sending one adds
// [data-message-author-role] elements for both turns. Verified live:
// this flips as soon as the first exchange completes, same moment the
// URL moves from "/" to "/c/<uuid>" (a secondary, unused-here signal
// that would work just as well if this one ever breaks).
function isEstablishedChat() {
  return document.querySelectorAll("[data-message-author-role]").length > 0;
}

// Verified live: "ChatGPT can make mistakes. Check important info."
function findDisclaimerText(main) {
  return [...main.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && /can make mistakes/i.test(el.textContent || "")
  );
}
