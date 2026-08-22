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

// The "+" button's attach/tools menu (Add photos & files, Web search,
// etc.) — verified live via its actual class list, "popover" among a
// long generated Tailwind string. Opens below the composer when there's
// room (new chat, composer vertically centered) or above it when there
// isn't (established chat, composer docked near the bottom) — a Radix
// popper, so it flips automatically; content.js reacts to wherever it
// currently is rather than assuming a fixed direction. Other ChatGPT
// popovers likely share this same base class and get the same
// treatment, which is fine — they'd cause the same visual conflict.
const FILE_MENU_SELECTOR = ".popover";

// ChatGPT's composer reads as almost pill-shaped — a full pill radius
// matches that instead of claude.ai's more modest rounded rect. Padding
// is shorter top/bottom than claude.ai's: the sass comment straddles
// the composer's own top edge (half above, half inside — see
// positionSass() in content.js), and the taller default padding pushed
// that overlap far enough down to cover the first line of typed text.
const SASS_BORDER_RADIUS = "9999px";
const SASS_PADDING = "3px 14px";

// The stable anchor content.js finds for ChatGPT's composer (nearest
// non-transparent-background ancestor) measures ~52px tall — noticeably
// shorter than claude.ai's, so the readout/fish gap values tuned there
// read as sitting too far from the composer here. Brought both in.
const READOUT_GAP_BELOW_COMPOSER = 4;
const FISH_TOP_OFFSET = -15;

// Read directly from ChatGPT's own --header-height CSS custom property
// (computed on <html>) rather than measured off a screenshot — verified
// live it resolves to 52px and matches the real <header> element's
// rendered height exactly.
const HEADER_HEIGHT_PX = 52;

// Re-verified with a signed-in session: ChatGPT's sidebar isn't one
// consistent element. The icon-only rail (nav#stage-sidebar-tiny-bar)
// is a fixed 52px, but the fuller panel (#stage-slideover-sidebar)
// renders at different widths depending on state — measured live at
// 52px, 187px, and 260px across collapsed/mid-toggle/expanded — without
// cleanly mapping to one selector being "the" answer in every state.
// Taking the widest of both candidates' current rects sidesteps having
// to fully pin down which one is authoritative when: whichever is
// actually widest right now IS the real visible boundary.
function sidebarRightEdge() {
  const candidates = [
    document.querySelector("nav#stage-sidebar-tiny-bar"),
    document.getElementById("stage-slideover-sidebar"),
  ];
  return candidates.reduce((max, el) => (el ? Math.max(max, el.getBoundingClientRect().right) : max), 0);
}

// NOT main#main, and NOT [data-scroll-root] either — both tried and
// both wrong, verified live (signed-in session, long conversation,
// artificially scrolled thousands of px via scrollTop and re-measured):
//
// - main#main's own box is only ever one viewport tall even though its
//   content overflows far past that, and main itself moves as its
//   scrolling ancestor scrolls (rect.top goes deeply negative) — so a
//   layer attached to main scrolls away with it.
// - [data-scroll-root] (one level up, the actual `overflow-y: auto`
//   element) looked like the fix, but position:absolute children DO
//   scroll along with their own scrolling containing block — that's
//   normal CSS behavior, not something position:absolute exempts you
//   from. A test layer attached there also scrolled away, confirmed by
//   directly setting scrollTop and re-reading getBoundingClientRect().
//
// The real fix is the PARENT of [data-scroll-root]: itself not a
// scroll container (overflow-y: visible), so its own box never moves
// when the descendant scrolls — confirmed by the same scrollTop test,
// this one's rect stayed exactly put. That's the actual equivalent of
// claude.ai's main.dframe-content (a stable, non-scrolling, viewport-
// bound anchor with the scrolling happening in a descendant instead).
function findChatMain() {
  const scrollRoot = document.querySelector("[data-scroll-root]");
  return scrollRoot && scrollRoot.parentElement;
}

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
