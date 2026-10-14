import { parseDocument } from 'yaml';

// The workstream file contract (design.md section 5.9). A workstream is one branch, and its state
// lives in one file, `docs/workstreams/<branch>.md`. This file reads and checks such a file.
//
// It is pure: no file system, no network, no Node-only import. The Vercel functions, the page and
// the tests all call it, so every one of them gives the same verdict and the same error text. The
// error text goes straight into a red row on the page, so each message names the field.

/** Where the files live, from the repo root. */
export const WORKSTREAM_DIR = 'docs/workstreams';

/** A file whose PR merged longer ago than this many days is stale: the page hides it. */
export const STALE_AFTER_DAYS = 14;

/** The states a workstream file can claim. The page overrides "merged" from the PR itself. */
export const WORKSTREAM_STATES = ['active', 'review', 'blocked', 'parked', 'merged'] as const;
export type WorkstreamState = (typeof WORKSTREAM_STATES)[number];

/**
 * A branch name that may carry a workstream file: lowercase kebab-case parts joined by `/`. It
 * blocks upper case (two names that differ only by case collide on Windows), dots (so no `.md`
 * suffix), empty parts (`a//b`, a leading or a trailing `/`) and every other character.
 */
export const BRANCH_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;

/** The fields of a valid file. The names are the names in the file, so a reader can pass them on as they are. */
export type Workstream = {
  type: 'workstream';
  title: string;
  /** The branch. It equals the path of the file without `docs/workstreams/` and `.md`. */
  branch: string;
  /** An id in `docs/roadmap/roadmap.json`. */
  roadmap: string;
  state: WorkstreamState;
  /** Numbers of the decision issues this workstream waits on. Empty when none. */
  blocked_on: number[];
  /** `YYYY-MM-DD`. */
  updated: string;
};

/** What `parseWorkstream` hands back. It never throws. */
export type WorkstreamResult =
  | { ok: true; path: string; workstream: Workstream }
  | {
      ok: false;
      path: string;
      /** Every problem found, one line each. */
      errors: string[];
      /** The path and the errors as one line: the text of the red row. */
      message: string;
    };

/** What a branch needs from the workstream check. */
export type BranchCheck =
  | { kind: 'valid' }
  /** No file and a name outside the rule (a bot branch): a neutral "no workstream" row. */
  | { kind: 'skipped' }
  /** A file and a name outside the rule: a red row with this text, and no file lookup. */
  | { kind: 'invalid'; message: string };

/** The fields a file may have. Any other key is an error: it is most likely a typo. */
const KNOWN_KEYS = ['type', 'title', 'branch', 'roadmap', 'state', 'blocked_on', 'updated'];

/**
 * A key that the "Your move" redesign retired (2026-10-13). Branches that began before it still carry `next_for_mark` in their own workstream file, and this check reads each
 * branch's file as that branch has it. So the key is accepted and ignored: it is not shown anywhere and it is not an error. Every other unknown key stays an error.
 * Remove this when no branch carries `next_for_mark` any more: `git grep next_for_mark origin/<branch> -- docs/workstreams` finds none on any branch.
 */
const IGNORED_LEGACY_KEYS = ['next_for_mark'];

export function isValidBranchName(name: string): boolean {
  return BRANCH_NAME_PATTERN.test(name);
}

/** The reason a branch name is outside the rule, as one line. */
export function branchNameProblem(name: string): string {
  return `branch name "${name}" must be lowercase letters and digits in kebab-case parts, joined by "/" (no capitals, dots or empty parts)`;
}

/** The path of the file of a branch. */
export function workstreamPathFor(branch: string): string {
  return `${WORKSTREAM_DIR}/${branch}.md`;
}

/**
 * The branch that a file path names, or null when the path is not `docs/workstreams/<name>.md`.
 * It does not check the rule for branch names: `branchCheck` and `parseWorkstream` do.
 */
export function branchFromWorkstreamPath(path: string): string | null {
  const clean = path.replace(/\\/g, '/');
  const prefix = `${WORKSTREAM_DIR}/`;
  if (!clean.startsWith(prefix) || !clean.endsWith('.md')) return null;
  const branch = clean.slice(prefix.length, -'.md'.length);
  return branch === '' ? null : branch;
}

/**
 * What to do with a branch. A name inside the rule needs its file looked up. A name outside the
 * rule is a red row when it has a file, and is skipped when it has none (a bot branch, or
 * `release-1.0`). The rule governs the branches that Mark and the sessions create.
 */
export function branchCheck(branch: string, hasFile: boolean): BranchCheck {
  if (isValidBranchName(branch)) return { kind: 'valid' };
  if (!hasFile) return { kind: 'skipped' };
  return { kind: 'invalid', message: `${workstreamPathFor(branch)}: ${branchNameProblem(branch)}` };
}

/** Cuts the frontmatter block off the text. Null when the file has no complete block. */
function frontmatterBlock(src: string): string | null {
  const lines = src
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const fence = /^---[ \t]*$/;
  if (!fence.test(lines[0] ?? '')) return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (fence.test(lines[i] ?? '')) return lines.slice(1, i).join('\n');
  }
  return null;
}

/** True for a real calendar day written as YYYY-MM-DD. */
function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/**
 * Reads and checks one workstream file. `path` is the path from the repo root
 * (`docs/workstreams/<branch>.md`); the branch field must match it. It never throws: every problem
 * comes back in `errors`, so the page can show a red row and keep going.
 */
export function parseWorkstream(path: string, src: string): WorkstreamResult {
  const cleanPath = path.replace(/\\/g, '/');
  const errors: string[] = [];
  const fail = (): WorkstreamResult => ({
    ok: false,
    path: cleanPath,
    errors,
    message: `${cleanPath}: ${errors.join('; ')}`,
  });

  // The branch the path names. A path outside docs/workstreams, or a name outside the rule, stops the check here.
  const pathBranch = branchFromWorkstreamPath(cleanPath);
  if (pathBranch === null) {
    errors.push(`path must be ${WORKSTREAM_DIR}/<branch>.md`);
    return fail();
  }
  if (!isValidBranchName(pathBranch)) {
    errors.push(branchNameProblem(pathBranch));
    return fail();
  }

  const block = frontmatterBlock(src);
  if (block === null) {
    errors.push('the file has no frontmatter block (it must start with a --- line and have a closing --- line)');
    return fail();
  }

  const doc = parseDocument(block, { prettyErrors: false });
  if (doc.errors.length > 0) {
    const first = doc.errors[0]?.message.split('\n')[0] ?? 'unknown error';
    errors.push(`frontmatter is not valid YAML: ${first}`);
    return fail();
  }
  const data: unknown = doc.toJS();
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('frontmatter must be a list of "key: value" lines');
    return fail();
  }
  const fields = data as Record<string, unknown>;

  for (const key of Object.keys(fields)) {
    if (!KNOWN_KEYS.includes(key) && !IGNORED_LEGACY_KEYS.includes(key)) errors.push(`unknown field "${key}" (allowed: ${KNOWN_KEYS.join(', ')})`);
  }

  if (fields.type !== 'workstream') errors.push(`type must be "workstream", not ${describe(fields.type)}`);

  const text = (key: string): string | null => {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    errors.push(`${key} must be a non-empty text, not ${describe(value)}`);
    return null;
  };
  const title = text('title');
  const roadmap = text('roadmap');

  const branch = text('branch');
  if (branch !== null) {
    if (!isValidBranchName(branch)) errors.push(branchNameProblem(branch));
    else if (branch !== pathBranch) {
      errors.push(`branch "${branch}" does not match the file path, which names the branch "${pathBranch}"`);
    }
  }

  const state = fields.state;
  if (!(typeof state === 'string' && (WORKSTREAM_STATES as readonly string[]).includes(state))) errors.push(`state must be one of ${WORKSTREAM_STATES.join(', ')}, not ${describe(state)}`);

  const updated = fields.updated;
  if (!(typeof updated === 'string' && isCalendarDate(updated))) errors.push(`updated must be a date written YYYY-MM-DD, not ${describe(updated)}`);

  // Empty lists may be left out, or written with nothing after the key (YAML reads that as null).
  const blockedOn = fields.blocked_on ?? [];
  if (!(Array.isArray(blockedOn) && blockedOn.every((x) => Number.isInteger(x) && (x as number) > 0))) errors.push('blocked_on must be a list of issue numbers (whole numbers), for example [61]');

  if (errors.length > 0) return fail();

  return {
    ok: true,
    path: cleanPath,
    workstream: {
      type: 'workstream',
      title: title as string,
      branch: branch as string,
      roadmap: roadmap as string,
      state: state as WorkstreamState,
      blocked_on: blockedOn as number[],
      updated: updated as string,
    },
  };
}

/** A pull request as the stale check needs it. `mergedAt` is an ISO time, or null when the PR is not merged. */
export type PrMerge = { headRefName: string; mergedAt: string | null };

/**
 * The paths of the files to delete: those whose branch has merged PRs only, the newest of which
 * merged more than `STALE_AFTER_DAYS` days before `now`. A branch that has any PR that is not
 * merged (open, or closed without a merge) is live and keeps its file, because a new branch may
 * have reused the name. A path with no PR is never listed.
 */
export function staleWorkstreamPaths(
  paths: readonly string[],
  prs: readonly PrMerge[],
  now: Date | number | string,
  days: number = STALE_AFTER_DAYS,
): string[] {
  const nowMs = new Date(now).getTime();
  const limit = days * 24 * 60 * 60 * 1000;
  const newestMerge = new Map<string, number>();
  const live = new Set<string>();
  for (const pr of prs) {
    const merged = pr.mergedAt === null ? Number.NaN : new Date(pr.mergedAt).getTime();
    if (pr.mergedAt === null || Number.isNaN(merged)) {
      live.add(pr.headRefName);
      continue;
    }
    newestMerge.set(pr.headRefName, Math.max(newestMerge.get(pr.headRefName) ?? Number.NEGATIVE_INFINITY, merged));
  }
  return paths
    .filter((path) => {
      const branch = branchFromWorkstreamPath(path);
      if (branch === null || live.has(branch)) return false;
      const merged = newestMerge.get(branch);
      return merged !== undefined && nowMs - merged > limit;
    })
    .sort();
}
