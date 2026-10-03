/**
 * Writing several files as ONE set (Phaser spike `spike/phaser-stage`). Used only by the dev server's save endpoint
 * (`vite.config.ts`), never by the browser page, so it is free to use Node's file functions.
 *
 * One Save in the Battle Stage Editor can change `stages.json`, `hud.json` and `axes.json`. They belong together: a
 * stage's own HUD boxes were checked against the NEW `hud.json`, so writing one file and failing on another would
 * leave a set the check never approved. So the files are written in two steps:
 *  1. each file's new text goes to a temporary file next to it. A full disk or a locked folder fails HERE, before any
 *     real file has been touched;
 *  2. each temporary file is renamed over its real file (a rename replaces a file in one step, so a reader never sees
 *     half a file). If a rename fails after others went through, the old text of those files is written back and the
 *     error is thrown, so afterwards the files are all new or all as they were.
 * The temporary files are always removed.
 *
 * Putting the old text back can fail too (a locked file, a disk that went away). Then the files are NOT all as they were,
 * and the error says which files are in an unknown state (`WriteSetError.unknown`), so nobody is told "no file was changed"
 * when one was.
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export interface FileJob {
  path: string;
  text: string;
}

/** The file functions `writeTogether` uses. A test replaces one of them to make a step fail. */
export interface WriteOps {
  writeFile: (path: string, text: string) => void;
  rename: (from: string, to: string) => void;
  remove: (path: string) => void;
}

const REAL_OPS: WriteOps = { writeFile: (p, t) => writeFileSync(p, t), rename: (a, b) => renameSync(a, b), remove: (p) => unlinkSync(p) };

/** A save that failed and could not be fully undone. `unknown` lists the files whose state is not known (they may hold the new text or the old). */
export class WriteSetError extends Error {
  constructor(
    readonly cause0: unknown,
    readonly unknown: string[],
  ) {
    super(`could not write the files, and putting the old text back failed for ${unknown.join(', ')}`);
    this.name = 'WriteSetError';
  }
}

/** Write all the jobs or none. Throws (after putting the old files back) if it cannot; throws a `WriteSetError` if putting them back failed too. */
export function writeTogether(jobs: readonly FileJob[], ops: Partial<WriteOps> = {}): void {
  const io: WriteOps = { ...REAL_OPS, ...ops };
  const temps = jobs.map((j) => `${j.path}.${process.pid}.tmp`);
  const old = jobs.map((j) => (existsSync(j.path) ? readFileSync(j.path, 'utf8') : null));
  const renamed: number[] = [];
  try {
    jobs.forEach((j, k) => {
      io.writeFile(temps[k] as string, j.text);
    });
    jobs.forEach((j, k) => {
      io.rename(temps[k] as string, j.path);
      renamed.push(k);
    });
  } catch (e) {
    // Put back what was already replaced: the old text, or no file at all if there was none before. Try every file, even after one fails.
    const unknown: string[] = [];
    for (const k of renamed) {
      const before = old[k];
      const job = jobs[k];
      if (!job) continue;
      try {
        if (before === null || before === undefined) io.remove(job.path);
        else io.writeFile(job.path, before);
      } catch {
        unknown.push(job.path);
      }
    }
    if (unknown.length) throw new WriteSetError(e, unknown);
    throw e;
  } finally {
    for (const t of temps) {
      try {
        if (existsSync(t)) unlinkSync(t);
      } catch {
        // A temporary file that cannot be removed is only litter; it never changes what the game reads.
      }
    }
  }
}

/** What the save endpoint tells the page when `writeTogether` threw: honest about whether any file was changed. */
export function saveFailureMessage(e: unknown): string {
  if (e instanceof WriteSetError) {
    return `couldn't write the files, and putting the old text back failed too. The state of ${e.unknown.join(', ')} is unknown: check ${e.unknown.length === 1 ? 'it' : 'them'} (git diff) before you save again. (${String(e.cause0)})`;
  }
  return `couldn't write the files, and none was changed: ${String(e)}`;
}
