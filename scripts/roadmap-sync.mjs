#!/usr/bin/env node
// Syncs docs/roadmap/roadmap.json from the GitHub project board (user project 2). Brief: docs/command-center/roadmap-sync-brief.md.
//   node scripts/roadmap-sync.mjs            rewrites roadmap.json when the board changed, then runs the chart generator
//   node scripts/roadmap-sync.mjs --check    writes nothing; exits 1 when the file is out of date or an item is stale
// `npm run roadmap:sync` runs it. The script only reads the board (gh api graphql). It never commits and never writes to GitHub.
// The `gh` runner is a function parameter, so tests give it a fake. Plain Node, no dependencies.

import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { columnsOf, generate, validate } from './gen-roadmap.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'roadmap');

export const OWNER = 'markhazlewood42';
export const PROJECT_NUMBER = 2;
export const AUTH_FIX = 'gh auth refresh -s project';
const LABEL_CHARS = 12;
const PAGE = 100;

/** Board Status to roadmap status. */
export const STATUS_MAP = {
  Backlog: 'later',
  Next: 'next',
  'In progress': 'active',
  'In review': 'active',
  'Waiting on Mark': 'gated',
  Done: 'done',
};

/** Lane of a board-new item, by board Kind. Waiting on Mark goes to the gated lane first. */
const LANE_OF_KIND = { Epic: 'engine', Milestone: 'side' };
const DEFAULT_LANE = 'other';
const GATED_LANE = 'gated';

/** The order of keys on an item. An old item keeps its own order; keys it gains are added in this order. */
export const KEY_ORDER = ['id', 'issue', 'kind', 'label', 'title', 'boardKind', 'lane', 'status', 'state', 'after', 'column', 'branch', 'pr', 'tag', 'notes', 'url', 'parent', 'group', 'decisions'];
/** Fields the board owns: overwritten on every run. */
const OVERWRITE = ['issue', 'title', 'boardKind', 'status', 'state', 'url', 'parent', 'group', 'decisions'];

const QUERY = `query($owner:String!,$number:Int!,$cursor:String){user(login:$owner){projectV2(number:$number){items(first:${PAGE},after:$cursor){pageInfo{hasNextPage endCursor}nodes{fieldValues(first:30){nodes{__typename ... on ProjectV2ItemFieldSingleSelectValue{name field{...on ProjectV2FieldCommon{name}}} ... on ProjectV2ItemFieldNumberValue{number field{...on ProjectV2FieldCommon{name}}}}} content{__typename ... on Issue{number url title state parent{number} milestone{title} closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{number merged mergedAt state}}}}}}}}}`;

// ---- gh ----

/** The real runner: runs `gh` with the arguments and returns stdout. Throws with stderr in the message on a non-zero exit. */
export function defaultGh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = error && typeof error.stderr === 'string' ? error.stderr : '';
    throw new Error(`${stderr}${error instanceof Error ? error.message : String(error)}`.trim());
  }
}

/** A failed gh call that comes from a missing login or a missing scope. */
const isAuthError = (error) => /(not logged|gh auth|auth login|missing required scopes?|required scopes?|insufficient_scopes|credential|authenticat|HTTP 401|requires? .*token)/i.test(error instanceof Error ? error.message : String(error));

class SyncError extends Error {}

const parseJson = (text, what) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new SyncError(`gh returned ${what} that is not valid JSON. The file is unchanged.`);
  }
};

/** Board entries from the GraphQL query, paged at 100. Entry: { number, url, title, state, parent, group, kind, status, step, prs }. */
function readGraphql(gh) {
  const entries = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const args = ['api', 'graphql', '-F', `owner=${OWNER}`, '-F', `number=${PROJECT_NUMBER}`, '-f', `query=${QUERY}`];
    if (cursor !== null) args.push('-F', `cursor=${cursor}`);
    const json = parseJson(gh(args), 'the board data');
    const items = json?.data?.user?.projectV2?.items;
    if (!items || !Array.isArray(items.nodes)) throw new SyncError('gh returned board data in an unknown shape. The file is unchanged.');
    for (const node of items.nodes) entries.push(fromGraphqlNode(node));
    if (!items.pageInfo?.hasNextPage) return entries;
    cursor = items.pageInfo.endCursor;
    if (typeof cursor !== 'string') throw new SyncError('gh returned a next page with no cursor. The file is unchanged.');
  }
  throw new SyncError('The board has more than 50 pages. The file is unchanged.');
}

function fromGraphqlNode(node) {
  const fields = {};
  for (const value of node?.fieldValues?.nodes ?? []) {
    const name = value?.field?.name;
    if (name) fields[name] = value.name ?? value.number;
  }
  const content = node?.content;
  if (!content || content.__typename !== 'Issue' || typeof content.number !== 'number') return null;
  return {
    number: content.number,
    url: content.url,
    title: content.title,
    state: String(content.state ?? '').toLowerCase() === 'closed' ? 'closed' : 'open',
    parent: content.parent?.number ?? null,
    group: content.milestone?.title ?? null,
    kind: fields.Kind ?? null,
    status: fields.Status ?? null,
    step: typeof fields.Step === 'number' ? fields.Step : null,
    prs: (content.closedByPullRequestsReferences?.nodes ?? []).filter(Boolean),
  };
}

/** Fallback: `gh project item-list`. It has no parent, state or PRs, so those stay as they are. Past 100 items it fails. */
function readItemList(gh) {
  const json = parseJson(gh(['project', 'item-list', String(PROJECT_NUMBER), '--owner', OWNER, '--limit', String(PAGE), '--format', 'json']), 'the item list');
  const items = json?.items;
  if (!Array.isArray(items)) throw new SyncError('gh returned an item list in an unknown shape. The file is unchanged.');
  if (items.length >= PAGE) throw new SyncError(`The board has ${PAGE} items or more. The fallback cannot page. The file is unchanged.`);
  return items.map((item) => {
    const content = item?.content;
    if (!content || typeof content.number !== 'number') return null;
    return {
      number: content.number,
      url: content.url,
      title: content.title,
      state: null,
      parent: null,
      group: item.milestone?.title ?? null,
      kind: item.kind ?? null,
      status: item.status ?? null,
      step: typeof item.step === 'number' ? item.step : null,
      prs: null,
    };
  });
}

// ---- mapping ----

const dateOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');

/** `#98 (merged 2026-10-16)` from the merged closing PRs, or undefined. An open or closed-unmerged PR gives nothing. */
function prText(prs) {
  if (!Array.isArray(prs)) return undefined;
  const parts = [];
  for (const pr of prs) {
    if (pr.merged) parts.push(`#${pr.number} (merged ${dateOf(pr.mergedAt)})`);
  }
  return parts.length === 0 ? undefined : parts.join(', ');
}

/** True when a label fits two lines of 12 characters, as gen-roadmap checks it. */
function fits(label) {
  const lines = [];
  let line = '';
  for (const word of label.split(' ')) {
    if (word.length > LABEL_CHARS) return false;
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= LABEL_CHARS) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines.length <= 2;
}

/** A short label from a full title: the Epic or Decision prefix cut, then words dropped from the end until it fits two lines of 12 characters. */
export function labelFrom(title) {
  const base = String(title)
    .replace(/^(?:Epic|Decision)\b\s*:?\s*/i, '')
    .replace(/^[A-Z]\d+(?:\s+D\d+)?\s*:\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s:,-]+$/, '')
    .trim();
  const words = base.split(' ').filter((w) => w !== '');
  while (words.length > 0) {
    const text = words.join(' ');
    if (fits(text)) return text.replace(/[\s:,-]+$/, '');
    words.pop();
  }
  return base.slice(0, LABEL_CHARS) || 'Item';
}

/** Puts the keys of a new item in the fixed order. An old item keeps its own order and its new keys follow in the fixed order. */
function arrange(item, oldKeys) {
  const out = {};
  for (const key of oldKeys) if (item[key] !== undefined) out[key] = item[key];
  for (const key of KEY_ORDER) if (item[key] !== undefined && !(key in out)) out[key] = item[key];
  for (const key of Object.keys(item)) if (!(key in out) && item[key] !== undefined) out[key] = item[key];
  return out;
}

const stringify = (data) => `${JSON.stringify(data, null, 2)}\n`;
const withoutUpdated = (data) => JSON.stringify({ ...data, updated: '' });

/**
 * Merges the board into the data in memory. Returns { data, added, stale, warnings }.
 * Old items keep their place; board-new items append sorted by issue number; decisions are not items.
 */
export function mergeBoard(current, entries) {
  const warnings = [];
  const present = entries.filter((e) => e !== null);
  const byNumber = new Map(present.map((e) => [e.number, e]));
  const kindOf = (entry) => entry.kind ?? '';
  const isOpenDecision = (entry) => kindOf(entry) === 'Decision' && entry.status !== 'Done' && entry.state !== 'closed';

  const statusOf = (entry) => {
    let status = STATUS_MAP[entry.status ?? ''];
    if (status === undefined) {
      warnings.push(`#${entry.number} has board Status "${entry.status ?? 'none'}", which has no map. Used "later".`);
      status = 'later';
    }
    if (entry.state === 'closed' && status !== 'done') {
      warnings.push(`#${entry.number} is closed but its board Status is "${entry.status ?? 'none'}". Used "done". Update the board.`);
      status = 'done';
    }
    return status;
  };

  const overwrite = (item, entry) => {
    const fallback = entry.prs === null; // the item-list fallback: parent, state and decisions are unknown
    const values = {
      issue: entry.number,
      title: entry.title,
      boardKind: entry.kind ?? undefined,
      status: statusOf(entry),
      state: entry.state ?? item.state,
      url: entry.url,
      parent: fallback ? item.parent : (entry.parent ?? undefined),
      group: entry.group ?? undefined,
      decisions: kindOf(entry) === 'Epic' && !fallback ? present.filter((c) => c.parent === entry.number && isOpenDecision(c)).length : item.decisions,
    };
    for (const key of OVERWRITE) item[key] = values[key];
  };

  const old = current.items.map((item) => ({ item: { ...item }, keys: Object.keys(item) }));
  const items = old.map((o) => o.item);
  const joined = new Set();
  for (const item of items) {
    if (typeof item.issue !== 'number') continue;
    const entry = byNumber.get(item.issue);
    if (entry === undefined) continue;
    joined.add(entry.number);
    overwrite(item, entry);
    // `pr` is set once: only when empty and a merged closing PR exists. A hand-set value is never changed.
    const pr = prText(entry.prs);
    if (!item.pr && pr !== undefined) item.pr = pr;
  }
  const stale = items.filter((item) => typeof item.issue === 'number' && !byNumber.has(item.issue)).map((item) => `${item.id} (#${item.issue})`);

  const added = [];
  const fresh = present.filter((e) => !joined.has(e.number) && kindOf(e) !== 'Decision').sort((a, b) => a.number - b.number);
  for (const entry of fresh) {
    const lane = entry.status === 'Waiting on Mark' ? GATED_LANE : (LANE_OF_KIND[kindOf(entry)] ?? DEFAULT_LANE);
    const item = { id: `#${entry.number}`, kind: 'task', label: labelFrom(entry.title), lane, after: [], notes: `Board item #${entry.number}.` };
    const pr = prText(entry.prs);
    if (pr !== undefined) item.pr = pr;
    overwrite(item, entry);
    // The column: Step - 1 when that column is free in the lane, else the next free one.
    const columns = columnsOf(items);
    const taken = new Set(items.filter((other) => other.lane === lane).map((other) => columns.get(other.id)));
    let column = entry.step !== null && entry.step >= 1 ? entry.step - 1 : 0;
    while (taken.has(column)) column += 1;
    item.column = column;
    items.push(item);
    old.push({ item, keys: [] });
    added.push(item.id);
  }
  return { data: { ...current, items: old.map((o) => arrange(o.item, o.keys)) }, added, stale, warnings };
}

// ---- main ----

const localDate = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * Runs one sync. Never throws. Returns { code, changed, added, stale, warnings, lines }.
 * Options: gh (runner, args to stdout string), dir, check, today.
 */
export function syncRoadmap({ gh = defaultGh, dir = DIR, check = false, today = localDate() } = {}) {
  const lines = [];
  const result = { code: 0, changed: false, added: [], stale: [], warnings: [], lines };
  const fail = (text) => {
    lines.push(text);
    result.code = 1;
    return result;
  };
  try {
    const path = join(dir, 'roadmap.json');
    const current = parseJson(readFileSync(path, 'utf8'), 'the roadmap file');
    let entries;
    try {
      entries = readGraphql(gh);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      if (isAuthError(error)) return fail(`The gh login is missing or has no project scope. Run: ${AUTH_FIX}`);
      lines.push('The GraphQL call failed. Used the gh project item-list fallback: parent, state and PRs are not updated.');
      try {
        entries = readItemList(gh);
      } catch (inner) {
        if (inner instanceof SyncError) throw inner;
        if (isAuthError(inner)) return fail(`The gh login is missing or has no project scope. Run: ${AUTH_FIX}`);
        throw new SyncError('gh failed on both the GraphQL call and the item-list fallback. The file is unchanged. Run gh by hand to see why.');
      }
    }
    const merged = mergeBoard(current, entries);
    result.added = merged.added;
    result.stale = merged.stale;
    result.warnings = merged.warnings;
    for (const warning of merged.warnings) lines.push(`Warning: ${warning}`);
    for (const id of merged.stale) lines.push(`Stale: ${id} is no longer on the board. It stays in the file.`);

    const unchanged = withoutUpdated(merged.data) === withoutUpdated(current);
    const data = { ...merged.data, updated: unchanged ? current.updated : today };
    const problems = validate(data);
    if (problems.length > 0) return fail(`The merged roadmap is not sound. The file is unchanged.\n- ${problems.join('\n- ')}`);

    result.changed = !unchanged;
    if (check) {
      if (result.changed) lines.push('roadmap.json is out of date. Run: npm run roadmap:sync');
      if (merged.stale.length > 0) lines.push('Stale items need a hand fix.');
      result.code = result.changed || merged.stale.length > 0 ? 1 : 0;
      if (result.code === 0) lines.push('roadmap.json is current.');
      return result;
    }
    if (result.changed) {
      const tmp = `${path}.tmp-${process.pid}`;
      try {
        writeFileSync(tmp, stringify(data));
        renameSync(tmp, path);
      } catch (error) {
        try {
          unlinkSync(tmp);
        } catch {
          // The temp file may not exist; the write error below is the one to report.
        }
        throw new SyncError(`Could not write roadmap.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // The chart and the README follow the data, so they never drift.
    const { svg, readme } = generate(dir);
    writeFileSync(join(dir, 'roadmap.svg'), svg);
    writeFileSync(join(dir, 'README.md'), readme);
    lines.push(`${result.changed ? 'Wrote' : 'No change to'} roadmap.json. Added ${merged.added.length}${merged.added.length ? `: ${merged.added.join(', ')}` : ''}. Warnings ${merged.warnings.length}. Stale ${merged.stale.length}.`);
    return result;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = syncRoadmap({ check: process.argv.includes('--check') });
  for (const line of result.lines) (result.code === 0 ? console.log : console.error)(line);
  process.exit(result.code);
}

