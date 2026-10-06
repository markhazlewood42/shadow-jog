import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocNotFound, DocPage, DocPageData, DocsListing, Panel, SearchHit } from '../src/shared/types';
import { compose } from '../src/server/compose';
import { DEFAULT_CONFIG_FILE, loadConfig } from '../src/server/config';
import { createDocIndex } from '../src/server/docs/index';
import { createHub } from '../src/server/hub';
import { createRunner } from '../src/server/runner';
import { registerDocsRoutes } from '../src/server/routes/docs';
import { PACKAGE_DIR, REPO_DIR, SseReader, getFrom, makeApp, noopRunner } from './helpers';
import { type DocsRepo, makeDocsApp, makeDocsRepo, makeIndex, must, pageOf } from './doc-index-helpers';

// The HTTP side of the doc index: the panels of /api/docs, /api/docs/<slug> and /api/search, the
// file route, and the two checks of the "Done when" list (the real repo, and an edit that reaches
// an event-stream client).

const repos: DocsRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});
function repoWith(files: Record<string, string | Buffer>): DocsRepo {
  const repo = makeDocsRepo(files);
  repos.push(repo);
  return repo;
}

/** A PNG signature and a few bytes: not a real picture, but the server serves bytes, not pictures. */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff]);

describe('the file route', () => {
  const files = {
    'docs/a.md': '# A\n\n![flow](diagrams/flow.png) [source](diagrams/flow.html) ![vector](diagrams/vector.svg)\n',
    'docs/diagrams/flow.png': PNG_BYTES,
    'docs/diagrams/flow.html': '<!doctype html><title>flow</title><p>hello</p><script>document.title = "ran"</script>',
    'docs/diagrams/vector.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>1</script></svg>',
    'docs/secret.txt': 'not an asset: only pictures and diagram sources are served',
  };

  /** The address of each served file, as the html of doc "a" writes it. */
  function addressesIn(page: DocPage): Record<string, string> {
    const found: Record<string, string> = {};
    for (const match of page.html.matchAll(/\/files\/[0-9a-f]{8}\/([\w.%-]+)/g)) found[match[1] as string] = match[0];
    return found;
  }

  it('asset route: unknown id 404, traversal 404, html gets CSP sandbox', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();
    const { app, config } = makeDocsApp(repo, index);
    const address = addressesIn(pageOf(index, 'a'));
    const png = must(address['flow.png'], 'the address of flow.png');
    const html = must(address['flow.html'], 'the address of flow.html');
    const svg = must(address['vector.svg'], 'the address of vector.svg');
    const id = png.split('/')[2] as string;

    // A picture comes back as it is.
    const picture = await getFrom(app, png, config);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await picture.arrayBuffer())).toEqual(PNG_BYTES);
    expect(picture.headers.get('x-content-type-options')).toBe('nosniff');

    // The HTML source of a diagram and an SVG open in a tab of this site, so they could run script with the page's origin
    // (where the write token is). The sandbox policy takes away scripts and the origin, and nothing is allowed back.
    for (const path of [html, svg]) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(200);
      const policy = res.headers.get('content-security-policy') ?? '';
      expect(policy, path).toMatch(/(^|;\s*)sandbox\s*(;|$)/);
      expect(policy, path).not.toMatch(/allow-/);
      expect(policy, path).toContain("default-src 'none'");
      expect(policy, path).not.toContain("script-src 'self'");
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
    }
    const htmlRes = await getFrom(app, html, config);
    expect(htmlRes.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await htmlRes.text()).toContain('<p>hello</p>'); // the file itself, not changed
    expect((await getFrom(app, svg, config)).headers.get('content-type')).toMatch(/^image\/svg\+xml/);

    // The policy of the page itself did not change.
    const page = await getFrom(app, '/', config);
    const pagePolicy = page.headers.get('content-security-policy') ?? '';
    expect(pagePolicy).toContain("script-src 'self'");
    expect(pagePolicy).not.toMatch(/sandbox/);

    // An id that the index never made.
    for (const path of ['/files/00000000/flow.png', '/files/ffffffff/x.png', '/files/zzzzzzzz/flow.png', '/files/FLOW/flow.png', '/files/x', '/files/', `/files/${id}`]) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toMatchObject({ ok: false, error: { code: 'not-found' } });
    }

    // A file name that is not the file's own, and every way of asking for a path: none of them gives a file.
    const name = 'flow.png';
    const traversals = [
      `/files/${id}/other.png`,
      `/files/${id}/${name.toUpperCase()}`,
      `/files/${id}/..%2f..%2fpackage.json`,
      `/files/${id}/..%2F..%2F..%2Fpackage.json`,
      `/files/${id}/..%5c..%5cpackage.json`,
      `/files/${id}/%2e%2e%2fa.md`,
      `/files/${id}/${name}%00.html`,
      `/files/${id}/${name}%2f..%2f..%2fa.md`,
      `/files/..%2f..%2fpackage.json/${name}`,
      `/files/%2e%2e%2f%2e%2e%2fpackage.json/${name}`,
      `/files/${id}%2f${name}/${name}`,
      `/files/${id}/${name}/`,
      `/files/${id}/${name}/extra`,
      `/files/${id}/${name}/../../a.md`,
    ];
    for (const path of traversals) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(404);
      const text = await res.text();
      expect(text, path).not.toContain('# A');
      expect(text, path).not.toContain('"name"'); // not a package.json
      expect(JSON.parse(text), path).toMatchObject({ ok: false });
    }

    // A file that is not a picture or a diagram source has no id, and a file that is gone since the last scan is a 404, not a crash.
    expect(index.asset('secret')).toBeNull();
    rmSync(join(repo.dir, 'docs', 'diagrams', 'flow.png'));
    const gone = await getFrom(app, png, config);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('gives each served file an id from its path, and index.asset() answers with the file and its type', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();
    const address = addressesIn(pageOf(index, 'a'));
    const id = must(address['flow.png'], 'the address of flow.png').split('/')[2] as string;
    expect(id).toMatch(/^[0-9a-f]{8,40}$/);
    expect(index.asset(id)).toEqual({ file: join(repo.dir, 'docs', 'diagrams', 'flow.png'), type: 'image/png' });
    expect(index.asset(id.toUpperCase())).toBeNull();
    expect(index.asset('')).toBeNull();
    expect(index.asset('../x')).toBeNull();

    // The id depends on the path only, so it stays the same when the file changes or the server restarts.
    const again = makeIndex(repo).index;
    await again.ready();
    expect(addressesIn(pageOf(again, 'a'))['flow.png']).toBe(address['flow.png']);
  });

  it('does not serve a link that has taken the place of a file since the last scan', async (context) => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();
    const { app, config } = makeDocsApp(repo, index);
    const png = must(addressesIn(pageOf(index, 'a'))['flow.png'], 'the address of flow.png');

    // The picture is replaced by a link to another file of the repo, after the index has read the folder.
    rmSync(join(repo.dir, 'docs', 'diagrams', 'flow.png'));
    try {
      symlinkSync(join(repo.dir, 'docs', 'secret.txt'), join(repo.dir, 'docs', 'diagrams', 'flow.png'));
    } catch {
      context.skip(); // a machine that may not make links (no Developer Mode on Windows) cannot make this case
      return;
    }
    const res = await getFrom(app, png, config);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('only pictures and diagram sources are served');
  });

  it('gives two files with the same name in different folders different ids, each serving its own bytes', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n\n![one](one/flow.png) ![two](two/flow.png)\n',
      'docs/one/flow.png': Buffer.from('the first picture'),
      'docs/two/flow.png': Buffer.from('the second picture'),
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const { app, config } = makeDocsApp(repo, index);
    const urls = [...new Set(pageOf(index, 'a').html.match(/\/files\/[0-9a-f]+\/flow\.png/g))];
    expect(urls).toHaveLength(2);
    const bodies = await Promise.all(urls.map(async (url) => (await getFrom(app, url, config)).text()));
    expect(bodies.sort()).toEqual(['the first picture', 'the second picture']);
  });

  it('makes an id longer, and only the ids of the files that share it, when two paths have the same short hash', async () => {
    // The first eight characters of the SHA-1 of these two paths are the same (found by a search, and checked below).
    const first = 'docs/img/p29685.png';
    const second = 'docs/img/p32146.png';
    const short = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 8);
    expect(short(first)).toBe(short(second));

    const repo = repoWith({
      'docs/x.md': '# X\n\n![a](img/p29685.png) ![b](img/p32146.png) ![c](img/other.png)\n',
      [first]: Buffer.from('bytes of the first'),
      [second]: Buffer.from('bytes of the second'),
      'docs/img/other.png': Buffer.from('bytes of the other'),
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const { app, config } = makeDocsApp(repo, index);
    const html = pageOf(index, 'x').html;
    const idOf = (name: string) => must(new RegExp(`/files/([0-9a-f]+)/${name}`).exec(html)?.[1], `the id of ${name}`);

    expect(idOf('other\\.png')).toHaveLength(8); // alone with its short hash: it keeps it
    const [idFirst, idSecond] = [idOf('p29685\\.png'), idOf('p32146\\.png')];
    expect(idFirst).not.toBe(idSecond);
    expect(idFirst.startsWith(short(first))).toBe(true);
    expect(idSecond.startsWith(short(second))).toBe(true);
    expect(idFirst.length).toBeGreaterThan(8);
    expect(idSecond.length).toBeGreaterThan(8);
    expect(await (await getFrom(app, `/files/${idFirst}/p29685.png`, config)).text()).toBe('bytes of the first');
    expect(await (await getFrom(app, `/files/${idSecond}/p32146.png`, config)).text()).toBe('bytes of the second');
  });

  it('answers only GET', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();
    const { app, config } = makeDocsApp(repo, index);
    const address = must(addressesIn(pageOf(index, 'a'))['flow.png'], 'the address of flow.png');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      for (const path of [address, '/api/docs', '/api/docs/a', '/api/search?q=a']) {
        const res = await app.request(path, { method, headers: { host: `localhost:${config.port}` } });
        expect(res.status, `${method} ${path}`).toBe(405);
      }
    }
  });
});

describe('the doc routes', () => {
  const files = {
    'docs/engine/decisions.md': '---\ntitle: Engine decisions\n---\n# Engine decisions\n\n## E1. First\n\nText about wombats.\n',
    'docs/other with space.md': '# Other doc\n',
    'status.md': '# Status\n',
  };

  async function setup() {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    const { app, config } = makeDocsApp(repo, index);
    return { repo, index, app, config };
  }

  it('GET /api/docs answers a panel with every doc, the nav and the problems', async () => {
    const { app, config } = await setup(); // the route itself waits for the first scan
    const res = await getFrom(app, '/api/docs', config);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const panel = (await res.json()) as Panel<DocsListing>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(Date.parse(panel.updatedAt)).not.toBeNaN();
    expect(Object.keys(panel.data).sort()).toEqual(['docs', 'nav', 'problems']);
    expect(panel.data.docs.map((doc) => doc.slug)).toEqual(['engine/decisions', 'other with space', 'status']);
    expect(panel.data.nav.map((section) => section.id)).toEqual(['other']);
    expect(panel.data.problems).toEqual([]);
    // A list holds summaries, not the html of each doc.
    expect(JSON.stringify(panel.data.docs)).not.toContain('<h1');
  });

  it('GET /api/docs/<slug> answers the doc as a panel, for a slug with slashes, a space and a dot', async () => {
    const { app, config } = await setup();
    for (const [path, slug] of [
      ['/api/docs/engine/decisions', 'engine/decisions'],
      ['/api/docs/other%20with%20space', 'other with space'],
      ['/api/docs/status', 'status'],
    ] as const) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(200);
      const panel = (await res.json()) as Panel<DocPage>;
      expect(panel.ok, path).toBe(true);
      if (panel.ok) expect(panel.data.slug, path).toBe(slug);
    }
    const page = ((await (await getFrom(app, '/api/docs/engine/decisions', config)).json()) as { data: DocPage }).data;
    expect(page.html).toContain('<h2 id="e1-first">E1. First</h2>');
    expect(page.headings).toEqual([{ level: 2, text: 'E1. First', id: 'e1-first' }]);
  });

  it('GET /api/docs/<slug> for an address that no doc has is a 404 with a failed panel that names the docs with the same file name', async () => {
    const { repo, index, app, config } = await setup();
    await index.ready();
    repo.move('docs/engine/decisions.md', 'docs/archive/decisions.md');
    await index.refresh();

    for (const path of ['/api/docs/engine/decisions', '/api/docs/engine/decisions/', '/api/docs/docs/status', '/api/docs/nope', '/api/docs/engine%2Fdecisions', '/api/docs/..%2f..%2fpackage']) {
      const res = await getFrom(app, path, config);
      expect(res.status, path).toBe(404);
      const body = (await res.json()) as DocNotFound;
      expect(body.ok, path).toBe(false);
      expect(body.error.code, path).toBe('doc-not-found');
      expect(body.error.message, path).toEqual(expect.any(String));
      expect(body.updatedAt, path).toBeNull();
      expect(body.lastGood, path).toBeNull();
      expect(Array.isArray(body.suggestions), path).toBe(true);
    }
    const moved = (await (await getFrom(app, '/api/docs/engine/decisions', config)).json()) as DocNotFound;
    expect(moved.suggestions).toEqual([{ slug: 'archive/decisions', title: 'Engine decisions' }]);
    const unknown = (await (await getFrom(app, '/api/docs/nope', config)).json()) as DocNotFound;
    expect(unknown.suggestions).toEqual([]);
  });

  it('GET /api/search?q= answers a panel of hits, and an empty list for a missing or empty query', async () => {
    const { app, config } = await setup();
    const res = await getFrom(app, '/api/search?q=wombats', config);
    expect(res.status).toBe(200);
    const panel = (await res.json()) as Panel<SearchHit[]>;
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.data).toHaveLength(1);
    expect(panel.data[0]).toMatchObject({ slug: 'engine/decisions', heading: 'E1. First' });

    for (const path of ['/api/search', '/api/search?q=', '/api/search?q=%20%20']) {
      const empty = (await (await getFrom(app, path, config)).json()) as Panel<SearchHit[]>;
      expect(empty.ok && empty.data, path).toEqual([]);
    }
    // A very long query is cut, not refused and not slow.
    const long = await getFrom(app, `/api/search?q=${'wombats%20'.repeat(5000)}`, config);
    expect(long.status).toBe(200);
  });

  it('answers a doc request that comes before the first scan has finished, once it has', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    const { app, config } = makeDocsApp(repo, index);
    // Nothing called ready() yet: the route starts the scan and waits for it.
    const res = await getFrom(app, '/api/docs/status', config);
    expect(res.status).toBe(200);
  });
});

describe('the reading order of the engine docs', () => {
  /** An engine README whose "Reading order" list names three docs, and one more doc of the folder that the list leaves out. */
  const files = {
    'docs/engine/README.md':
      '# Engine overview\n\n## 3. Reading order\n\n1. This file.\n2. [scene-graph.md](scene-graph.md): the tree.\n3. [interfaces.md](interfaces.md): the types.\n4. [decisions.md](decisions.md): every decision.\n',
    'docs/engine/scene-graph.md': '# Scene graph\n',
    'docs/engine/interfaces.md': '# Interfaces\n',
    'docs/engine/decisions.md': '# Decisions\n',
    'docs/engine/conventions.md': '# Conventions\n',
    'docs/other.md': '# Another doc\n',
    'docs/stray.md': '# A doc that nav.json does not name\n',
  };
  const nav = {
    sections: [
      { id: 'engine', title: 'Engine design', items: [{ readingOrder: 'docs/engine/README.md' }, 'docs/engine/'] },
      { id: 'misc', title: 'Misc', items: ['docs/other.md'] },
    ],
  };

  /** What `GET /api/docs/<slug>` says about where the doc sits in the reading order. */
  async function orderOf(app: Parameters<typeof getFrom>[0], config: Parameters<typeof getFrom>[2], slug: string) {
    const res = await getFrom(app, `/api/docs/${slug}`, config);
    expect(res.status, slug).toBe(200);
    const panel = (await res.json()) as Panel<DocPageData>;
    if (!panel.ok) throw new Error(`${slug} gave a failed panel`);
    return panel.data.readingOrder;
  }

  it('Previous and Next follow the reading order: the first has no Previous, the last no Next', async () => {
    const repo = repoWith(files);
    repo.writeNav(nav);
    const { index } = makeIndex(repo);
    const { app, config } = makeDocsApp(repo, index);

    // The README's own list first ("This file" is the README), then the doc of the folder that the list does not name.
    const ref = (slug: string, title: string) => ({ slug, title });
    expect(await orderOf(app, config, 'engine/README')).toEqual({ prev: null, next: ref('engine/scene-graph', 'Scene graph') });
    expect(await orderOf(app, config, 'engine/scene-graph')).toEqual({ prev: ref('engine/README', 'Engine overview'), next: ref('engine/interfaces', 'Interfaces') });
    expect(await orderOf(app, config, 'engine/interfaces')).toEqual({ prev: ref('engine/scene-graph', 'Scene graph'), next: ref('engine/decisions', 'Decisions') });
    expect(await orderOf(app, config, 'engine/decisions')).toEqual({ prev: ref('engine/interfaces', 'Interfaces'), next: ref('engine/conventions', 'Conventions') });
    expect(await orderOf(app, config, 'engine/conventions')).toEqual({ prev: ref('engine/decisions', 'Decisions'), next: null });

    // A doc of another section, and a doc that no section names (it is in Other), are in no reading order.
    expect(await orderOf(app, config, 'other')).toBeNull();
    expect(await orderOf(app, config, 'stray')).toBeNull();
  });

  it('is null for every doc when the engine README is not in a section (nav.json does not name it)', async () => {
    const repo = repoWith(files); // the nav of makeDocsRepo has no section: every doc is in Other
    const { index } = makeIndex(repo);
    const { app, config } = makeDocsApp(repo, index);
    for (const slug of ['engine/README', 'engine/scene-graph', 'engine/conventions', 'other']) expect(await orderOf(app, config, slug), slug).toBeNull();
  });

  it('is null when the section holds the README and nothing else, and for a repo that has no engine docs', async () => {
    const alone = repoWith({ 'docs/engine/README.md': files['docs/engine/README.md'], 'docs/other.md': files['docs/other.md'] });
    alone.writeNav({ sections: [{ id: 'engine', title: 'Engine design', items: [{ readingOrder: 'docs/engine/README.md' }] }] });
    const aloneApp = makeDocsApp(alone, makeIndex(alone).index);
    expect(await orderOf(aloneApp.app, aloneApp.config, 'engine/README')).toBeNull();

    const none = repoWith({ 'docs/a.md': '# A\n', 'status.md': '# Status\n' });
    const noneApp = makeDocsApp(none, makeIndex(none).index);
    expect(await orderOf(noneApp.app, noneApp.config, 'a')).toBeNull();
  });
});

/** What `GET /api/docs` says about the real repo: the real config, the real runner, the real nav.json, and no watcher. */
async function realListing(): Promise<DocsListing> {
  const config = loadConfig(DEFAULT_CONFIG_FILE);
  const index = createDocIndex({ config, runner: createRunner(config), hub: createHub() }, { watch: false });
  const { app } = makeApp({ config });
  registerDocsRoutes(app, index);

  const res = await getFrom(app, '/api/docs', config);
  expect(res.status).toBe(200);
  const panel = (await res.json()) as Panel<DocsListing>;
  expect(panel.ok).toBe(true);
  if (!panel.ok) throw new Error('GET /api/docs on the real repo gave a failed panel');
  return panel.data;
}

/**
 * The markdown files under docs/ and at the root, as git finds them (tracked, or untracked and not ignored): not found by the server under test.
 * The README of this tool is the one doc outside both places: nav.json names it (ruling R4), so the index holds it.
 */
function realDocIds(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: REPO_DIR, encoding: 'utf8' })
    .split('\0')
    .filter((path) => /^docs\/.+\.md$/i.test(path) || /^[^/]+\.md$/i.test(path) || path === 'tools/command-center/README.md');
}

/** The slug of every doc item in the nav, sections and Other together. */
const slugsInNav = (nav: DocsListing['nav']): string[] => nav.flatMap((section) => section.items.flatMap((item) => (item.kind === 'doc' ? [item.slug] : [])));

describe('done when', () => {
  it('GET /api/docs on the real repo lists every real doc, and problems holds only the known broken links', async () => {
    const { docs, nav, problems } = await realListing();

    // Every real doc, as git finds them (and not as this server does).
    const listed = realDocIds();
    expect(listed.length).toBeGreaterThan(40);
    expect(docs.map((doc) => doc.id).sort()).toEqual(listed.slice().sort());

    // The only problems are the four links to files of the diagram skill that this repo does not hold.
    const known = ['primitive-terminal.md', 'primitive-annotation.md', 'onboarding.md', 'profiles.md'];
    expect(problems.length).toBeLessThanOrEqual(known.length);
    for (const problem of problems) {
      expect(problem, problem).toContain('docs/diagrams/profile/shadow-jog.md');
      expect(problem, problem).toContain('broken link');
      expect(known.some((name) => problem.includes(`"${name}"`)), problem).toBe(true);
    }

    // Every doc is in the nav exactly once: in a section, or in Other (the section for a doc that nav.json does not name, so that no doc is lost).
    const inNav = slugsInNav(nav);
    expect(inNav.slice().sort()).toEqual(docs.map((doc) => doc.slug).sort());
    expect(new Set(inNav).size).toBe(inNav.length);

    // Some docs have a frontmatter, with its type and date, and some have none: they show an empty type and the date from git.
    expect(docs.some((doc) => doc.type !== '' && doc.updatedFrom === 'frontmatter')).toBe(true);
    expect(docs.some((doc) => doc.type === '' && doc.status === '' && doc.updatedFrom === 'git' && doc.title.length > 0)).toBe(true);
  });

  // Ruling R15. "Other is empty" is a check of nav.json, not of the server, and it fails as soon as a doc is added and nav.json is not
  // updated. Design criterion 4 says that nothing needs manual upkeep: a doc that nav.json does not name lands in Other, so none is lost.
  // So this check does not run in the default suite. The "Done when" checks of Tasks 4 and 12 set the flag:
  //   CC_REAL_NAV=1 npm --prefix tools/command-center run check
  it.skipIf(process.env.CC_REAL_NAV !== '1')('with CC_REAL_NAV=1: nav.json names every real doc, so Other is empty (ruling R4), and the engine docs follow the engine README', async () => {
    const { docs, nav } = await realListing();

    expect(nav.some((section) => section.id === 'other')).toBe(false);
    expect(slugsInNav(nav).slice().sort()).toEqual(docs.map((doc) => doc.slug).sort());

    // The engine docs are in the engine section, with the README first (its reading order puts "This file" first).
    const engine = must(nav.find((section) => section.id === 'engine'), 'the engine section');
    const engineSlugs = slugsInNav([engine]);
    expect(engineSlugs[0]).toBe('engine/README');
    expect(engineSlugs.slice().sort()).toEqual(docs.filter((doc) => doc.id.startsWith('docs/engine/')).map((doc) => doc.slug).sort());
  });

  it('an edit in a temp copy reaches an event-stream client within 5 s', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n', 'docs/b.md': '# B\n' });
    repo.writeNav({ sections: [{ id: 'all', title: 'All', items: ['docs/'] }] });
    // The whole server, as `npm run cc` builds it, over the temp copy.
    const composed = compose({ config: repo.config, runner: noopRunner, webRoot: join(PACKAGE_DIR, 'src', 'web'), navFile: repo.navFile });
    await composed.start();
    const res = await getFrom(composed.app, '/api/events', repo.config);
    const stream = new SseReader(res.body);
    try {
      expect((await stream.next()).event).toBe('hello');

      const edited = Date.now();
      repo.write('docs/a.md', '# A, edited\n\nNew words.\n');
      const frame = await nextDocsEvent(stream, 5000);
      expect(Date.now() - edited).toBeLessThan(5000);
      expect(JSON.parse(frame.data)).toMatchObject({ module: 'docs', ids: ['docs/a.md'] });

      // The same server answers with the new text.
      const doc = (await (await getFrom(composed.app, '/api/docs/a', repo.config)).json()) as Panel<DocPage>;
      expect(doc.ok && doc.data.title).toBe('A, edited');
      const hits = (await (await getFrom(composed.app, '/api/search?q=words', repo.config)).json()) as Panel<SearchHit[]>;
      expect(hits.ok && hits.data.map((hit) => hit.slug)).toEqual(['a']);
    } finally {
      await stream.cancel();
      await composed.stop();
    }
  });
});

/** The next `changed` frame of the docs module: other frames (hello) are passed over. */
async function nextDocsEvent(stream: SseReader, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = await stream.next(Math.max(1, deadline - Date.now()));
    if (frame.event === 'changed' && (JSON.parse(frame.data) as { module: string }).module === 'docs') return frame;
  }
}
