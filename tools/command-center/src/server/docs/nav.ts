import { posix } from 'node:path';
import type { NavItem, NavSection } from '../../shared/types';
import { parseReadingOrder, resolveReadingOrder } from './reading-order';

// The nav map. `nav.json` says which docs go into which section of the tree on the left of the docs
// pages. It is two levels deep: sections, and docs (or pages) in them. A doc that no section
// names goes into a last section called "Other", so no doc is ever lost.
//
//   { "sections": [
//     { "id": "start", "title": "Start here", "items": [
//         "status.md",                                       a file
//         "docs/quality/",                                   a folder: every doc below it
//         { "readingOrder": "docs/engine/README.md" },       the docs in the order of that doc's "Reading order" list
//         { "page": "/docs/decisions", "title": "Decisions" } a page of the site that is not a doc
//     ] }
//   ] }

/** One item of nav.json, checked. */
export type NavItemDef =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string } // the path ends with a slash
  | { kind: 'readingOrder'; path: string }
  | { kind: 'page'; path: string; title: string };

export type NavSectionDef = { id: string; title: string; items: NavItemDef[] };

/** What nav.json says, with everything that is wrong with it. A mistake leaves out its section or item and nothing more. */
export type NavDefinition = { sections: NavSectionDef[]; problems: string[] };

/** The id of the section that the index adds for the docs that no section names. It lists docs in no order of their own. */
export const OTHER_SECTION_ID = 'other';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short form of an item for a message. */
function show(item: unknown): string {
  const text = JSON.stringify(item) ?? String(item);
  return text.length > 70 ? `${text.slice(0, 67)}...` : text;
}

/**
 * A path of nav.json: inside the repo, with forward slashes, relative. Gives the tidy form
 * (`docs/./a.md` is `docs/a.md`), or null when the path is not one.
 */
function repoPath(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || /[\u0000-\u001f]/.test(value) || value.startsWith('/')) return null;
  const folder = value.endsWith('/');
  const tidy = posix.normalize(value);
  if (tidy === '.' || tidy === '..' || tidy.startsWith('../')) return null;
  return folder && !tidy.endsWith('/') ? `${tidy}/` : tidy;
}

/** A path of a page of this site: absolute, with letters, digits and a few marks. It cannot start a second slash (that is another host). */
function sitePath(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/(?!\/)[A-Za-z0-9._~/-]*$/.test(value) || /(^|\/)\.\.(\/|$)/.test(value)) return null;
  return value;
}

function parseItem(item: unknown, where: string, problems: string[]): NavItemDef | null {
  if (typeof item === 'string') {
    const path = repoPath(item);
    if (path === null) {
      problems.push(`${where}: "${item}" is not a path inside the repo (use forward slashes, no leading slash, no "..").`);
      return null;
    }
    if (path.endsWith('/')) return { kind: 'folder', path };
    if (!/\.md$/i.test(path)) {
      problems.push(`${where}: "${item}" is not a markdown file or a folder (a folder ends with a slash).`);
      return null;
    }
    return { kind: 'file', path };
  }

  if (isRecord(item)) {
    const keys = Object.keys(item);
    if ('readingOrder' in item && keys.length === 1) {
      const path = repoPath(item.readingOrder);
      if (path === null || path.endsWith('/') || !/\.md$/i.test(path)) {
        problems.push(`${where}: the readingOrder ${show(item.readingOrder)} is not a path to a markdown file.`);
        return null;
      }
      return { kind: 'readingOrder', path };
    }
    if ('page' in item && keys.length === 2 && 'title' in item) {
      const path = sitePath(item.page);
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (path === null || title === '') {
        problems.push(`${where}: the page ${show(item)} needs a path of this site that starts with one slash, and a title.`);
        return null;
      }
      return { kind: 'page', path, title };
    }
    if ('items' in item) {
      problems.push(`${where}: the item ${show(item)} is a section inside a section. The navigation is two levels deep: sections hold docs and pages only.`);
      return null;
    }
  }
  problems.push(`${where}: the item ${show(item)} is not a file, a folder (a path that ends with a slash), a readingOrder or a page.`);
  return null;
}

/**
 * Reads the text of nav.json. Never throws: a file that is not JSON, a section with no title and an
 * item that is not an item each give a line in `problems`, and the rest of the file still counts.
 * `file` is the name of the file as the messages should say it.
 */
export function parseNavFile(text: string, file: string): NavDefinition {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { sections: [], problems: [`${file} is not valid JSON (${reason}), so every doc is listed under Other.`] };
  }
  if (!isRecord(parsed)) return { sections: [], problems: [`${file} must be an object with a "sections" list, so every doc is listed under Other.`] };
  if (!Array.isArray(parsed.sections)) return { sections: [], problems: [`${file} has no "sections" list, so every doc is listed under Other.`] };

  const sections: NavSectionDef[] = [];
  const seen = new Set<string>();
  parsed.sections.forEach((raw: unknown, index: number) => {
    const label = `${file}, section ${index + 1}`;
    if (!isRecord(raw)) {
      problems.push(`${label} is not an object.`);
      return;
    }
    const { id, title } = raw;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      problems.push(`${label} needs an "id" of lower-case letters, digits and hyphens.`);
      return;
    }
    if (id === OTHER_SECTION_ID || seen.has(id)) {
      problems.push(`${label}: the id "${id}" is ${id === OTHER_SECTION_ID ? 'kept for the section of docs that no section names' : 'used twice'}.`);
      return;
    }
    if (typeof title !== 'string' || title.trim() === '') {
      problems.push(`${label} ("${id}") needs a "title".`);
      return;
    }
    if (!Array.isArray(raw.items)) {
      problems.push(`${label} ("${title}") needs an "items" list.`);
      return;
    }
    seen.add(id);
    const items: NavItemDef[] = [];
    for (const item of raw.items as unknown[]) {
      const def = parseItem(item, `${file}, section "${title}"`, problems);
      if (def !== null) items.push(def);
    }
    sections.push({ id, title: title.trim(), items });
  });
  return { sections, problems };
}

/** The markdown files that nav.json names itself (files and reading orders), so the index reads them even when they are not under docs/. */
export function namedFiles(def: NavDefinition): string[] {
  const paths = new Set<string>();
  for (const section of def.sections) {
    for (const item of section.items) {
      if (item.kind === 'file' || item.kind === 'readingOrder') paths.add(item.path);
    }
  }
  return [...paths];
}

/** What `buildNav` needs to know about a doc. */
export type NavDoc = { id: string; slug: string; title: string; updated: string };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The order of docs inside a folder or in Other: the docs of a folder before the docs of the
 * folders below it, a README first in its folder, then by name without regard to case, with
 * numbers in numeric order (round-9 before round-10).
 */
function compareDocIds(a: string, b: string): number {
  const folderA = posix.dirname(a);
  const folderB = posix.dirname(b);
  if (folderA !== folderB) return collator.compare(folderA, folderB);
  const readmeA = /^readme\.md$/i.test(posix.basename(a));
  const readmeB = /^readme\.md$/i.test(posix.basename(b));
  if (readmeA !== readmeB) return readmeA ? -1 : 1;
  return collator.compare(posix.basename(a), posix.basename(b)) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Builds the sections from nav.json and the docs the index holds.
 *
 * - Every doc appears once. The first place that names it keeps it. A file that two sections
 *   name is reported; a doc that a folder covers after another section named it is not (that is
 *   what folders are for).
 * - A section with nothing in it is left out, and the docs that no section named go to the last
 *   section, Other. Other is not there when every doc is placed.
 * - `sourceOf(id)` gives a doc's markdown, for a reading order.
 */
export function buildNav(def: NavDefinition, docs: readonly NavDoc[], sourceOf: (id: string) => string | undefined): { nav: NavSection[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const placedIn = new Map<string, string>(); // doc id -> the title of the section that has it
  const pages = new Map<string, string>(); // page path -> the title of the section that has it
  const ordered = [...docs].sort((a, b) => compareDocIds(a.id, b.id));
  const nav: NavSection[] = [];

  for (const section of def.sections) {
    const items: NavItem[] = [];
    const where = `nav.json, section "${section.title}"`;

    /** Puts a doc into this section unless an earlier section has it. Says `true` when the doc was already placed. */
    const place = (doc: NavDoc): boolean => {
      if (placedIn.has(doc.id)) return true;
      placedIn.set(doc.id, section.title);
      items.push({ kind: 'doc', slug: doc.slug, title: doc.title, updated: doc.updated });
      return false;
    };

    for (const item of section.items) {
      if (item.kind === 'file') {
        const doc = byId.get(item.path);
        if (doc === undefined) {
          problems.push(`${where}: ${item.path} is not a doc of the repo.`);
        } else if (place(doc)) {
          problems.push(`nav.json lists ${item.path} in "${placedIn.get(doc.id)}" and again in "${section.title}". It stays in "${placedIn.get(doc.id)}".`);
        }
      } else if (item.kind === 'folder') {
        const inside = ordered.filter((doc) => doc.id.startsWith(item.path));
        if (inside.length === 0) problems.push(`${where}: the folder ${item.path} has no docs.`);
        for (const doc of inside) place(doc);
      } else if (item.kind === 'readingOrder') {
        problems.push(...placeReadingOrder(item.path, where, byId, sourceOf, place));
      } else if (pages.has(item.path)) {
        problems.push(`nav.json lists the page ${item.path} in "${pages.get(item.path)}" and again in "${section.title}". It stays in "${pages.get(item.path)}".`);
      } else {
        pages.set(item.path, section.title);
        items.push({ kind: 'page', path: item.path, title: item.title });
      }
    }
    if (items.length > 0) nav.push({ id: section.id, title: section.title, items });
  }

  const unplaced = ordered.filter((doc) => !placedIn.has(doc.id));
  if (unplaced.length > 0) {
    nav.push({
      id: OTHER_SECTION_ID,
      title: 'Other',
      items: unplaced.map((doc): NavItem => ({ kind: 'doc', slug: doc.slug, title: doc.title, updated: doc.updated })),
    });
  }
  return { nav, problems };
}

/** Places the docs of one reading order, and returns what it could not place. */
function placeReadingOrder(
  path: string,
  where: string,
  byId: ReadonlyMap<string, NavDoc>,
  sourceOf: (id: string) => string | undefined,
  place: (doc: NavDoc) => boolean,
): string[] {
  const holder = byId.get(path);
  const source = holder === undefined ? undefined : sourceOf(holder.id);
  if (holder === undefined || source === undefined) return [`${where}: ${path} is not a doc of the repo, so its reading order is not used.`];

  const entries = parseReadingOrder(source);
  if (entries.length === 0) return [`${where}: ${path} has no "Reading order" list.`];

  const problems: string[] = [];
  for (const { label, path: docPath } of resolveReadingOrder(entries, holder.id)) {
    if (docPath === null) {
      problems.push(`${path}: the reading order item "${label}" does not link to a doc of the repo.`);
      continue;
    }
    const doc = byId.get(docPath);
    if (doc === undefined) problems.push(`${path}: the reading order names "${label}" (${docPath}), which is not a doc of the repo.`);
    else place(doc); // a doc that an earlier section took stays there, without a message
  }
  return problems;
}
