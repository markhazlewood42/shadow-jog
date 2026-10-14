#!/usr/bin/env node
// Changelog entry files (the reason: two PRs that edit CHANGELOG.md under `Unreleased` conflict on every merge).
//   Each PR adds changelog.d/<branch-slug>.md and never edits CHANGELOG.md. A release folds the entries in.
//
//   node scripts/changelog-fold.mjs --check                                    validate every entry file (exit 1 on a bad one)
//   node scripts/changelog-fold.mjs <version> [--date YYYY-MM-DD] [--dry-run]   fold the entries into CHANGELOG.md
//
// `npm run changelog:check` and `npm run changelog:fold -- <version>` call it. tests/changelog-fold.test.ts imports the pure functions and
// runs the validator over the real changelog.d folder, so `npm run check` and CI fail on a bad entry file. Plain Node, no dependencies.
// Format and rules: changelog.d/README.md.

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRY_DIR = join(ROOT, 'changelog.d');
export const CHANGELOG = join(ROOT, 'CHANGELOG.md');

/** The Keep a Changelog 1.1.0 headings, in the order a release section lists them. */
export const HEADINGS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
/** An entry file name: the branch name with each slash turned into a hyphen. */
export const FILE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const lf = (text) => text.replace(/\r\n?/g, '\n');

/**
 * Reads one entry file. Returns the bullets for each heading and every problem found.
 * A bullet starts with `- ` at the left edge. Indented lines after it belong to it (nested bullets, wrapped text).
 * @param {string} text
 * @param {string} [name] the file name, used in the messages
 * @returns {{ sections: Record<string, string[]>, errors: string[] }}
 */
export function parseEntry(text, name = 'entry') {
  /** @type {Record<string, string[]>} */
  const sections = {};
  /** @type {string[]} */
  const errors = [];
  const at = (n, message) => errors.push(`${name}:${n}: ${message}`);
  const lines = lf(text).split('\n');
  if (lines.every((line) => line.trim() === '')) return { sections, errors: [`${name}: the file is empty`] };

  let heading = null; // the known heading in force, or null
  let badHeading = false; // a wrong heading was reported: stay quiet about the bullets under it
  let bullet = null; // the lines of the bullet being read
  let blanks = 0; // blank lines seen since the last text line
  const counts = new Map(); // heading -> { line, bullets }
  const close = () => {
    if (bullet && heading) sections[heading].push(bullet.join('\n'));
    bullet = null;
  };

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trimEnd();
    if (line.trim() === '') {
      blanks += 1;
      return;
    }
    const h = /^(#{1,6})\s*(.*)$/.exec(line);
    if (h) {
      close();
      blanks = 0;
      const title = h[2].replace(/^\[(.*)\]$/, '$1').trim();
      heading = null;
      badHeading = true;
      if (/^unreleased\b/i.test(title)) at(n, 'an entry file has no Unreleased heading: CHANGELOG.md keeps it, and the fold fills it');
      else if (h[1] !== '###') at(n, `use a "### " heading (found "${line}")`);
      else if (!HEADINGS.includes(title)) at(n, `unknown heading "${title}" (use ${HEADINGS.join(', ')})`);
      else {
        heading = title;
        badHeading = false;
        sections[title] ??= [];
        if (!counts.has(title)) counts.set(title, { line: n, bullets: 0 });
      }
      return;
    }
    if (line === '-' || line.startsWith('- ')) {
      close();
      blanks = 0;
      if (!heading) {
        if (!badHeading) at(n, 'a bullet needs a heading above it');
        return;
      }
      if (line.slice(1).trim() === '') {
        at(n, 'the bullet is empty');
        return;
      }
      bullet = [line];
      counts.get(heading).bullets += 1;
      return;
    }
    if (/^\s/.test(line) && bullet) {
      if (blanks > 0) bullet.push('');
      blanks = 0;
      bullet.push(line);
      return;
    }
    at(n, `text outside headings and bullets: "${line.length > 60 ? `${line.slice(0, 57)}...` : line}"`);
  });
  close();
  for (const [title, info] of counts) if (info.bullets === 0) at(info.line, `the heading "${title}" has no bullet`);
  if (errors.length === 0 && counts.size === 0) errors.push(`${name}: the file has no heading and no bullet`);
  return { sections, errors };
}

/** Lists the problems of one entry file (its text and its name). An empty list means the file is good. */
export function validateEntry(text, name) {
  const errors = FILE_NAME.test(name)
    ? []
    : [`${name}: the file name must be the branch name in lowercase kebab-case, ending in .md (a slash becomes a hyphen)`];
  return [...errors, ...parseEntry(text, name).errors];
}

/** The entry files of a folder: every `.md` file except README.md, sorted by name. */
export function listEntryFiles(dir = ENTRY_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') && file.toLowerCase() !== 'readme.md')
    .sort();
}

/** Reads and validates every entry file of a folder. */
export function checkDir(dir = ENTRY_DIR) {
  const files = listEntryFiles(dir);
  const errors = files.flatMap((file) => validateEntry(readFileSync(join(dir, file), 'utf8'), file));
  return { files, errors };
}

/**
 * Merges the bullets of several entries by heading. Files go in name order, so the result does not depend on the disk.
 * @param {{ name: string, text: string }[]} entries
 * @returns {Record<string, string[]>}
 */
export function mergeEntries(entries) {
  /** @type {Record<string, string[]>} */
  const merged = {};
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const { sections } = parseEntry(entry.text, entry.name);
    for (const heading of HEADINGS) if (sections[heading]?.length) (merged[heading] ??= []).push(...sections[heading]);
  }
  return merged;
}

/** The text of one release section: the `## [version] - date` heading, then the headings that have bullets, in Keep a Changelog order. */
export function renderRelease(version, date, merged) {
  const parts = [`## [${version}] - ${date}`];
  for (const heading of HEADINGS) if (merged[heading]?.length) parts.push(`### ${heading}\n${merged[heading].join('\n')}`);
  return `${parts.join('\n\n')}\n`;
}

/**
 * Puts a release section directly under `## [Unreleased]` and leaves Unreleased empty.
 * Bullets that still sit under Unreleased (written before the entry files existed) join the new section, ahead of the entry-file bullets.
 * It also moves the `[Unreleased]:` compare link and adds the link of the new version, when the file has them.
 * @returns {string} the new text of CHANGELOG.md
 */
export function foldIntoChangelog(changelog, entries, version, date) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a version like 0.2.0`);
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw new Error(`"${date}" is not a date like 2026-10-14`);
  const lines = lf(changelog).split('\n');
  const start = lines.findIndex((line) => /^## \[Unreleased\]\s*$/.test(line));
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
  if (lines.some((line) => line.startsWith(`## [${version}]`))) throw new Error(`CHANGELOG.md already has a section for ${version}`);
  let end = lines.findIndex((line, i) => i > start && (/^## \[/.test(line) || /^\[[^\]]+\]: /.test(line)));
  if (end < 0) end = lines.length;

  const legacy = lines.slice(start + 1, end).join('\n');
  const old = legacy.trim() === '' ? { sections: {}, errors: [] } : parseEntry(legacy, 'CHANGELOG.md [Unreleased]');
  if (old.errors.length > 0) {
    throw new Error(`The Unreleased section of CHANGELOG.md cannot be folded by the script. Move its text by hand first.\n- ${old.errors.join('\n- ')}`);
  }
  const merged = mergeEntries(entries);
  const combined = {};
  for (const heading of HEADINGS) {
    const all = [...(old.sections[heading] ?? []), ...(merged[heading] ?? [])];
    if (all.length > 0) combined[heading] = all;
  }
  if (Object.keys(combined).length === 0) throw new Error('There is nothing to fold: no entry file and nothing under Unreleased');

  const release = renderRelease(version, date, combined).replace(/\n$/, '').split('\n');
  const out = [...lines.slice(0, start + 1), '', ...release, '', ...lines.slice(end)];

  // Compare links at the foot: [Unreleased] now compares from the new tag, and [version] compares the old tag with the new one.
  for (let i = 0; i < out.length; i += 1) {
    const m = /^\[Unreleased\]: (.*)\/compare\/v(.+)\.\.\.HEAD\s*$/.exec(out[i]);
    if (!m) continue;
    out[i] = `[Unreleased]: ${m[1]}/compare/v${version}...HEAD`;
    out.splice(i + 1, 0, `[${version}]: ${m[1]}/compare/v${m[2]}...v${version}`);
    break;
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Folds the entry files of `dir` into the changelog file, then deletes them. With `dryRun` it writes and deletes nothing.
 * Throws an Error with every problem when an entry file is bad or the folder holds no entry.
 * @returns {{ text: string, files: string[], release: string }}
 */
export function fold({ dir = ENTRY_DIR, changelogPath = CHANGELOG, version, date = new Date().toISOString().slice(0, 10), dryRun = false }) {
  const { files, errors } = checkDir(dir);
  if (errors.length > 0) throw new Error(`The entry files have problems, nothing was changed:\n- ${errors.join('\n- ')}`);
  if (files.length === 0) throw new Error(`No entry file in ${dir}. A release needs at least one.`);
  const entries = files.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  const text = foldIntoChangelog(readFileSync(changelogPath, 'utf8'), entries, version, date);
  const from = text.indexOf(`## [${version}]`);
  const to = text.indexOf('\n## [', from + 1);
  const release = text.slice(from, to < 0 ? undefined : to);
  if (!dryRun) {
    writeFileSync(changelogPath, text);
    for (const file of files) unlinkSync(join(dir, file));
  }
  return { text, files, release };
}

/** The command line. Returns the exit code, so a test can call it. */
export function main(argv, log = console.log, logError = console.error) {
  const args = argv.slice();
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i >= 0) args.splice(i, 1);
    return i >= 0;
  };
  const check = flag('--check');
  const dryRun = flag('--dry-run');
  let date;
  const d = args.indexOf('--date');
  if (d >= 0) [, date] = args.splice(d, 2);
  try {
    if (check) {
      const { files, errors } = checkDir();
      if (errors.length > 0) {
        logError(`changelog.d has ${errors.length} problem${errors.length === 1 ? '' : 's'}. Fix them (format: changelog.d/README.md):\n- ${errors.join('\n- ')}`);
        return 1;
      }
      log(`changelog.d: ${files.length} entry file${files.length === 1 ? '' : 's'}, all good`);
      return 0;
    }
    const version = args[0];
    if (!version || args.length > 1) {
      logError('Usage: node scripts/changelog-fold.mjs <version> [--date YYYY-MM-DD] [--dry-run]\n       node scripts/changelog-fold.mjs --check');
      return 1;
    }
    const result = fold({ version, date, dryRun });
    if (dryRun) log(`Dry run, nothing changed. The new section would be:\n\n${result.release}\nIt would delete: ${result.files.join(', ')}`);
    else log(`Folded ${result.files.length} entry file${result.files.length === 1 ? '' : 's'} into CHANGELOG.md as ${version} and deleted them.`);
    return 0;
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
