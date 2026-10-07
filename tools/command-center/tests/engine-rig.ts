// A git repo that holds the three sample docs, with a doc index and an engine module over it. This
// file has no tests of its own: the test runner only loads files that end in .test.ts or .test.tsx.
import { execFileSync } from 'node:child_process';
import type { TempRepo } from '../fixtures/make-temp-repo';
import type { Config } from '../src/server/config';
import type { DocIndex } from '../src/server/docs/index';
import { createEngineModule } from '../src/server/engine/module';
import type { Hub } from '../src/server/hub';
import { type Runner, createRunner } from '../src/server/runner';
import type { PanelSource } from '../src/server/source';
import type { ChangeEvent, Decision } from '../src/shared/types';
import { type DocsRepo, commitAll, makeGitDocsRepo, makeIndex } from './doc-index-helpers';
import { decisionsMd, phaseMd, readmeMd } from './engine-helpers';

/** The three docs of a sample repo. */
export type EngineDocTexts = { decisions: string; readme: string; phase: string };

export function defaultDocTexts(): EngineDocTexts {
  return { decisions: decisionsMd(), readme: readmeMd(), phase: phaseMd() };
}

export const ENGINE_PATHS = { decisions: 'docs/engine/decisions.md', readme: 'docs/engine/README.md', phase: 'docs/PHASE-0.2.md' } as const;

/** What a test gets from `makeEngineRig`. */
export type EngineRig = {
  repo: DocsRepo & { git: TempRepo };
  config: Config;
  index: DocIndex;
  hub: Hub;
  events: ChangeEvent[];
  engine: PanelSource<Decision[]>;
  /** The commit that holds the three docs as `texts` gave them: the approval commit. */
  approvalRef: string;
  /** Writes one of the three docs in the working folder (a change after the approval, not committed). */
  edit(which: keyof EngineDocTexts, text: string): void;
  close(): Promise<void>;
};

/** What a test can change in the rig. */
export type EngineRigOptions = {
  texts?: Partial<EngineDocTexts>;
  /** Run the doc index's file watcher (a test of a live edit needs it). */
  watch?: boolean;
  /** The approval ref of the config, from the repo and its latest commit. The latest commit holds the three docs: it is the default. */
  approvalRef?: (repo: DocsRepo & { git: TempRepo }, head: string) => string;
  /** Puts something around the real runner (counts its calls, or fails one of them). */
  wrapRunner?: (real: Runner) => Runner;
};

/**
 * A git repo that holds the three sample docs in a commit (the approval commit), with a doc index and
 * an engine module on the same hub, built over the real runner (git runs for real). A test then edits
 * the docs in the working folder and asks the module what changed since the approval.
 */
export async function makeEngineRig(options: EngineRigOptions = {}): Promise<EngineRig> {
  const texts = { ...defaultDocTexts(), ...options.texts };
  const repo = makeGitDocsRepo();
  repo.write(ENGINE_PATHS.decisions, texts.decisions);
  repo.write(ENGINE_PATHS.readme, texts.readme);
  repo.write(ENGINE_PATHS.phase, texts.phase);
  commitAll(repo.dir, 'Approve the sample design', '2026-01-03T00:00:00Z');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();

  const config: Config = { ...repo.config, approvalRef: options.approvalRef?.(repo, head) ?? head };
  const real = createRunner(config);
  const runner = options.wrapRunner?.(real) ?? real;
  const { index, hub, events } = makeIndex({ ...repo, config }, { runner, watch: options.watch ?? false });
  const engine = createEngineModule({ config, runner, docs: index, hub });
  return {
    repo,
    config,
    index,
    hub,
    events,
    engine,
    approvalRef: head,
    edit: (which, text) => repo.write(ENGINE_PATHS[which], text),
    async close() {
      engine.stop();
      await index.close();
      repo.close();
    },
  };
}
