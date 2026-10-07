import type { Stats } from 'node:fs';
import { resolve } from 'node:path';
import { watch } from 'chokidar';

// The watcher tells the index that a file changed, so the pages can show an edit within a few
// seconds. It POLLS: it asks the disk about every watched file once a second, instead of waiting
// for the operating system to say so. The game's own Vite has to do the same on this machine (see
// the game's vite.config.ts), because the system's change events are not reliable here.

/** How often the disk is asked, in milliseconds. An edit shows up within one round, plus the debounce. */
const POLL_MS = 1000;

/**
 * Changes that arrive within this many milliseconds of each other are reported together. A save
 * from an editor, or an agent that writes five files, would otherwise start five scans.
 */
const DEBOUNCE_MS = 150;

/** If the first scan of the folders is not done by then, say so and go on: the index must not wait for ever. */
const READY_TIMEOUT_MS = 15_000;

export type DocWatcherOptions = {
  /** The repo folder. Watched: `docs/` with everything below it, and the markdown files at the top. */
  root: string;
  /** Files to watch as well, wherever they are: nav.json, a doc that nav.json names, the git log. */
  files: readonly string[];
  /** Whether a file is a doc (markdown). */
  isDocFile(path: string): boolean;
  /** Whether a file under docs/ is a picture or a diagram source. A change there can turn a broken link good. */
  isAssetFile(path: string): boolean;
  /** Called with the absolute paths of the files that were added, changed or removed. */
  onChange(paths: string[]): void;
  /** Called when the watcher itself has a problem. It is reported, never dropped. */
  onError(error: Error): void;
  /** For tests: how often to poll, and how long to wait for more changes. */
  intervalMs?: number;
  debounceMs?: number;
};

export type DocWatcher = {
  /** Done when the first scan of the folders is done. A change made after this is reported. */
  ready: Promise<void>;
  /** Watches more files (a doc that nav.json names after the nav was read). */
  addFiles(files: readonly string[]): void;
  /** Stops watching. Nothing is reported after it. */
  close(): Promise<void>;
};

/** A path as text that can be compared: forward slashes, no trailing slash (chokidar gives the same to its `ignored` function). */
const slashes = (path: string): string => resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');

export function startDocWatcher(options: DocWatcherOptions): DocWatcher {
  const root = slashes(options.root);
  const named = new Set(options.files.map(slashes));
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  /**
   * What chokidar must not look at. chokidar asks about every path it meets, sometimes before it
   * knows whether the path is a folder (`stats` is then missing), so a folder is only ever
   * ignored by its place, and a file by its kind.
   */
  const ignored = (path: string, stats?: Stats): boolean => {
    const here = slashes(path);
    if (named.has(here) || here === root) return false;
    if (!here.startsWith(`${root}/`)) return true;
    const parts = here.slice(root.length + 1).split('/');
    // Hidden files and folders (.git, .obsidian) are not docs.
    if (parts.some((part) => part.startsWith('.'))) return true;
    // Under docs/, folders are walked, and a file counts when it is a doc or a picture.
    if (parts[0] === 'docs') return stats?.isFile() === true && !options.isDocFile(here) && !options.isAssetFile(here);
    // At the top of the repo only markdown files count, and no other folder is walked.
    return parts.length > 1 || !options.isDocFile(here);
  };

  const interval = options.intervalMs ?? POLL_MS;
  const fsw = watch([root, ...named], {
    usePolling: true,
    interval,
    binaryInterval: interval, // pictures are "binary" to chokidar and would be polled three times a second otherwise
    ignoreInitial: true, // the files that are there at the start are the index's first scan, not changes
    followSymlinks: false, // a link must not lead the watcher (or the index) out of the repo
    ignored,
  });

  const flush = (): void => {
    timer = null;
    const paths = [...changed];
    changed.clear();
    if (closed || paths.length === 0) return;
    try {
      options.onChange(paths);
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  // Only files count. A new folder reports the files in it one by one, and a removed folder reports its files too.
  fsw.on('all', (event, path) => {
    if (closed || (event !== 'add' && event !== 'change' && event !== 'unlink')) return;
    changed.add(path);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, options.debounceMs ?? DEBOUNCE_MS);
  });

  const ready = new Promise<void>((done) => {
    const guard = setTimeout(() => {
      options.onError(new Error(`The file watcher did not finish its first scan in ${READY_TIMEOUT_MS / 1000} seconds. Edits may not show until it does.`));
      done();
    }, READY_TIMEOUT_MS);
    guard.unref();
    fsw.once('ready', () => {
      clearTimeout(guard);
      done();
    });
    fsw.on('error', (error) => {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    });
  });

  return {
    ready,
    addFiles(files) {
      const fresh = files.map(slashes).filter((file) => !named.has(file));
      for (const file of fresh) named.add(file);
      if (fresh.length > 0 && !closed) fsw.add(fresh);
    },
    async close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      changed.clear();
      await fsw.close();
    },
  };
}
