import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exec } from '../src/server/runner';
import { DECISION_FIELDS } from '../src/server/decisions/parse';
import { bannersOf } from '../src/server/decisions/module';
import { MARK_LOGIN } from '../src/server/github/github';
import type { DecisionDetail, DecisionIssue, DecisionsInfo, DocDecision, DocPageData, Panel } from '../src/shared/types';
import { FAKE_VIEWER, setGhIssues } from '../e2e/fake-gh';
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

// ---- a spy on the file system ----

const nodeRequire = createRequire(import.meta.url);

/** The functions of node:fs and node:fs/promises that take a path and look at it: a read, a listing, a look at the file, an open. (The no-write scan shows that the server has no function that writes.) */
const FS_LOOKERS = ['readFile', 'readFileSync', 'open', 'openSync', 'opendir', 'opendirSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'exists', 'existsSync', 'realpath', 'realpathSync', 'readlink', 'readlinkSync', 'createReadStream', 'glob', 'globSync'];

/**
 * Records the path of every call that looks at the file system, from now until `stop()`. It wraps the functions of the two modules in place and has the ES module
 * wrappers follow (`syncBuiltinESMExports`), so the server code that imported them by name calls the wrappers. A test of an answer cannot see a read whose result is
 * thrown away (an `exists` check, a read that is not shown), and this can.
 */
function watchFileLooks(): { paths: string[]; stop(): void } {
  const paths: string[] = [];
  const undo: (() => void)[] = [];
  for (const moduleName of ['node:fs', 'node:fs/promises']) {
    const owner = nodeRequire(moduleName) as Record<string, unknown>;
    for (const name of FS_LOOKERS) {
      const original = owner[name];
      if (typeof original !== 'function') continue;
      owner[name] = function (this: unknown, ...args: unknown[]) {
        paths.push(String(args[0]));
        return (original as (...all: unknown[]) => unknown).apply(this, args);
      };
      undo.push(() => {
        owner[name] = original;
      });
    }
  }
  syncBuiltinESMExports();
  return {
    paths,
    stop() {
      for (const restore of undo.splice(0)) restore();
      syncBuiltinESMExports();
    },
  };
}

/** A path as one text for a comparison: forward slashes, lower case. */
const flat = (path: string): string => path.replace(/\\/g, '/').toLowerCase();

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
    // Both lists are of the issues of Mark's account (`--author`): the template gives its label to an issue of any author, and a list holds 100 issues, so the
    // issues of strangers must not use the places of his (see the flood test below).
    expect(lists).toEqual([
      ['issue', 'list', '--repo', repo, '--label', 'decision', '--author', MARK_LOGIN, '--state', 'open', '--limit', '100', '--json', DECISION_FIELDS],
      ['issue', 'list', '--repo', repo, '--label', 'decided', '--author', MARK_LOGIN, '--state', 'all', '--limit', '100', '--json', DECISION_FIELDS],
    ]);
    // Every call that it made is a read.
    expect(rig.writes()).toEqual([]);
  });

  it('a flood of issues from strangers cannot push the decisions of Mark out of the list', async () => {
    // GitHub gives the label of the template to an issue of any author, and `gh issue list` holds 100 issues. A stranger who opens 150 issues from the template, all newer than
    // the decision of Mark, would fill the list, and Mark's decision would be missing with no error: no page, no banner, and a panel that says it is fine.
    const stranger = SEED.issues.find((issue) => issue.number === 42);
    if (stranger === undefined) throw new Error('no issue 42');
    const flood = Array.from({ length: 150 }, (_all, i) => ({
      ...stranger,
      number: 100 + i,
      title: `Decision: Flood ${i + 1}`,
      url: `https://github.com/fixture-owner/fixture-repo/issues/${100 + i}`,
      createdAt: '2026-10-05T20:00:00Z',
      comments: [],
      events: [],
    }));
    const rig = rigOf({ store: { ...SEED, issues: [...SEED.issues, ...flood] } });
    const info = await infoOf(rig);
    expect(numbers(info.open)).toEqual([41, 43, 46, 47]);
    expect(numbers(info.recent)).toEqual([44]);
    // The page of the decision, and the banner on its doc, are still there.
    expect((await detailOf(rig, 41)).status).toBe(200);
    const doc = dataOf((await (await rig.get('/api/docs/guides/setup')).json()) as Panel<DocPageData>);
    expect(doc.decisions?.some((banner) => banner.number === 41)).toBe(true);
  });

  it('does not list a pull request of Mark\'s that carries the label: gh issue view opens pull requests too, and the parser refuses them', async () => {
    // (gh issue list does not list pull requests, so this is the second line of defense: the fake lists it as a real list never would.)
    const template = SEED.issues.find((issue) => issue.number === 41);
    if (template === undefined) throw new Error('no issue 41');
    const pull = { ...template, number: 60, title: 'A pull request with the label', url: 'https://github.com/fixture-owner/fixture-repo/pull/60' };
    const rig = rigOf({ store: { ...SEED, issues: [...SEED.issues, pull] } });
    expect(numbers((await infoOf(rig)).open)).toEqual([41, 43, 46, 47]);
    expect((await detailOf(rig, 60)).status).toBe(404);
  });

  it('still leaves out an issue of another author that gh gave, because the filter of gh is not the only check', async () => {
    // The author is checked by the parser as well: if gh, or the fake, returned a stranger's issue in the list, it would not be a decision.
    const rig = rigOf();
    const stranger = SEED.issues.find((issue) => issue.number === 42);
    if (stranger === undefined) throw new Error('no issue 42');
    const { events: _events, ...printed } = stranger;
    setRigMode(rig, { mode: 'ok', replies: { 'issue list': { stdout: JSON.stringify([printed]) } } });
    expect(await infoOf(rig)).toEqual({ open: [], recent: [] });
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

  it('reads all the comments of an issue that the list cut short: a flood of comments from a stranger cannot hide the answer of Mark', async () => {
    // `gh issue list` prints the first 100 comments of an issue. A stranger can write 100 comments before Mark answers, and his answer is then the 101st: the list never shows it.
    // The module asks for the whole issue when the list is full, so the answer is found. (The fake gh cuts the list at 100, as the real one does.)
    const noise = (count: number) => Array.from({ length: count }, (_all, i) => ({ author: { login: 'fixture-stranger' }, body: `Noise ${i + 1}`, createdAt: '2026-10-05T09:00:00Z' }));
    const answerAt = { author: { login: FAKE_VIEWER }, body: 'Decision: B. Found after the noise.', createdAt: '2026-10-05T15:12:09Z' };
    const flooded = SEED.issues.map((issue) => {
      if (issue.number === 44) return { ...issue, comments: [...noise(104), answerAt] }; // answered: closed, labelled by Mark
      if (issue.number === 41) return { ...issue, comments: [...noise(120), { ...answerAt, body: 'Decision: C. Half an answer, after the noise.' }] }; // open, with the comment and nothing else
      return issue;
    });
    const rig = rigOf({ store: { ...SEED, issues: flooded } });
    const info = await infoOf(rig);
    expect(issueOf(info.recent, 44)).toMatchObject({ state: 'answered', answer: { option: 'B', note: 'Found after the noise.', complete: true } });
    expect(issueOf(info.open, 41)).toMatchObject({ state: 'open', answer: { option: 'C', complete: false } });
    // It asked for the whole issue for the two that were full, and for no other.
    const viewed = rig.calls().filter((call) => call.args[1] === 'view').map((call) => call.args.slice(2).join(' '));
    expect(viewed.sort()).toEqual([`--repo ${rig.config.githubRepo} 41 --json comments`, `--repo ${rig.config.githubRepo} 44 --json comments`]);
  });

  it('does not read the whole issue for a stranger whose issue is full of comments: that costs nothing', async () => {
    // Anyone can open an issue with the label of the template and a hundred comments. It is left out after the list, with no call for it.
    const noisy = SEED.issues.map((issue) =>
      issue.number === 42 ? { ...issue, comments: Array.from({ length: 150 }, (_all, i) => ({ author: { login: 'fixture-stranger' }, body: `Noise ${i + 1}`, createdAt: '2026-10-05T09:00:00Z' })) } : issue,
    );
    const rig = rigOf({ store: { ...SEED, issues: noisy } });
    expect(numbers((await infoOf(rig)).open)).toEqual([41, 43, 46, 47]);
    expect(rig.calls().filter((call) => call.args[1] === 'view')).toEqual([]);
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

  it('a link that names a path outside the docs reads no file: the page looks in the doc index only, and a spy on the file system sees no read', async () => {
    // No route takes a path: the doc and the heading of a link are looked up in the doc index, which is a map of the docs that it scanned. Each link below names a file that is on the disk
    // and is not a doc, or a file outside the repo, and each of those files holds a marker. Two things show that nothing is read: the marker is in no answer, and the spy sees no look at the disk.
    const MARKER = 'CANARY-NOT-A-DOC';
    const outsideName = `cc-canary-outside-${randomUUID()}.md`;
    const links = [
      `../${outsideName}#x`, // up out of the repo: dropped (the file is in the folder above the repo)
      '/etc/passwd#root', // read as the repo path "etc/passwd" (a link may start with a slash, as on GitHub)
      'secret.txt#x',
      '.env.local#x',
      'private/notes.md#x', // markdown, in a folder that is not docs/
      'node_modules/pkg/README.md#x',
      'C:\\Windows\\win.ini#x', // a drive: dropped
      'docs/../../../hosts#y', // up out of the repo: dropped
      'docs/guides/setup.md#installing', // a real doc: it is in the index
    ];
    const hostile = SEED.issues.map((issue) =>
      issue.number === 43
        ? { ...issue, body: `${issue.body.split('## Docs')[0]}## Docs\n\n${links.map((link) => `- ${link}`).join('\n')}\n\n## Raised by\n\nSession.\n` }
        : issue,
    );
    const rig = rigOf({ store: { ...SEED, issues: hostile } });
    const outsideFile = join(dirname(rig.repo.dir), outsideName);
    try {
      writeFileSync(outsideFile, `# Outside\n\n## x\n\n${MARKER} outside\n`);
      for (const path of ['etc/passwd', 'secret.txt', '.env.local']) rig.repo.write(path, `${MARKER} ${path}`);
      for (const path of ['private/notes.md', 'node_modules/pkg/README.md']) rig.repo.write(path, `# Notes\n\n## x\n\n${MARKER} ${path}\n`);
      await rig.index.ready(); // the scan reads the docs once, before the spy starts

      const watch = watchFileLooks();
      let looked: string[];
      let control: string[];
      let detail: DecisionDetail;
      let doc: DocPageData;
      try {
        await rig.decisions.get(true);
        detail = dataOf((await detailOf(rig, 43)).panel);
        doc = dataOf((await (await rig.get('/api/docs/guides/setup')).json()) as Panel<DocPageData>);
        looked = [...watch.paths];
        await rig.index.refresh(); // the control: this is a read, and the spy must see it
        control = watch.paths.slice(looked.length);
      } finally {
        watch.stop();
      }

      // The links that go up out of the repo, and the one with a drive, are not links to a doc of the repo. The others stay inside it, and a file that no doc has gives an empty section.
      expect(detail.docs.map((link) => `${link.docId}#${link.anchor}`)).toEqual([
        'etc/passwd#root',
        'secret.txt#x',
        '.env.local#x',
        'private/notes.md#x',
        'node_modules/pkg/README.md#x',
        'docs/guides/setup.md#installing',
      ]);
      expect(detail.sections.map((section) => [section.docId, section.heading, section.html === null])).toEqual([
        ['etc/passwd', null, true],
        ['secret.txt', null, true],
        ['.env.local', null, true],
        ['private/notes.md', null, true],
        ['node_modules/pkg/README.md', null, true],
        ['docs/guides/setup.md', 'Installing', false],
      ]);
      // The marker of a file is in no answer: not on the page of the decision, and not on the doc page with its banners.
      expect(JSON.stringify([detail, doc])).not.toContain(MARKER);

      // The spy saw no look at the repo folder, and none at a file that a link names (a read whose result is not shown would not be in an answer).
      const named = /(?:^|\/)(?:passwd|win\.ini|hosts|secret\.txt|\.env\.local|notes\.md|readme\.md)$|cc-canary-outside-/;
      const inRepo = (path: string): boolean => flat(path).startsWith(flat(rig.repo.dir));
      expect(looked.filter((path) => inRepo(path) || named.test(flat(path)))).toEqual([]);
      // The control: the spy does see the index read the repo folder, so the empty list above is not a spy that sees nothing.
      expect(control.filter(inRepo).length).toBeGreaterThan(0);
    } finally {
      rmSync(outsideFile, { force: true });
    }
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
