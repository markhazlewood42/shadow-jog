import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NavSection } from '../src/shared/types';
import { namedFiles, parseNavFile } from '../src/server/docs/nav';
import { PACKAGE_DIR } from './helpers';
import { type DocsRepo, makeDocsRepo, makeIndex } from './doc-index-helpers';

// The nav map: nav.json says which doc goes into which section of the left-hand tree, and the
// index turns it into NavSection[]. These tests make small synthetic repos, write a nav.json and
// read what the index builds from them.

const repos: DocsRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.close();
});
function repoWith(files: Record<string, string>): DocsRepo {
  const repo = makeDocsRepo(files);
  repos.push(repo);
  return repo;
}

/** The address of each item of a section: the slug of a doc, the path of a page. */
const addresses = (section: NavSection | undefined): string[] => (section?.items ?? []).map((item) => (item.kind === 'doc' ? item.slug : item.path));
const sectionIds = (nav: NavSection[]) => nav.map((section) => section.id);

const DOCS = {
  'status.md': '# Status\n',
  'docs/a.md': '# A\n',
  'docs/b.md': '# B\n',
  'docs/sub/c.md': '# C\n',
  'docs/sub/deeper/d.md': '# D\n',
  'docs/stray.md': '# Stray\n',
};

describe('the nav map', () => {
  it('an unlisted doc lands in Other and every doc appears once', async () => {
    const repo = repoWith(DOCS);
    repo.writeNav({
      sections: [
        { id: 'one', title: 'One', items: ['status.md', 'docs/a.md'] },
        // docs/a.md is named a second time here: it stays in the first section that names it.
        { id: 'two', title: 'Two', items: ['docs/sub/', 'docs/a.md'] },
      ],
    });
    const { index } = makeIndex(repo);
    await index.ready();

    const nav = index.nav();
    expect(sectionIds(nav)).toEqual(['one', 'two', 'other']);
    expect(addresses(nav[0])).toEqual(['status', 'a']);
    // A folder holds every doc under it, in every level below it.
    expect(addresses(nav[1])).toEqual(['sub/c', 'sub/deeper/d']);
    // The docs that no section names (b and stray) are in Other, so no doc gets lost.
    expect(nav[2]).toMatchObject({ id: 'other', title: 'Other' });
    expect(addresses(nav[2])).toEqual(['b', 'stray']);

    // Every doc of the index is in the nav exactly once.
    const listed = nav.flatMap((section) => addresses(section));
    expect(listed.slice().sort()).toEqual(index.list().map((doc) => doc.slug).sort());
    expect(new Set(listed).size).toBe(listed.length);

    // The second mention of docs/a.md is reported, so a typo in nav.json does not hide.
    const clash = index.problems().filter((problem) => problem.includes('docs/a.md'));
    expect(clash).toHaveLength(1);
    expect(clash[0]).toMatch(/"One".*"Two"/);

    // When every doc is named, there is no Other section at all (not an empty one).
    repo.writeNav({ sections: [{ id: 'all', title: 'All', items: ['status.md', 'docs/'] }] });
    await index.refresh();
    expect(sectionIds(index.nav())).toEqual(['all']);
    expect(index.problems()).toEqual([]);
  });

  it('no section nests deeper than two levels', async () => {
    const repo = repoWith(DOCS);
    repo.writeNav({
      sections: [
        { id: 'tree', title: 'Tree', items: ['docs/sub/'] },
        // A section inside a section is not allowed: it is reported, and its docs fall to Other.
        { id: 'bad', title: 'Bad', items: [{ title: 'Inner', items: ['docs/a.md'] }, 'status.md'] },
      ],
    });
    const { index } = makeIndex(repo);
    await index.ready();

    const nav = index.nav();
    // The folder three levels down is flat: the section holds docs, and a doc holds nothing.
    expect(addresses(nav.find((section) => section.id === 'tree'))).toEqual(['sub/c', 'sub/deeper/d']);
    for (const section of nav) {
      expect(Object.keys(section).sort()).toEqual(['id', 'items', 'title']);
      for (const item of section.items) {
        expect(['doc', 'page']).toContain(item.kind);
        expect(Object.keys(item)).not.toContain('items');
      }
    }
    const problem = index.problems().find((text) => text.includes('Bad'));
    expect(problem).toMatch(/two levels/);
    expect(addresses(nav.find((section) => section.id === 'bad'))).toEqual(['status']);
    expect(addresses(nav.find((section) => section.id === 'other'))).toContain('a');
  });

  it('puts a README first in a folder and sorts the rest by name, with numbers in order', async () => {
    const repo = repoWith({
      'docs/spikes/zeta.md': '# Z\n',
      'docs/spikes/README.md': '# R\n',
      'docs/spikes/alpha.md': '# A\n',
      'docs/spikes/Beta.md': '# B\n',
      'docs/spikes/round-10.md': '# 10\n',
      'docs/spikes/round-9.md': '# 9\n',
    });
    repo.writeNav({ sections: [{ id: 's', title: 'Spikes', items: ['docs/spikes/'] }] });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(addresses(index.nav()[0])).toEqual(['spikes/README', 'spikes/alpha', 'spikes/Beta', 'spikes/round-9', 'spikes/round-10', 'spikes/zeta']);
  });

  it('gives each doc item its title and its last-changed date, and keeps a page item as a page', async () => {
    const repo = repoWith({
      'docs/a.md': '---\ntitle: The A doc\nupdated: 2026-03-04\n---\n# Heading\n',
    });
    repo.writeNav({
      sections: [
        { id: 'one', title: 'One', items: ['docs/a.md', { page: '/docs/decisions', title: 'All decisions' }] },
      ],
    });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(index.nav()).toEqual([
      {
        id: 'one',
        title: 'One',
        items: [
          { kind: 'doc', slug: 'a', title: 'The A doc', updated: '2026-03-04' },
          { kind: 'page', path: '/docs/decisions', title: 'All decisions' },
        ],
      },
    ]);
    expect(index.problems()).toEqual([]);
  });

  it('lists the docs of a reading order in its order, then the other docs of the folder, and says what it cannot place', async () => {
    const repo = repoWith({
      'docs/engine/README.md': `# Engine

## 3. Reading order

1. This file.
2. [two.md](two.md)
3. [missing.md](missing.md)
4. Words with no link.
5. [one.md](one.md)
`,
      'docs/engine/one.md': '# One\n',
      'docs/engine/two.md': '# Two\n',
      'docs/engine/unlisted.md': '# Unlisted\n',
    });
    repo.writeNav({ sections: [{ id: 'engine', title: 'Engine design', items: [{ readingOrder: 'docs/engine/README.md' }, 'docs/engine/'] }] });
    const { index } = makeIndex(repo);
    await index.ready();

    expect(addresses(index.nav()[0])).toEqual(['engine/README', 'engine/two', 'engine/one', 'engine/unlisted']);
    expect(sectionIds(index.nav())).toEqual(['engine']);
    const problems = index.problems().join('\n');
    expect(problems).toContain('missing.md');
    expect(problems).toContain('Words with no link');
  });

  it('leaves out a section that has nothing in it, and says what it could not find', async () => {
    const repo = repoWith(DOCS);
    repo.writeNav({
      sections: [
        { id: 'gone', title: 'Gone', items: ['docs/missing.md', 'docs/nothing-here/'] },
        { id: 'one', title: 'One', items: ['status.md'] },
      ],
    });
    const { index } = makeIndex(repo);
    await index.ready();
    expect(sectionIds(index.nav())).toEqual(['one', 'other']);
    const problems = index.problems().join('\n');
    expect(problems).toContain('docs/missing.md is not a doc of the repo');
    expect(problems).toContain('the folder docs/nothing-here/ has no docs');
  });
});

describe('parseNavFile', () => {
  it('reads the four kinds of item', () => {
    const def = parseNavFile(
      JSON.stringify({
        sections: [
          {
            id: 'a',
            title: 'A',
            items: ['docs/one.md', 'docs/folder/', { readingOrder: 'docs/engine/README.md' }, { page: '/docs/decisions', title: 'Decisions' }],
          },
        ],
      }),
      'nav.json',
    );
    expect(def.problems).toEqual([]);
    expect(def.sections).toEqual([
      {
        id: 'a',
        title: 'A',
        items: [
          { kind: 'file', path: 'docs/one.md' },
          { kind: 'folder', path: 'docs/folder/' },
          { kind: 'readingOrder', path: 'docs/engine/README.md' },
          { kind: 'page', path: '/docs/decisions', title: 'Decisions' },
        ],
      },
    ]);
    // The files that the index must read, even when they are not under docs/, are the files and the reading orders.
    expect(namedFiles(def)).toEqual(['docs/one.md', 'docs/engine/README.md']);
  });

  it('reports a nav.json that is not JSON, not an object, or has no sections, and keeps what is good', () => {
    expect(parseNavFile('{ not json', 'nav.json').problems[0]).toMatch(/nav\.json is not valid JSON/);
    expect(parseNavFile('[]', 'nav.json').problems[0]).toMatch(/must be an object/);
    expect(parseNavFile('{}', 'nav.json').problems[0]).toMatch(/"sections"/);

    const mixed = parseNavFile(
      JSON.stringify({
        sections: [
          { id: 'ok', title: 'Fine', items: ['docs/a.md'] },
          { id: 'no title', items: [] },
          { title: 'No id', items: [] },
          { id: 'ok', title: 'Same id', items: [] },
          'not an object',
          { id: 'items', title: 'Items is not a list', items: 'docs/a.md' },
        ],
      }),
      'nav.json',
    );
    expect(mixed.sections.map((section) => section.id)).toEqual(['ok']);
    expect(mixed.problems).toHaveLength(5);
  });

  it('refuses a path that leaves the repo, a page that is not a path of this site, and an item of another shape', () => {
    const def = parseNavFile(
      JSON.stringify({
        sections: [
          {
            id: 'x',
            title: 'X',
            items: [
              '../outside.md',
              '/etc/passwd.md',
              'docs\\back.md',
              'docs/not-markdown.txt',
              '',
              42,
              { readingOrder: '../outside.md' },
              { page: '//evil.example/x', title: 'Evil' },
              { page: 'javascript:alert(1)', title: 'Script' },
              { page: '/has space', title: 'Space' },
              { page: '/docs/ok', title: '' },
              { page: '/docs/ok' },
              { readingOrder: 'docs/a.md', page: '/docs/x', title: 'Both' },
              'docs/fine.md',
            ],
          },
        ],
      }),
      'nav.json',
    );
    expect(def.sections[0]?.items).toEqual([{ kind: 'file', path: 'docs/fine.md' }]);
    expect(def.problems).toHaveLength(13);
  });
});

describe('the real nav.json', () => {
  const real = readFileSync(join(PACKAGE_DIR, 'nav.json'), 'utf8');

  it('holds every section of design 5.2, with the Command center folder (ruling R4)', () => {
    const def = parseNavFile(real, 'nav.json');
    expect(def.problems).toEqual([]);
    expect(def.sections.map((section) => section.title)).toEqual([
      'Start here',
      'Roadmap',
      'Game design',
      'Engine design',
      'Decisions',
      'Architecture and development',
      'Spikes and research',
      'Quality',
      'Project records',
      'Command center',
    ]);
    const commandCenter = def.sections.find((section) => section.title === 'Command center');
    expect(commandCenter?.items).toContainEqual({ kind: 'folder', path: 'docs/command-center/' });
    // The engine docs go in the order of the engine README.
    const engine = def.sections.find((section) => section.title === 'Engine design');
    expect(engine?.items[0]).toEqual({ kind: 'readingOrder', path: 'docs/engine/README.md' });
  });

  it('is two levels deep: every section holds only files, folders, reading orders and pages', () => {
    const parsed = JSON.parse(real) as { sections: { items: unknown[] }[] };
    for (const section of parsed.sections) {
      for (const item of section.items) {
        const isPath = typeof item === 'string';
        const isObject = typeof item === 'object' && item !== null && !('items' in item);
        expect(isPath || isObject).toBe(true);
      }
    }
  });
});
