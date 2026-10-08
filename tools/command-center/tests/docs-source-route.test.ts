import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocNotFound, DocPage, Panel } from '../src/shared/types';
import { DEFAULT_CONFIG_FILE, loadConfig } from '../src/server/config';
import { createDocIndex } from '../src/server/docs/index';
import { createHub } from '../src/server/hub';
import { registerDocsRoutes } from '../src/server/routes/docs';
import { createRunner } from '../src/server/runner';
import { type DocsRepo, makeDocsApp, makeDocsRepo, makeIndex } from './doc-index-helpers';
import { REPO_DIR, getFrom, makeApp } from './helpers';

// GET /api/docs/<slug>/source: the text of a doc file as it is, for the Copy and Download buttons of a
// doc page (revision 2, design 5.7). These tests check what the route sends, and that it never takes
// a path: the doc is found by its slug in the index, so no request can name a file of the disk.

const repos: DocsRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});

/**
 * A doc with a frontmatter, Windows line ends and non-ASCII letters: a route that parsed, trimmed or re-coded
 * the text would change at least one of them. The slug of the last two docs makes a doc whose slug ends in "source".
 */
const FILES = {
  'docs/engine/decisions.md': '---\r\ntitle: Engine decisions\r\ntype: design\r\n---\r\n# Engine decisions\r\n\r\nCafé — naïve text.  \r\n',
  'docs/guide.md': '# Guide\n\nThe guide.\n',
  'docs/guide/source.md': '# A doc named source\n\nIt is a page, not the source of the guide.\n',
  'status.md': '# Status\n\nThe status file.\n',
};

async function setup() {
  const repo = makeDocsRepo(FILES);
  repos.push(repo);
  const { index } = makeIndex(repo);
  const { app, config } = makeDocsApp(repo, index);
  return { repo, app, config };
}

describe('the source route', () => {
  it('source route returns the file text as markdown with nosniff', async () => {
    const { repo, app, config } = await setup();
    const res = await getFrom(app, '/api/docs/engine/decisions/source', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The same bytes as the file: no change of line ends, no trimming, no other coding.
    const sent = Buffer.from(await res.arrayBuffer());
    expect(sent.equals(readFileSync(join(repo.dir, 'docs', 'engine', 'decisions.md')))).toBe(true);
    // A doc outside docs/ has its slug too (status.md is "status").
    const status = await getFrom(app, '/api/docs/status/source', config);
    expect(status.status).toBe(200);
    expect(await status.text()).toBe(FILES['status.md']);
  });

  it('source route keeps the frontmatter in the text', async () => {
    const { app, config } = await setup();
    const text = await (await getFrom(app, '/api/docs/engine/decisions/source', config)).text();
    expect(text.startsWith('---\r\ntitle: Engine decisions\r\ntype: design\r\n---\r\n# Engine decisions')).toBe(true);
  });

  it('source route answers 404 for an unknown slug', async () => {
    const { app, config } = await setup();
    for (const path of ['/api/docs/nope/source', '/api/docs/engine/source', '/api/docs//source']) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(404);
      // The same shape as the other docs routes: a failed Panel with the code of a missing doc.
      const body = (await res.json()) as DocNotFound;
      expect(body.ok, path).toBe(false);
      expect(body.error.code, path).toBe('doc-not-found');
      expect(body.updatedAt, path).toBeNull();
      expect(body.lastGood, path).toBeNull();
      expect(Array.isArray(body.suggestions), path).toBe(true);
    }
    // The message names the doc that was asked for, not the word "source".
    const body = (await (await getFrom(app, '/api/docs/nope/source', config)).json()) as DocNotFound;
    expect(body.error.message).toContain('"nope"');
  });

  it('source route takes a slug and never a path', async () => {
    const { app, config } = await setup();
    const paths = [
      '/api/docs/..%2f..%2fpackage/source', // climbs out of the folder
      '/api/docs/engine%2Fdecisions/source', // an encoded slash is not a slash
      '/api/docs/docs/engine/decisions/source', // the repo path without .md
      '/api/docs/docs/engine/decisions.md/source', // the repo path
      '/api/docs/engine/decisions.md/source', // the slug with the extension
      '/api/docs/status.md/source', // a real file of the repo, but its slug is "status"
      '/api/docs/package.json/source', // a real file of the tool that is not a doc
      '/api/docs/C:/Windows/win.ini/source', // an absolute path
      '/api/docs/../source', // the browser and the router fold ".." away before the route sees it
    ];
    for (const path of paths) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(404);
      // Whatever answers is not the text of a file.
      expect(res.headers.get('content-type'), path).not.toMatch(/markdown/);
    }
  });

  it('a doc page wins over the source route when the slug ends in source', async () => {
    const { app, config } = await setup();
    // `guide/source` is a doc of its own. The address is its page, as for every other doc.
    const page = await getFrom(app, '/api/docs/guide/source', config);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^application\/json/);
    const panel = (await page.json()) as Panel<DocPage>;
    expect(panel.ok).toBe(true);
    if (panel.ok) expect(panel.data.title).toBe('A doc named source');
    // The source of that doc is one `/source` further. The source of `guide` has no address now: the page of `guide/source` has it.
    const own = await getFrom(app, '/api/docs/guide/source/source', config);
    expect(own.status).toBe(200);
    expect(await own.text()).toBe(FILES['docs/guide/source.md']);
    expect(own.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    // The page of `guide` is unchanged.
    const guide = (await (await getFrom(app, '/api/docs/guide', config)).json()) as Panel<DocPage>;
    expect(guide.ok && guide.data.title).toBe('Guide');
  });

  it('answers only GET', async () => {
    const { app, config } = await setup();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const res = await app.request('/api/docs/engine/decisions/source', { method, headers: { host: `localhost:${config.port}` } });
      expect(res.status, method).toBe(405);
    }
  });
});

// Ruling R15: a check against the real repo runs on demand. It needs no port: the app is asked in the process, so it never touches a server.
//   CC_REAL_NAV=1 npm --prefix tools/command-center run check
describe('the source route on the real repo', () => {
  it.skipIf(process.env.CC_REAL_NAV !== '1')('with CC_REAL_NAV=1, the source route sends the exact bytes of every real doc', async () => {
    const config = loadConfig(DEFAULT_CONFIG_FILE);
    const index = createDocIndex({ config, runner: createRunner(config), hub: createHub() }, { watch: false });
    const { app } = makeApp({ config });
    registerDocsRoutes(app, index);
    await index.ready();

    const docs = index.list();
    expect(docs.length).toBeGreaterThan(40);
    const slugs = new Set(docs.map((doc) => doc.slug));
    let checked = 0;
    for (const doc of docs) {
      // A doc whose slug is `<slug>/source` takes that address, so the text of `<slug>` has none (see the test about it). No real doc is named so today.
      if (slugs.has(`${doc.slug}/source`)) continue;
      const res = await getFrom(app, `/api/docs/${doc.slug.split('/').map(encodeURIComponent).join('/')}/source`, config);
      expect(res.status, doc.id).toBe(200);
      expect(res.headers.get('content-type'), doc.id).toBe('text/markdown; charset=utf-8');
      expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(join(REPO_DIR, doc.id))), doc.id).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(docs.length);
  });
});
