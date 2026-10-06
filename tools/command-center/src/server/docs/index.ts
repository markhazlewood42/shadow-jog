import { createHash } from 'node:crypto';
import { type Dirent, type Stats, readdirSync } from 'node:fs';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getMimeType } from 'hono/utils/mime';
import MiniSearch from 'minisearch';
import type { DocHeading, DocPage, DocRef, DocSummary, NavSection, SearchHit } from '../../shared/types';
import { type Config, PACKAGE_DIR, isInside } from '../config';
import { isMissing } from '../fs-errors';
import type { Hub } from '../hub';
import type { Runner } from '../runner';
import { lastChangedDates, resolveUpdated } from './dates';
import { type KnownTargets, resolveHref } from './links';
import { type NavDefinition, type NavDoc, buildNav, namedFiles, parseNavFile } from './nav';
import { renderDoc } from './render';
import { type DocWatcher, startDocWatcher } from './watch';

// The doc index is the docs module of the server. It reads every doc of the repo, renders it once
// (see render.ts), and keeps the result in memory: the pages, the nav, the backlinks and the
// search. It watches the files, and when one changes it reads everything again and tells the
// event hub which docs changed, so an open page can reload.
//
// A scan always reads the whole repo's docs again (about 50 files, well under a second) instead of
// patching the old result. That is the simple way to be right: a link in one doc turns good or
// broken when another doc is added or removed, and a scan that starts from nothing never forgets
// to update that. Only the reading of file text is saved when a file has not changed.

/** What the index needs from the rest of the server. */
export type DocIndexDeps = { config: Config; runner: Runner; hub: Hub };

export type DocIndexOptions = {
  /** Watch the files and scan again when one changes. On unless this says false (a test that does not need it turns it off). */
  watch?: boolean;
  /** Where nav.json is. The tool's own nav.json unless this says another (tests and the end-to-end server use a fixture). */
  navFile?: string;
};

export type DocIndex = {
  /** Starts the index (the first scan, and the watcher) and says when the first scan is done. Calling it again gives the same promise. The other methods answer from the last scan, so wait for this first. */
  ready(): Promise<void>;
  /** Every doc, by path. */
  list(): DocSummary[];
  /** The doc with this slug (`engine/decisions`), or null. */
  get(slug: string): DocPage | null;
  /** The sections of the navigation. */
  nav(): NavSection[];
  /** What is wrong with the docs, one line each. */
  problems(): string[];
  /** Searches titles, headings and text. One hit for each doc, the best first. `limit` is how many docs at most (20 when not given). */
  search(query: string, limit?: number): SearchHit[];
  /** A served file (a picture or a diagram source) by the id in its address, or null. */
  asset(id: string): { file: string; type: string } | null;
  /** The docs that have the same file name as this slug, for a doc that has moved. */
  suggest(slug: string): DocRef[];
  /** The part of a doc that a heading opens: the heading and what follows, up to the next heading of the same or a higher level. `docId` is the repo path of the doc and `anchor` the id of the heading. Null when either is unknown. */
  section(docId: string, anchor: string): { heading: string; html: string } | null;
  /** Renders markdown as if it were written in the doc `docId`, so its links resolve from that doc's folder. Gives html that is safe to put into a page. */
  renderFragment(docId: string, markdown: string): string;
  /** Reads the docs again now. `paths` are the files that changed (repo paths, or absolute paths in the repo): only these are read from disk again, the others come from the last scan. Without `paths` everything is read again. Calls that arrive together share one scan. */
  refresh(paths?: string[]): Promise<void>;
  /** Stops the watcher. The index keeps answering from its last scan. */
  close(): Promise<void>;
};

// ---- settings ----

/** A doc larger than this is left out and reported: reading and rendering a huge file would stall the server. */
const MAX_DOC_BYTES = 2 * 1024 * 1024;
/** Files are read this many at a time, so a repo with thousands of docs does not open them all at once. */
const READ_BATCH = 32;
/** The branch that a link to a repo file opens on GitHub. */
const GITHUB_BRANCH = 'main';
/**
 * How long after the first scan the index scans once more. The watcher says it is ready a moment
 * before each of its pollers has taken its first look at its file, and a file that changes in that
 * moment would be missed for good. Scanning again after one polling round (a second), with some
 * to spare, finds such a change. It costs one scan, once, and finds nothing new in the usual case.
 */
const CATCH_UP_MS = 1500;
const DEFAULT_HITS = 20;
const MAX_QUERY_CHARS = 200;
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 140;

/** A markdown file: a doc. */
const isDocFile = (path: string): boolean => /\.md$/i.test(path);
/** A picture, or the HTML source of a diagram: a file the site serves under /files. */
const isAssetFile = (path: string): boolean => /\.(png|jpe?g|gif|webp|svg|html)$/i.test(path);

// ---- helpers ----

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The slug of a doc: its repo path without `.md` and without a leading `docs/`. */
const slugOf = (id: string): string => id.replace(/\.md$/i, '').replace(/^docs\//, '');

/** A path (a repo path, or an absolute path inside the repo) as a repo path with forward slashes, or null when it is outside the repo. */
function repoPathOf(root: string, path: string): string | null {
  const absolute = isAbsolute(path) ? path : join(root, path);
  if (!isInside(root, absolute)) return null;
  const id = relative(root, absolute).split(sep).join('/');
  return id === '' || id.startsWith('..') ? null : id;
}

/** A frontmatter value as text for a list: a string as it is, a number or a flag as its text, anything else as nothing. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

// ---- finding the files ----

type Found = {
  /** Every markdown file to read: repo path -> absolute path. */
  docs: Map<string, string>;
  /** Every served file under docs/: repo path -> absolute path. */
  assets: Map<string, string>;
};

/** The folders below `dir`, depth first. A folder that is not there is not an error (a repo may have no docs/). */
async function walk(root: string, dir: string, found: Found, problems: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (!isMissing(error)) problems.push(`${repoPathOf(root, dir) ?? dir}: the folder could not be read (${messageOf(error)}).`);
    return;
  }
  for (const entry of entries) {
    // Hidden folders (.git, .obsidian) are not docs. A symbolic link is neither a file nor a folder
    // here, so a link can never lead the index out of the repo.
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, path, found, problems);
    } else if (entry.isFile()) {
      const id = repoPathOf(root, path);
      if (id === null) continue;
      if (isDocFile(entry.name)) found.docs.set(id, path);
      else if (isAssetFile(entry.name)) found.assets.set(id, path);
    }
  }
}

/** The docs of the repo: docs/ and everything under it, the markdown files at the top, and the files that nav.json names. */
async function findFiles(root: string, named: readonly string[], problems: string[]): Promise<Found> {
  const found: Found = { docs: new Map(), assets: new Map() };
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile() && isDocFile(entry.name) && !entry.name.startsWith('.')) found.docs.set(entry.name, join(root, entry.name));
    }
  } catch (error) {
    problems.push(`The repo folder could not be read (${messageOf(error)}).`);
  }
  await walk(root, join(root, 'docs'), found, problems);

  for (const id of named) {
    if (found.docs.has(id)) continue;
    const file = join(root, id);
    try {
      // lstat does not follow a link: a named file that is a link is left out.
      if (isInside(root, file) && (await lstat(file)).isFile()) found.docs.set(id, file);
    } catch (error) {
      if (!isMissing(error)) problems.push(`${id}: ${messageOf(error)}`);
    }
  }
  return found;
}

// ---- reading the files ----

/** One doc's text as read from disk. */
type Source = { id: string; file: string; text: string; hash: string; mtimeMs: number; size: number };

async function readSource(id: string, file: string, before: Source | undefined, reread: boolean, problems: string[]): Promise<Source | null> {
  let info: Stats;
  try {
    info = await stat(file);
  } catch (error) {
    if (!isMissing(error)) problems.push(`${id}: ${messageOf(error)}`); // gone since the folder was listed: not a problem
    return null;
  }
  if (!info.isFile()) return null;
  if (info.size > MAX_DOC_BYTES) {
    problems.push(`${id} is larger than ${MAX_DOC_BYTES / 1024 / 1024} MB, so it is not on the site.`);
    return null;
  }
  // The text of a file that was not named as changed, and whose size and time are as before, is the text we have.
  if (before !== undefined && !reread && before.mtimeMs === info.mtimeMs && before.size === info.size) return before;
  try {
    const text = await readFile(file, 'utf8');
    return { id, file, text, hash: sha1(text), mtimeMs: info.mtimeMs, size: info.size };
  } catch (error) {
    if (!isMissing(error)) problems.push(`${id}: ${messageOf(error)}`);
    return null;
  }
}

async function readSources(found: Found, previous: ReadonlyMap<string, Source>, changed: ReadonlySet<string> | null, problems: string[]): Promise<Source[]> {
  const ids = [...found.docs.keys()].sort();
  const sources: Source[] = [];
  for (let at = 0; at < ids.length; at += READ_BATCH) {
    const batch = ids.slice(at, at + READ_BATCH);
    const read = await Promise.all(
      batch.map((id) => readSource(id, found.docs.get(id) ?? '', previous.get(id), changed === null || changed.has(id), problems)),
    );
    for (const source of read) if (source !== null) sources.push(source);
  }
  return sources;
}

// ---- served files ----

/** The id of each served file: a short hash of its path, made longer only when two paths share the short one. */
function assignAssetIds(paths: readonly string[]): Map<string, string> {
  const hashes = new Map(paths.map((path) => [path, sha1(path)]));
  const ids = new Map<string, string>();
  for (let length = 8; length <= 40 && ids.size < paths.length; length++) {
    const groups = new Map<string, string[]>();
    for (const [path, hash] of hashes) {
      if (!ids.has(path)) groups.set(hash.slice(0, length), [...(groups.get(hash.slice(0, length)) ?? []), path]);
    }
    for (const [prefix, group] of groups) {
      const only = group[0];
      if (group.length === 1 && only !== undefined) ids.set(only, prefix);
    }
  }
  return ids;
}

// ---- links ----

/**
 * Whether a file or folder of the repo exists, with the case of every name exact, as on GitHub:
 * Windows would say yes to `Docs/A.md`, and GitHub would show a 404. The folders are read once
 * each (the answers are kept in `cache`, which lives as long as one scan).
 */
function existsExactCase(root: string, path: string, cache: Map<string, Set<string> | null>): boolean {
  let dir = root;
  for (const name of path.split('/')) {
    let names = cache.get(dir);
    if (names === undefined) {
      try {
        names = new Set(readdirSync(dir));
      } catch {
        names = null; // not a folder, or not readable: nothing below it exists
      }
      cache.set(dir, names);
    }
    if (names === null || !names.has(name)) return false;
    dir = join(dir, name);
  }
  return true;
}

/** What links in a doc can point at, as renderDoc's resolver wants it (see links.ts). */
type Targets = { docs: ReadonlyMap<string, string>; assets: ReadonlyMap<string, string> };

function knownFor(root: string, targets: Targets): KnownTargets {
  const cache = new Map<string, Set<string> | null>();
  return {
    docs: new Map(targets.docs),
    assets: new Map(targets.assets),
    exists: (path) => existsExactCase(root, path, cache),
  };
}

// ---- headings and sections of rendered html ----

/** A heading in the html of a doc: where it is, what it says, and the id that links jump to. */
type HeadingSpan = { level: number; id: string; text: string; start: number; end: number };

/** The tags that stay inside a line of text: taking them out must not split a word in two. */
const INLINE_TAGS = new Set(['a', 'code', 'em', 'strong', 's', 'span', 'b', 'i', 'u', 'mark', 'small', 'sub', 'sup', 'kbd', 'img']);
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** The words of some html (the html that render.ts writes): no tags, the five entities it writes turned back into characters. */
function htmlToText(html: string): string {
  return html
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (_tag, name: string) => (INLINE_TAGS.has(name.toLowerCase()) ? '' : ' '))
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every heading of some html, in order. render.ts writes a heading as `<h2 id="slug">words</h2>` and
 * escapes every `<` of the doc's own text, so the only `<h2` in the html is a real heading.
 */
function headingSpans(html: string): HeadingSpan[] {
  const spans: HeadingSpan[] = [];
  const open = /<h([1-6])((?:\s[^>]*)?)>/g;
  for (let match = open.exec(html); match !== null; match = open.exec(html)) {
    const level = Number(match[1]);
    const closeTag = `</h${level}>`;
    const close = html.indexOf(closeTag, open.lastIndex);
    if (close === -1) continue;
    const end = close + closeTag.length;
    spans.push({
      level,
      id: /\sid="([^"]*)"/.exec(match[2] ?? '')?.[1] ?? '',
      text: htmlToText(html.slice(open.lastIndex, close)),
      start: match.index,
      end,
    });
    open.lastIndex = end;
  }
  return spans;
}

// ---- search ----

/** A part of a doc for the search: the text under one heading (the text before the first heading is a part too). */
type SearchSection = { id: number; slug: string; title: string; heading: string; text: string };

/**
 * Splits a text into the words that the search indexes, and the same for a query. Every run of
 * letters, digits and underscores is a word, and a name written in camelCase, snake_case or with
 * digits (`createWidgetFactory`, `snake_case`, `E12`) also gives its parts, so a search for
 * `widget` finds `createWidgetFactory`. A name with dots (`scene.add.layer()`) is its words.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const [word] of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    tokens.push(word);
    const parts = word.split(/_+|(?<=\p{Ll})(?=\p{Lu})|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u).filter((part) => part !== '');
    if (parts.length > 1) tokens.push(...parts);
  }
  return tokens;
}

function newSearch(): MiniSearch<SearchSection> {
  return new MiniSearch<SearchSection>({
    fields: ['title', 'heading', 'text'],
    tokenize,
    // Case does not matter, and a single letter is noise.
    processTerm: (term) => (term.length < 2 ? null : term.toLowerCase()),
    searchOptions: {
      prefix: true, // "quok" finds "quokka": a search as you type
      combineWith: 'AND', // every word of the query must be there
      boost: { title: 4, heading: 2 },
    },
  });
}

/** The parts of a doc to search, from its html: one for each heading, and one for the text above the first heading. The ids count up from `firstId`. */
function sectionsOf(slug: string, title: string, html: string, spans: readonly HeadingSpan[], firstId: number): SearchSection[] {
  const parts: Omit<SearchSection, 'id'>[] = [];
  const first = spans[0];
  const intro = htmlToText(html.slice(0, first === undefined ? html.length : first.start));
  if (intro !== '') parts.push({ slug, title, heading: '', text: intro });
  spans.forEach((span, i) => {
    const next = spans[i + 1];
    parts.push({ slug, title, heading: span.text, text: htmlToText(html.slice(span.end, next === undefined ? html.length : next.start)) });
  });
  return parts.map((part, i) => ({ id: firstId + i, ...part }));
}

/** A few words of `text` around the first of `terms` (the words the search matched), as plain text. */
function snippetOf(text: string, terms: readonly string[]): string {
  if (text === '') return '';
  const lower = text.toLowerCase();
  let center = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at !== -1 && (center === -1 || at < center)) center = at;
  }
  center = Math.max(center, 0);
  let start = Math.max(0, center - SNIPPET_BEFORE);
  let end = Math.min(text.length, center + SNIPPET_AFTER);
  // Cut at a space when there is one, so a word is not cut in half.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < center) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > center) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// ---- the result of one scan ----

/** One doc, rendered. */
type DocEntry = {
  summary: DocSummary;
  page: DocPage;
  source: Source;
  spans: HeadingSpan[];
  /** The slugs of the other docs that this doc links to (not itself). */
  linksTo: Set<string>;
};

type Snapshot = {
  /** Every doc on the site, by path. */
  docs: DocEntry[];
  summaries: DocSummary[];
  bySlug: Map<string, DocEntry>;
  byId: Map<string, DocEntry>;
  nav: NavSection[];
  problems: string[];
  /** Served files by the id in their address. */
  assets: Map<string, { file: string; type: string }>;
  /** What links point at, kept to resolve the links of a fragment later. */
  targets: Targets;
  sections: SearchSection[];
  search: MiniSearch<SearchSection>;
  /** Everything a page can see, as a short text: two scans with the same signature need no event. */
  signature: string;
};

function emptySnapshot(): Snapshot {
  return {
    docs: [],
    summaries: [],
    bySlug: new Map(),
    byId: new Map(),
    nav: [],
    problems: [],
    assets: new Map(),
    targets: { docs: new Map(), assets: new Map() },
    sections: [],
    search: newSearch(),
    signature: '',
  };
}

/** The ids of the docs whose text is not what it was, or that are new, or that are gone. */
function changedIds(before: Snapshot, after: Snapshot): string[] {
  const ids = new Set<string>();
  for (const entry of after.docs) if (before.byId.get(entry.source.id)?.source.hash !== entry.source.hash) ids.add(entry.source.id);
  for (const entry of before.docs) if (!after.byId.has(entry.source.id)) ids.add(entry.source.id);
  return [...ids].sort();
}

/** Renders each doc once, and says what is wrong with it (a broken link, a bad frontmatter) in `problems`. */
function renderEntries(
  onSite: readonly { slug: string; source: Source }[],
  known: KnownTargets,
  blobBase: string,
  gitDays: ReadonlyMap<string, string>,
  problems: string[],
): DocEntry[] {
  const entries: DocEntry[] = [];
  for (const { slug, source } of onSite) {
    try {
      const rendered = renderDoc(source.text, { docId: source.id, resolve: (href) => resolveHref(href, source.id, known, blobBase) });
      const day = resolveUpdated(rendered.frontmatter.updated, gitDays.get(source.id), source.mtimeMs);
      const summary: DocSummary = {
        id: source.id,
        slug,
        title: rendered.title,
        type: textOf(rendered.frontmatter.type),
        status: textOf(rendered.frontmatter.status),
        updated: day.updated,
        updatedFrom: day.updatedFrom,
      };

      const brokenLinks: string[] = [];
      const linksTo = new Set<string>();
      for (const { href, resolved } of rendered.links) {
        if (resolved.kind === 'broken' && !brokenLinks.includes(href)) {
          brokenLinks.push(href);
          problems.push(`${source.id}: broken link "${href}" (${resolved.reason}).`);
        } else if (resolved.kind === 'doc' && resolved.slug !== slug) {
          linksTo.add(resolved.slug);
        }
      }
      if (rendered.frontmatterError !== null) problems.push(`${source.id}: ${rendered.frontmatterError}`);

      const headings: DocHeading[] = rendered.headings;
      const page: DocPage = { ...summary, html: rendered.html, headings, backlinks: [], brokenLinks, frontmatterError: rendered.frontmatterError };
      entries.push({ summary, page, source, spans: headingSpans(rendered.html), linksTo });
    } catch (error) {
      problems.push(`${source.id} could not be rendered (${messageOf(error)}), so it is not on the site.`);
    }
  }
  return entries;
}

const titleCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Puts on each doc the docs that link to it: each once, never the doc itself, and no broken link (a broken link has no target). */
function addBacklinks(entries: readonly DocEntry[]): void {
  const bySlug = new Map(entries.map((entry) => [entry.summary.slug, entry]));
  const linkers = new Map<string, DocRef[]>();
  for (const { summary, linksTo } of entries) {
    for (const slug of linksTo) {
      if (bySlug.has(slug)) linkers.set(slug, [...(linkers.get(slug) ?? []), { slug: summary.slug, title: summary.title }]);
    }
  }
  for (const [slug, refs] of linkers) {
    const target = bySlug.get(slug);
    if (target !== undefined) target.page.backlinks = refs.sort((a, b) => titleCollator.compare(a.title, b.title) || (a.slug < b.slug ? -1 : 1));
  }
}

/** The search index over every part of every doc. */
function buildSearch(entries: readonly DocEntry[]): { search: MiniSearch<SearchSection>; sections: SearchSection[] } {
  const sections: SearchSection[] = [];
  for (const { summary, page, spans } of entries) sections.push(...sectionsOf(summary.slug, summary.title, page.html, spans, sections.length));
  const search = newSearch();
  search.addAll(sections);
  return { search, sections };
}

// ---- the index ----

export function createDocIndex(deps: DocIndexDeps, options: DocIndexOptions = {}): DocIndex {
  const { config, runner, hub } = deps;
  const root = resolve(config.repoRoot);
  const navFile = resolve(options.navFile ?? join(PACKAGE_DIR, 'nav.json'));
  const navName = basename(navFile);
  const blobBase = `https://github.com/${config.githubRepo}/blob/${GITHUB_BRANCH}`;
  /** The git log of the repo grows with every commit, so a change there means that the dates may have changed. */
  const gitLogFile = join(root, '.git', 'logs', 'HEAD');

  let snapshot = emptySnapshot();
  let scanned = false;
  let closed = false;
  let started: Promise<void> | null = null;
  let watcher: DocWatcher | null = null;
  let catchUp: NodeJS.Timeout | null = null;
  /** What the watcher said was wrong with it. Every scan adds these to its problems. */
  const watcherProblems = new Set<string>();

  /** Reads nav.json. A file that is missing or cannot be read is a problem and an empty nav: every doc goes to Other. */
  async function readNav(problems: string[]): Promise<NavDefinition> {
    let text: string;
    try {
      text = await readFile(navFile, 'utf8');
    } catch (error) {
      problems.push(
        isMissing(error)
          ? `${navName} was not found (looked for ${navFile}), so every doc is listed under Other.`
          : `${navName} could not be read (${messageOf(error)}), so every doc is listed under Other.`,
      );
      return { sections: [], problems: [] };
    }
    return parseNavFile(text, navName);
  }

  /** Reads the whole repo's docs and builds a new snapshot. `changed` are the files to read from disk again, or null for all of them. */
  async function scan(changed: ReadonlySet<string> | null): Promise<Snapshot> {
    const problems: string[] = [];
    const navDef = await readNav(problems);
    problems.push(...navDef.problems);

    const named = namedFiles(navDef);
    watcher?.addFiles(named.map((id) => join(root, id))); // a doc that nav.json names may be anywhere: watch it too
    const found = await findFiles(root, named, problems);
    const previous = new Map(snapshot.docs.map((entry) => [entry.source.id, entry.source]));
    const sources = await readSources(found, previous, changed, problems);

    // Each doc's address. The first path in order keeps a slug, and a clash is reported, never thrown.
    const claimed = new Map<string, Source>();
    for (const source of sources) {
      const slug = slugOf(source.id);
      const owner = claimed.get(slug);
      if (owner === undefined) claimed.set(slug, source);
      else problems.push(`${owner.id} and ${source.id} both have the address "${slug}". ${source.id} is not on the site.`);
    }
    const onSite = [...claimed].map(([slug, source]) => ({ slug, source }));

    // The day each doc last changed in git, from one git call. Without git the file time is used, and the reason is shown.
    let gitDays: ReadonlyMap<string, string> = new Map();
    try {
      gitDays = await lastChangedDates(runner, root);
    } catch (error) {
      problems.push(`The dates from git are not available (${messageOf(error)}). The time of each file is used instead.`);
    }

    // The files that the site serves, and everything that a link can point at.
    const assetIds = assignAssetIds([...found.assets.keys()]);
    const assets = new Map<string, { file: string; type: string }>();
    const assetUrls = new Map<string, string>();
    for (const [path, id] of assetIds) {
      const file = found.assets.get(path) ?? '';
      const name = basename(file);
      assets.set(id, { file, type: getMimeType(name) ?? 'application/octet-stream' });
      assetUrls.set(path, `/files/${id}/${encodeURIComponent(name)}`);
    }
    const targets: Targets = { docs: new Map(onSite.map(({ slug, source }) => [source.id, slug])), assets: assetUrls };

    const docs = renderEntries(onSite, knownFor(root, targets), blobBase, gitDays, problems);
    addBacklinks(docs);
    const { search, sections } = buildSearch(docs);

    const navDocs: NavDoc[] = docs.map(({ summary }) => ({ id: summary.id, slug: summary.slug, title: summary.title, updated: summary.updated }));
    const built = buildNav(navDef, navDocs, (id) => docs.find((entry) => entry.source.id === id)?.source.text);
    problems.push(...built.problems, ...watcherProblems);

    const signature = sha1(JSON.stringify([docs.map((entry) => [entry.source.hash, entry.page]), built.nav, problems, [...assets.keys()]]));
    return {
      docs,
      summaries: docs.map((entry) => entry.summary),
      bySlug: new Map(docs.map((entry) => [entry.summary.slug, entry])),
      byId: new Map(docs.map((entry) => [entry.source.id, entry])),
      nav: built.nav,
      problems,
      assets,
      targets,
      sections,
      search,
      signature,
    };
  }

  /** One scan, and what follows it. It never rejects: a scan that fails leaves the last result in place and says so in the problems. */
  async function runScan(changed: ReadonlySet<string> | null): Promise<void> {
    if (closed) return;
    try {
      const next = await scan(changed);
      if (closed) return;
      const before = snapshot;
      snapshot = next;
      // The first scan is not a change: no page has seen the index yet. After that, an event goes out
      // only when something a page can see is different, and it names the docs whose text changed.
      if (scanned && next.signature !== before.signature) hub.publish({ module: 'docs', at: new Date().toISOString(), ids: changedIds(before, next) });
      scanned = true;
    } catch (error) {
      console.error('The docs could not be scanned:', error);
      const line = `The docs could not be read again (${messageOf(error)}). What the site shows may be out of date.`;
      snapshot = { ...snapshot, problems: [...snapshot.problems.filter((problem) => problem !== line), line] };
      scanned = true;
    }
  }

  // Scans run one after another. A call that comes while a scan is waiting to start joins it, so a burst of
  // calls gives one scan, and a call that comes while a scan is running gets the next one, which starts after the call.
  let tail: Promise<void> = Promise.resolve();
  let waiting: { changed: Set<string> | null; done: Promise<void> } | null = null;

  function refresh(paths?: string[]): Promise<void> {
    const named = paths === undefined ? null : new Set(paths.map((path) => repoPathOf(root, path)).filter((id): id is string => id !== null));
    if (waiting !== null) {
      if (named === null) waiting.changed = null;
      else if (waiting.changed !== null) for (const id of named) waiting.changed.add(id);
      return waiting.done;
    }
    const next = { changed: named, done: Promise.resolve() };
    next.done = tail.then(() => {
      waiting = null; // this scan starts now: a later call waits for the one after it
      return runScan(next.changed);
    });
    waiting = next;
    tail = next.done;
    return next.done;
  }

  async function start(): Promise<void> {
    if (options.watch ?? true) {
      try {
        watcher = startDocWatcher({
          root,
          files: [navFile, gitLogFile],
          isDocFile,
          isAssetFile,
          onChange: (paths) => void refresh(paths),
          onError: (error) => {
            console.error('The docs file watcher reported a problem:', error);
            const line = `The file watcher reported a problem (${error.message}). Edits may not show up.`;
            if (!watcherProblems.has(line)) {
              watcherProblems.add(line);
              void refresh();
            }
          },
        });
        await watcher.ready;
      } catch (error) {
        watcherProblems.add(`The file watcher could not start (${messageOf(error)}). Edits will not show up until the server is restarted.`);
      }
    }
    await refresh();
    if (watcher !== null && !closed) {
      catchUp = setTimeout(() => void refresh(), CATCH_UP_MS);
      catchUp.unref(); // a scan that is only a precaution must not keep the process alive
    }
  }

  const safeDecode = (text: string): string => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };

  return {
    ready() {
      started ??= start();
      return started;
    },

    list: () => snapshot.summaries,
    get: (slug) => snapshot.bySlug.get(slug)?.page ?? null,
    nav: () => snapshot.nav,
    problems: () => snapshot.problems,
    asset: (id) => snapshot.assets.get(id) ?? null,

    search(query, limit = DEFAULT_HITS) {
      const text = query.slice(0, MAX_QUERY_CHARS);
      if (text.trim() === '' || !(limit >= 1)) return [];
      const hits: SearchHit[] = [];
      const seen = new Set<string>();
      for (const result of snapshot.search.search(text)) {
        // MiniSearch lists the best part first, so the first part of a doc that comes up is the doc's best.
        const part = snapshot.sections[result.id as number];
        if (part === undefined || seen.has(part.slug)) continue;
        seen.add(part.slug);
        hits.push({
          slug: part.slug,
          title: part.title,
          heading: part.heading || part.title,
          snippet: snippetOf(part.text, result.terms),
          score: Math.round(result.score * 1000) / 1000,
        });
        if (hits.length >= Math.floor(limit)) break;
      }
      return hits;
    },

    suggest(slug) {
      const name = (slug.split('/').pop() ?? '').toLowerCase();
      if (name === '') return [];
      return snapshot.docs
        .filter(({ summary }) => (summary.slug.split('/').pop() ?? '').toLowerCase() === name)
        .map(({ summary }) => ({ slug: summary.slug, title: summary.title }))
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    },

    section(docId, anchor) {
      const entry = snapshot.byId.get(docId);
      if (entry === undefined || anchor === '') return null;
      // An anchor may come percent-encoded, as a browser writes it for a heading with non-ASCII letters.
      const at = entry.spans.findIndex((span) => span.id !== '' && (span.id === anchor || span.id === safeDecode(anchor)));
      const heading = entry.spans[at];
      if (heading === undefined) return null;
      // The section ends at the next heading of the same or a higher level (a lower number); deeper headings are inside it.
      const next = entry.spans.slice(at + 1).find((span) => span.level <= heading.level);
      return { heading: heading.text, html: entry.page.html.slice(heading.start, next?.start ?? entry.page.html.length) };
    },

    renderFragment(docId, markdown) {
      const known = knownFor(root, snapshot.targets);
      return renderDoc(markdown, { docId, resolve: (href) => resolveHref(href, docId, known, blobBase) }).html;
    },

    refresh,

    async close() {
      closed = true;
      if (catchUp !== null) clearTimeout(catchUp);
      await started?.catch(() => undefined);
      await watcher?.close();
      watcher = null;
      await tail;
    },
  };
}
