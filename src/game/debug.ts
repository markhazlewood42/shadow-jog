/** Test/debug switches, driven from E2E tests via window.__SJ__.debug. Never enabled in normal play. */
export const debug = {
  /** Dialogs, cards, panels, shops and prompts resolve instantly (choice 0). */
  autoDialog: false,
  /** Battles resolve instantly as wins (rewards still granted). */
  autoBattle: false,
};
