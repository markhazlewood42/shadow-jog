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
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

export interface FileJob {
  path: string;
  text: string;
}

/** Write all the jobs or none. Throws (after putting the old files back) if it cannot. */
export function writeTogether(jobs: readonly FileJob[]): void {
  const temps = jobs.map((j) => `${j.path}.${process.pid}.tmp`);
  const old = jobs.map((j) => (existsSync(j.path) ? readFileSync(j.path, 'utf8') : null));
  const renamed: number[] = [];
  try {
    jobs.forEach((j, k) => {
      writeFileSync(temps[k] as string, j.text);
    });
    jobs.forEach((j, k) => {
      renameSync(temps[k] as string, j.path);
      renamed.push(k);
    });
  } catch (e) {
    // Put back what was already replaced: the old text, or no file at all if there was none before.
    for (const k of renamed) {
      const before = old[k];
      const job = jobs[k];
      if (!job) continue;
      if (before === null || before === undefined) unlinkSync(job.path);
      else writeFileSync(job.path, before);
    }
    throw e;
  } finally {
    for (const t of temps) if (existsSync(t)) unlinkSync(t);
  }
}
