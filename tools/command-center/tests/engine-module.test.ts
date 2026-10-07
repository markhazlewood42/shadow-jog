import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_FILE, loadConfig } from '../src/server/config';
import { createDocIndex } from '../src/server/docs/index';
import { parseUpdateChoices } from '../src/server/engine/decisions';
import { createEngineModule } from '../src/server/engine/module';
import { createHub } from '../src/server/hub';
import { registerEngineRoutes } from '../src/server/routes/engine';
import { type Runner, createRunner } from '../src/server/runner';
import type { Decision, Panel } from '../src/shared/types';
import { must, waitFor } from './doc-index-helpers';
import { SAMPLE_PHASE_LINES, SAMPLE_ROWS, decisionsMd, phaseMd, readmeMd } from './engine-helpers';
import { ENGINE_PATHS, type EngineRig, type EngineRigOptions, makeEngineRig } from './engine-rig';
import { REPO_DIR, getFrom, makeApp, makeTestConfig } from './helpers';

// The engine module: the decisions of the three docs with their status, and what an edit, a bad
// approval ref and a missing column do to them. The docs are the made-up ones of engine-helpers.ts,
// in a real git repo, so `git show <ref>:<path>` runs for real. The last tests read the real docs.

const rigs: EngineRig[] = [];
afterEach(async () => {
  await Promise.all(rigs.splice(0).map((rig) => rig.close()));
});

/** A rig that the test does not have to close. */
async function rigWith(options: EngineRigOptions = {}): Promise<EngineRig> {
  const rig = await makeEngineRig(options);
  rigs.push(rig);
  return rig;
}

/** The decisions of a panel that must be good. */
function decisionsOf(panel: Panel<Decision[]>): Decision[] {
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}

/** `approved`, `open`, or `changed:edited` / `changed:added`, by decision id. */
const statesOf = (decisions: readonly Decision[]): Record<string, string> =>
  Object.fromEntries(decisions.map((decision) => [decision.id, decision.change === null ? decision.status : `${decision.status}:${decision.change}`]));

/** The state of every decision of the sample docs at the approval commit: nothing has changed yet. */
const AT_APPROVAL = {
  E1: 'approved',
  E2: 'open', // Mark's, and his answer is empty
  E3: 'approved',
  E4: 'open', // Mark's, and his answer says OPEN
  E9: 'approved',
  E10: 'approved', // the agents' decision with no answer: not waiting for Mark
  D1: 'approved',
  D2: 'approved',
  D5: 'open',
  C1: 'open', // the sample README says it waits for Mark
  C2: 'open',
  C3: 'open',
};

/** The sample decisions doc with the recommendation of one row changed. */
const withRecommendation = (id: string, recommendation: string) => decisionsMd({ rows: SAMPLE_ROWS.map((row) => (row.id === id ? { ...row, recommendation } : row)) });

describe('the engine module', () => {
  it('lists the E, D and C decisions of the three docs, in that order, each with its doc and heading', async () => {
    const rig = await rigWith();
    await rig.index.ready();
    const decisions = decisionsOf(await rig.engine.get());
    expect(decisions.map((decision) => decision.id)).toEqual(['E1', 'E2', 'E3', 'E4', 'E9', 'E10', 'D1', 'D2', 'D5', 'C1', 'C2', 'C3']);
    expect(decisions.map((decision) => decision.source)).toEqual([...Array(6).fill('engine'), ...Array(3).fill('phase-0.2'), ...Array(3).fill('engine-update')]);
    expect(statesOf(decisions)).toEqual(AT_APPROVAL);

    // Each decision names a doc of the site, and the heading that its page gives (the id is in the page's html).
    for (const decision of decisions) {
      const page = must(rig.index.get(decision.docSlug), `the doc "${decision.docSlug}" of ${decision.id}`);
      if (decision.anchor !== null) expect(page.html, decision.id).toContain(`id="${decision.anchor}"`);
    }
    const byId = new Map(decisions.map((decision) => [decision.id, decision]));
    expect(byId.get('E1')?.anchor).toBe('e1-what-is-the-answer-of-e1'); // its own section
    expect(byId.get('D5')?.anchor).toBe('decisions-for-mark'); // the heading above its line
    expect(byId.get('C2')?.anchor).toBe('what-the-spike-changed'); // the heading above the table
    expect(byId.get('E1')).toMatchObject({ docSlug: 'engine/decisions', who: 'Mark', option: 'A', milestone: 'Phase 0', answer: 'Phaser style: scene code' });
  });

  it('a missing column gives an error panel that names it', async () => {
    // The approved doc is fine. After the approval, the column "Who decides" is deleted from the table.
    const rig = await rigWith();
    rig.edit('decisions', decisionsMd({ columns: ['#', 'Decision', 'Recommendation', 'Needed before', 'Your answer'] }));
    const panel = await rig.engine.get();
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('decisions-column-missing');
    expect(panel.error.message).toContain('"Who decides"');
    expect(panel.error.message).toContain(ENGINE_PATHS.decisions);
    expect(panel.lastGood).toBeNull(); // nothing loaded before

    // Put the column back: the same module recovers at the next load, and the earlier error is gone.
    rig.edit('decisions', decisionsMd());
    expect(statesOf(decisionsOf(await rig.engine.get(true)))).toEqual(AT_APPROVAL);
  });

  it('a PHASE-0.2 decision with an unknown verdict gives an error panel that names it, and not a list with one decision fewer', async () => {
    const rig = await rigWith();
    rig.edit('phase', phaseMd([...SAMPLE_PHASE_LINES, '', '**6. A new decision?** — **deferred**']));
    const panel = await rig.engine.get();
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('engine-decision-unreadable');
    expect(panel.error.message).toContain('"deferred"');
  });

  it('a doc that is missing from the repo gives an error panel that names it, and a good load after it keeps the data of the last one', async () => {
    const rig = await rigWith();
    expect(decisionsOf(await rig.engine.get())).toHaveLength(12);
    rig.repo.remove(ENGINE_PATHS.phase);
    const panel = await rig.engine.get(true);
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('engine-doc-missing');
    expect(panel.error.message).toContain(ENGINE_PATHS.phase);
    // The earlier decisions are kept beside the error, as every panel keeps its last good data.
    expect(panel.lastGood?.data).toHaveLength(12);
  });

  it('changed: the row or the section text differs from git show <approvalRef>:<path> once whitespace is collapsed', async () => {
    const rig = await rigWith();
    expect(statesOf(decisionsOf(await rig.engine.get()))).toEqual(AT_APPROVAL);

    // After the approval: E1's row changes; E3's section changes (its row does not); E9's section is
    // written with other white space and the same words; D2's verdict changes, in a doc that is another file.
    rig.edit(
      'decisions',
      decisionsMd({
        rows: SAMPLE_ROWS.map((row) => (row.id === 'E1' ? { ...row, recommendation: 'Unity style' } : row)),
        bodies: {
          E3: 'The words of E3 are new.',
          E9: '**Question.**   The question of E9.\n\n\n\n**Recommendation.**\tThe recommendation of E9.\n\n',
        },
      }),
    );
    rig.edit('phase', phaseMd(SAMPLE_PHASE_LINES.map((line) => line.replace('the loop, not the camera', 'the loop and the camera'))));

    const after = decisionsOf(await rig.engine.get(true));
    expect(statesOf(after)).toEqual({
      ...AT_APPROVAL,
      E1: 'changed:edited', // its row differs
      E3: 'changed:edited', // its section differs
      D2: 'changed:edited',
      // E9 is as it was, with other white space. E2, E4 and D5 are open, which is the stronger word.
    });
    expect(after.find((decision) => decision.id === 'E1')?.status).toBe('changed');

    // The same text with Windows line endings is the same text.
    rig.edit('decisions', decisionsMd().replace(/\n/g, '\r\n'));
    rig.edit('phase', phaseMd().replace(/\n/g, '\r\n'));
    expect(statesOf(decisionsOf(await rig.engine.get(true)))).toEqual(AT_APPROVAL);
  });

  it('a decision absent at the ref is changed with change added', async () => {
    const rig = await rigWith();
    // Two new decisions after the approval: a row and its section in the table doc, and a line in the phase doc.
    rig.edit(
      'decisions',
      decisionsMd({ rows: [...SAMPLE_ROWS, { id: 'E11', decision: 'A new decision', recommendation: 'Do it', needed: 'M4', who: 'Mark', answer: 'A' }] }),
    );
    rig.edit('phase', phaseMd([...SAMPLE_PHASE_LINES, '', '**6. A new decision?** — **decided 2026-10-06: (a)**']));
    expect(statesOf(decisionsOf(await rig.engine.get(true)))).toEqual({ ...AT_APPROVAL, E11: 'changed:added', D6: 'changed:added' });

    // A doc that did not exist at the approval commit has no decision then: every decision of it is added (but the open ones are open).
    const early = await rigWith({ approvalRef: (repo) => must(repo.git.commits[0], 'the first commit of the repo') });
    expect(statesOf(decisionsOf(await early.engine.get()))).toEqual({
      E1: 'changed:added',
      E2: 'open',
      E3: 'changed:added',
      E4: 'open',
      E9: 'changed:added',
      E10: 'changed:added',
      D1: 'changed:added',
      D2: 'changed:added',
      D5: 'open',
      C1: 'open', // the C rows have no check against the approval commit
      C2: 'open',
      C3: 'open',
    });
  });

  it("the README's status decides the C rows in the panel: open while it waits for Mark, approved after", async () => {
    const rig = await rigWith();
    const cStates = async (refresh: boolean) => Object.entries(statesOf(decisionsOf(await rig.engine.get(refresh)))).filter(([id]) => id.startsWith('C'));
    expect(await cStates(false)).toEqual([['C1', 'open'], ['C2', 'open'], ['C3', 'open']]);

    rig.edit('readme', readmeMd({ status: 'approved 2026-10-05 (final). First approval 2026-10-04. Phase 0 update accepted' }));
    expect(await cStates(true)).toEqual([['C1', 'approved'], ['C2', 'approved'], ['C3', 'approved']]);
    // A README edit is not a change of the C rows against the approval commit: they have no such check.
    expect(statesOf(decisionsOf(await rig.engine.get())).E1).toBe('approved');
  });

  it('no C table gives no rows and no error', async () => {
    const withoutTable = readmeMd({ choices: null });
    expect(parseUpdateChoices(withoutTable)).toEqual([]);

    const rig = await rigWith({ texts: { readme: withoutTable } });
    const decisions = decisionsOf(await rig.engine.get());
    expect(decisions.filter((decision) => decision.source === 'engine-update')).toEqual([]);
    expect(decisions).toHaveLength(9); // the E and D decisions are all there

    // With no table the README's status is not looked at, so even a broken frontmatter is no error.
    rig.edit('readme', '---\nstatus: [unclosed\n---\n\n# Overview\n\nNo table here.\n');
    expect(decisionsOf(await rig.engine.get(true))).toHaveLength(9);
  });

  it('an edit of decisions.md in a temp copy changes the list within 5 s', async () => {
    const rig = await rigWith({ watch: true });
    await rig.index.ready();
    rig.engine.start();
    await waitFor(async () => (await rig.engine.get()).ok, 'the first list');
    expect(statesOf(decisionsOf(await rig.engine.get())).E1).toBe('approved');
    // The watcher says it is ready a moment before it has looked at each file, and the index scans once more to cover that
    // (CATCH_UP_MS in docs/index.ts). An edit that must be seen by the watcher itself waits for that scan.
    await new Promise((done) => setTimeout(done, 1800));

    const started = Date.now();
    rig.edit('decisions', withRecommendation('E1', 'Unity style'));
    await waitFor(async () => statesOf(decisionsOf(await rig.engine.get())).E1 === 'changed:edited', 'E1 to read changed after the edit', 5000);
    expect(Date.now() - started).toBeLessThan(5000);

    // The module said so on the hub, and the doc index's event named the doc that it was about.
    expect(rig.events.some((event) => event.module === 'docs' && event.ids?.includes(ENGINE_PATHS.decisions))).toBe(true);
    expect(rig.events.filter((event) => event.module === 'engine').length).toBeGreaterThanOrEqual(2);
  });

  it('loads again for a change to one of the three docs, and not for a change to another doc', async () => {
    let calls = 0;
    const rig = await rigWith({
      wrapRunner: (real): Runner => (cmd, args, options) => {
        if (cmd === 'git' && args[0] === 'rev-parse') calls += 1; // each load asks git once, first
        return real(cmd, args, options);
      },
    });
    rig.engine.start();
    await waitFor(() => calls === 1, 'the first load');

    rig.hub.publish({ module: 'docs', at: new Date().toISOString(), ids: ['docs/other.md'] });
    rig.hub.publish({ module: 'git', at: new Date().toISOString() });
    rig.hub.publish({ module: 'docs', at: new Date().toISOString() });
    await new Promise((done) => setTimeout(done, 400));
    expect(calls).toBe(1);

    for (const [i, path] of [ENGINE_PATHS.decisions, ENGINE_PATHS.readme, ENGINE_PATHS.phase].entries()) {
      rig.hub.publish({ module: 'docs', at: new Date().toISOString(), ids: ['docs/other.md', path] });
      await waitFor(() => calls === i + 2, `a load after a change to ${path}`);
    }

    // A stopped module no longer listens.
    rig.engine.stop();
    rig.hub.publish({ module: 'docs', at: new Date().toISOString(), ids: [ENGINE_PATHS.decisions] });
    await new Promise((done) => setTimeout(done, 400));
    expect(calls).toBe(4);
  });

  it('a bad approvalRef gives a visible error and no changed flags', async () => {
    const rig = await rigWith({ approvalRef: () => 'no-such-ref' });
    // After the approval, a row changes. With a good ref this would be flagged.
    rig.edit('decisions', withRecommendation('E1', 'Unity style'));

    const panel = await rig.engine.get();
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    // The error says what is wrong, and where to fix it.
    expect(panel.error.code).toBe('approval-check-failed');
    expect(panel.error.message).toContain('approvalRef "no-such-ref"');
    expect(panel.error.message).toContain('not a commit');
    expect(panel.error.message).toContain('"Changed since approved" is off');
    expect(panel.error.message).toContain('command-center.config.json');

    // The decisions still come with it (the page shows the error above them), and none carries a change flag.
    const shown = must(panel.lastGood, 'the decisions that come with the error').data;
    expect(shown).toHaveLength(12);
    expect(shown.filter((decision) => decision.status === 'changed' || decision.change !== null)).toEqual([]);
    expect(statesOf(shown)).toEqual(AT_APPROVAL); // E1 reads approved: nothing can be compared; the open ones are still open
    expect(panel.updatedAt).toEqual(expect.any(String));
  });

  it('git that cannot read the approved doc, and an approved doc that is not a decision list, are visible errors with no changed flags too', async () => {
    // git show fails (the ref is a commit, but the call fails for another reason than a missing path).
    const failing = await rigWith({
      wrapRunner: (real): Runner => (cmd, args, options) =>
        cmd === 'git' && args[0] === 'show' ? Promise.resolve({ code: 128, stdout: '', stderr: 'fatal: unable to read the object\nmore' }) : real(cmd, args, options),
    });
    failing.edit('decisions', withRecommendation('E1', 'Unity style'));
    const first = await failing.engine.get();
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.message).toContain(`git could not read ${ENGINE_PATHS.decisions} at ${failing.approvalRef}`);
    expect(first.error.message).toContain('unable to read the object');
    expect(first.error.message).not.toContain('more'); // the first line of git's words
    expect(must(first.lastGood, 'the decisions beside the error').data.filter((decision) => decision.change !== null)).toEqual([]);

    // The doc at the approval commit had a table that cannot be read (no "Who decides" column): the check cannot be made.
    const old = await rigWith({ texts: { decisions: decisionsMd({ columns: ['#', 'Decision', 'Recommendation', 'Needed before', 'Your answer'] }) } });
    old.edit('decisions', decisionsMd());
    const second = await old.engine.get();
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.message).toContain(`${ENGINE_PATHS.decisions} at ${old.approvalRef} could not be read as a list of decisions`);
    expect(second.error.message).toContain('"Who decides"');
    expect(statesOf(must(second.lastGood, 'the decisions beside the error').data)).toEqual(AT_APPROVAL);
  });
});

describe('GET /api/engine/decisions', () => {
  it('answers the decisions as a panel, and only GET', async () => {
    const rig = await rigWith();
    const { app } = makeApp({ config: rig.config });
    registerEngineRoutes(app, rig.engine);

    const res = await getFrom(app, '/api/engine/decisions', rig.config);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const panel = (await res.json()) as Panel<Decision[]>;
    expect(panel.ok && statesOf(panel.data)).toEqual(AT_APPROVAL);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const refused = await app.request('/api/engine/decisions', { method, headers: { host: `localhost:${rig.config.port}` } });
      expect(refused.status, method).toBe(405);
    }
  });

  it('tries a failed panel again at the next request, so the page Retry button does something', async () => {
    const rig = await rigWith();
    const { app } = makeApp({ config: rig.config });
    registerEngineRoutes(app, rig.engine);
    const read = async () => (await (await getFrom(app, '/api/engine/decisions', rig.config)).json()) as Panel<Decision[]>;

    // The module is not started and nothing tells it about edits: only a request can make it look again.
    rig.repo.remove(ENGINE_PATHS.phase);
    const failed = await read();
    expect(!failed.ok && failed.error.code).toBe('engine-doc-missing');

    rig.edit('phase', phaseMd());
    const again = await read();
    expect(again.ok).toBe(true);
    expect(again.ok && again.data).toHaveLength(12);
  });
});

describe('the real docs', () => {
  /** The module over the real repo, with the real runner and the real doc index (no watcher), and the given approval ref. */
  async function realModule(approvalRef: string) {
    const config = { ...makeTestConfig({ repoRoot: REPO_DIR, roots: [REPO_DIR] }), approvalRef };
    const runner = createRunner(config);
    const hub = createHub();
    const index = createDocIndex({ config, runner, hub }, { watch: false });
    await index.ready();
    return { index, engine: createEngineModule({ config, runner, docs: index, hub }) };
  }

  it('the real repo has E1 to E25, decisions 1 to 17 of PHASE-0.2 and C1 to C7, each with its doc on the site', async () => {
    // HEAD as the approval ref: it is in every clone, and nothing is flagged unless a doc is edited in the working folder.
    const { index, engine } = await realModule('HEAD');
    const decisions = decisionsOf(await engine.get());
    const ids = new Set(decisions.map((decision) => decision.id));
    const range = (prefix: string, last: number) => Array.from({ length: last }, (_unused, i) => `${prefix}${i + 1}`);
    for (const id of [...range('E', 25), ...range('D', 17), ...range('C', 7)]) expect(ids.has(id), id).toBe(true);
    expect(decisions.filter((decision) => decision.source === 'engine')).toHaveLength(25);
    expect(decisions.filter((decision) => decision.source === 'engine-update')).toHaveLength(7);
    expect(new Set(decisions.map((decision) => decision.source))).toEqual(new Set(['engine', 'phase-0.2', 'engine-update']));

    for (const decision of decisions) {
      expect(['approved', 'open', 'changed']).toContain(decision.status);
      const page = must(index.get(decision.docSlug), `the doc "${decision.docSlug}" of ${decision.id}`);
      if (decision.anchor !== null) expect(page.html, decision.id).toContain(`id="${decision.anchor}"`);
    }
    // Every E decision has the heading of its own section on its page.
    expect(decisions.filter((decision) => decision.source === 'engine' && decision.anchor?.startsWith('e') !== true)).toEqual([]);
  });

  // The facts of the "Done when" list. They are true today and become false when Mark answers decision 5 or the docs change, so
  // they run on demand and not in the default suite (the same way as CC_REAL_NAV in docs-routes.test.ts):
  //   CC_REAL_ENGINE=1 npx vitest run tests/engine-module.test.ts -t "Done when"
  it.skipIf(process.env.CC_REAL_ENGINE !== '1')('with CC_REAL_ENGINE=1, Done when: decision 5 reads open, the C rows read approved, and E12 reads changed against 9f830de', async () => {
    const configured = loadConfig(DEFAULT_CONFIG_FILE).approvalRef;
    const real = decisionsOf(await (await realModule(configured)).engine.get());
    expect(real.find((decision) => decision.id === 'D5')?.status).toBe('open');
    // The README no longer says it waits for Mark (the approval record is merged), so the C rows read approved.
    expect(real.filter((decision) => decision.source === 'engine-update').map((decision) => decision.status)).toEqual(Array(7).fill('approved'));
    expect(real.filter((decision) => decision.status === 'changed')).toEqual([]); // nothing changed since the approval

    // Against the first approval of 2026-10-04, E12 (the resolution that Mark settled the next day) reads changed.
    const early = decisionsOf(await (await realModule('9f830de')).engine.get());
    expect(early.find((decision) => decision.id === 'E12')).toMatchObject({ status: 'changed', change: 'edited' });
    expect(early.find((decision) => decision.id === 'D5')?.status).toBe('open');
    expect(early.filter((decision) => decision.source === 'engine-update').every((decision) => decision.status === 'approved' && decision.change === null)).toBe(true);
  });
});
