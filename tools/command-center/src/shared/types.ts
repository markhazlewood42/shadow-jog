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

// ---- docs ----
// The shapes of the docs module (src/server/docs). The server builds them and the docs pages read
// them. A doc has two names: its `id` is its path in the repo (`docs/engine/decisions.md`), which
// is what every other module uses to point at it, and its `slug` is its address on the site
// (`/docs/engine/decisions`): the path without `.md` and without a leading `docs/`.

/** Where a doc's last-changed date came from. */
export type UpdatedFrom = 'frontmatter' | 'git' | 'file';

/** A doc as the lists show it. */
export type DocSummary = {
  /** The path in the repo, with forward slashes. It is what a `changed` event names. */
  id: string;
  slug: string;
  /** The `title` of the frontmatter, else the first `#` heading, else the file name. */
  title: string;
  /** The frontmatter `type`, or "" when there is none. */
  type: string;
  /** The frontmatter `status`, or "" when there is none. */
  status: string;
  /** The day the doc last changed, as YYYY-MM-DD. `updatedFrom` says where it was read. */
  updated: string;
  updatedFrom: UpdatedFrom;
};

/** A link to another doc: its address and its title. */
export type DocRef = { slug: string; title: string };

/** One entry of a doc's outline (h2 to h4). `id` is the id of the heading in the html. */
export type DocHeading = { level: 2 | 3 | 4; text: string; id: string };

/** One doc, with its html. The html is safe to put into the page as it is. */
export type DocPage = DocSummary & {
  html: string;
  headings: DocHeading[];
  /** The docs that link here, each once, not the doc itself, and no link that is broken. */
  backlinks: DocRef[];
  /** The addresses of the links in this doc that go nowhere, each once, as the doc wrote them. */
  brokenLinks: string[];
  /** What is wrong with the frontmatter, or null. */
  frontmatterError: string | null;
};

/** One entry in a section of the navigation: a doc, or a page of the site that is not a doc. */
export type NavItem = { kind: 'doc'; slug: string; title: string; updated: string } | { kind: 'page'; path: string; title: string };

/** A section of the navigation. A section holds items and nothing else: the navigation is two levels deep. */
export type NavSection = { id: string; title: string; items: NavItem[] };

/** One hit of a search. One hit for each doc: the section of it that matched best. */
export type SearchHit = {
  slug: string;
  title: string;
  /** The heading of the section that matched, or the doc's title when it has no heading there. Plain text. */
  heading: string;
  /** A few words of that section around the match. Plain text, not html: show it as text. */
  snippet: string;
  score: number;
};

/** What `GET /api/docs` holds (inside a Panel). */
export type DocsListing = {
  docs: DocSummary[];
  nav: NavSection[];
  /** What is wrong with the docs, one line each: broken links, a bad frontmatter, a name clash, a nav.json mistake. */
  problems: string[];
};

/**
 * The answer of `GET /api/docs/<slug>` for an address that no doc has (status 404). It is a failed
 * Panel, so a page that loads it as a panel shows its error; `suggestions` holds the docs that have
 * the same file name, for a doc that was moved.
 */
export type DocNotFound = {
  ok: false;
  error: { code: 'doc-not-found'; message: string };
  updatedAt: null;
  lastGood: null;
  suggestions: DocRef[];
};
