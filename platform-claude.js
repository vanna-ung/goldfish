// Platform adapter for claude.ai — the first (and so far only)
// implementation of the interface every other file relies on to stay
// site-agnostic. A second platform (ChatGPT, Gemini, ...) would add its
// own file exposing these same names, verified live against ITS OWN
// DOM — none of what's below is assumed to transfer to another site.
//
// Loaded before content.js/aquarium.js/games.js (see manifest.json),
// which is why everything here is a plain top-level const/function
// rather than an export — same cross-file sharing pattern those three
// already use with each other.
//
// Verified against the live claude.ai DOM (2026-08-21). Both selectors
// below are data-testid attributes rather than aria-label text, which is
// more resilient to copy/label changes than the guessed selectors this
// started with — the previous aria-label guess ("Send Message") didn't
// match the real one ("Send message", lowercase m), which is why sends
// weren't being counted.
const CONFIG = {
  composerSelector: '[data-testid="chat-input"]',
  sendButtonSelector: '[data-testid="chat-input-send"]',
};

const ATTACHMENT_SELECTOR = '[data-testid="file-thumbnail"]';

// Sass comment box shape — matches claude.ai's own modestly-rounded
// composer. (The original, unstyled-by-adapter values — kept here
// explicitly now that a second platform needs its own.)
const SASS_BORDER_RADIUS = "8px";
const SASS_PADDING = "6px 10px";

// Gap/offset baselines — unchanged from content.js's original values,
// kept here explicitly now that a second platform needs its own.
const READOUT_GAP_BELOW_COMPOSER = 12;
const FISH_TOP_OFFSET = 8;

// claude.ai's sticky-header fade, measured live (see AQUARIUM_ESTABLISHED_TOP_OFFSET_PX in aquarium.js).
const HEADER_HEIGHT_PX = 72;

// Scoping: verified live that claude.ai renders the sidebar and the chat
// area as SEPARATE elements — <aside class="dframe-sidebar"> sits on top
// (z-index 20) of <main class="dframe-content">, which spans the full
// width underneath it.
const SIDEBAR_SELECTOR = "aside.dframe-sidebar";
const CHAT_MAIN_SELECTOR = "main.dframe-content";

function sidebarRightEdge() {
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);
  return sidebar ? sidebar.getBoundingClientRect().right : 0;
}

// A NEW chat has the composer centered on the page, no ancestor uses
// sticky positioning. An ESTABLISHED chat docks the composer to the
// bottom via a `position: sticky` wrapper partway up the tree — verified
// live on both layouts. Used to decide whether fish/bubbles should be
// swimming (new chat) or the tank should just be still water (scrolling
// through history).
function isEstablishedChat() {
  const composer = typeof findComposer === "function" ? findComposer() : null;
  if (!composer) return false;
  let el = composer.parentElement;
  for (let i = 0; i < 14 && el; i++) {
    if (window.getComputedStyle(el).position === "sticky") return true;
    el = el.parentElement;
  }
  return false;
}

// No stable selector/testid on this one — found the same way it was
// verified live, by its text content.
function findDisclaimerText(main) {
  return [...main.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && /double-check responses/i.test(el.textContent || "")
  );
}
