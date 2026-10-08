import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lastChangedDates } from '../src/server/docs/dates';
import type { Runner } from '../src/server/runner';
import { startDocWatcher } from '../src/server/docs/watch';
import {
  type DocsRepo,
  commitAll,
  makeDocsRepo,
  makeGitDocsRepo,
  makeIndex,
  must,
  pageOf,
  realRunner,
  waitFor,
} from './doc-index-helpers';

// The doc index: the addresses, titles, dates, backlinks, search, sections and the watcher. Each
// test makes a small synthetic repo in the temp folder, so none of them depends on the real docs
// (the one test of the real repo is in docs-routes.test.ts).

const repos: DocsRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});
function repoWith(files: Record<string, string | Buffer>): DocsRepo {
  const repo = makeDocsRepo(files);
  repos.push(repo);
  return repo;
}
function gitRepo(): ReturnType<typeof makeGitDocsRepo> {
  const repo = makeGitDocsRepo();
  repos.push(repo);
  return repo;
}

describe('addresses', () => {
  it('slug rules (engine/decisions, PHASE-0.2, status)', async () => {
    const repo = repoWith({
      'docs/engine/decisions.md': '# Decisions\n',
      'docs/PHASE-0.2.md': '# Phase 0.2\n',
      'status.md': '# Status\n',
      'README.md': '# Readme\n',
      'docs/engine/README.md': '# Engine readme\n',
      'docs/quality/reviews/round-06.md': '# Round 6\n',
      // Not docs: a file that is not markdown, a picture, and markdown outside docs/ and the repo root.
      'docs/notes.txt': 'not a doc',
      'docs/diagrams/flow.png': 'not really a picture',
      'src/code.md': '# Code notes\n',
      'knowledge/other.md': '# Other\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();

    // The slug is the repo path without .md and without a leading docs/. The id is the repo path.
    const slugs = Object.fromEntries(index.list().map((doc) => [doc.id, doc.slug]));
    expect(slugs).toEqual({
      'README.md': 'README',
      'docs/PHASE-0.2.md': 'PHASE-0.2',
      'docs/engine/README.md': 'engine/README',
      'docs/engine/decisions.md': 'engine/decisions',
      'docs/quality/reviews/round-06.md': 'quality/reviews/round-06',
      'status.md': 'status',
    });
    expect(pageOf(index, 'engine/decisions').id).toBe('docs/engine/decisions.md');
    expect(pageOf(index, 'PHASE-0.2').id).toBe('docs/PHASE-0.2.md');
    expect(pageOf(index, 'status').id).toBe('status.md');

    // A slug is exact: not the repo path, not with .md, not empty.
    for (const wrong of ['docs/engine/decisions', 'engine/decisions.md', 'Engine/Decisions', '', 'engine', 'src/code', 'knowledge/other']) {
      expect(index.get(wrong), wrong).toBeNull();
    }
    expect(index.problems()).toEqual([]);
  });

  it('a slug clash is listed in problems, not thrown', async () => {
    const repo = repoWith({
      'status.md': '# Root status\n',
      'docs/status.md': '# Docs status\n',
      'docs/other.md': '# Other\n',
    });
    const { index } = makeIndex(repo);
    await expect(index.ready()).resolves.toBeUndefined();

    // The path that sorts first keeps the slug. The other file is not on the site, and the problem says so.
    expect(index.list().map((doc) => doc.slug).sort()).toEqual(['other', 'status']);
    expect(pageOf(index, 'status').id).toBe('docs/status.md');
    const clash = index.problems().filter((problem) => problem.includes('status'));
    expect(clash).toHaveLength(1);
    expect(clash[0]).toContain('docs/status.md');
    expect(clash[0]).toContain('The site skips status.md');
  });

  it('a doc with no frontmatter: the title is the first # heading, type and status are empty, the date comes from git', async () => {
    const repo = gitRepo();
    const { index } = makeIndex(repo, { runner: realRunner(repo) });
    await index.ready();
    // README.md of the fixture repo has no frontmatter.
    expect(index.list().find((doc) => doc.id === 'README.md')).toEqual({
      id: 'README.md',
      slug: 'README',
      title: 'Fixture repo',
      type: '',
      status: '',
      updated: '2026-01-01',
      updatedFrom: 'git',
    });
  });

  it('gives a doc page every field of the brief, and type and status from the frontmatter', async () => {
    const repo = repoWith({
      'docs/a.md': '---\ntype: design\ntitle: "The A doc"\nstatus: approved on a day\nupdated: 2026-03-04\n---\n\n# Heading\n\n## One\n\nText.\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const page = pageOf(index, 'a');
    expect(Object.keys(page).sort()).toEqual(
      ['backlinks', 'brokenLinks', 'frontmatterError', 'headings', 'html', 'id', 'slug', 'status', 'title', 'type', 'updated', 'updatedFrom'],
    );
    expect(page).toMatchObject({ id: 'docs/a.md', slug: 'a', title: 'The A doc', type: 'design', status: 'approved on a day', updated: '2026-03-04', updatedFrom: 'frontmatter', frontmatterError: null });
    expect(page.headings).toEqual([{ level: 2, text: 'One', id: 'one' }]);
    expect(page.html).toContain('<h2 id="one">One</h2>');
    expect(page.backlinks).toEqual([]);
    expect(page.brokenLinks).toEqual([]);
  });

  it('lists a doc with a bad frontmatter, with its error, and keeps the rest of the docs', async () => {
    const repo = repoWith({
      'docs/bad.md': '---\ntitle: [unclosed\n---\n# Still renders\n',
      'docs/good.md': '# Good\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.list().map((doc) => doc.slug)).toEqual(['bad', 'good']);
    const bad = pageOf(index, 'bad');
    expect(bad.title).toBe('Still renders');
    expect(bad.frontmatterError).toMatch(/Invalid YAML/);
    expect(index.problems().filter((problem) => problem.includes('docs/bad.md'))).toHaveLength(1);
  });

  it('reads only the folders of the repo it should: no hidden folder, and not a file over the size limit', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n',
      'docs/.hidden/secret.md': '# Hidden\n',
      'docs/node_modules/pkg/readme.md': '# Package\n',
    });
    repo.write('docs/huge.md', `# Huge\n\n${'word '.repeat(500_000)}\n`); // about 2.5 MB
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.list().map((doc) => doc.slug)).toEqual(['a']);
    const problem = index.problems().find((text) => text.includes('docs/huge.md'));
    expect(problem).toMatch(/larger than/);
  });

  it('says so when the repo has no docs folder, and still becomes ready', async () => {
    const repo = repoWith({ 'README.md': '# Only a readme\n' });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.list().map((doc) => doc.slug)).toEqual(['README']);
    expect(index.nav().map((section) => section.id)).toEqual(['other']);
  });
});

describe('dates', () => {
  it('date: frontmatter, else git, else file time', async () => {
    const repo = gitRepo();
    // The fixture repo has README.md (committed 2026-01-01) and docs/first.md and docs/second.md (2026-01-02).
    repo.write('docs/second.md', '---\nupdated: 2026-03-04\n---\n# Second doc\n'); // a frontmatter date wins over git
    repo.write('docs/first.md', '---\nupdated: not a date\n---\n# First doc\n'); // a frontmatter date that is no day is not used
    repo.write('docs/fresh.md', '# Fresh\n'); // not in git at all: its file time counts
    utimesSync(join(repo.dir, 'docs', 'fresh.md'), new Date(2025, 4, 6, 12, 0, 0), new Date(2025, 4, 6, 12, 0, 0));
    repo.write('docs/timed.md', '---\nupdated: 2026-05-06T10:20:30Z\n---\n# Timed\n'); // the day part of a time
    repo.write('README.md', '---\nupdated: 2026-02-31\n---\n# Fixture repo\n'); // a day that no calendar has: not used either

    const { index } = makeIndex(repo, { runner: realRunner(repo) });
    await index.ready();

    const dates = Object.fromEntries(index.list().map((doc) => [doc.id, [doc.updated, doc.updatedFrom]]));
    expect(dates).toEqual({
      'README.md': ['2026-01-01', 'git'],
      'docs/first.md': ['2026-01-02', 'git'],
      'docs/second.md': ['2026-03-04', 'frontmatter'],
      'docs/fresh.md': ['2025-05-06', 'file'],
      'docs/timed.md': ['2026-05-06', 'frontmatter'],
    });
    expect(index.problems()).toEqual([]);
  });

  it('uses the file time for every doc, and says why, when git cannot give the dates', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n' });
    utimesSync(join(repo.dir, 'docs', 'a.md'), new Date(2025, 0, 2, 12, 0, 0), new Date(2025, 0, 2, 12, 0, 0));
    const failing: Runner = async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' });
    const { index } = makeIndex(repo, { runner: failing });
    await index.ready();
    expect(index.list()[0]).toMatchObject({ updated: '2025-01-02', updatedFrom: 'file' });
    const problem = index.problems().find((text) => text.includes('git'));
    expect(problem).toMatch(/not a git repository/);
  });

  it('lastChangedDates reads the dates of every markdown file with one git log call', async () => {
    const repo = gitRepo();
    repo.write('docs/with space.md', '# S\n');
    repo.write('docs/ünï-ço.md', '# U\n');
    repo.write('docs/not-a-doc.txt', 'x');
    commitAll(repo.dir, 'More docs', '2026-02-03T12:00:00Z');

    const calls: string[][] = [];
    const real = realRunner(repo);
    const spy: Runner = (cmd, args, options) => {
      calls.push([cmd, ...args]);
      return real(cmd, args, options);
    };
    const dates = await lastChangedDates(spy, repo.dir);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual(['git', 'log']);
    // The newest commit that touched a file gives its date; a name with a space or a non-ASCII letter is exact.
    expect(Object.fromEntries(dates)).toEqual({
      'README.md': '2026-01-01',
      'docs/first.md': '2026-01-02',
      'docs/second.md': '2026-01-02',
      'docs/with space.md': '2026-02-03',
      'docs/ünï-ço.md': '2026-02-03',
    });
  });

  it('lastChangedDates throws a clear error when git fails', async () => {
    const failing: Runner = async () => ({ code: 128, stdout: '', stderr: 'fatal: bad object HEAD\nsecond line\n' });
    await expect(lastChangedDates(failing, '/anywhere')).rejects.toThrow(/git log.*128.*bad object HEAD/);
  });
});

describe('links between docs', () => {
  it('backlinks list each source once and skip self and broken links', async () => {
    const repo = repoWith({
      'docs/a.md': '# Doc A\n\nSee [B](b.md) and again [B once more](b.md#part), also [itself](a.md), a [broken one](missing.md), and [the web](https://example.com).\n',
      'docs/b.md': '# Doc B\n\n## Part\n\nBack to [A](a.md), and to [myself](b.md#part).\n',
      'docs/c.md': '# Doc C\n\n[to B](b.md)\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();

    // B is linked from A (twice) and C (once): each source is listed once, B itself is not listed.
    expect(pageOf(index, 'b').backlinks).toEqual([
      { slug: 'a', title: 'Doc A' },
      { slug: 'c', title: 'Doc C' },
    ]);
    // A links to itself and to a file that does not exist: neither is a backlink.
    expect(pageOf(index, 'a').backlinks).toEqual([{ slug: 'b', title: 'Doc B' }]);
    expect(pageOf(index, 'c').backlinks).toEqual([]);

    // The broken link is on the page that holds it, once, as written, and in problems.
    expect(pageOf(index, 'a').brokenLinks).toEqual(['missing.md']);
    expect(pageOf(index, 'b').brokenLinks).toEqual([]);
    expect(index.problems()).toHaveLength(1);
    expect(index.problems()[0]).toContain('docs/a.md');
    expect(index.problems()[0]).toContain('missing.md');
  });

  it('a link whose file name has the wrong case is broken, as it is on GitHub, and a doc link with the wrong case too', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n\n[right](../src/Code.ts) [wrong](../src/code.ts) [folder](../src/) [wrong folder](../SRC/Code.ts) [doc](B.md) [wrong doc](b.md)\n',
      'docs/B.md': '# B\n',
      'src/Code.ts': 'export {};\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const page = pageOf(index, 'a');
    // Windows would find src/code.ts and SRC/Code.ts. GitHub would show a 404 for both, so the doc says so.
    expect(page.brokenLinks).toEqual(['../src/code.ts', '../SRC/Code.ts', 'b.md']);
    expect(page.html).toContain('href="https://github.com/octo-owner/octo-repo/blob/main/src/Code.ts"');
    expect(page.html).toContain('href="/docs/B"');
    expect(pageOf(index, 'B').backlinks).toEqual([{ slug: 'a', title: 'A' }]);
  });

  it('lists a link that is broken more than once only once, and tells a link to a doc from one to a repo file', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n\n[x](gone.md) [y](gone.md) [z](gone.md#top) [code](../src/code.ts)\n',
      'src/code.ts': 'export {};\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const page = pageOf(index, 'a');
    expect(page.brokenLinks).toEqual(['gone.md', 'gone.md#top']);
    expect(page.html).toContain('href="https://github.com/octo-owner/octo-repo/blob/main/src/code.ts"');
    expect(index.problems()).toHaveLength(2);
  });

  it('an html source used as an image is a link to the file, not an img', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n\n![the picture](diagrams/flow.png) ![the source](diagrams/flow.html) [source link](diagrams/flow.html)\n',
      'docs/diagrams/flow.png': 'png bytes',
      'docs/diagrams/flow.html': '<!doctype html><title>flow</title>',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const { html } = pageOf(index, 'a');
    // The picture is an image with its zoom address; the html source is not an image.
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toMatch(/<img src="\/files\/[0-9a-f]{8}\/flow\.png" alt="the picture" data-zoom="\/files\/[0-9a-f]{8}\/flow\.png">/);
    expect(html).toMatch(/<a href="\/files\/[0-9a-f]{8}\/flow\.html" target="_blank" rel="noopener noreferrer">the source<\/a>/);
    expect(html).toMatch(/<a href="\/files\/[0-9a-f]{8}\/flow\.html" target="_blank" rel="noopener noreferrer">source link<\/a>/);
  });

  it('renderFragment renders markdown as if it were in the doc, so its links resolve from that folder', async () => {
    const repo = repoWith({
      'docs/engine/a.md': '# A\n',
      'docs/engine/b.md': '# B\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    const html = index.renderFragment('docs/engine/a.md', 'See [B](b.md#top) and **bold**, [gone](gone.md) and <script>alert(1)</script>.');
    expect(html).toContain('<a href="/docs/engine/b#top">B</a>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<span class="broken-link"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
  });
});

describe('search', () => {
  const files = {
    'docs/zebra.md': `---
title: Zebra stripes handbook
---

# Zebra stripes handbook

An opening paragraph about nothing in particular.

## Quokka corner

The wombat sleeps in the afternoon. Nothing else happens here.

## The API

\`\`\`ts
const maker = createWidgetFactory({ size: 1 });
\`\`\`

Call \`scene.add.layer()\` to get a layer, or put a \`<div>\` tag & more on the page.
`,
    'docs/other.md': '# Other doc\n\nSomething unrelated: apples and pears.\n',
    'docs/body-only.md': '# Plain\n\nThe word zebra shows up once in the body.\n',
  };

  it('search finds a title, a heading, a body word and a code name', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();

    // A title word: the doc whose title has it comes first, then the doc that only has it in its body.
    const title = index.search('zebra');
    expect(title.map((hit) => hit.slug)).toEqual(['zebra', 'body-only']);
    expect(title[0]).toMatchObject({ slug: 'zebra', title: 'Zebra stripes handbook' });

    // A heading word gives the section that the heading opens.
    const heading = index.search('quokka');
    expect(heading).toHaveLength(1);
    expect(heading[0]).toMatchObject({ slug: 'zebra', title: 'Zebra stripes handbook', heading: 'Quokka corner' });

    // A body word gives its section and a snippet around it.
    const body = index.search('wombat');
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ slug: 'zebra', heading: 'Quokka corner' });
    expect(body[0]?.snippet).toContain('The wombat sleeps in the afternoon.');

    // A code name, whole or by one of its words, and a name with dots.
    for (const query of ['createWidgetFactory', 'createwidgetfactory', 'widget', 'factory']) {
      const code = index.search(query);
      expect(code.map((hit) => [hit.slug, hit.heading]), query).toEqual([['zebra', 'The API']]);
      expect(code[0]?.snippet, query).toContain('createWidgetFactory');
    }
    expect(index.search('scene.add.layer()')[0]).toMatchObject({ slug: 'zebra', heading: 'The API' });
    expect(index.search('layer')[0]).toMatchObject({ slug: 'zebra', heading: 'The API' });
  });

  it('search matches the start of a word, wants every word of the query, and finds nothing for an empty or unknown query', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();

    expect(index.search('quok')[0]).toMatchObject({ slug: 'zebra' });
    // Every word must match: a title word plus a body word of the same doc, but not words of two docs.
    expect(index.search('wombat zebra').map((hit) => hit.slug)).toEqual(['zebra']);
    expect(index.search('wombat apples')).toEqual([]);
    expect(index.search('')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(index.search('!!! ???')).toEqual([]);
    expect(index.search('nonexistentword')).toEqual([]);
    // The limit counts docs.
    expect(index.search('zebra', 1)).toHaveLength(1);
    expect(index.search('zebra', 0)).toEqual([]);
  });

  it('a search hit has exactly the fields of the brief, and its snippet is plain text', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();
    const hit = must(index.search('div')[0], 'a hit for div');
    expect(Object.keys(hit).sort()).toEqual(['heading', 'score', 'slug', 'snippet', 'title']);
    expect(typeof hit.score).toBe('number');
    // The page shows the snippet as text, so it holds the characters, not html entities or tags.
    expect(hit.snippet).toContain('<div> tag & more');
    expect(hit.snippet).not.toMatch(/&lt;|&amp;|<code>/);
  });

  it('search sees an edit after a refresh, and forgets a deleted doc', async () => {
    const repo = repoWith(files);
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.search('pomegranate')).toEqual([]);
    repo.write('docs/other.md', '# Other doc\n\nNow it is about a pomegranate.\n');
    await index.refresh();
    expect(index.search('pomegranate').map((hit) => hit.slug)).toEqual(['other']);
    expect(index.search('apples')).toEqual([]);
    repo.remove('docs/other.md');
    await index.refresh();
    expect(index.search('pomegranate')).toEqual([]);
  });
});

describe('sections', () => {
  const doc = `# Title

Intro words.

## Alpha

Alpha text.

### Alpha one

Alpha one text.

#### Deep four

Deep text.

## Beta

Beta text.

## Gamma \`code\` & more

Gamma text.
`;
  const ID = 'docs/s.md';

  it('section() returns a heading and its text up to the next heading of the same or a higher level, and null for an unknown anchor', async () => {
    const repo = repoWith({ [ID]: doc });
    const { index } = makeIndex(repo);
    await index.ready();

    // A section holds its own text and the sections below it, and stops at the next heading of its level or a higher one.
    const alpha = must(index.section(ID, 'alpha'), 'the Alpha section');
    expect(alpha.heading).toBe('Alpha');
    expect(alpha.html).toMatch(/^<h2 id="alpha">Alpha<\/h2>/);
    expect(alpha.html).toContain('Alpha text.');
    expect(alpha.html).toContain('<h3 id="alpha-one">Alpha one</h3>');
    expect(alpha.html).toContain('Deep text.');
    expect(alpha.html).not.toContain('Beta');
    expect(alpha.html).not.toContain('Intro words');

    const one = must(index.section(ID, 'alpha-one'), 'the Alpha one section');
    expect(one.heading).toBe('Alpha one');
    expect(one.html).toContain('Alpha one text.');
    expect(one.html).toContain('Deep text.');
    expect(one.html).not.toContain('Alpha text.');
    expect(one.html).not.toContain('Beta');

    // A section ends where a heading of a higher level starts, even when it is deeper than the section.
    const deep = must(index.section(ID, 'deep-four'), 'the Deep four section');
    expect(deep.heading).toBe('Deep four');
    expect(deep.html).toContain('Deep text.');
    expect(deep.html).not.toContain('Beta');

    const beta = must(index.section(ID, 'beta'), 'the Beta section');
    expect(beta.html).toContain('Beta text.');
    expect(beta.html).not.toContain('Gamma');

    // The last section runs to the end, and the heading is plain text (code, entities and all).
    const gamma = must(index.section(ID, 'gamma-code--more'), 'the Gamma section');
    expect(gamma.heading).toBe('Gamma code & more');
    expect(gamma.html).toContain('Gamma text.');

    // The title is an h1, and it holds everything below it.
    const title = must(index.section(ID, 'title'), 'the Title section');
    expect(title.heading).toBe('Title');
    expect(title.html).toContain('Intro words.');
    expect(title.html).toContain('Gamma text.');

    // An anchor that no heading has, a doc that is not there, and a slug in place of the doc id: null.
    expect(index.section(ID, 'nope')).toBeNull();
    expect(index.section(ID, '')).toBeNull();
    expect(index.section('docs/missing.md', 'alpha')).toBeNull();
    expect(index.section('s', 'alpha')).toBeNull();
  });

  it('section() follows an edit, and reads an anchor that was written percent-encoded', async () => {
    const repo = repoWith({ [ID]: '# T\n\n## Über uns\n\nText.\n' });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.section(ID, 'über-uns')?.heading).toBe('Über uns');
    expect(index.section(ID, encodeURIComponent('über-uns'))?.heading).toBe('Über uns');
    repo.write(ID, '# T\n\n## Renamed\n\nText.\n');
    await index.refresh();
    expect(index.section(ID, 'über-uns')).toBeNull();
    expect(index.section(ID, 'renamed')?.heading).toBe('Renamed');
  });
});

describe('changes', () => {
  it('rename: the old slug returns null and suggest() offers the same file name', async () => {
    const repo = repoWith({
      'docs/engine/decisions.md': '# Decisions\n',
      'docs/engine/other.md': '# Other\n',
      'docs/notes/Decisions.md': '# A different doc with the same name in another case\n',
    });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.get('engine/decisions')).not.toBeNull();

    repo.move('docs/engine/decisions.md', 'docs/archive/decisions.md');
    await index.refresh();

    expect(index.get('engine/decisions')).toBeNull();
    // The doc that moved and the doc that has the same name in another case are offered. A doc with another name is not.
    expect(index.suggest('engine/decisions')).toEqual([
      { slug: 'archive/decisions', title: 'Decisions' },
      { slug: 'notes/Decisions', title: 'A different doc with the same name in another case' },
    ]);
    expect(index.suggest('engine/other')).toEqual([{ slug: 'engine/other', title: 'Other' }]);
    expect(index.suggest('engine/unknown-name')).toEqual([]);
    expect(index.suggest('')).toEqual([]);
  });

  it('delete: the doc leaves the index and backlinks update', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n\n[to B](b.md)\n',
      'docs/b.md': '# B\n\n[to C](c.md)\n',
      'docs/c.md': '# C\n',
    });
    const { index, events } = makeIndex(repo);
    await index.ready();
    expect(pageOf(index, 'b').backlinks.map((ref) => ref.slug)).toEqual(['a']);
    expect(pageOf(index, 'c').backlinks.map((ref) => ref.slug)).toEqual(['b']);
    expect(index.problems()).toEqual([]);

    repo.remove('docs/a.md');
    await index.refresh();

    expect(index.get('a')).toBeNull();
    expect(index.list().map((doc) => doc.slug)).toEqual(['b', 'c']);
    expect(pageOf(index, 'b').backlinks).toEqual([]);
    expect(pageOf(index, 'c').backlinks.map((ref) => ref.slug)).toEqual(['b']);
    // The event names the doc that is gone, so an open page of it can say so.
    expect(events.map((event) => event.ids)).toEqual([['docs/a.md']]);

    // Deleting the doc that is linked to turns the link in the other doc into a broken link.
    repo.remove('docs/c.md');
    await index.refresh();
    expect(pageOf(index, 'b').brokenLinks).toEqual(['c.md']);
    expect(index.problems()).toHaveLength(1);
  });

  it('refresh() with paths reads the named files again, publishes the ids of the docs that changed, and publishes nothing when nothing changed', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n',
      'docs/b.md': '# B\n',
    });
    const { index, events } = makeIndex(repo);
    await index.ready();
    // The first scan publishes nothing: no page has seen the index yet.
    expect(events).toEqual([]);

    await index.refresh();
    expect(events).toEqual([]);

    repo.write('docs/a.md', '# A, changed\n');
    repo.write('docs/c.md', '# C, new\n');
    await index.refresh(['docs/a.md', join(repo.dir, 'docs', 'c.md')]); // a repo path and an absolute path
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ module: 'docs' });
    expect(events[0]?.ids?.slice().sort()).toEqual(['docs/a.md', 'docs/c.md']);
    expect(Date.parse(events[0]?.at ?? '')).not.toBeNaN();
    expect(index.list().map((doc) => doc.title)).toEqual(['A, changed', 'B', 'C, new']);
  });

  it('refresh() reads every file again, and refresh(paths) the named files and any file whose size or time changed', async () => {
    const repo = repoWith({ 'docs/a.md': '# One\n', 'docs/b.md': '# Two\n', 'docs/c.md': '# Six\n' });
    const { index } = makeIndex(repo);
    await index.ready();
    const day = new Date(2026, 0, 2, 12, 0, 0);
    for (const name of ['a', 'b', 'c']) utimesSync(join(repo.dir, 'docs', `${name}.md`), day, day);
    await index.refresh();

    // A text of the same length, saved with the same time (an edit that a file system cannot tell apart from no edit).
    for (const name of ['a', 'b']) {
      repo.write(`docs/${name}.md`, `# ${name === 'a' ? 'Uno' : 'Dos'}\n`);
      utimesSync(join(repo.dir, 'docs', `${name}.md`), day, day);
    }
    // A change that shows: another length.
    repo.write('docs/c.md', '# Six, longer\n');

    await index.refresh(['docs/a.md']); // named: read again. c is read again as well, because its size changed. b is not.
    expect(index.list().map((doc) => doc.title)).toEqual(['Uno', 'Two', 'Six, longer']);
    await index.refresh(); // everything
    expect(index.list().map((doc) => doc.title)).toEqual(['Uno', 'Dos', 'Six, longer']);
  });

  it('refresh() calls that arrive together are not run side by side, and every caller waits for a scan that started after its call', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n' });
    const { index } = makeIndex(repo);
    await index.ready();
    repo.write('docs/a.md', '# A, one\n');
    const first = index.refresh();
    repo.write('docs/a.md', '# A, two\n');
    const second = index.refresh();
    const third = index.refresh();
    await Promise.all([first, second, third]);
    expect(pageOf(index, 'a').title).toBe('A, two');
  });

  it('scans never run side by side: a refresh that comes during a scan waits for it, and then runs once', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n' });
    // A runner that holds each scan at its git call until the test lets it go, and counts the scans that are inside it at once.
    let inside = 0;
    let most = 0;
    const gates: (() => void)[] = [];
    const held: Runner = async () => {
      inside += 1;
      most = Math.max(most, inside);
      await new Promise<void>((open) => gates.push(open));
      inside -= 1;
      return { code: 0, stdout: '', stderr: '' };
    };
    const { index } = makeIndex(repo, { runner: held });

    const first = index.ready(); // the first scan starts and waits at its git call
    await waitFor(() => gates.length === 1, 'the first scan to reach git');
    const second = index.refresh(); // comes while the first scan runs
    const third = index.refresh(); // and another one, which shares the second scan
    await new Promise((done) => setTimeout(done, 150));
    expect(gates).toHaveLength(1); // neither has started

    gates[0]?.(); // the first scan ends
    await first;
    await waitFor(() => gates.length === 2, 'the next scan to start');
    gates[1]?.();
    await Promise.all([second, third]);
    await new Promise((done) => setTimeout(done, 150));
    expect(gates).toHaveLength(2); // two scans in all: the first, and one for the two calls that came during it
    expect(most).toBe(1);
  });

  it('a doc that nav.json names outside docs/ is read as well, and one that nothing names is not', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n',
      'tools/cc/README.md': '# Tool readme\n',
      'tools/cc/OTHER.md': '# Not named\n',
    });
    repo.writeNav({ sections: [{ id: 'tool', title: 'Tool', items: ['tools/cc/README.md'] }] });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.list().map((doc) => doc.id)).toEqual(['docs/a.md', 'tools/cc/README.md']);
    expect(index.nav().map((section) => [section.id, section.items.length])).toEqual([
      ['tool', 1],
      ['other', 1],
    ]);
  });

  it('a nav.json that is missing or broken puts every doc under Other and says so', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n' });
    repo.remove('nav.json');
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.nav().map((section) => section.id)).toEqual(['other']);
    expect(index.problems().join('\n')).toMatch(/nav\.json is missing/);

    repo.writeNav('{ this is not json');
    await index.refresh();
    expect(index.nav().map((section) => section.id)).toEqual(['other']);
    expect(index.problems().join('\n')).toMatch(/not valid JSON/);

    repo.writeNav({ sections: [{ id: 'all', title: 'All', items: ['docs/'] }] });
    await index.refresh();
    expect(index.nav().map((section) => section.id)).toEqual(['all']);
    expect(index.problems()).toEqual([]);
  });
});

describe('the watcher', () => {
  it('polling watcher: a fixture edit updates the doc within 5 s and publishes changed with its doc id', async () => {
    const repo = repoWith({ 'docs/a.md': '# Old title\n', 'docs/b.md': '# Other doc\n' });
    const { index, events } = makeIndex(repo, { watch: true });
    try {
      await index.ready();
      expect(events).toEqual([]);

      // An edit.
      const edited = Date.now();
      repo.write('docs/a.md', '# New title\n\nChanged text.\n');
      await waitFor(() => index.get('a')?.title === 'New title', 'the edit to reach the index', 5000);
      expect(Date.now() - edited).toBeLessThan(5000);
      expect(events.filter((event) => event.module === 'docs').map((event) => event.ids)).toEqual([['docs/a.md']]);
      expect(Date.parse(must(events[0], 'the first event').at)).not.toBeNaN();
      expect(pageOf(index, 'a').html).toContain('Changed text.');

      // The index scans once more a moment after its first scan (see CATCH_UP_MS). Wait that out, so that from here on only the watcher can see a change.
      await new Promise((done) => setTimeout(done, 2000));

      // A new doc, in a folder that did not exist.
      repo.write('docs/deep/er/new.md', '# New doc\n');
      await waitFor(() => index.get('deep/er/new') !== null, 'the new doc to reach the index');
      expect(events.at(-1)?.ids).toEqual(['docs/deep/er/new.md']);

      // A doc that is deleted.
      repo.remove('docs/b.md');
      await waitFor(() => index.get('b') === null, 'the deletion to reach the index');
      expect(events.at(-1)?.ids).toEqual(['docs/b.md']);

      // The watcher had nothing to complain about (not even about the git log that this folder does not have).
      expect(index.problems()).toEqual([]);
    } finally {
      await index.close();
    }
  });

  it('a doc that nav.json names outside docs/ is watched too', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n', 'tools/cc/README.md': '# Tool readme\n', 'tools/cc/OTHER.md': '# Not named\n' });
    repo.writeNav({ sections: [{ id: 'tool', title: 'Tool', items: ['tools/cc/README.md'] }] });
    const { index, events } = makeIndex(repo, { watch: true });
    try {
      await index.ready();
      // Wait until the second scan that the index makes after the first one is over (see CATCH_UP_MS), so that only the watcher can see the edit.
      await new Promise((done) => setTimeout(done, 2500));
      expect(events).toEqual([]);
      repo.write('tools/cc/README.md', '# Tool readme, edited\n');
      repo.write('tools/cc/OTHER.md', '# Not named, edited\n');
      await waitFor(() => index.get('tools/cc/README')?.title === 'Tool readme, edited', 'the edit of the named doc to reach the index');
      expect(events.map((event) => event.ids)).toEqual([['tools/cc/README.md']]);
      expect(index.get('tools/cc/OTHER')).toBeNull(); // not named: not a doc, and not watched
    } finally {
      await index.close();
    }
  });

  it('the watcher reports docs, pictures, markdown at the repo root and named files, and nothing else', async () => {
    const repo = repoWith({
      'docs/a.md': '# A\n',
      'docs/pic.png': 'one',
      'docs/note.txt': 'one',
      'docs/gone.md': '# Will be deleted\n',
      'docs/.obsidian/workspace.md': '# a hidden folder\n',
      'package.json': '{}',
      'src/x.md': '# not watched\n',
      'tools/cc/README.md': '# named\n',
      'tools/cc/other.md': '# not named\n',
    });
    const seen = new Set<string>();
    const errors: Error[] = [];
    const nav = join(repo.dir, 'nav.json');
    const named = join(repo.dir, 'tools', 'cc', 'README.md');
    const watcher = startDocWatcher({
      root: repo.dir,
      files: [nav, named],
      isDocFile: (path) => /\.md$/i.test(path),
      isAssetFile: (path) => /\.png$/i.test(path),
      onChange: (paths) => paths.forEach((path) => seen.add(path.replaceAll('\\', '/').replace(`${repo.dir.replaceAll('\\', '/')}/`, ''))),
      onError: (error) => errors.push(error),
    });
    try {
      await watcher.ready;
      // chokidar says "ready" a moment before each poller has taken its first look at its file, and a
      // change in that moment is not seen (the index covers for this with a second scan, see CATCH_UP_MS).
      await new Promise((done) => setTimeout(done, 600));
      repo.write('docs/a.md', '# A, changed\n'); // watched
      repo.write('docs/deep/new.md', '# New\n'); // watched, in a new folder
      repo.write('docs/pic.png', 'two'); // watched: a picture
      repo.write('NOTES.md', '# Notes\n'); // watched: markdown at the repo root
      repo.write('nav.json', '{ "sections": [] }'); // watched: named
      repo.write('tools/cc/README.md', '# named, changed\n'); // watched: named
      repo.remove('docs/gone.md'); // watched: a doc that is deleted
      repo.write('docs/note.txt', 'two'); // not a doc or a picture
      repo.write('docs/.obsidian/workspace.md', '# changed\n'); // markdown, but in a hidden folder
      repo.write('package.json', '{ "a": 1 }'); // not markdown
      repo.write('src/x.md', '# changed\n'); // markdown, but not in docs/ and not at the root
      repo.write('tools/cc/other.md', '# changed\n'); // markdown next to a named file
      const expected = ['NOTES.md', 'docs/a.md', 'docs/deep/new.md', 'docs/gone.md', 'docs/pic.png', 'nav.json', 'tools/cc/README.md'];
      await waitFor(
        () => expected.every((path) => seen.has(path)),
        () => `the watcher to report the changes (it reported: ${[...seen].join(', ') || 'nothing'}; errors: ${errors.map((error) => error.message).join(' | ') || 'none'})`,
        6000,
      );
      // Give a path that should not be reported a full polling round to show up.
      await new Promise((done) => setTimeout(done, 1600));
      expect([...seen].sort()).toEqual(expected);
      expect(errors).toEqual([]);
    } finally {
      await watcher.close();
    }
    // After close, nothing is reported.
    const countAfterClose = seen.size;
    repo.write('docs/after-close.md', '# After\n');
    await new Promise((done) => setTimeout(done, 1500));
    expect(seen.size).toBe(countAfterClose);
  });

  it('close() stops the watcher: no scan and no event happens after it', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n' });
    const { index, events } = makeIndex(repo, { watch: true });
    await index.ready();
    await index.close();
    repo.write('docs/a.md', '# Changed after close\n');
    await new Promise((done) => setTimeout(done, 1600));
    expect(events).toEqual([]);
    expect(pageOf(index, 'a').title).toBe('A');
    // Closing twice is fine.
    await expect(index.close()).resolves.toBeUndefined();
  });

  it('git dates follow a commit: the watcher also watches the git log of the repo', async () => {
    const repo = gitRepo();
    // The doc is changed before the index starts, so the commit later changes no file that the index watches.
    repo.write('docs/first.md', '# First doc\n\nThird version.\n');
    const { index } = makeIndex(repo, { watch: true, runner: realRunner(repo) });
    try {
      await index.ready();
      expect(pageOf(index, 'first').updated).toBe('2026-01-02'); // the day of the last commit that touched it
      await new Promise((done) => setTimeout(done, 2500)); // past the second scan of the index (see CATCH_UP_MS)

      commitAll(repo.dir, 'Change the first doc', '2026-04-05T09:00:00Z');
      await waitFor(() => index.get('first')?.updated === '2026-04-05', 'the new git date to reach the index');
    } finally {
      await index.close();
    }
  });

  it('changes that arrive close together are reported together, once', async () => {
    const repo = repoWith({ 'docs/a.md': '# A\n', 'docs/b.md': '# B\n', 'docs/c.md': '# C\n' });
    const batches: string[][] = [];
    const watcher = startDocWatcher({
      root: repo.dir,
      files: [],
      isDocFile: (path) => /\.md$/i.test(path),
      isAssetFile: () => false,
      onChange: (paths) => batches.push(paths),
      onError: (error) => {
        throw error;
      },
      intervalMs: 100, // look often, so that all the changes below are seen in one round...
      debounceMs: 600, // ...and wait longer than a round for more
    });
    try {
      await watcher.ready;
      await new Promise((done) => setTimeout(done, 400));
      for (const name of ['a', 'b', 'c']) repo.write(`docs/${name}.md`, `# ${name.toUpperCase()}, changed\n`);
      await waitFor(() => batches.length > 0, 'the changes to be reported');
      await new Promise((done) => setTimeout(done, 900)); // a second batch, if there were going to be one, would show by now
      expect(batches).toHaveLength(1);
      expect(batches[0]?.map((path) => path.replaceAll('\\', '/').split('/').pop()).sort()).toEqual(['a.md', 'b.md', 'c.md']);
    } finally {
      await watcher.close();
    }
  });
});
