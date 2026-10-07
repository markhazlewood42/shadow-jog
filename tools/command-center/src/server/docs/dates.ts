import type { UpdatedFrom } from '../../shared/types';
import type { Runner } from '../runner';

// The day a doc last changed has three sources, in this order of trust: the doc's own frontmatter
// (`updated: 2026-10-05`), the newest git commit that touched the file, and the time of the file on
// disk. A date is kept as a plain day (YYYY-MM-DD) so the page shows exactly that text: no time
// zone can move it to the day before or after.

/**
 * The day each markdown file of the repo last changed in git, from ONE `git log` call. The map is
 * from a repo path (`docs/engine/decisions.md`) to a day (`2026-10-05`); a file that git has never
 * seen is not in it. Throws an Error that says why when git cannot answer (not a repository, git
 * missing), so the caller can show the reason and use file times instead.
 */
export async function lastChangedDates(runner: Runner, cwd: string): Promise<Map<string, string>> {
  const result = await runner(
    'git',
    [
      'log',
      // Each commit starts with a \u0001 mark and its author date as a short day. (The author date, not
      // the commit date: a rebase gives every commit a new commit date, and no doc changed that day.)
      '--format=%x01%as',
      '--name-only',
      '--no-renames', // no rename detection: it costs time, and a moved file shows under its new name in the commit that moved it anyway
      '-z', // names ending in NUL and never quoted, so a name with a space or a non-ASCII letter comes out exact
      '--',
      '*.md',
    ],
    { cwd },
  );
  if (result.code !== 0) {
    const reason = result.stderr.trim().split(/\r?\n/)[0] || 'no message';
    throw new Error(`git log failed (exit ${result.code}): ${reason}`);
  }

  // git lists the newest commit first, so the first time a path shows up is its newest day.
  // With -z the output is: \u0001<day> NUL, then "\n" and the first file name, NUL, the next name, NUL...
  // A commit that changed none of these files (a merge) is a lone "\u0001<day> NUL".
  const days = new Map<string, string>();
  let day = '';
  for (const piece of result.stdout.split('\0')) {
    if (piece.startsWith('\u0001')) {
      day = piece.slice(1);
      continue;
    }
    const path = piece.replace(/^\n/, '');
    if (path !== '' && day !== '' && !days.has(path)) days.set(path, day);
  }
  return days;
}

/**
 * The day in a frontmatter `updated` value, or null when it is not a day. A day is
 * `YYYY-MM-DD`, alone or followed by a time (`2026-10-05T10:20:00Z`): the time is dropped, because
 * the page shows days. A value such as `2026-02-31` or `soon` is not a day.
 */
function frontmatterDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
  if (match === null) return null;
  const [, year = '', month = '', day = ''] = match;
  // Date.UTC rolls an impossible day (February 31) over into the next month: if the pieces do not come back, it was not a day.
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const real = probe.getUTCFullYear() === Number(year) && probe.getUTCMonth() === Number(month) - 1 && probe.getUTCDate() === Number(day);
  return real ? `${year}-${month}-${day}` : null;
}

/** The day a file was last written, by the clock of this machine. */
function fileDay(mtimeMs: number): string {
  const date = new Date(mtimeMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day to show for a doc, and where it came from: frontmatter, else git, else the file time. */
export function resolveUpdated(frontmatterValue: unknown, gitDay: string | undefined, mtimeMs: number): { updated: string; updatedFrom: UpdatedFrom } {
  const fromFrontmatter = frontmatterDay(frontmatterValue);
  if (fromFrontmatter !== null) return { updated: fromFrontmatter, updatedFrom: 'frontmatter' };
  if (gitDay !== undefined) return { updated: gitDay, updatedFrom: 'git' };
  return { updated: fileDay(mtimeMs), updatedFrom: 'file' };
}
