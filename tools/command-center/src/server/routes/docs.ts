import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Hono } from 'hono';
import type { DocNotFound, DocsListing, Panel, SearchHit } from '../../shared/types';
import type { DocIndex } from '../docs/index';
import { isMissing } from '../fs-errors';
import { apiError } from '../guard';

// The routes of the docs module. Every one is a GET, and none takes a path: a doc is asked for by
// its slug, a file by the id that the index made for it, and both are looked up in the index, so
// no request can name a file of the disk. (The server's method gate refuses every other method.)

/** The longest address that an error message repeats. */
const MAX_ECHO_CHARS = 120;

/** A good panel around some data, made now. The index watches the files, so what it holds is current. */
function panelOf<T>(data: T): Panel<T> {
  return { ok: true, data, updatedAt: new Date().toISOString() };
}

/**
 * Adds the docs routes to `app`:
 *
 * - `GET /api/docs`: a Panel of `{ docs, nav, problems }`.
 * - `GET /api/docs/<slug>`: a Panel of the doc. An address that no doc has gives status 404 and a
 *   failed Panel (code `doc-not-found`) that also carries `suggestions`: the docs that have the
 *   same file name, for a doc that was moved.
 * - `GET /api/search?q=`: a Panel of the hits.
 * - `GET /files/<id>/<name>`: a picture or a diagram source of the repo, by the id in its address.
 *
 * Each route waits for the index's first scan, so a page that asks while the server is starting
 * gets the answer a moment later and not an empty one.
 */
export function registerDocsRoutes(app: Hono, docs: DocIndex): void {
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
      const shown = slug.length > MAX_ECHO_CHARS ? `${slug.slice(0, MAX_ECHO_CHARS)}...` : slug;
      const missing: DocNotFound = {
        ok: false,
        error: { code: 'doc-not-found', message: `No doc has the address "${shown}". It may have been moved or deleted.` },
        updatedAt: null,
        lastGood: null,
        suggestions: docs.suggest(slug),
      };
      return c.json(missing, 404);
    }
    return c.json(panelOf(page));
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
