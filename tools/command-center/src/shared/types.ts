// Types shared by the server and the page app. They are the contract between the two: the
// server writes these shapes as JSON and the page reads them. This folder imports nothing from
// the game's own src/ folder, and nothing outside this tool.

/** The name shown in the tab title, the page header and the health reply. */
export const APP_NAME = 'Shadow Jog Command Center';

/** The sources of data. The server has one module for each. */
export type ModuleName = 'docs' | 'engine' | 'status' | 'git' | 'github' | 'sessions' | 'decisions';

/**
 * What a data endpoint answers: either the data, or the reason there is none.
 *
 * A failed panel still carries the last data that did load (`lastGood`), so a page can show an
 * error and the older data together instead of an empty box. `updatedAt` is when the data on
 * offer was made: the time of the last good load, or null when nothing ever loaded.
 */
export type Panel<T> =
  | { ok: true; data: T; updatedAt: string }
  | {
      ok: false;
      error: { code: string; message: string };
      updatedAt: string | null;
      lastGood: { data: T; updatedAt: string } | null;
    };

/** "This module's data changed." The page reloads the panels that listen to that module. */
export type ChangeEvent = {
  module: ModuleName;
  /** When it happened, as an ISO time. */
  at: string;
  /** What changed, when the module knows (for example the ids of the docs that changed). */
  ids?: string[];
};

/** The reply of `GET /api/health`. The Links panel reads the game address and the links from it. */
export type Health = {
  ok: true;
  name: string;
  version: string;
  startedAt: string;
  gameUrl: string;
  links: { label: string; url: string }[];
};

/** The body of every error answer from the server (a refusal, a missing route, a failed write). */
export type ApiErrorBody = {
  ok: false;
  error: { code: string; message: string };
};
