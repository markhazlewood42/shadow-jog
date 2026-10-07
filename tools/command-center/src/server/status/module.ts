import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Panel, StatusInfo } from '../../shared/types';
import type { Config } from '../config';
import type { DocIndex } from '../docs/index';
import { isMissing } from '../fs-errors';
import type { Hub } from '../hub';
import { POLL_EVERY_MS, PanelError, type PanelSource, createPanelSource } from '../source';
import { MIGRATION_DOC_PATH, STATUS_DOC_PATH, parseMilestones, parseStatus } from './status';

// The status module: the current "Right now" section of status.md and its "Next up for Mark" list,
// and the engine milestones of docs/engine/migration.md. It reads the two files from the repo (the
// doc index renders the markdown, so links work as they do on the docs site), and it loads again
// when the doc index says that docs changed.

export type StatusModuleDeps = {
  config: Config;
  /** Renders markdown as html for the page, and says when its first scan of the docs is done (the links of the html are checked against that scan). */
  docs: DocIndex;
  hub: Hub;
};

/**
 * What one load finds. `milestonesProblem` says why the milestone list could not be read, or is null.
 * The rest of the status is there either way, because a doc that has nothing to do with status.md
 * (the engine's migration plan) must not take Mark's to-do list away from the page. The page sees the
 * problem as an error beside the data (see `publicPanel`).
 */
type Loaded = { info: StatusInfo; milestonesProblem: { code: string; message: string } | null };

/** The text of a doc, or a PanelError that names the doc and says that it is missing. */
async function readDoc(root: string, path: string, code: string, consequence: string): Promise<string> {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch (error) {
    if (isMissing(error)) throw new PanelError(code, `${path} was not found in the repo, so ${consequence}.`);
    throw error;
  }
}

/**
 * The panel that callers see. A problem with the milestones is an error of the panel (so the page
 * shows it, with its Retry button), and the status that could be read rides along as the data of a
 * failed panel (`lastGood`), with no milestones. The same shape as the engine module's panel when its
 * approval check fails.
 */
function publicPanel(panel: Panel<Loaded>): Panel<StatusInfo> {
  if (!panel.ok) {
    return { ...panel, lastGood: panel.lastGood === null ? null : { ...panel.lastGood, data: panel.lastGood.data.info } };
  }
  const { info, milestonesProblem } = panel.data;
  if (milestonesProblem === null) return { ok: true, data: info, updatedAt: panel.updatedAt };
  return { ok: false, error: milestonesProblem, updatedAt: panel.updatedAt, lastGood: { data: info, updatedAt: panel.updatedAt } };
}

/**
 * The status module, as a source of a Panel of StatusInfo. It loads when it starts, when the doc
 * index publishes any change of the docs (an edit of status.md or migration.md, or a doc that one
 * of its links points at), and every 60 seconds as a safety net.
 */
export function createStatusSource(deps: StatusModuleDeps): PanelSource<StatusInfo> {
  const { config, docs, hub } = deps;

  const source = createPanelSource<Loaded>({
    name: 'status',
    async load() {
      // The links in the html are checked against the doc index's scan, so wait for the first one.
      await docs.ready();
      const statusMd = await readDoc(config.repoRoot, STATUS_DOC_PATH, 'status-missing', 'the project status cannot be shown');
      const status = parseStatus(statusMd, (markdown) => docs.renderFragment(STATUS_DOC_PATH, markdown));

      let milestones: StatusInfo['milestones'] = [];
      let milestonesProblem: Loaded['milestonesProblem'] = null;
      try {
        const migrationMd = await readDoc(config.repoRoot, MIGRATION_DOC_PATH, 'milestones-doc-missing', 'the milestone list cannot be shown');
        milestones = parseMilestones(migrationMd);
      } catch (error) {
        // Only the named problems of the milestone doc: any other failure is a failure of the load.
        if (!(error instanceof PanelError)) throw error;
        milestonesProblem = { code: error.code, message: error.message };
      }
      return { info: { ...status, milestones }, milestonesProblem };
    },
    hub,
    everyMs: POLL_EVERY_MS,
  });

  let unsubscribe: (() => void) | null = null;

  return {
    async get(refresh) {
      return publicPanel(await source.get(refresh));
    },

    start() {
      // The doc index tells the hub when docs changed. Any change can matter: a link in the status may now point at a doc that exists.
      unsubscribe ??= hub.subscribe((event) => {
        if (event.module === 'docs') void source.get(true);
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
