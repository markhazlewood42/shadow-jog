import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_VIEWER, createFakeGh, readGhCalls, resetGh, setGhIssues, setGhMode } from '../e2e/fake-gh';
import { answerDecision, checkAnswer } from '../src/server/decisions/answer';
import { readDecision } from '../src/server/decisions/module';
import { parseDecisionIssue } from '../src/server/decisions/parse';
import { compose } from '../src/server/compose';
import { type Exec, createRunner } from '../src/server/runner';
import { type DecisionsInfo, MAX_NOTE_CHARS, type Panel } from '../src/shared/types';
import { type DecisionsRig, SEED, SETUP_DOC, makeDecisionsRig, setRigMode } from './decisions-rig';
import { PACKAGE_DIR, makeTestConfig } from './helpers';
import { makeDocsRepo } from './doc-index-helpers';

// The one write of the command center: Mark's answer to a decision. These tests run the real route
// (`POST /api/decisions/<n>/answer`), over the real runner with its allow-list, and a fake gh that
// remembers its issues (e2e/fake-gh.ts), so what the route writes can be read back. No test writes to GitHub.
//
// The route does five things, and each one has its tests:
//   1. The guards (token, same origin, JSON, method): "the real answer route, through the whole server".
//   2. It reads the issue again from GitHub, and does not trust the list that the page has (R19).
//   3. It refuses what it must: an issue that is not Mark's decision (404), an issue that is answered or
//      closed, or that another answer is writing now (409), an option that the issue does not have (422).
//   4. It makes the three writes in order (a comment, the label swap, the close), and a retry starts at the first
//      one that is not done.
//   5. It looks at GitHub again at once, so that every page sees the answer.

const rigs: DecisionsRig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.close();
});
function rigOf(options: Parameters<typeof makeDecisionsRig>[0] = {}): DecisionsRig {
  const rig = makeDecisionsRig(options);
  rigs.push(rig);
  return rig;
}

type Body = Record<string, unknown> & { ok?: boolean; step?: string; error?: { code: string; message: string } };
const bodyOf = async (res: Response): Promise<Body> => (await res.json()) as Body;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** The comments that the fake repository holds for an issue, newest last. */
const commentsOf = (rig: DecisionsRig, number: number) => (rig.issues().issues.find((issue) => issue.number === number)?.comments ?? []) as { author: { login: string }; body: string }[];
const labelsOf = (rig: DecisionsRig, number: number) => (rig.issues().issues.find((issue) => issue.number === number)?.labels ?? []).map((label) => label.name);

/** An issue of the fake repository as it is now, split into what gh prints for the issue and what it prints for the events. */
function storedIssue(rig: DecisionsRig, number: number) {
  const found = rig.issues().issues.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`the fake repository has no issue ${number}`);
  const { events, ...issue } = found;
  return { issue, events };
}

describe('POST /api/decisions/<n>/answer: what it refuses', () => {
  it('POST: an option not in the issue gets 422 and an already answered issue gets 409', async () => {
    const rig = rigOf();

    // Issue 41 has the options A, B and C. Any other id gets 422, and nothing is written. An id is exact: "a" is not "A".
    for (const option of ['Z', 'D', 'a', 'AB', 'A ', '1']) {
      const res = await rig.post(41, { option });
      expect(res.status, JSON.stringify(option)).toBe(422);
      const body = await bodyOf(res);
      expect(body).toMatchObject({ ok: false, error: { code: 'unknown-option' } });
      expect(body.error?.message).toContain('A, B, C'); // it names the options that the issue has
    }
    expect(rig.writes()).toEqual([]);

    // Issue 44 is answered (closed, a Decision: comment of Mark's, and the label that he put on): 409, and nothing is written.
    const answered = await rig.post(44, { option: 'A' });
    expect(answered.status).toBe(409);
    expect(await bodyOf(answered)).toMatchObject({ ok: false, error: { code: 'already-answered' } });
    expect(rig.writes()).toEqual([]);

    // An issue that the answer has just been written to is answered too: the same answer twice is 409, and no second comment is written.
    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(200);
    const again = await rig.post(41, { option: 'C', note: 'Because.' });
    expect(again.status).toBe(409);
    expect(await bodyOf(again)).toMatchObject({ error: { code: 'already-answered' } });
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue close']);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
  });

  it('an issue that is closed and not answered gets 409: the page offers no answer for it, and the route writes none', async () => {
    const rig = rigOf();
    // Issue 45: closed, with a comment of Mark's, but the label decided was put on by another account.
    const res = await rig.post(45, { option: 'A' });
    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toMatchObject({ ok: false, error: { code: 'not-open' } });
    expect(rig.writes()).toEqual([]);
  });

  it('an issue that is not a decision of Mark gets 404, and nothing is written', async () => {
    const rig = rigOf();
    // 42: the issue of a stranger, with the label decision on it (GitHub puts the label of the template on any issue made from it). 999: no such issue.
    for (const number of [42, 999, 1]) {
      const res = await rig.post(number, { option: 'A' });
      expect(res.status, `issue ${number}`).toBe(404);
      expect(await bodyOf(res), `issue ${number}`).toMatchObject({ ok: false, error: { code: 'decision-not-found' } });
    }
    // A decision of Mark's with the answer of a look-alike login in it is a decision that is still open: it can be answered.
    expect((await rig.post(43, { option: 'A' })).status).toBe(200);
    expect(commentsOf(rig, 42)).toHaveLength(1); // the stranger's comment is the only one: nothing was added
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue close']); // all three from the one answer to issue 43
  });

  it('a pull request of Mark\'s that carries the label gets 404: gh issue view opens pull requests, and the route must not comment on one, relabel it or close it', async () => {
    const template = SEED.issues.find((issue) => issue.number === 41);
    if (template === undefined) throw new Error('no issue 41');
    const pull = { ...template, number: 60, title: 'A pull request with the label', url: 'https://github.com/fixture-owner/fixture-repo/pull/60' };
    const rig = rigOf({ store: { ...SEED, issues: [...SEED.issues, pull] } });
    const res = await rig.post(60, { option: 'A', note: 'Merge it.' });
    expect(res.status).toBe(404);
    expect(await bodyOf(res)).toMatchObject({ ok: false, error: { code: 'decision-not-found' } });
    expect(rig.writes()).toEqual([]);
    expect(commentsOf(rig, 60)).toHaveLength(0);
    expect(rig.issues().issues.find((issue) => issue.number === 60)).toMatchObject({ state: 'OPEN' });
    // The same number as an issue (not a pull request) is answered as usual.
    const issue = { ...pull, url: 'https://github.com/fixture-owner/fixture-repo/issues/60' };
    const other = rigOf({ store: { ...SEED, issues: [...SEED.issues, issue] } });
    expect((await other.post(60, { option: 'A' })).status).toBe(200);
  });

  it('an issue with no options (a body outside the template) gets 422: there is nothing to pick', async () => {
    const rig = rigOf();
    const res = await rig.post(46, { option: 'A' });
    expect(res.status).toBe(422);
    expect(await bodyOf(res)).toMatchObject({ ok: false, error: { code: 'unknown-option' } });
    expect(rig.writes()).toEqual([]);
  });

  it('a body that is not a request gets 400 or 422 before GitHub is asked anything', async () => {
    const rig = rigOf();
    const bad: [unknown, number, string][] = [
      ['not json {', 400, 'bad-json'],
      ['', 400, 'bad-json'],
      ['null', 400, 'bad-request'],
      ['[]', 400, 'bad-request'],
      ['"A"', 400, 'bad-request'],
      [{}, 400, 'bad-request'],
      [{ option: 5 }, 400, 'bad-request'],
      [{ option: '' }, 400, 'bad-request'],
      [{ option: 'A', note: 5 }, 400, 'bad-request'],
      [{ option: 'A', note: ['x'] }, 400, 'bad-request'],
      [{ option: 'A', note: 'x'.repeat(MAX_NOTE_CHARS + 1) }, 422, 'note-too-long'],
      [{ option: 'A', note: 'a null \u0000 character' }, 422, 'bad-note'],
      [{ option: 'A', note: 'a bell \u0007' }, 422, 'bad-note'],
    ];
    for (const [body, status, code] of bad) {
      const res = await rig.post(41, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(status);
      expect((await bodyOf(res)).error?.code, JSON.stringify(body).slice(0, 60)).toBe(code);
    }
    expect(rig.calls()).toEqual([]); // not one call to gh: the body is checked first
  });

  it('a body of more than 16 KB gets 413 and is not read', async () => {
    const rig = rigOf();
    const res = await rig.post(41, JSON.stringify({ option: 'A', note: 'x'.repeat(20_000) }));
    expect(res.status).toBe(413);
    expect(await bodyOf(res)).toMatchObject({ ok: false, error: { code: 'too-large' } });
    expect(rig.calls()).toEqual([]);
  });

  it('a number that is not a plain issue number is not an answer route', async () => {
    const rig = rigOf();
    // The method gate lets only POST /api/decisions/<digits>/answer through; a number that is too big for gh is not an issue.
    for (const number of ['0', '00', '99999999999999999999', '2147483648']) {
      const res = await rig.post(number, { option: 'A' });
      expect(res.status, number).toBe(404);
    }
    expect(rig.calls()).toEqual([]);
  });
});

describe('POST /api/decisions/<n>/answer: the three writes', () => {
  it('writes the comment, then the label swap, then the close, each in its one allowed shape, and the answer reads back as answered', async () => {
    const rig = rigOf();
    const res = await rig.post(41, { option: 'C', note: 'Because it keeps the cache over a restart.' });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });

    // The reads come first (the issue and its events, as the route reads them again), then the three writes in order.
    const repo = rig.config.githubRepo;
    const calls = rig.calls().map((call) => call.args);
    const writes = calls.filter((args) => ['comment', 'edit', 'close'].includes(args[1] ?? ''));
    expect(writes).toEqual([
      ['issue', 'comment', '--repo', repo, '41', '--body', 'Decision: C. Because it keeps the cache over a restart.'],
      ['issue', 'edit', '--repo', repo, '41', '--add-label', 'decided', '--remove-label', 'decision'],
      ['issue', 'close', '--repo', repo, '41'],
    ]);
    expect(calls[0]?.slice(0, 5)).toEqual(['issue', 'view', '--repo', repo, '41']);
    expect(calls[1]).toEqual(['api', `repos/${repo}/issues/41/events`, '--paginate', '--slurp']);

    // What GitHub holds now, read back through the same trust rules as the page uses: answered, with this option and this note, by Mark.
    const { issue, events } = storedIssue(rig, 41);
    expect(issue.state).toBe('CLOSED');
    expect(labelsOf(rig, 41)).toEqual(['decided']);
    expect(commentsOf(rig, 41).at(-1)).toMatchObject({ author: { login: FAKE_VIEWER }, body: 'Decision: C. Because it keeps the cache over a restart.' });
    expect(parseDecisionIssue(issue, events)).toMatchObject({ state: 'answered', answer: { option: 'C', note: 'Because it keeps the cache over a restart.', complete: true } });
  });

  it('sends a note of the longest length and refuses one character more, with the one number that the form uses too', async () => {
    const rig = rigOf();
    expect((await rig.post(41, { option: 'A', note: 'x'.repeat(MAX_NOTE_CHARS + 1) })).status).toBe(422);
    expect(rig.writes()).toEqual([]);
    expect((await rig.post(41, { option: 'A', note: 'x'.repeat(MAX_NOTE_CHARS) })).status).toBe(200);
    expect(commentsOf(rig, 41).at(-1)?.body).toBe(`Decision: A. ${'x'.repeat(MAX_NOTE_CHARS)}`);
  });

  it('writes no dot and no note when there is no note, and trims a note', async () => {
    const rig = rigOf();
    expect((await rig.post(41, { option: 'B' })).status).toBe(200);
    expect(commentsOf(rig, 41).at(-1)?.body).toBe('Decision: B');
    expect((await rig.post(43, { option: 'A', note: '   \n  ' })).status).toBe(200);
    expect(commentsOf(rig, 43).at(-1)?.body).toBe('Decision: A');
    // A note with two lines keeps them, and the white space around it goes.
    const other = rigOf();
    expect((await other.post(41, { option: 'A', note: '  Line one.\nLine two.  ' })).status).toBe(200);
    expect(commentsOf(other, 41).at(-1)?.body).toBe('Decision: A. Line one.\nLine two.');
  });

  it('a retry resumes at the first step that did not finish', async () => {
    // The label swap fails after the comment is posted. The retry must not post the comment again.
    const rig = rigOf();
    setRigMode(rig, { mode: 'write-fails', step: 'edit' });
    const failed = await rig.post(41, { option: 'C', note: 'Because.' });
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'label', error: { code: 'gh-failed', message: expect.stringContaining('failed to change the labels') } });
    expect(rig.writes()).toEqual(['issue comment', 'issue edit']);
    // The comment is on the issue, and the issue is still open with its label: an answer that stopped half way.
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
    expect(labelsOf(rig, 41)).toEqual(['decision']);

    setRigMode(rig, { mode: 'ok' });
    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(200);
    // One comment in all. The label swap ran twice (the failed one, and the one that worked) and the close once.
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue edit', 'issue close']);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
    expect(labelsOf(rig, 41)).toEqual(['decided']);
    expect(rig.issues().issues.find((issue) => issue.number === 41)?.state).toBe('CLOSED');

    // The close fails after the comment and the label swap: the retry runs the close and nothing else.
    const closing = rigOf();
    setRigMode(closing, { mode: 'write-fails', step: 'close' });
    const stopped = await closing.post(41, { option: 'A' });
    expect(stopped.status).toBe(502);
    expect(await bodyOf(stopped)).toMatchObject({ ok: false, step: 'close', error: { code: 'gh-failed' } });
    expect(closing.writes()).toEqual(['issue comment', 'issue edit', 'issue close']);
    expect(labelsOf(closing, 41)).toEqual(['decided']); // the issue is open and has the label decided: it is in no list of the label decision any more
    setRigMode(closing, { mode: 'ok' });
    expect((await closing.post(41, { option: 'A' })).status).toBe(200);
    expect(closing.writes()).toEqual(['issue comment', 'issue edit', 'issue close', 'issue close']);

    // The comment fails: nothing is written, and the retry starts at the comment.
    const first = rigOf();
    setRigMode(first, { mode: 'write-fails', step: 'comment' });
    const none = await first.post(41, { option: 'B' });
    expect(none.status).toBe(502);
    expect(await bodyOf(none)).toMatchObject({ ok: false, step: 'comment' });
    expect(commentsOf(first, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(0);
    setRigMode(first, { mode: 'ok' });
    expect((await first.post(41, { option: 'B' })).status).toBe(200);
    expect(first.writes()).toEqual(['issue comment', 'issue comment', 'issue edit', 'issue close']);
  });

  it('a retry with another option or another note posts a new comment: the newest one is the answer', async () => {
    const rig = rigOf();
    setRigMode(rig, { mode: 'write-fails', step: 'edit' });
    expect((await rig.post(41, { option: 'A', note: 'First thought.' })).status).toBe(502);
    setRigMode(rig, { mode: 'ok' });
    expect((await rig.post(41, { option: 'B', note: 'Second thought.' })).status).toBe(200);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:')).map((comment) => comment.body)).toEqual(['Decision: A. First thought.', 'Decision: B. Second thought.']);
    const { issue, events } = storedIssue(rig, 41);
    expect(parseDecisionIssue(issue, events)?.answer).toMatchObject({ option: 'B', note: 'Second thought.', complete: true });
  });

  it('an issue that already has the label decided from another account gets a new labeled event by Mark from the answer, and reads back as answered', async () => {
    // Issue 41 with the label decided on it, put there by another account, and the label decision still on. GitHub makes no event for a
    // label that is already on, so a bare --add-label would leave the label as that account's, and the answer could never be trusted.
    const template = SEED.issues.find((issue) => issue.number === 41);
    const forged = SEED.issues.find((issue) => issue.number === 45);
    if (template === undefined || forged === undefined) throw new Error('no issue 41 or 45');
    const decidedLabel = forged.labels.find((label) => label.name === 'decided');
    const forgedEvent = forged.events.find((event) => (event as { event?: string; label?: { name?: string } }).event === 'labeled' && (event as { label?: { name?: string } }).label?.name === 'decided');
    if (decidedLabel === undefined || forgedEvent === undefined) throw new Error('issue 45 has no decided label');
    const stale = { ...template, number: 61, labels: [...template.labels, decidedLabel], events: [...template.events, forgedEvent] };
    const rig = rigOf({ store: { ...SEED, issues: [...SEED.issues, stale] } });

    // Before the answer: open, and not answered (the label is not Mark's).
    const before = storedIssue(rig, 61);
    expect(parseDecisionIssue(before.issue, before.events)).toMatchObject({ state: 'open' });

    const res = await rig.post(61, { option: 'B', note: 'Because.' });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });

    // The comment, then decided off, then decided on with decision off, then the close.
    const repo = rig.config.githubRepo;
    const writes = rig.calls().map((call) => call.args).filter((args) => ['comment', 'edit', 'close'].includes(args[1] ?? ''));
    expect(writes).toEqual([
      ['issue', 'comment', '--repo', repo, '61', '--body', 'Decision: B. Because.'],
      ['issue', 'edit', '--repo', repo, '61', '--remove-label', 'decided'],
      ['issue', 'edit', '--repo', repo, '61', '--add-label', 'decided', '--remove-label', 'decision'],
      ['issue', 'close', '--repo', repo, '61'],
    ]);
    expect(labelsOf(rig, 61)).toEqual(['decided']);

    // The newest labeled event of decided is Mark's, and the issue reads back as answered.
    const { issue, events } = storedIssue(rig, 61);
    const decidedEvents = (events as { event: string; actor: { login: string }; label?: { name: string } }[]).filter((event) => event.label?.name === 'decided');
    expect(decidedEvents.map((event) => [event.event, event.actor.login])).toEqual([['labeled', 'fixture-collaborator'], ['unlabeled', FAKE_VIEWER], ['labeled', FAKE_VIEWER]]);
    expect(parseDecisionIssue(issue, events)).toMatchObject({ state: 'answered', answer: { option: 'B', note: 'Because.', complete: true } });
  });

  it('the label decided that is already by Mark is not taken off: the answer makes one label call', async () => {
    // The close failed on an earlier try: decided is Mark's, decision is off, the issue is open. The retry runs the close only.
    const rig = rigOf();
    setRigMode(rig, { mode: 'write-fails', step: 'close' });
    expect((await rig.post(41, { option: 'A' })).status).toBe(502);
    setRigMode(rig, { mode: 'ok' });
    expect((await rig.post(41, { option: 'A' })).status).toBe(200);
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue close', 'issue close']);
  });

  it('a missing label decided gives an error that names it', async () => {
    // The repository has the label decision and no label decided. gh says "'decided' not found" and changes nothing.
    const rig = rigOf({ store: { ...SEED, labels: ['decision'] } });
    const res = await rig.post(41, { option: 'C', note: 'Because.' });
    expect(res.status).toBe(502);
    const body = await bodyOf(res);
    expect(body).toMatchObject({ ok: false, step: 'label', error: { code: 'label-missing' } });
    expect(body.error?.message).toContain('"decided"');
    expect(body.error?.message).toContain(rig.config.githubRepo);
    expect(body.error?.message).toMatch(/comment/i); // it says that the comment is already posted, so a retry will not post it again
    expect(rig.writes()).toEqual(['issue comment', 'issue edit']);
    expect(labelsOf(rig, 41)).toEqual(['decision']);

    // Mark makes the label. The retry finishes the answer, and posts no second comment.
    setGhIssues({ ...rig.issues(), labels: ['decision', 'decided'] }, rig.ghDir);
    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(200);
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue edit', 'issue close']);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
  });

  it('names what went wrong when gh cannot be used: not signed in, offline, missing, too slow', async () => {
    const cases = [
      ['signed-out', 'gh-not-signed-in'],
      ['offline', 'gh-offline'],
      ['missing', 'gh-missing'],
      ['timeout', 'gh-timeout'],
    ] as const;
    for (const [mode, code] of cases) {
      const rig = rigOf();
      setRigMode(rig, { mode });
      const res = await rig.post(41, { option: 'A' });
      // gh fails at the very first call (the read of the issue), so no write was tried: there is no step.
      expect(res.status, mode).toBe(502);
      const body = await bodyOf(res);
      expect(body, mode).toMatchObject({ ok: false, error: { code } });
      expect(body.step, mode).toBeUndefined();
      expect(rig.writes(), mode).toEqual([]);
    }
  });
});

describe('POST /api/decisions/<n>/answer: it reads the issue again', () => {
  it('does not trust the list that the page has: an issue that was answered since the last load gets 409', async () => {
    const rig = rigOf();
    await rig.decisions.get(true);
    // The cache (what the page shows) has issue 41 as open ...
    const cached = (await rig.decisions.get()) as Panel<DecisionsInfo>;
    expect(cached.ok && cached.data.open.map((issue) => issue.number)).toContain(41);
    // ... and then Mark answers it from GitHub itself, or from another computer. The cache is up to 60 s old.
    const before = rig.calls().length;
    const store = rig.issues();
    const stored = store.issues.find((issue) => issue.number === 41);
    if (stored === undefined) throw new Error('no issue 41');
    stored.comments.push({ author: { login: FAKE_VIEWER }, body: 'Decision: A. From GitHub.', createdAt: '2026-10-06T11:59:00Z' });
    stored.labels = [{ name: 'decided' }];
    stored.state = 'CLOSED';
    stored.events.push({ event: 'labeled', label: { name: 'decided' }, actor: { login: FAKE_VIEWER }, created_at: '2026-10-06T11:59:01Z' });
    setGhIssues(store, rig.ghDir);

    const res = await rig.post(41, { option: 'B' });
    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toMatchObject({ error: { code: 'already-answered' } });
    expect(rig.writes()).toEqual([]);
    // It asked GitHub: the issue and its events.
    expect(rig.calls().slice(before).map((call) => call.args.slice(0, 2).join(' '))).toEqual(['issue view', `api repos/${rig.config.githubRepo}/issues/41/events`]);
  });

  it('works for an issue that the list has never seen, because it asks about that one issue', async () => {
    const rig = rigOf();
    // Nothing has been loaded: the cache of the module is empty, as for an issue that an agent raised a second ago.
    expect(rig.calls()).toEqual([]);
    expect((await rig.post(41, { option: 'A' })).status).toBe(200);
    // The write reads the issue (view and events) before it writes, and then looks at the lists again.
    const words = rig.calls().map((call) => call.args.slice(0, 2).join(' '));
    expect(words.slice(0, 2)).toEqual(['issue view', `api repos/${rig.config.githubRepo}/issues/41/events`]);
    expect(words.slice(2, 5)).toEqual(['issue comment', 'issue edit', 'issue close']);
  });

  it('a stranger cannot make an issue answerable by putting the label decision on it, or an answer on it: only the author counts', async () => {
    const rig = rigOf();
    // 42 has the label and a "Decision: A" comment from a stranger. 43 has one from a look-alike login, and is still Mark's open decision.
    expect((await rig.post(42, { option: 'A' })).status).toBe(404);
    const open = await rig.post(43, { option: 'B', note: 'Mine.' });
    expect(open.status).toBe(200);
    // The comments of the look-alike are not touched, and the answer of Mark's is the newest trusted one.
    expect(commentsOf(rig, 43).map((comment) => comment.author.login)).toEqual(['markhazlewood-42', FAKE_VIEWER]);
  });

  it('readDecision gives null for an issue that is not there and for one that is not a decision of Mark, and throws for a gh that fails', async () => {
    const rig = rigOf();
    expect(await readDecision(rig.config, rig.runner, 999)).toBeNull();
    expect(await readDecision(rig.config, rig.runner, 42)).toBeNull();
    const read = await readDecision(rig.config, rig.runner, 41);
    expect(read?.issue).toMatchObject({ number: 41, state: 'open' });
    expect(read?.progress).toEqual({ comment: null, labelsSwapped: false, closed: false });
    setRigMode(rig, { mode: 'offline' });
    await expect(readDecision(rig.config, rig.runner, 41)).rejects.toMatchObject({ code: 'gh-offline' });
  });
});

describe('POST /api/decisions/<n>/answer: one answer at a time, and the list at once', () => {
  it('two POSTs at once give one comment and one 409', async () => {
    // The fake gh is slow to write a comment, so the first answer is still running when the second arrives (a double click, or a second tab).
    const rig = rigOf({
      wrapExec: (fake): Exec => async (cmd, args, o) => {
        if (args[0] === 'issue' && args[1] === 'comment') await wait(150);
        return fake(cmd, args, o);
      },
    });
    const [first, second] = await Promise.all([rig.post(41, { option: 'C', note: 'Because.' }), rig.post(41, { option: 'C', note: 'Because.' })]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const refused = first.status === 409 ? first : second;
    expect(await bodyOf(refused)).toMatchObject({ ok: false, error: { code: 'answer-in-progress' } });

    // One comment, one label swap, one close: the second POST wrote nothing.
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue close']);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
    // And a third one later is told that the decision is answered, not that one is running.
    expect(await bodyOf(await rig.post(41, { option: 'C', note: 'Because.' }))).toMatchObject({ error: { code: 'already-answered' } });
  });

  it('two answers for different issues run at the same time', async () => {
    const rig = rigOf({
      wrapExec: (fake): Exec => async (cmd, args, o) => {
        if (args[0] === 'issue' && args[1] === 'comment') await wait(100);
        return fake(cmd, args, o);
      },
    });
    const [a, b] = await Promise.all([rig.post(41, { option: 'A' }), rig.post(43, { option: 'B' })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(commentsOf(rig, 41).at(-1)?.body).toBe('Decision: A');
    expect(commentsOf(rig, 43).at(-1)?.body).toBe('Decision: B');
  });

  it('lets the next answer in when one has ended, whether it worked, failed or was refused', async () => {
    const rig = rigOf();
    expect((await rig.post(41, { option: 'Z' })).status).toBe(422); // refused
    setRigMode(rig, { mode: 'write-fails', step: 'comment' });
    expect((await rig.post(41, { option: 'A' })).status).toBe(502); // failed
    setRigMode(rig, { mode: 'ok' });
    expect((await rig.post(41, { option: 'A' })).status).toBe(200); // not "in progress": the lock was let go each time
  });

  it('a successful answer refreshes the source at once', async () => {
    const rig = rigOf();
    const changes: string[] = [];
    rig.hub.subscribe((event) => changes.push(event.module));
    const first = (await rig.decisions.get(true)) as Panel<DecisionsInfo>;
    expect(first.ok && first.data.open.map((issue) => issue.number)).toContain(41);
    expect(first.ok && first.data.recent.map((issue) => issue.number)).toEqual([44]);
    const listCalls = () => rig.calls().filter((call) => call.args[0] === 'issue' && call.args[1] === 'list').length;
    const before = listCalls();
    changes.length = 0;

    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(200);

    // The route asked GitHub for both lists again before it answered, so no timer and no refresh of the page is needed.
    expect(listCalls()).toBe(before + 2);
    const now = (await rig.decisions.get()) as Panel<DecisionsInfo>; // from the source, not from a new load
    expect(listCalls()).toBe(before + 2);
    expect(now.ok && now.data.open.map((issue) => issue.number)).not.toContain(41);
    expect(now.ok && now.data.recent.map((issue) => issue.number).sort()).toEqual([41, 44]);
    expect(now.ok && now.data.recent.find((issue) => issue.number === 41)).toMatchObject({ state: 'answered', answer: { option: 'C', note: 'Because.', complete: true } });
    // The open pages hear that the decisions changed.
    expect(changes).toContain('decisions');
  });

  it('refreshes the source after an answer that stopped half way too, because GitHub has changed', async () => {
    const rig = rigOf();
    await rig.decisions.get(true);
    const before = rig.calls().filter((call) => call.args[1] === 'list').length;
    setRigMode(rig, { mode: 'write-fails', step: 'edit' });
    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(502);
    expect(rig.calls().filter((call) => call.args[1] === 'list').length).toBe(before + 2);
    // The list shows the half answer: open, with an answer that is not complete.
    const panel = (await rig.decisions.get()) as Panel<DecisionsInfo>;
    const issue = panel.ok ? panel.data.open.find((candidate) => candidate.number === 41) : undefined;
    expect(issue).toMatchObject({ state: 'open', answer: { option: 'C', complete: false } });
  });

  it('keeps a decision in the list when its answer stopped at the close: the issue has the label decided now, and is still open', async () => {
    // The label swap worked and the close did not. The issue is open and has "decided" (not "decision"), so it is in the list of neither "open decision"
    // issues nor "closed" ones. The module reads the issues with the label decided in every state, so the page of the decision does not turn into "not found" under Mark's form.
    const rig = rigOf();
    await rig.decisions.get(true);
    setRigMode(rig, { mode: 'write-fails', step: 'close' });
    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(502);
    expect(labelsOf(rig, 41)).toEqual(['decided']);
    const panel = (await rig.decisions.get()) as Panel<DecisionsInfo>;
    expect(panel.ok && panel.data.open.find((issue) => issue.number === 41)).toMatchObject({ state: 'open', answer: { option: 'C', note: 'Because.', complete: false } });
    // The page of the decision is still there, and the retry finishes the answer.
    const page = await rig.get('/api/decisions/41');
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ ok: true, data: { number: 41, state: 'open' } });
    setRigMode(rig, { mode: 'ok' });
    expect((await rig.post(41, { option: 'C', note: 'Because.' })).status).toBe(200);
    expect(rig.writes()).toEqual(['issue comment', 'issue edit', 'issue close', 'issue close']);
    const done = (await rig.decisions.get()) as Panel<DecisionsInfo>;
    expect(done.ok && done.data.recent.find((issue) => issue.number === 41)).toMatchObject({ state: 'answered', answer: { complete: true } });
  });

  it('does not refresh the source after an answer that was refused, because nothing was written', async () => {
    const rig = rigOf();
    await rig.decisions.get(true);
    const before = rig.calls().length;
    expect((await rig.post(41, { option: 'Z' })).status).toBe(422);
    expect(rig.calls().slice(before).map((call) => call.args[1])).toEqual(['view', `repos/${rig.config.githubRepo}/issues/41/events`]); // only the two reads of the issue
  });
});

describe('answerDecision and checkAnswer', () => {
  /** A runner over the fake gh, in a folder of its own. */
  function runnerOver(dir: string) {
    const config = makeTestConfig();
    return { config, runner: createRunner(config, createFakeGh(dir)) };
  }
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function rigDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cc-answer-'));
    dirs.push(dir);
    resetGh(dir);
    setGhIssues(SEED, dir);
    return dir;
  }
  const words = (dir: string) => readGhCalls(dir).map((call) => call.args.slice(0, 2).join(' '));

  it('runs the three steps in order, and from a later step only the steps from there on', async () => {
    const dir = rigDir();
    const { config, runner } = runnerOver(dir);
    expect(await answerDecision({ config, runner, number: 41, option: 'A', note: 'x' })).toEqual({ ok: true });
    expect(words(dir)).toEqual(['issue comment', 'issue edit', 'issue close']);

    const later = rigDir();
    const over = runnerOver(later);
    expect(await answerDecision({ ...over, number: 43, option: 'A', from: 'label' })).toEqual({ ok: true });
    expect(words(later)).toEqual(['issue edit', 'issue close']);
    const last = rigDir();
    const lastOver = runnerOver(last);
    expect(await answerDecision({ ...lastOver, number: 43, option: 'A', from: 'close' })).toEqual({ ok: true });
    expect(words(last)).toEqual(['issue close']);
  });

  it('stops at the first step that fails, and says which one, with a named error', async () => {
    for (const step of ['comment', 'edit', 'close'] as const) {
      const dir = rigDir();
      const { config, runner } = runnerOver(dir);
      setGhMode({ mode: 'write-fails', step }, dir);
      const result = await answerDecision({ config, runner, number: 41, option: 'A' });
      const names = { comment: 'comment', edit: 'label', close: 'close' } as const;
      expect(result).toMatchObject({ ok: false, step: names[step], error: { code: 'gh-failed' } });
      // The steps after it were not tried.
      expect(words(dir)).toEqual(['issue comment', 'issue edit', 'issue close'].slice(0, ['comment', 'edit', 'close'].indexOf(step) + 1));
    }
  });

  it('checkAnswer: not found, not open, no such option, and the first step still to do', () => {
    const issue = (state: 'open' | 'answered' | 'closed') => ({
      issue: {
        number: 7, title: 'T', url: '', state, question: 'Q', context: null, options: [{ id: 'A', text: 'one' }, { id: 'B', text: 'two' }], recommended: null, docs: [],
        raisedBy: null, waitsOn: null, createdAt: '', answer: null, problem: null,
      },
      progress: { comment: null, labelsSwapped: false, closed: state !== 'open' },
      staleDecided: false,
    });
    expect(checkAnswer(null, 'A', null)).toMatchObject({ ok: false, status: 404, code: 'decision-not-found' });
    expect(checkAnswer(issue('answered'), 'A', null)).toMatchObject({ ok: false, status: 409, code: 'already-answered' });
    expect(checkAnswer(issue('closed'), 'A', null)).toMatchObject({ ok: false, status: 409, code: 'not-open' });
    expect(checkAnswer(issue('open'), 'C', null)).toMatchObject({ ok: false, status: 422, code: 'unknown-option' });
    expect(checkAnswer(issue('open'), 'A', null)).toEqual({ ok: true, from: 'comment' });

    const written = (comment: { option: string; note: string | null } | null, labelsSwapped: boolean) => ({ ...issue('open'), progress: { comment, labelsSwapped, closed: false } });
    // The comment is there and says what is asked: go on at the label. The same with the label swapped: go on at the close.
    expect(checkAnswer(written({ option: 'A', note: 'x' }, false), 'A', 'x')).toEqual({ ok: true, from: 'label' });
    expect(checkAnswer(written({ option: 'A', note: 'x' }, true), 'A', 'x')).toEqual({ ok: true, from: 'close' });
    // A comment with another option or another note is not this answer: write it again, so that the newest comment is the one that Mark means now.
    expect(checkAnswer(written({ option: 'B', note: 'x' }, true), 'A', 'x')).toEqual({ ok: true, from: 'comment' });
    expect(checkAnswer(written({ option: 'A', note: 'y' }, true), 'A', 'x')).toEqual({ ok: true, from: 'comment' });
    expect(checkAnswer(written({ option: 'A', note: null }, false), 'A', null)).toEqual({ ok: true, from: 'label' });
    // The label is swapped but there is no comment: it starts at the comment.
    expect(checkAnswer(written(null, true), 'A', null)).toEqual({ ok: true, from: 'comment' });
    // The label decided is on the issue and another account put it on: the label step must take it off first.
    expect(checkAnswer({ ...written({ option: 'A', note: null }, false), staleDecided: true }, 'A', null)).toEqual({ ok: true, from: 'label', clearDecided: true });
  });

  it('answerDecision: with clearDecided the label step takes decided off first and then swaps, and the steps before it are not run', async () => {
    const dir = rigDir();
    const { config, runner } = runnerOver(dir);
    expect(await answerDecision({ config, runner, number: 41, option: 'A', clearDecided: true })).toEqual({ ok: true });
    const writes = readGhCalls(dir).map((call) => call.args.slice(0, 2).join(' ') + ' ' + call.args.filter((arg) => arg.startsWith('--') && arg !== '--repo').join(' '));
    expect(writes).toEqual([
      'issue comment --body',
      'issue edit --remove-label',
      'issue edit --add-label --remove-label',
      'issue close ',
    ]);
  });
});

// ---- the whole server ----

describe('the real answer route, through the whole server', () => {
  let ghDir = '';
  let stop: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await stop?.();
    stop = null;
    if (ghDir !== '') rmSync(ghDir, { recursive: true, force: true });
    ghDir = '';
  });

  /** The server as `npm run cc` composes it: the real app, guards and routes, over the real runner and the fake gh. */
  async function server(options: { slowComment?: boolean } = {}) {
    ghDir = mkdtempSync(join(tmpdir(), 'cc-answer-server-'));
    resetGh(ghDir);
    setGhIssues(SEED, ghDir);
    const repo = makeDocsRepo({ 'docs/guides/setup.md': SETUP_DOC });
    const fake = createFakeGh(ghDir);
    const runner = createRunner(repo.config, async (cmd, args, o) => {
      if (cmd !== 'gh') throw new Error('no git here');
      // A slow comment keeps the first answer running while the second one arrives.
      if (options.slowComment && args[0] === 'issue' && args[1] === 'comment') await wait(150);
      return fake(cmd, args, o);
    });
    const composed = compose({ config: repo.config, runner, webRoot: join(PACKAGE_DIR, 'src', 'web'), navFile: repo.navFile, refreshGapMs: 0 });
    stop = async () => {
      await composed.stop();
      repo.close();
    };
    const host = `localhost:${repo.config.port}`;
    // The token that a page of this run holds.
    const page = await composed.app.request('/', { headers: { host } });
    const token = /<meta name="cc-token" content="([^"]*)"/.exec(await page.text())?.[1] ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const request = (path: string, init: { method?: string; headers?: Record<string, string | undefined>; body?: string } = {}) => {
      const headers = Object.fromEntries(Object.entries({ host, ...init.headers }).filter((entry): entry is [string, string] => entry[1] !== undefined));
      return Promise.resolve(composed.app.request(path, { method: init.method ?? 'GET', headers, ...(init.body === undefined ? {} : { body: init.body }) }));
    };
    const post = (headers: Record<string, string | undefined> = {}, body = '{"option":"A"}') =>
      request('/api/decisions/41/answer', { method: 'POST', body, headers: { origin: `http://${host}`, 'content-type': 'application/json', 'x-cc-token': token, ...headers } });
    return { app: composed.app as Hono, host, token, request, post, calls: () => readGhCalls(ghDir) };
  }

  it('POST without a token gets 403, a wrong token gets 403, and a foreign Origin gets 403', async () => {
    const { post, token, calls } = await server();

    // No token, an empty one, and a token of the right length that is not this run's, one that is a little too long, and one that is a little too short.
    for (const wrong of [undefined, '', token.replace(/.$/, token.endsWith('A') ? 'B' : 'A'), `${token}x`, token.slice(0, -1), 'wrong']) {
      const res = await post({ 'x-cc-token': wrong });
      expect(res.status, `token ${JSON.stringify(wrong)}`).toBe(403);
      expect(await bodyOf(res)).toMatchObject({ ok: false, error: { code: 'bad-token' } });
    }

    // With the right token, a request that comes from another site is refused: another web page cannot write.
    for (const headers of [{ origin: 'http://evil.example' }, { origin: 'null' }, { origin: 'https://localhost:3009' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
      const res = await post(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await bodyOf(res), JSON.stringify(headers)).toMatchObject({ ok: false, error: { code: 'cross-site' } });
    }

    // A foreign Host header (DNS rebinding) is refused before anything else.
    const rebound = await post({ host: 'evil.example:3009' });
    expect(rebound.status).toBe(403);
    expect(await bodyOf(rebound)).toMatchObject({ error: { code: 'forbidden-host' } });

    // A body that is not JSON: a plain HTML form can post these to any address.
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', undefined]) {
      const res = await post({ 'content-type': type }, 'option=A');
      expect(res.status, String(type)).toBe(415);
    }

    // Not one call reached gh: no read and no write.
    expect(calls()).toEqual([]);
  });

  it('POST with the right token, the same origin and JSON gets through the guards (so the 403s above are the guards, not a broken route)', async () => {
    const { post, calls } = await server();
    const res = await post();
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });
    // A request with no Origin at all (a script, not a web page) passes when the token is right, as the write guard says.
    expect(calls().filter((call) => call.args[1] === 'comment')).toHaveLength(1);
  });

  it('another method on the answer path gets 405, and the page of the route is not a form', async () => {
    const { request, token, calls } = await server();
    const path = '/api/decisions/41/answer';
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'PROPFIND']) {
      const res = await request(path, { method, headers: { 'x-cc-token': token, 'content-type': 'application/json' } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('POST');
    }
    // The decision page's own data routes take GET only.
    for (const method of ['POST', 'PUT', 'DELETE']) {
      for (const other of ['/api/decisions', '/api/decisions/41']) {
        expect((await request(other, { method, headers: { 'x-cc-token': token, 'content-type': 'application/json' } })).status, `${method} ${other}`).toBe(405);
      }
    }
    expect(calls()).toEqual([]);
  });

  it('refuses a replay: the same request twice writes once, whichever of the two answers first', async () => {
    const { post, calls } = await server({ slowComment: true });
    const [first, second] = await Promise.all([post(), post()]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const third = await post();
    expect(third.status).toBe(409);
    expect(calls().filter((call) => call.args[1] === 'comment')).toHaveLength(1);
    expect(calls().filter((call) => call.args[1] === 'close')).toHaveLength(1);
  });
});
