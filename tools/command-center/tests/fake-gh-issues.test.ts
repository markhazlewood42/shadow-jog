import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_VIEWER, type GhIssueStore, createFakeGh, readGhCalls, readGhIssues, resetGh, setGhIssues, setGhMode } from '../e2e/fake-gh';
import { DECISION_FIELDS } from '../src/server/decisions/parse';
import { createRunner } from '../src/server/runner';
import { PACKAGE_DIR, makeTestConfig } from './helpers';

// The issue store of the fake gh. The end-to-end tests of the decision inbox need a gh that remembers: after
// the page posts an answer (a comment, a label swap and a close) the next read must show the answer, as the
// real GitHub does, and a retry after a failed write must find what the first try already did. So the fake holds
// issues in a file, answers the reads of the decisions module from it, and applies the three writes to it.
// The fixture (fixtures/gh/issues.json) is made up.

const dir = mkdtempSync(join(tmpdir(), 'cc-fake-gh-issues-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = makeTestConfig();
const REPO = config.githubRepo;
const SEED = JSON.parse(readFileSync(join(PACKAGE_DIR, 'fixtures', 'gh', 'issues.json'), 'utf8')) as GhIssueStore;
const fake = createFakeGh(dir);
const where = { cwd: config.repoRoot, timeoutMs: 5000 };
const gh = (...args: string[]) => fake('gh', args, where);
const json = async (...args: string[]) => JSON.parse((await gh(...args)).stdout) as unknown;

type Listed = { number: number; [field: string]: unknown };
const numbers = async (...args: string[]) => ((await json('issue', 'list', '--repo', REPO, ...args)) as Listed[]).map((issue) => issue.number);

beforeEach(() => {
  resetGh(dir);
  setGhIssues(SEED, dir);
});

describe('the issue store of the fake gh: reads', () => {
  it('keeps the old answers when there is no store: empty data', async () => {
    resetGh(dir);
    expect(await gh('issue', 'list', '--repo', REPO, '--json', 'number')).toEqual({ code: 0, stdout: '[]', stderr: '' });
    expect(await gh('issue', 'view', '--repo', REPO, '41', '--json', 'number')).toEqual({ code: 0, stdout: '{}', stderr: '' });
    expect(readGhIssues(dir)).toBeNull();
  });

  it('lists the issues of a state and a label, the newest first, up to the limit', async () => {
    // The state is open when no --state is given, as in gh.
    expect(await numbers('--label', 'decision', '--json', 'number')).toEqual([47, 46, 43, 42, 41]);
    expect(await numbers('--label', 'decision', '--state', 'open', '--json', 'number')).toEqual([47, 46, 43, 42, 41]);
    expect(await numbers('--label', 'decided', '--state', 'closed', '--json', 'number')).toEqual([45, 44, 40]);
    expect(await numbers('--label', 'decided', '--state', 'all', '--json', 'number')).toEqual([45, 44, 40]);
    expect(await numbers('--state', 'all', '--json', 'number')).toEqual([47, 46, 45, 44, 43, 42, 41, 40]);
    expect(await numbers('--state', 'all', '--limit', '3', '--json', 'number')).toEqual([47, 46, 45]);
    // A label is matched without regard to case, as GitHub does.
    expect(await numbers('--label', 'Decision', '--json', 'number')).toEqual([47, 46, 43, 42, 41]);
    // Every --label must be on the issue.
    expect(await numbers('--label', 'decision', '--label', 'decided', '--state', 'all', '--json', 'number')).toEqual([]);
  });

  it('lists only the issues of the author that --author names, with no regard to case, and the limit counts after that', async () => {
    // The labels of a stranger's issue and Mark's are the same; the author is what tells them apart. (The search of GitHub, which gh uses for a label, also takes the author.)
    expect(await numbers('--label', 'decision', '--author', 'markhazlewood42', '--json', 'number')).toEqual([47, 46, 43, 41]);
    expect(await numbers('--label', 'decision', '--author', 'MarkHazlewood42', '--json', 'number')).toEqual([47, 46, 43, 41]);
    expect(await numbers('--label', 'decision', '--author', 'fixture-stranger', '--json', 'number')).toEqual([42]);
    expect(await numbers('--label', 'decision', '--author', 'nobody', '--json', 'number')).toEqual([]);
    expect(await numbers('--author', 'markhazlewood42', '--state', 'all', '--json', 'number')).toEqual([47, 46, 45, 44, 43, 41, 40]); // all of Mark's, 42 is not
    // The limit is applied to the issues of that author, not to all the issues: two of Mark's, though a newer issue of a stranger is in the way.
    const flooded = { ...SEED, issues: [...SEED.issues, ...Array.from({ length: 5 }, (_all, i) => ({ ...(SEED.issues[2] as (typeof SEED.issues)[number]), number: 200 + i }))] };
    setGhIssues(flooded, dir);
    expect(await numbers('--label', 'decision', '--limit', '2', '--json', 'number')).toEqual([204, 203]);
    expect(await numbers('--label', 'decision', '--author', 'markhazlewood42', '--limit', '2', '--json', 'number')).toEqual([47, 46]);
  });

  it('prints the fields that --json asks for and no others, and never the events', async () => {
    const [issue] = (await json('issue', 'list', '--repo', REPO, '--label', 'decision', '--json', 'number,title,state')) as Listed[];
    expect(Object.keys(issue ?? {}).sort()).toEqual(['number', 'state', 'title']);
    // The fields that the decisions module asks for are all there: a module that forgets one gets nothing for it, as with gh.
    const [full] = (await json('issue', 'list', '--repo', REPO, '--label', 'decision', '--json', DECISION_FIELDS)) as Listed[];
    expect(Object.keys(full ?? {}).sort()).toEqual(DECISION_FIELDS.split(',').sort());
    expect(JSON.stringify(full)).not.toContain('"events"');
  });

  it('lists the first 100 comments of an issue and no more, as gh does, and views all of them', async () => {
    // Real gh: `gh issue list --json comments` stops at the first 100 comments of each issue (checked on a public issue with 149), and `gh issue view` pages through all.
    const flooded = SEED.issues.map((issue) =>
      issue.number === 41 ? { ...issue, comments: Array.from({ length: 130 }, (_all, i) => ({ author: { login: 'fixture-stranger' }, body: `Comment ${i + 1}`, createdAt: '2026-10-05T10:00:00Z' })) } : issue,
    );
    setGhIssues({ ...SEED, issues: flooded }, dir);
    const listed = (await json('issue', 'list', '--repo', REPO, '--label', 'decision', '--json', 'number,comments')) as { number: number; comments: { body: string }[] }[];
    const first = listed.find((issue) => issue.number === 41);
    expect(first?.comments).toHaveLength(100);
    expect(first?.comments.at(-1)?.body).toBe('Comment 100');
    expect(listed.find((issue) => issue.number === 43)?.comments).toHaveLength(1); // an issue with fewer is whole
    const viewed = (await json('issue', 'view', '--repo', REPO, '41', '--json', 'comments')) as { comments: { body: string }[] };
    expect(viewed.comments).toHaveLength(130);
    expect(viewed.comments.at(-1)?.body).toBe('Comment 130');
  });

  it('views one issue by its number, and says what gh says for a number that no issue has', async () => {
    const issue = (await json('issue', 'view', '--repo', REPO, '44', '--json', 'number,state,labels')) as { number: number; state: string; labels: { name: string }[] };
    expect(issue.number).toBe(44);
    expect(issue.state).toBe('CLOSED');
    expect(issue.labels.map((label) => label.name)).toEqual(['decided']);

    const missing = await gh('issue', 'view', '--repo', REPO, '999', '--json', 'number');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Could not resolve to an issue or pull request with the number of 999');
  });

  it('gives the events of an issue as a list of pages with --slurp, and as a plain list without it', async () => {
    const stored = SEED.issues.find((issue) => issue.number === 44)?.events ?? [];
    expect(stored.length).toBeGreaterThan(0);
    expect(await json('api', `repos/${REPO}/issues/44/events`, '--paginate', '--slurp')).toEqual([stored]);
    expect(await json('api', `repos/${REPO}/issues/44/events`, '--paginate')).toEqual(stored);
    expect(await json('api', `repos/${REPO}/issues/44/events`)).toEqual(stored);

    const missing = await gh('api', `repos/${REPO}/issues/999/events`, '--paginate', '--slurp');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Not Found');
  });

  it('a reply that a test sets wins over the store', async () => {
    setGhMode({ mode: 'ok', replies: { 'issue view 44': { stdout: '{"number":44,"title":"from the reply"}' } } }, dir);
    expect(await json('issue', 'view', '--repo', REPO, '44', '--json', 'number,title')).toEqual({ number: 44, title: 'from the reply' });
    expect(((await json('issue', 'view', '--repo', REPO, '41', '--json', 'number')) as Listed).number).toBe(41); // another number: the store
  });
});

describe('the issue store of the fake gh: the three writes', () => {
  const comment = (number: number, body: string) => gh('issue', 'comment', '--repo', REPO, String(number), '--body', body);
  const edit = (number: number) => gh('issue', 'edit', '--repo', REPO, String(number), '--add-label', 'decided', '--remove-label', 'decision');
  const close = (number: number) => gh('issue', 'close', '--repo', REPO, String(number));
  const issue = (number: number) => {
    const found = readGhIssues(dir)?.issues.find((entry) => entry.number === number);
    if (found === undefined) throw new Error(`the store has no issue ${number}`);
    return found;
  };

  it('a comment is added by the signed-in account, with the time it was made', async () => {
    const before = issue(41).comments.length;
    const result = await comment(41, 'Decision: C. Because.');
    expect(result.code).toBe(0);
    const added = issue(41).comments.at(-1) as { author: { login: string }; body: string; createdAt: string; url: string };
    expect(issue(41).comments).toHaveLength(before + 1);
    expect(added).toMatchObject({ author: { login: FAKE_VIEWER }, body: 'Decision: C. Because.' });
    expect(Number.isNaN(Date.parse(added.createdAt))).toBe(false);
    expect(result.stdout).toBe(added.url);
    // What the reads then say.
    const [viewed] = [(await json('issue', 'view', '--repo', REPO, '41', '--json', 'comments')) as { comments: { body: string }[] }];
    expect(viewed.comments.at(-1)?.body).toBe('Decision: C. Because.');
  });

  it('the label swap puts the label decided on and takes the label decision off, and leaves the two events of Mark', async () => {
    const result = await edit(41);
    expect(result.code).toBe(0);
    expect(issue(41).labels.map((label) => label.name)).toEqual(['decided']);
    const events = issue(41).events.slice(-2) as { event: string; label: { name: string }; actor: { login: string } }[];
    expect(events.map((event) => [event.event, event.label.name, event.actor.login])).toEqual([
      ['labeled', 'decided', FAKE_VIEWER],
      ['unlabeled', 'decision', FAKE_VIEWER],
    ]);
    // The new label shows in the list of the label, and not in the list of the old one.
    expect(await numbers('--label', 'decision', '--json', 'number')).not.toContain(41);
    expect(await numbers('--label', 'decided', '--state', 'all', '--json', 'number')).toContain(41);
  });

  it('a close closes the issue and leaves a closed event, and closing a closed issue changes nothing', async () => {
    expect((await close(41)).code).toBe(0);
    expect(issue(41).state).toBe('CLOSED');
    expect((issue(41).events.at(-1) as { event: string }).event).toBe('closed');
    const eventCount = issue(41).events.length;
    const again = await close(41);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/already closed/);
    expect(issue(41).events).toHaveLength(eventCount);
  });

  it('refuses a label that the repo does not have, as gh does, and changes nothing', async () => {
    setGhIssues({ ...SEED, labels: ['decision'] }, dir);
    const before = JSON.stringify(readGhIssues(dir));
    const result = await edit(41);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^failed to update https:\/\/github\.com\/.+\/issues\/41: 'decided' not found/);
    expect(JSON.stringify(readGhIssues(dir))).toBe(before);
  });

  it('says what gh says for an issue that is not there, for each write', async () => {
    for (const result of [await comment(999, 'x'), await edit(999), await close(999)]) {
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Could not resolve to an issue or pull request with the number of 999');
    }
  });

  it('write-fails: the write that fails changes nothing, and the others still work on the store', async () => {
    setGhMode({ mode: 'write-fails', step: 'edit' }, dir);
    expect((await comment(41, 'Decision: A.')).code).toBe(0);
    const failed = await edit(41);
    expect(failed.code).toBe(1);
    expect(issue(41).labels.map((label) => label.name)).toEqual(['decision']); // the failed write left the labels alone
    expect(issue(41).comments.at(-1)).toMatchObject({ body: 'Decision: A.' }); // the comment before it is there
    setGhMode({ mode: 'ok' }, dir);
    expect((await edit(41)).code).toBe(0);
    expect(issue(41).labels.map((label) => label.name)).toEqual(['decided']);
  });

  it('records every call, with the arguments the runner gave, so a test can count the writes', async () => {
    const runner = createRunner(config, fake);
    await runner('gh', ['issue', 'comment', '41', '--body', 'Decision: A']);
    await runner('gh', ['issue', 'edit', '41', '--add-label', 'decided', '--remove-label', 'decision']);
    await runner('gh', ['issue', 'close', '41']);
    expect(readGhCalls(dir).map((call) => call.args.slice(0, 2).join(' '))).toEqual(['issue comment', 'issue edit', 'issue close']);
    expect(readGhCalls(dir)[0]?.args).toEqual(['issue', 'comment', '--repo', REPO, '41', '--body', 'Decision: A']);
  });

  it('resetGh removes the store, and a store that cannot be read is an error, not an empty answer', async () => {
    resetGh(dir);
    expect(existsSync(join(dir, 'gh-issues.json'))).toBe(false);
    setGhIssues(SEED, dir);
    rmSync(join(dir, 'gh-mode.json'), { force: true });
    // A store with no issue list is a mistake of the test, and the fake says so.
    setGhIssues({ labels: [] } as unknown as GhIssueStore, dir);
    await expect(gh('issue', 'list', '--repo', REPO, '--json', 'number')).rejects.toThrow(/gh-issues\.json/);
  });
});
