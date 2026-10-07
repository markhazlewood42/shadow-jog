// Shared helpers for the doc index tests (docs-index, nav and reading-order). This file has no
// tests of its own: the test runner only loads files that end in .test.ts or .test.tsx.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Hono } from 'hono';
import { type TempRepo, makeTempRepo } from '../fixtures/make-temp-repo';
import type { ChangeEvent, DocPage } from '../src/shared/types';
import type { Config } from '../src/server/config';
import { type DocIndex, type DocIndexOptions, createDocIndex } from '../src/server/docs/index';
import { type Hub, createHub } from '../src/server/hub';
import { type Runner, createRunner } from '../src/server/runner';
import { makeApp, makeTestConfig, noopRunner } from './helpers';
import { registerDocsRoutes } from '../src/server/routes/docs';

/** A folder of docs for one test, in the OS temp folder. */
export type DocsRepo = {
  dir: string;
  config: Config;
  /** Where nav.json is kept for this repo (the file itself is only made when a test writes it). */
  navFile: string;
  /** Writes a file (a repo path such as `docs/a.md`), making its folders. */
  write(path: string, text: string | Buffer): void;
  remove(path: string): void;
  move(from: string, to: string): void;
  /** Writes nav.json from an object (or any text, to test a nav.json that is wrong). */
  writeNav(nav: unknown): void;
  close(): void;
};

function docsRepoAt(dir: string, close: () => void): DocsRepo {
  const config = makeTestConfig({ repoRoot: dir, roots: [dir] });
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  return {
    dir,
    config,
    navFile: join(dir, 'nav.json'),
    write,
    remove: (path) => rmSync(join(dir, path), { recursive: true, force: true }),
    move(from, to) {
      mkdirSync(dirname(join(dir, to)), { recursive: true });
      renameSync(join(dir, from), join(dir, to));
    },
    writeNav: (nav) => write('nav.json', typeof nav === 'string' ? nav : JSON.stringify(nav, null, 2)),
    close,
  };
}

/**
 * A temp folder (not a git repo) holding `files`, a map from a repo path to its text. It also holds a
 * nav.json with no sections (so every doc is in Other, and nothing is wrong with the nav): a test
 * that wants another nav writes it, and a test of a missing nav.json removes it.
 */
export function makeDocsRepo(files: Record<string, string | Buffer> = {}): DocsRepo {
  const dir = mkdtempSync(join(tmpdir(), 'cc-docs-'));
  const repo = docsRepoAt(dir, () => rmSync(dir, { recursive: true, force: true }));
  repo.writeNav({ sections: [] });
  for (const [path, text] of Object.entries(files)) repo.write(path, text);
  return repo;
}

/** The fixture git repo of Task 1 (README.md, docs/first.md, docs/second.md, two commits with fixed dates), as a DocsRepo. */
export function makeGitDocsRepo(): DocsRepo & { git: TempRepo } {
  const git = makeTempRepo();
  const repo = docsRepoAt(git.dir, () => git.remove());
  repo.writeNav({ sections: [] });
  return { ...repo, git };
}

/** Commits everything under the repo with a made-up author and the given date, so a test can rely on the date. */
export function commitAll(dir: string, message: string, date: string): void {
  const run = (args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture Author',
        GIT_AUTHOR_EMAIL: 'author@fixture.example',
        GIT_COMMITTER_NAME: 'Fixture Author',
        GIT_COMMITTER_EMAIL: 'author@fixture.example',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
  run(['add', '--all']);
  run(['commit', '--quiet', '--no-verify', '-m', message]);
}

/** A doc index over `repo` that never starts a process (git is answered with nothing) and has no watcher, unless `options` says so. */
export function makeIndex(
  repo: DocsRepo,
  options: DocIndexOptions & { runner?: Runner } = {},
): { index: DocIndex; hub: Hub; events: ChangeEvent[] } {
  const { runner = noopRunner, ...indexOptions } = options;
  const hub = createHub();
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const index = createDocIndex({ config: repo.config, runner, hub }, { watch: false, navFile: repo.navFile, ...indexOptions });
  return { index, hub, events };
}

/** The real runner for a repo (git runs for real, in the repo's folder). */
export function realRunner(repo: DocsRepo): Runner {
  return createRunner(repo.config);
}

/** An app with the docs routes of `index` mounted, as compose.ts does it. */
export function makeDocsApp(repo: DocsRepo, index: DocIndex): { app: Hono; config: Config } {
  const { app } = makeApp({ config: repo.config });
  registerDocsRoutes(app, index);
  return { app, config: repo.config };
}

/** Polls `check` until it is true, and fails with a message that names `what` (text, or a function that makes the text when it is needed) when `timeoutMs` pass. */
export async function waitFor(check: () => boolean | Promise<boolean>, what: string | (() => string), timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${typeof what === 'function' ? what() : what} after ${timeoutMs} ms`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** A value that must be there (a test that finds nothing fails with this message, not with an undefined access). */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

/** The doc with this slug, or a failure that names the slug. */
export function pageOf(index: DocIndex, slug: string): DocPage {
  return must(index.get(slug), `the doc "${slug}"`);
}
