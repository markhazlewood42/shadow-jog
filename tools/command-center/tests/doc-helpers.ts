// Shared helpers for the markdown pipeline tests (frontmatter, links and render). This file has
// no tests of its own: the test runner only loads files that end in .test.ts or .test.tsx.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { type KnownTargets, resolveHref } from '../src/server/docs/links';
import { type RenderedDoc, renderDoc } from '../src/server/docs/render';
import { PACKAGE_DIR } from './helpers';

/** The sample repo of this tool (fixtures/repo): synthetic docs, written for these tests. */
export const FIXTURE_REPO = join(PACKAGE_DIR, 'fixtures', 'repo');

/** Where a link to a repo file that is not a doc goes. Made up: no test reaches the network. */
export const GITHUB_BLOB_BASE = 'https://github.com/fixture-owner/fixture-repo/blob/main';

/** The file types the index will serve as assets: pictures, and the HTML source of a diagram. */
const ASSET_FILE = /\.(png|jpe?g|gif|webp|svg|html)$/i;

/** The slug rule of the doc index: the repo path without `.md` and without a leading `docs/`. */
function slugOf(path: string): string {
  return path.replace(/\.md$/i, '').replace(/^docs\//, '');
}

/** The url a made-up index would give an asset: a short hash of its path, then its file name. */
export function assetUrl(path: string): string {
  return `/files/${createHash('sha1').update(path).digest('hex').slice(0, 8)}/${basename(path)}`;
}

/** Every file under `folder` (a path inside `root`), as repo paths with forward slashes. */
export function listFiles(root: string, folder: string): string[] {
  return readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** The `known` targets for a folder of files: the way the doc index will build them, with real files behind `exists`. */
export function knownFor(root: string, files: string[]): KnownTargets {
  const docs = new Map<string, string>();
  const assets = new Map<string, string>();
  for (const file of files) {
    if (file.toLowerCase().endsWith('.md')) docs.set(file, slugOf(file));
    else if (ASSET_FILE.test(file)) assets.set(file, assetUrl(file));
  }
  return { docs, assets, exists: (path) => existsSync(join(root, path)) };
}

/** The render context for one doc: `resolve` checks each link against `known`, as the doc index does. */
function contextFor(docId: string, known: KnownTargets) {
  return { docId, resolve: (href: string) => resolveHref(href, docId, known, GITHUB_BLOB_BASE) };
}

/** Targets that hold nothing: every link to a file is broken, and only external links and anchors work. */
const NOTHING_KNOWN: KnownTargets = { docs: new Map(), assets: new Map(), exists: () => false };

/** Renders a markdown text as if it were the file `docId`, against `known` (nothing, by default). */
export function render(src: string, docId = 'docs/sample.md', known: KnownTargets = NOTHING_KNOWN): RenderedDoc {
  return renderDoc(src, contextFor(docId, known));
}

/** Reads one file of a repo folder and renders it against `known`. */
export function renderFile(root: string, path: string, known: KnownTargets): RenderedDoc {
  return renderDoc(readFileSync(join(root, path), 'utf8'), contextFor(path, known));
}

/** The first `<tag ...>` of some HTML, as its attributes by name (empty when there is no such tag). */
export function attributesOf(html: string, tag: string): Record<string, string> {
  const open = new RegExp(`<${tag}(?=[\\s>/])([^>]*)>`, 'i').exec(html)?.[1] ?? '';
  const attributes: Record<string, string> = {};
  for (const match of open.matchAll(/([\w-]+)="([^"]*)"/g)) attributes[match[1] ?? ''] = match[2] ?? '';
  return attributes;
}

/** The names of every tag in some HTML, once each and sorted. A tag that doc text smuggled in would show up here. */
export function tagNames(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)/gi)) names.add((match[1] ?? '').toLowerCase());
  return [...names].sort();
}
