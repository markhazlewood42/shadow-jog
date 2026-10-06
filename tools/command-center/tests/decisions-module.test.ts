import { afterEach, describe, expect, it, vi } from 'vitest';
import { setGhIssues } from '../e2e/fake-gh';
import type { Exec } from '../src/server/runner';
import { DECISION_FIELDS } from '../src/server/decisions/parse';
import { bannersOf } from '../src/server/decisions/module';
import type { DecisionDetail, DecisionIssue, DecisionsInfo, DocDecision, DocPageData, Panel } from '../src/shared/types';
import { SEED, SETUP_DOC, type DecisionsRig, type RigOptions, makeDecisionsRig, setRigMode } from './decisions-rig';

// The decisions module (the source of the panel that lists the decisions), the routes that serve it
// (`GET /api/decisions` and `GET /api/decisions/<n>`), and the banners that the docs route adds to a doc.
// They run over the real runner, with the fake gh of the end-to-end tests under it (it remembers issues:
// fixtures/gh/issues.json, all made up), and a doc index over a temp folder.

const rigs: DecisionsRig[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const rig of rigs.splice(0)) rig.close();
});
function rigOf(options: RigOptions = {}): DecisionsRig {
  const rig = makeDecisionsRig(options);
  rigs.push(rig);
  return rig;
}

const DAY = 24 * 60 * 60 * 1000;

function dataOf<T>(panel: Panel<T>): T {
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return panel.data;
}
const infoOf = async (rig: DecisionsRig, refresh = false): Promise<DecisionsInfo> => dataOf((await rig.decisions.get(refresh)) as Panel<DecisionsInfo>);
const numbers = (issues: readonly DecisionIssue[]) => issues.map((issue) => issue.number);
const issueOf = (issues: readonly DecisionIssue[], number: number): DecisionIssue => {
  const found = issues.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`issue ${number} is not in the list`);
  return found;
};
const detailOf = async (rig: DecisionsRig, number: number | string): Promise<{ status: number; panel: Panel<DecisionDetail> }> => {
  const res = await rig.get(`/api/decisions/${number}`);
  return { status: res.status, panel: (await res.json()) as Panel<DecisionDetail> };
};

describe('the decisions source', () => {
  it('asks gh for the open decisions and for the decided issues, with the fields of the parser, in calls that the runner allows', async () => {
    const rig = rigOf();
    await rig.decisions.get();
    const repo = rig.config.githubRepo;
    const lists = rig.calls().filter((call) => call.args[1] === 'list').map((call) => call.args);
    expect(lists).toEqual([
      ['issue', 'list', '--repo', repo, '--label', 'decision', '--state', 'open', '--limit', '100', '--json', DECISION_FIELDS],
      ['issue', 'list', '--repo', repo, '--label', 'decided', '--state', 'all', '--limit', '100', '--json', DECISION_FIELDS],
    ]);
    // Every call that it made is a read.
    expect(rig.writes()).toEqual([]);
  });

  it('lists the open decisions of Mark and the ones that he answered in the last week, and nothing else', async () => {
    const rig = rigOf();
    const info = await infoOf(rig);
    // 41, 43, 46 and 47 are open decisions of Mark's, the oldest first (by number). 42 is a stranger's issue with the label.
    expect(numbers(info.open)).toEqual([41, 43, 46, 47]);
    // 44 is answered a day ago. 45 has a label from another account, and 40 was answered a month ago: neither is listed.
    expect(numbers(info.recent)).toEqual([44]);
    for (const number of [40, 42, 45]) expect(numbers([...info.open, ...info.recent])).not.toContain(number);

    expect(issueOf(info.open, 43)).toMatchObject({ state: 'open', answer: null }); // the "Decision: B" of the look-alike login does not count
    expect(issueOf(info.open, 46)).toMatchObject({ options: [], problem: expect.stringMatching(/template/) }); // listed: Mark can open it on GitHub
    expect(issueOf(info.recent, 44)).toMatchObject({ state: 'answered', answer: { option: 'B', complete: true } });
  });

  it('asks for the events only of a closed issue that was answered in the last week', async () => {
    const rig = rigOf();
    await rig.decisions.get();
    const repo = rig.config.githubRepo;
    const asked = rig.calls().filter((call) => call.args[0] === 'api').map((call) => call.args);
    // 44 (answered) and 45 (closed, and the label came from another account) are the closed issues with a comment of Mark's from the last week.
    // 40 is a month old, and the open issues cannot be answered, so none of them needs the events.
    expect(asked.map((args) => args[1]).sort()).toEqual([`repos/${repo}/issues/44/events`, `repos/${repo}/issues/45/events`]);
    // Every page of them (--paginate), as one list of pages (--slurp): the two read-only options that the runner allows.
    for (const args of asked) expect(args.slice(2)).toEqual(['--paginate', '--slurp']);
  });

  it('counts the last week from the clock of the module', async () => {
    // Issue 44 was answered at 2026-10-05T15:12:09Z.
    const answeredAt = Date.parse('2026-10-05T15:12:09Z');
    const recentAt = async (now: number) => numbers((await infoOf(rigOf({ now: () => now }))).recent);
    expect(await recentAt(answeredAt)).toEqual([44]);
    expect(await recentAt(answeredAt + 7 * DAY)).toEqual([44]); // exactly 7 days is still in
    expect(await recentAt(answeredAt + 7 * DAY + 1000)).toEqual([]);
    expect(await recentAt(answeredAt - DAY)).toEqual([44]); // a clock a little behind is not a reason to drop it
  });

  it('puts the heading of each linked doc section into the link, and null for a heading that the doc does not have', async () => {
    const rig = rigOf();
    const info = await infoOf(rig);
    expect(issueOf(info.open, 41).docs).toEqual([
      { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'storage', heading: 'Storage' },
      { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'first-run', heading: 'First run' },
      { docId: 'docs/guides/setup.md', slug: 'guides/setup', anchor: 'no-such-heading', heading: null },
    ]);
    // A doc that is not in the repo at all has no heading either.
    const other = rigOf({ docs: {} });
    expect(issueOf((await infoOf(other)).open, 41).docs.map((link) => link.heading)).toEqual([null, null, null]);
  });

  it('keeps the address of the issue, and makes one from the repository when gh gave none that can be used', async () => {
    const rig = rigOf({ store: { ...SEED, issues: SEED.issues.map((issue) => (issue.number === 41 ? { ...issue, url: 'javascript:alert(1)' } : issue)) } });
    const info = await infoOf(rig);
    expect(issueOf(info.open, 41).url).toBe(`https://github.com/${rig.config.githubRepo}/issues/41`);
    expect(issueOf(info.open, 43).url).toBe('https://github.com/fixture-owner/fixture-repo/issues/43');
  });

  it('is empty, not an error, when there is no decision at all', async () => {
    const rig = rigOf({ store: { labels: ['decision', 'decided'], issues: [] } });
    expect(await infoOf(rig)).toEqual({ open: [], recent: [] });
  });

  it('gh not signed in, missing, offline and timeout each give a named code and keep lastGood', async () => {
    const rig = rigOf();
    const good = await rig.decisions.get(true);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const messages = new Set<string>();
    for (const [mode, code] of [['signed-out', 'gh-not-signed-in'], ['missing', 'gh-missing'], ['offline', 'gh-offline'], ['timeout', 'gh-timeout']] as const) {
      setRigMode(rig, { mode });
      const failed = await rig.decisions.get(true);
      expect(failed.ok, mode).toBe(false);
      if (failed.ok) return;
      expect(failed.error.code, mode).toBe(code);
      messages.add(failed.error.message);
      expect(failed.lastGood, mode).toEqual({ data: good.data, updatedAt: good.updatedAt });
    }
    expect(messages.size).toBe(4);
    setRigMode(rig, { mode: 'ok' });
    expect((await rig.decisions.get(true)).ok).toBe(true);
  });

  it('output that gh printed in a form that cannot be read fails the panel with gh-bad-output, and never drops an issue without saying so', async () => {
    const bad: [string, string][] = [
      ['<html>not json</html>', 'not JSON'],
      ['{"number":1}', 'not a list'],
      ['[1]', 'entry 1'],
      ['[{"title":"no number"}]', 'number'],
      ['[{"number":5,"state":"OPEN","labels":[]}]', 'author'], // gh changed its shape: no author object
      ['[{"number":5,"state":"OPEN","author":{"login":"x"}}]', 'labels'],
    ];
    for (const [stdout, word] of bad) {
      const rig = rigOf();
      setRigMode(rig, { mode: 'ok', replies: { 'issue list': { stdout } } });
      const failed = await rig.decisions.get();
      expect(failed.ok, stdout).toBe(false);
      if (failed.ok) return;
      expect(failed.error.code, stdout).toBe('gh-bad-output');
      expect(failed.error.message, stdout).toContain(word);
    }
  });

  it('a failure to read the events of one issue fails the panel with a named code, and the last list stays', async () => {
    const rig = rigOf();
    const good = await rig.decisions.get(true);
    expect(good.ok).toBe(true);
    // The events of the closed issues fail, and the lists work: a reply with a failure for the events only.
    setRigMode(rig, { mode: 'ok', replies: { 'api events': { code: 1, stderr: 'error connecting to api.github.com' } } });
    const failed = await rig.decisions.get(true);
    expect(failed.ok).toBe(false);
    if (failed.ok || !good.ok) return;
    expect(failed.error.code).toBe('gh-offline');
    expect(failed.lastGood?.data).toEqual(good.data);
  });

  it('events that gh printed as an error body are an error, never read as "nobody labelled it"', async () => {
    const rig = rigOf();
    setRigMode(rig, { mode: 'ok', replies: { 'api events': { stdout: '{"message":"Not Found"}' } } });
    const failed = await rig.decisions.get();
    expect(failed).toMatchObject({ ok: false, error: { code: 'gh-bad-output' } });
  });

  it('loads when it starts and then every 60 s, and stops when it is stopped', async () => {
    const rig = rigOf();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const lists = () => rig.calls().filter((call) => call.args[1] === 'list').length;
    rig.decisions.start();
    try {
      await rig.decisions.get(); // waits for the load that start() began
      expect(lists()).toBe(2); // the open decisions and the decided ones
      await vi.advanceTimersByTimeAsync(59_999);
      expect(lists()).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(lists()).toBe(4);
    } finally {
      rig.decisions.stop();
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(lists()).toBe(4);
  });

  it('publishes a decisions change when the decisions change, and not when they stay the same', async () => {
    const rig = rigOf();
    const heard: string[] = [];
    rig.hub.subscribe((event) => heard.push(event.module));
    await rig.decisions.get(true);
    await rig.decisions.get(true); // the same decisions again
    expect(heard).toEqual(['decisions']);
    // An answer changes them.
    expect((await rig.post(41, { option: 'A' })).status).toBe(200);
    expect(heard).toEqual(['decisions', 'decisions']);
  });
});

describe('bannersOf', () => {
  const link = (docId: string, anchor: string) => ({ docId, slug: docId, anchor, heading: null });
  const issue = (number: number, title: string, ...docs: ReturnType<typeof link>[]): DecisionIssue => ({
    number, title, url: '', state: 'open', question: '', context: null, options: [], recommended: null, docs, raisedBy: null, waitsOn: null, createdAt: '', answer: null, problem: null,
  });

  it('gives one banner for each link of an open decision to the doc, in the order of the decisions, and none for another doc or an answered decision', () => {
    const info: DecisionsInfo = {
      open: [issue(2, 'Two', link('docs/a.md', 'x'), link('docs/b.md', 'y'), link('docs/a.md', 'z')), issue(5, 'Five', link('docs/a.md', 'x'), link('docs/a.md', 'x'))],
      recent: [issue(9, 'Nine, answered', link('docs/a.md', 'w'))],
    };
    expect(bannersOf(info, 'docs/a.md')).toEqual<DocDecision[]>([
      { number: 2, title: 'Two', anchor: 'x' },
      { number: 2, title: 'Two', anchor: 'z' },
      { number: 5, title: 'Five', anchor: 'x' },
    ]);
    expect(bannersOf(info, 'docs/c.md')).toEqual([]);
  });
});

describe('GET /api/decisions', () => {
  it('answers the panel of the decisions, and a forced refresh is limited to one in 10 s, as for the other panels', async () => {
    const rig = rigOf({ minGapMs: 10_000 });
    const lists = () => rig.calls().filter((call) => call.args[1] === 'list').length;
    const first = (await (await rig.get('/api/decisions')).json()) as Panel<DecisionsInfo>;
    expect(numbers(dataOf(first).open)).toEqual([41, 43, 46, 47]);
    expect(lists()).toBe(2); // the first load
    await rig.get('/api/decisions'); // from the source
    expect(lists()).toBe(2);
    await rig.get('/api/decisions?refresh=1'); // forced: the gap is counted from the last forced load, and there was none
    expect(lists()).toBe(4);
    await rig.get('/api/decisions?refresh=1'); // too soon
    expect(lists()).toBe(4);
  });

  it('answers a failed panel with status 200 and the reason, when gh fails', async () => {
    const rig = rigOf();
    setRigMode(rig, { mode: 'signed-out' });
    const res = await rig.get('/api/decisions');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'gh-not-signed-in' }, lastGood: null });
  });
});

describe('GET /api/decisions/<n>', () => {
  it('answers the decision with its linked sections as the docs have them: the heading and the html of each', async () => {
    const rig = rigOf();
    const { status, panel } = await detailOf(rig, 41);
    expect(status).toBe(200);
    const detail = dataOf(panel);
    expect(detail).toMatchObject({ number: 41, state: 'open', question: 'Where should Burrow keep its cache folder?' });
    expect(detail.sections.map((section) => [section.docId, section.anchor, section.heading])).toEqual([
      ['docs/guides/setup.md', 'storage', 'Storage'],
      ['docs/guides/setup.md', 'first-run', 'First run'],
      ['docs/guides/setup.md', 'no-such-heading', null],
    ]);
    // A section is the heading and what follows it up to the next heading of the same or a higher level: the deeper heading is inside it.
    expect(detail.sections[0]?.html).toContain('<h2 id="storage">Storage</h2>');
    expect(detail.sections[0]?.html).toContain('Burrow keeps its data in one folder.');
    expect(detail.sections[0]?.html).toContain('<h3 id="cache">Cache</h3>');
    expect(detail.sections[0]?.html).not.toContain('Upgrading');
    expect(detail.sections[1]?.html).toContain('The first run builds the index.');
    expect(detail.sections[1]?.html).not.toContain('Storage');
  });

  it('a missing anchor shows a notice, not an error: the section is null, and the decision is still answered with status 200', async () => {
    const rig = rigOf();
    const { status, panel } = await detailOf(rig, 41);
    expect(status).toBe(200);
    expect(panel.ok).toBe(true);
    expect(dataOf(panel).sections[2]).toEqual({ docId: 'docs/guides/setup.md', anchor: 'no-such-heading', heading: null, html: null });
    // The same when the doc itself is not there: the page says so in the same words ("this section was not found").
    const bare = rigOf({ docs: {} });
    const none = dataOf((await detailOf(bare, 41)).panel).sections;
    expect(none.map((section) => [section.heading, section.html])).toEqual([[null, null], [null, null], [null, null]]);
  });

  it('the page shows the current text of the linked section', async () => {
    // The sections are built from the doc index at each request, not kept in the list: an edit of the doc shows at the next read.
    const rig = rigOf();
    await rig.index.ready();
    const before = dataOf((await detailOf(rig, 41)).panel).sections[0]?.html ?? '';
    expect(before).toContain('Burrow keeps its data in one folder.');

    rig.repo.write('docs/guides/setup.md', SETUP_DOC.replace('Burrow keeps its data in one folder.', 'Burrow now keeps its data in three folders.'));
    await rig.index.refresh();
    const after = dataOf((await detailOf(rig, 41)).panel).sections[0]?.html ?? '';
    expect(after).toContain('Burrow now keeps its data in three folders.');
    expect(after).not.toContain('Burrow keeps its data in one folder.');

    // A heading that the edit adds is found at once, and one that it removes turns into a notice, with no new read of the issue.
    rig.repo.write('docs/guides/setup.md', `${SETUP_DOC.replace('## Storage', '## Data storage')}\n## No such heading\n\nNow it is there.\n`);
    await rig.index.refresh();
    const sections = dataOf((await detailOf(rig, 41)).panel).sections;
    expect(sections.map((section) => section.heading)).toEqual([null, 'First run', 'No such heading']);
    expect(sections[2]?.html).toContain('Now it is there.');
  });

  it('answers a decision that was answered in the last week, with its answer', async () => {
    const rig = rigOf();
    expect(dataOf((await detailOf(rig, 44)).panel)).toMatchObject({ state: 'answered', answer: { option: 'B', complete: true } });
  });

  it('answers 404 with a failed panel (decision-not-found) for a number that is not in the lists: none, a stranger, an old one, a forged label', async () => {
    const rig = rigOf();
    for (const number of [999, 42, 40, 45, 1]) {
      const { status, panel } = await detailOf(rig, number);
      expect(status, `issue ${number}`).toBe(404);
      expect(panel, `issue ${number}`).toMatchObject({ ok: false, error: { code: 'decision-not-found' }, lastGood: null });
    }
    // Not a number: no such route, and no call to gh for it.
    const before = rig.calls().length;
    for (const path of ['abc', '4x', '-1', '1.5', '99999999999999999999']) expect((await rig.get(`/api/decisions/${path}`)).status, path).toBe(404);
    expect(rig.calls()).toHaveLength(before);
  });

  it('looks again when the number is not in the list, because an agent may have raised the decision a moment ago, and no more than the panel rule allows', async () => {
    const rig = rigOf({ minGapMs: 10_000 });
    await rig.decisions.get(true); // the list as it was
    const lists = () => rig.calls().filter((call) => call.args[1] === 'list').length;
    expect(lists()).toBe(2);

    // An agent raises decision 48 after that.
    const store = rig.issues();
    const template = store.issues.find((issue) => issue.number === 43);
    if (template === undefined) throw new Error('no issue 43');
    store.issues.push({ ...template, number: 48, title: 'Decision: Raised a moment ago', url: 'https://github.com/fixture-owner/fixture-repo/issues/48', comments: [] });
    setGhIssues(store, rig.ghDir);

    const found = await detailOf(rig, 48);
    expect(found.status).toBe(200);
    expect(dataOf(found.panel).number).toBe(48);
    expect(lists()).toBe(4); // one forced load

    // A number that is still not there does not make a load for every request: one forced load in 10 s.
    expect((await detailOf(rig, 999)).status).toBe(404);
    expect(lists()).toBe(4);
  });

  it('answers a failed panel with the last good decision when gh fails later, so the page keeps what it has', async () => {
    const rig = rigOf();
    expect((await detailOf(rig, 41)).status).toBe(200);
    setRigMode(rig, { mode: 'offline' });
    await rig.decisions.get(true);
    const { status, panel } = await detailOf(rig, 41);
    expect(status).toBe(200);
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('gh-offline');
    expect(panel.lastGood?.data).toMatchObject({ number: 41, state: 'open' });
    expect(panel.lastGood?.data.sections).toHaveLength(3);
    // A number that was never in the list gets the error and no data (it cannot be said to be missing: gh could not be asked).
    const unknown = await detailOf(rig, 999);
    expect(unknown.status).toBe(200);
    expect(unknown.panel).toMatchObject({ ok: false, error: { code: 'gh-offline' }, lastGood: null });
  });
});

describe('the banners of a doc: GET /api/docs/<slug> adds the open decisions that link to it', () => {
  const docOf = async (rig: DecisionsRig, slug = 'guides/setup') => dataOf((await (await rig.get(`/api/docs/${slug}`)).json()) as Panel<DocPageData>);

  it('has an entry for each link of an open decision of Mark to the doc, and none for a stranger, an answered decision or another doc', async () => {
    const rig = rigOf();
    await rig.decisions.get(true);
    const doc = await docOf(rig);
    // 41 links to three headings of the doc (one of them is not in the doc: its banner goes to the top of the doc). 43, 46 (no template: no links) and 47 link to "installing".
    expect(doc.decisions).toEqual([
      { number: 41, title: 'Decision: Where should Burrow keep its cache?', anchor: 'storage' },
      { number: 41, title: 'Decision: Where should Burrow keep its cache?', anchor: 'first-run' },
      { number: 41, title: 'Decision: Where should Burrow keep its cache?', anchor: 'no-such-heading' },
      { number: 43, title: 'Decision: Should the log be kept?', anchor: 'installing' },
      { number: 47, title: 'Decision: <b>Bold</b> or plain?', anchor: 'installing' },
    ]);
    // The answer of 44 (a closed decision) and the stranger's 42 have no banner: 42 is not even in the list.
    expect(JSON.stringify(doc.decisions)).not.toContain('"number":44');
    expect(JSON.stringify(doc.decisions)).not.toContain('"number":42');
  });

  it('is an empty list for a doc that no decision links to, and the doc is the same as before', async () => {
    const rig = rigOf({ docs: { 'docs/guides/setup.md': SETUP_DOC, 'docs/other.md': '# Other\n\nText.\n' } });
    await rig.decisions.get(true);
    expect((await docOf(rig, 'other')).decisions).toEqual([]);
    expect((await docOf(rig, 'other')).title).toBe('Other');
  });

  it('is null when the decisions could not be read and there is no earlier list: the page says that the banners are missing', async () => {
    const rig = rigOf();
    setRigMode(rig, { mode: 'signed-out' });
    expect((await docOf(rig)).decisions).toBeNull();
    // The doc itself is served all the same: one broken source never blanks a page.
    expect((await docOf(rig)).title).toBe('Setup guide');
  });

  it('uses the last good list when a later load fails, so the banners stay while gh is offline', async () => {
    const rig = rigOf();
    await rig.decisions.get(true);
    setRigMode(rig, { mode: 'offline' });
    await rig.decisions.get(true);
    expect((await docOf(rig)).decisions?.map((banner) => banner.number)).toEqual([41, 41, 41, 43, 47]);
  });

  it('does not make a doc page wait for a gh that does not answer: it goes on without banners after a short wait', async () => {
    // Every call that lists issues hangs. The doc page must not hang with it.
    const hang: RigOptions['wrapExec'] = (fake): Exec => (cmd, args, o) => (args[0] === 'issue' && args[1] === 'list' ? new Promise(() => undefined) : fake(cmd, args, o));
    const rig = rigOf({ wrapExec: hang, decisionsWaitMs: 50 });
    const started = Date.now();
    const doc = await docOf(rig);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(doc.decisions).toBeNull();
    expect(doc.title).toBe('Setup guide');
  });

  it('does not change what the other doc routes answer', async () => {
    const rig = rigOf();
    expect((await rig.get('/api/docs/nope')).status).toBe(404);
    const listing = dataOf((await (await rig.get('/api/docs')).json()) as Panel<{ docs: { slug: string }[] }>);
    expect(listing.docs.map((doc) => doc.slug)).toEqual(['guides/setup']);
  });
});
