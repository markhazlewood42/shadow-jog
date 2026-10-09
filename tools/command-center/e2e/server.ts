import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type TempRepo, makeTempRepo } from '../fixtures/make-temp-repo';
import { compose } from '../src/server/compose';
import { type Config, PACKAGE_DIR } from '../src/server/config';
import { PortBusyError, startServer } from '../src/server/main';
import { type Runner, createRunner, execProcess } from '../src/server/runner';
import { E2E_DIR, createFakeGh } from './fake-gh';

// The server the Playwright tests run against (see playwright.config.ts). It is the real server
// (compose.ts) with a fixture config, a throwaway git repo, and a fake gh under the real runner.
// It never reuses a server that is already running: if port 3010 is taken, it says so and exits.

/** The port of the end-to-end server. playwright.config.ts names the same port. */
export const E2E_PORT = 3010;

/**
 * The sample docs that the fixture repo starts with (fixtures/repo), and the nav.json that sorts them
 * into sections. The tool's own nav.json names the real docs of the Shadow Jog repo, which the fixture
 * repo does not have.
 */
export const FIXTURE_DOCS_DIR = join(PACKAGE_DIR, 'fixtures', 'repo');
export const FIXTURE_NAV_FILE = join(PACKAGE_DIR, 'fixtures', 'nav.json');

export type E2eRuntime = {
  config: Config;
  /** The real runner (its allow-list holds), with git run for real in the fixture repo and gh answered by the fake. */
  runner: Runner;
  /** The fixture git repo: the two commits of makeTempRepo, with the sample docs of fixtures/repo in both. It is the folder "repo" in the work folder. */
  repo: TempRepo;
  /** The folder that holds the fixture repo and the fake gh's two files. A test finds the fake's files here. */
  workDir: string;
  /** Deletes the work folder. */
  close(): void;
};

/**
 * Builds what the end-to-end server runs on, in `workDir`. Whatever an earlier run left in that
 * folder is deleted first, so every start is the same start. Nothing in it names a real repo,
 * a real session folder or a real account.
 */
export function createE2eRuntime(workDir: string = E2E_DIR): E2eRuntime {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const repo = makeTempRepo({ dir: join(workDir, 'repo'), seed: FIXTURE_DOCS_DIR });
  const config: Config = {
    port: E2E_PORT,
    repoRoot: repo.dir,
    roots: [repo.dir],
    githubRepo: 'fixture-owner/fixture-repo',
    // The first commit of the fixture repo, so a decision's text can be compared with its text then.
    approvalRef: repo.commits[0] as string,
    gameUrl: 'http://localhost:3007',
    links: [
      { label: 'Game', url: 'http://localhost:3007' },
      { label: 'GitHub repo', url: 'https://github.com/fixture-owner/fixture-repo' },
    ],
    claude: {
      projectsRoot: join(workDir, 'claude-projects'),
      // The process list of the fixture world. The folder is not made until a test writes a process file, so the agents module starts in its file-age fallback.
      // Never the real folder (~/.claude/sessions): a test run must not read the processes of the machine it runs on.
      sessionsRoot: join(workDir, 'claude-sessions'),
      folders: ['fixture-shadow-jog'],
      cwdMatchFolders: ['fixture-home-base'],
      includeSdk: false,
      recentSeconds: 604800,
      workingSeconds: 300,
      waitingSeconds: 14400,
    },
    agents: { pollMs: 3000, lingerSeconds: 300, staleSeconds: 1800 },
  };

  const fakeGh = createFakeGh(workDir);
  const runner = createRunner(config, (cmd, args, o) => (cmd === 'gh' ? fakeGh(cmd, args, o) : execProcess(cmd, args, o)));

  return { config, runner, repo, workDir, close: () => rmSync(workDir, { recursive: true, force: true }) };
}

async function main(): Promise<void> {
  const runtime = createE2eRuntime();
  // refreshGapMs 0: a forced refresh of a panel is never held back, so a test that changes what the fake gh says sees it at once.
  const composed = compose({ config: runtime.config, runner: runtime.runner, navFile: FIXTURE_NAV_FILE, refreshGapMs: 0 });
  await startServer(composed.app, E2E_PORT);
  await composed.start();

  // Playwright stops this process hard when the run ends, so these only run on a normal stop.
  const stop = () => {
    composed.stop();
    runtime.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  console.log(`End-to-end server ready: http://127.0.0.1:${E2E_PORT} (work folder ${runtime.workDir})`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof PortBusyError ? error.message : error);
    process.exit(1);
  });
}
