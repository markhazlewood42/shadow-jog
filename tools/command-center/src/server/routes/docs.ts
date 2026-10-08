import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Hono } from 'hono';
import type { DocDecision, DocNotFound, DocPageData, DocRef, DecisionsInfo, DocsListing, NavItem, NavSection, Panel, ReadingOrder, SearchHit } from '../../shared/types';
import { bannersOf } from '../decisions/module';
import type { DocIndex } from '../docs/index';
import { OTHER_SECTION_ID } from '../docs/nav';
import { isMissing } from '../fs-errors';
import { apiError } from '../guard';
import type { PanelSource } from '../source';

// The routes of the docs module. Every one is a GET, and none takes a path: a doc is asked for by
// its slug, a file by the id that the index made for it, and both are looked up in the index, so
// no request can name a file of the disk. (The server's method gate refuses every other method.)

/** The longest address that an error message repeats. */
const MAX_ECHO_CHARS = 120;

/** A good panel around some data, made now. The index watches the files, so what it holds is current. */
function panelOf<T>(data: T): Panel<T> {
  return { ok: true, data, updatedAt: new Date().toISOString() };
}

/** The end of an address that asks for the text of a doc: `engine/decisions/source` is the text of the doc `engine/decisions`. */
const SOURCE_SUFFIX = '/source';

/** The doc whose "Reading order" list the engine docs follow: the README of docs/engine. */
const READING_ORDER_DOC = 'engine/README';

/** How long a doc page waits for the decisions (their banners) before it goes on without them. A doc must not hang because gh does not answer. */
const DECISIONS_WAIT_MS = 2000;

/**
 * The banners of a doc: the open decisions that link to a heading of it. Null when they cannot be said: the decisions source has no list (gh
 * failed and never worked) or does not answer within `waitMs`. A source that failed but has an earlier good list gives the banners of that list.
 */
async function bannersFor(source: PanelSource<DecisionsInfo>, docId: string, waitMs: number): Promise<DocDecision[] | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), waitMs);
  });
  try {
    const panel = await Promise.race([source.get(), timeout]);
    if (panel === null) return null;
    const info = panel.ok ? panel.data : panel.lastGood?.data;
    return info === undefined ? null : bannersOf(info, docId);
  } finally {
    clearTimeout(timer);
  }
}

/** The 404 answer for an address that no doc has: a failed Panel that also names the docs with the same file name. */
function docNotFound(docs: DocIndex, slug: string): DocNotFound {
  const shown = slug.length > MAX_ECHO_CHARS ? `${slug.slice(0, MAX_ECHO_CHARS)}...` : slug;
  return {
    ok: false,
    error: { code: 'doc-not-found', message: `No doc has the address "${shown}". It may have been moved or deleted.` },
    updatedAt: null,
    lastGood: null,
    suggestions: docs.suggest(slug),
  };
}

const refOf = (item: Extract<NavItem, { kind: 'doc' }> | undefined): DocRef | null => (item === undefined ? null : { slug: item.slug, title: item.title });

/**
 * The doc before and the doc after `slug` in the reading order of the engine docs, or null when it is
 * in no reading order. The order is the nav's own: nav.json lists the engine docs with a `readingOrder`
 * item, which puts them in the order of the README's "Reading order" list, and then the folder, which
 * adds the docs that the list does not name. So the section that holds the engine README is the order,
 * and Previous and Next walk it as the section tree on the left of the page does.
 */
function readingOrderOf(nav: readonly NavSection[], slug: string): ReadingOrder | null {
  const section = nav.find((candidate) => candidate.id !== OTHER_SECTION_ID && candidate.items.some((item) => item.kind === 'doc' && item.slug === READING_ORDER_DOC));
  if (section === undefined) return null;
  const docs = section.items.filter((item): item is Extract<NavItem, { kind: 'doc' }> => item.kind === 'doc');
  const at = docs.findIndex((item) => item.slug === slug);
  if (at === -1) return null;
  const order = { prev: refOf(docs[at - 1]), next: refOf(docs[at + 1]) };
  // A section of one doc has no neighbor to go to.
  return order.prev === null && order.next === null ? null : order;
}

/**
 * Adds the docs routes to `app`:
 *
 * - `GET /api/docs`: a Panel of `{ docs, nav, problems }`.
 * - `GET /api/docs/<slug>/source`: the text of the file of the doc, as it is (the frontmatter included), as
 *   `text/markdown`. The Copy and Download buttons of a doc page ask for it when they are pressed, so the
 *   page data does not carry it. It takes the slug of an indexed doc and never a path. A doc whose own slug
 *   ends in `/source` keeps its address: `GET /api/docs/<slug>` is tried first, and the text is the fallback.
 * - `GET /api/docs/<slug>`: a Panel of the doc, with its place in the reading order of the engine docs
 *   (`readingOrder`, or null). An address that no doc has gives status 404 and a
 *   failed Panel (code `doc-not-found`) that also carries `suggestions`: the docs that have the
 *   same file name, for a doc that was moved.
 * - `GET /api/search?q=`: a Panel of the hits.
 * - `GET /files/<id>/<name>`: a picture or a diagram source of the repo, by the id in its address.
 *
 * Each route waits for the index's first scan, so a page that asks while the server is starting
 * gets the answer a moment later and not an empty one.
 *
 * `decisions` is the source of the decisions module. With it, a doc also says which open decisions link to a heading of it (`decisions`
 * in the data of `GET /api/docs/<slug>`, for the banners). A doc page waits at most `decisionsWaitMs` for it. Without it, `decisions` is null.
 */
export function registerDocsRoutes(app: Hono, docs: DocIndex, decisions?: PanelSource<DecisionsInfo>, options: { decisionsWaitMs?: number } = {}): void {
  const decisionsWaitMs = options.decisionsWaitMs ?? DECISIONS_WAIT_MS;

  app.get('/api/docs', async (c) => {
    await docs.ready();
    const listing: DocsListing = { docs: docs.list(), nav: docs.nav(), problems: docs.problems() };
    return c.json(panelOf(listing));
  });

  // The slug has slashes in it (`engine/decisions`), so the route takes everything after /api/docs/.
  app.get('/api/docs/*', async (c) => {
    await docs.ready();
    const slug = c.req.path.slice('/api/docs/'.length);
    const page = docs.get(slug);
    if (page === null) {
      // Not a doc page. `<slug>/source` may still be the text of a doc. A doc page is looked up first, so a doc whose own slug
      // ends in "/source" is its page and not the text of another doc (its own text is at `<slug>/source/source`).
      if (slug.endsWith(SOURCE_SUFFIX)) {
        const asked = slug.slice(0, -SOURCE_SUFFIX.length);
        const text = docs.source(asked);
        if (text !== null) {
          // nosniff and no-store are also set for every answer by app.ts. They are said here too, so this route does not depend on that.
          return c.body(text, 200, { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        }
        // The address of the doc that was asked for, without the word "source", is what a person can act on.
        return c.json(docNotFound(docs, asked), 404);
      }
      return c.json(docNotFound(docs, slug), 404);
    }
    const data: DocPageData = {
      ...page,
      readingOrder: readingOrderOf(docs.nav(), slug),
      decisions: decisions === undefined ? null : await bannersFor(decisions, page.id, decisionsWaitMs),
    };
    return c.json(panelOf(data));
  });

  app.get('/api/search', async (c) => {
    await docs.ready();
    return c.json(panelOf<SearchHit[]>(docs.search(c.req.query('q') ?? '')));
  });

  app.get('/files/:id/:name', async (c) => {
    await docs.ready();
    const asset = docs.asset(c.req.param('id'));
    // The id picks the file. The name after it is only there so that a browser shows a sensible name
    // in its tab and when it saves the file, so it must be the file's own name: any other name (a
    // path, `..`, another file) is not the address of a file.
    if (asset === null || basename(asset.file) !== c.req.param('name')) return c.json(apiError('not-found', 'No such file.'), 404);
    try {
      // The index found a plain file here at its last scan. A link or a folder that has taken its place since is not served.
      if (!(await lstat(asset.file)).isFile()) return c.json(apiError('not-found', 'No such file.'), 404);
      const bytes = await readFile(asset.file);
      // The file can change under the same address, so the browser must ask again each time it needs it.
      return c.body(new Uint8Array(bytes), 200, { 'Content-Type': asset.type, 'Cache-Control': 'no-cache' });
    } catch (error) {
      if (isMissing(error)) return c.json(apiError('not-found', 'No such file.'), 404);
      throw error;
    }
  });
}
