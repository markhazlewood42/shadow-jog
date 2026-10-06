import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Decision, DocHeading, Panel } from '../../shared/types';
import type { Config } from '../config';
import type { DocIndex } from '../docs/index';
import { isMissing } from '../fs-errors';
import type { Hub } from '../hub';
import type { RunResult, Runner } from '../runner';
import { PanelError, type PanelSource, createPanelSource } from '../source';
import {
  ENGINE_DOCS,
  type RawDecision,
  approvedTextsOf,
  classifyDecisions,
  classifyUpdateChoices,
  parseEngineDecisions,
  parseUpdateChoices,
  readmeWaitsForMark,
} from './decisions';
import { parsePhaseDecisions } from './phase';

// The engine review module: every decision of the engine docs, with its status. The decisions come
// from three places (the table of docs/engine/decisions.md, the numbered lines of docs/PHASE-0.2.md
// and the C table of docs/engine/README.md), and a decision is `open` when it waits for Mark,
// `changed` when its text is not what it was at the approval commit, and `approved` when it is
// neither. The module reads the three docs from the repo, asks git for the approved versions, and
// loads again when the doc index says that one of the three docs changed.

export type EngineModuleDeps = {
  config: Config;
  /** The only way to run git: the approved versions of the docs come from `git show <approvalRef>:<path>`. */
  runner: Runner;
  /** The doc index, for the headings of the three docs: a decision links to the id that the page gives its heading. */
  docs: DocIndex;
  hub: Hub;
};

/** The paths of the docs whose change makes the module load again. */
const WATCHED_PATHS: ReadonlySet<string> = new Set([ENGINE_DOCS.decisions.path, ENGINE_DOCS.readme.path, ENGINE_DOCS.phase.path]);

/**
 * What one load finds. `approvalProblem` says why "changed since approved" could not be worked out
 * (a bad approvalRef, say), or is null. The decisions are there either way, with no change flags
 * when there is a problem. The page sees the problem as an error beside the decisions (see `publicPanel`).
 */
type Loaded = { decisions: Decision[]; approvalProblem: string | null };

/** What the three docs said at the approval commit, by decision id: the E decisions and the PHASE-0.2 decisions. */
type Approved = { engine: Map<string, string>; phase: Map<string, string> };

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? '';

/** git's words when a path is not in a commit (for a file that was added after the approval). Any other failure is a failure. */
const NOT_IN_COMMIT = /does not exist in|exists on disk, but not in/i;

async function readDoc(root: string, path: string): Promise<string> {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch (error) {
    if (isMissing(error)) throw new PanelError('engine-doc-missing', `${path} was not found in the repo, so its decisions cannot be listed.`);
    throw error;
  }
}

/**
 * What the decisions said at the approval commit, or why that is not known. A doc that did not
 * exist at that commit has no decisions then, so all of its decisions read as added. Anything else
 * that goes wrong (the ref is not a commit, git cannot run, the old doc cannot be read as a list of
 * decisions) is a problem, and the module then flags no decision as changed.
 */
async function readApproved(config: Config, runner: Runner): Promise<Approved | { problem: string }> {
  const ref = config.approvalRef;
  const off = '"Changed since approved" is off until this is fixed.';

  // Ask for the commit first: a bad ref and a doc that is missing from a good ref both make `git show` fail, and they are not the same thing.
  const verified = await runner('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (verified.code !== 0) {
    const why = verified.code === 1 || verified.code === 128 ? 'it is not a commit of this repo' : `git could not check it (${firstLine(verified.stderr) || `exit code ${verified.code}`})`;
    return { problem: `approvalRef "${ref}" cannot be used: ${why}. ${off} Set approvalRef in command-center.config.json to a commit of this repo.` };
  }

  /** The doc as it was at the approval commit, parsed with `parse`: its decisions by id. */
  const approvedIn = async (path: string, parse: (markdown: string) => RawDecision[]): Promise<Map<string, string> | { problem: string }> => {
    const shown: RunResult = await runner('git', ['show', `${ref}:${path}`]);
    if (shown.code !== 0) {
      if (NOT_IN_COMMIT.test(shown.stderr)) return new Map();
      return { problem: `git could not read ${path} at ${ref} (${firstLine(shown.stderr) || `exit code ${shown.code}`}). ${off}` };
    }
    try {
      return approvedTextsOf(parse(shown.stdout));
    } catch (error) {
      return { problem: `${path} at ${ref} could not be read as a list of decisions (${error instanceof Error ? error.message : String(error)}). ${off}` };
    }
  };

  const [engine, phase] = await Promise.all([approvedIn(ENGINE_DOCS.decisions.path, (md) => parseEngineDecisions(md)), approvedIn(ENGINE_DOCS.phase.path, (md) => parsePhaseDecisions(md))]);
  if ('problem' in engine) return engine;
  if ('problem' in phase) return phase;
  return { engine, phase };
}

/**
 * The panel that callers see. A problem with the approval check is an error of the panel (so the page
 * shows it, with its Retry button, and Task 10 lists the source as missing), and the decisions that
 * could be worked out ride along as the data of a failed panel (`lastGood`). The page then shows the
 * error and the decisions together, and the decisions carry no change flags.
 */
function publicPanel(panel: Panel<Loaded>): Panel<Decision[]> {
  if (!panel.ok) {
    return { ...panel, lastGood: panel.lastGood === null ? null : { ...panel.lastGood, data: panel.lastGood.data.decisions } };
  }
  const { decisions, approvalProblem } = panel.data;
  if (approvalProblem === null) return { ok: true, data: decisions, updatedAt: panel.updatedAt };
  return {
    ok: false,
    error: { code: 'approval-check-failed', message: approvalProblem },
    updatedAt: panel.updatedAt,
    lastGood: { data: decisions, updatedAt: panel.updatedAt },
  };
}

/** The headings of a doc's page, or none when the doc is not on the site. */
const headingsOf = (docs: DocIndex, slug: string): readonly DocHeading[] => docs.get(slug)?.headings ?? [];

/**
 * The engine module, as a source of a Panel of decisions. It loads when it starts and again when
 * the doc index publishes a change to one of the three docs, so an edit of a decision shows within
 * the time that the docs take to notice it.
 */
export function createEngineModule(deps: EngineModuleDeps): PanelSource<Decision[]> {
  const { config, runner, docs, hub } = deps;

  const source = createPanelSource<Loaded>({
    name: 'engine',
    async load() {
      // The headings come from the index, so wait for its first scan.
      await docs.ready();
      const [decisionsMd, readmeMd, phaseMd] = await Promise.all([
        readDoc(config.repoRoot, ENGINE_DOCS.decisions.path),
        readDoc(config.repoRoot, ENGINE_DOCS.readme.path),
        readDoc(config.repoRoot, ENGINE_DOCS.phase.path),
      ]);
      const engine = parseEngineDecisions(decisionsMd, headingsOf(docs, ENGINE_DOCS.decisions.slug));
      const phase = parsePhaseDecisions(phaseMd, headingsOf(docs, ENGINE_DOCS.phase.slug));
      const choices = parseUpdateChoices(readmeMd, headingsOf(docs, ENGINE_DOCS.readme.slug));
      // The README's status says if the choices are still open. With no choices it is not looked at, so a README with no table can have any status.
      const waiting = choices.length > 0 && readmeWaitsForMark(readmeMd);

      const approved = await readApproved(config, runner);
      const known = 'problem' in approved ? null : approved;
      return {
        decisions: [...classifyDecisions(engine, known?.engine ?? null), ...classifyDecisions(phase, known?.phase ?? null), ...classifyUpdateChoices(choices, waiting)],
        approvalProblem: 'problem' in approved ? approved.problem : null,
      };
    },
    hub,
  });

  let unsubscribe: (() => void) | null = null;

  return {
    async get(refresh) {
      return publicPanel(await source.get(refresh));
    },

    start() {
      // The doc index tells the hub which docs changed (by repo path). Only a change to one of the three docs is a reason to load again.
      unsubscribe ??= hub.subscribe((event) => {
        if (event.module === 'docs' && event.ids?.some((id) => WATCHED_PATHS.has(id))) void source.get(true);
      });
      source.start();
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      source.stop();
    },
  };
}
