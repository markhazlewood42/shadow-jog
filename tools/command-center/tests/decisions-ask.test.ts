import { afterEach, describe, expect, it } from 'vitest';
import { type DecisionsInfo, MAX_NOTE_CHARS, type Panel } from '../src/shared/types';
import type { Exec } from '../src/server/runner';
import { type DecisionsRig, SEED, makeDecisionsRig, setRigMode } from './decisions-rig';

// The local route of the Ask for more info: `POST /api/decisions/<n>/ask` (docs/command-center/needs-info-brief.md). It runs the real route over the real runner with its
// allow-list and the fake gh that remembers its issues, like tests/decisions-answer.test.ts. The hosted twin is tested in tests/vercel-ask.test.ts.

const rigs: DecisionsRig[] = [];
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.close();
});
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
function rigOf(options: Parameters<typeof makeDecisionsRig>[0] = {}): DecisionsRig {
  const rig = makeDecisionsRig(options);
  rigs.push(rig);
  return rig;
}

type Body = Record<string, unknown> & { ok?: boolean; step?: string; error?: { code: string; message: string } };
const bodyOf = async (res: Response): Promise<Body> => (await res.json()) as Body;

/** A POST to the ask route with everything right (host, same origin, token, JSON); `headers` changes or removes one (undefined removes). */
function postAsk(rig: DecisionsRig, number: number | string, body: unknown, headers: Record<string, string | undefined> = {}, method = 'POST'): Promise<Response> {
  const host = `localhost:${rig.config.port}`;
  const all: Record<string, string | undefined> = { host, origin: `http://${host}`, 'content-type': 'application/json', 'x-cc-token': rig.token, ...headers };
  const sent = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return Promise.resolve(rig.app.request(`/api/decisions/${number}/ask`, { method, headers: sent, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }));
}

const issueOf = (rig: DecisionsRig, number: number) => {
  const found = rig.issues().issues.find((issue) => issue.number === number);
  if (found === undefined) throw new Error(`no issue ${number}`);
  return found;
};
const commentsOf = (rig: DecisionsRig, number: number) => (issueOf(rig, number).comments ?? []) as { author: { login: string }; body: string }[];
const labelsOf = (rig: DecisionsRig, number: number) => issueOf(rig, number).labels.map((label) => label.name);
/** The gh calls that wrote, as their words after `--repo <repo>`: `issue edit 41 --add-label needs-info`. */
const writesWith = (rig: DecisionsRig): string[] =>
  rig
    .calls()
    .filter((call) => /^issue (comment|edit|close)$/.test(call.args.slice(0, 2).join(' ')))
    .map((call) => call.args.filter((arg, index) => !(arg === '--repo' || call.args[index - 1] === '--repo')).join(' '));

describe('POST /api/decisions/<n>/ask', () => {
  it('pass line 1: writes a Question: comment and then the label needs-info, and leaves the issue open with decision, with no decided and no close', async () => {
    const rig = rigOf();
    const res = await postAsk(rig, 41, { note: 'What does C cost to undo?' });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });
    expect(writesWith(rig)).toEqual(['issue comment 41 --body Question: What does C cost to undo?', 'issue edit 41 --add-label needs-info']);
    expect(issueOf(rig, 41).state).toBe('OPEN');
    expect(labelsOf(rig, 41)).toEqual(['decision', 'needs-info']);
    const comments = commentsOf(rig, 41);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ author: { login: 'markhazlewood42' }, body: 'Question: What does C cost to undo?' });
  });

  it('makes line breaks one kind and trims the ends', async () => {
    const rig = rigOf();
    expect((await postAsk(rig, 41, { note: '  one\r\ntwo\r  ' })).status).toBe(200);
    expect(commentsOf(rig, 41)[0]?.body).toBe('Question: one\ntwo');
  });

  it('the list then shows the decision as waiting for info, with the question in the thread', async () => {
    const rig = rigOf();
    await postAsk(rig, 41, { note: 'Why?' });
    const panel = (await (await rig.get('/api/decisions')).json()) as Panel<DecisionsInfo>;
    const issue = panel.ok ? panel.data.open.find((candidate) => candidate.number === 41) : undefined;
    expect(issue?.phase).toBe('needs-info');
    expect(issue?.thread?.map((entry) => [entry.kind, entry.text])).toEqual([['question', 'Why?']]);
  });

  it('pass line 2: an issue that is closed, answered, a stranger\'s or missing writes nothing (404 or 409)', async () => {
    const rig = rigOf();
    const expected: [number, number, string][] = [
      [44, 409, 'already-answered'],
      [45, 409, 'not-open'],
      [42, 404, 'decision-not-found'],
      [999, 404, 'decision-not-found'],
    ];
    for (const [number, status, code] of expected) {
      const res = await postAsk(rig, number, { note: 'Why?' });
      expect(res.status, String(number)).toBe(status);
      expect((await bodyOf(res)).error?.code, String(number)).toBe(code);
    }
    expect(rig.writes()).toEqual([]);
  });

  it('an open issue by Mark that has decided and not decision gives 409 not-a-decision and writes nothing', async () => {
    const source = SEED.issues.find((issue) => issue.number === 44);
    if (source === undefined) throw new Error('no issue 44');
    // Open, but an answer stopped after the label swap: `decided` is on and `decision` is off.
    const bare = { ...structuredClone(source), number: 56, state: 'OPEN' as const };
    const rig = rigOf({ store: { ...SEED, issues: [...SEED.issues, bare] } });
    const res = await postAsk(rig, 56, { note: 'Why?' });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('not-a-decision');
    expect(rig.writes()).toEqual([]);
  });

  it('two asks at once give one comment and one 409 answer-in-progress, and the lock is let go after', async () => {
    const rig = rigOf({
      wrapExec: (fake): Exec => async (cmd, args, o) => {
        if (args[0] === 'issue' && args[1] === 'comment') await wait(150);
        return fake(cmd, args, o);
      },
    });
    const [first, second] = await Promise.all([postAsk(rig, 41, { note: 'Why?' }), postAsk(rig, 41, { note: 'Why?' })]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const refused = first.status === 409 ? first : second;
    expect((await bodyOf(refused)).error?.code).toBe('answer-in-progress');
    expect(commentsOf(rig, 41)).toHaveLength(1);
    expect((await postAsk(rig, 41, { note: 'Why?' })).status).toBe(200); // the lock was let go
    expect(commentsOf(rig, 41)).toHaveLength(1);
  });

  it.each([
    ['an option', { note: 'x', option: 'A' }, 422],
    ['no note', {}, 422],
    ['an empty note', { note: '' }, 422],
    ['a note of only spaces', { note: '  \n ' }, 422],
    ['a note that is not text', { note: 5 }, 422],
    ['a note over the limit', { note: 'x'.repeat(MAX_NOTE_CHARS + 1) }, 422],
    ['a note with a control character', { note: 'a\u0000b' }, 422],
    ['a body that is not an object', [], 422],
    ['a body that is not JSON', 'not json {', 400],
  ])('pass line 2: %s gives %i and writes nothing', async (_name, body, status) => {
    const rig = rigOf();
    const res = await postAsk(rig, 41, body);
    expect(res.status).toBe(status);
    expect(rig.calls()).toEqual([]); // not even a read: the body is wrong
  });

  it.each([[[]], [null], ['"text"'], [5]])('a body that is not an object (%j) gives 422 with the ask message and writes nothing', async (body) => {
    const rig = rigOf();
    const res = await postAsk(rig, 41, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'bad-request', message: expect.stringContaining('A question needs text') } });
    expect(rig.calls()).toEqual([]);
  });

  it('pass line 3: the guards of the answer route run for the ask route too: token, same origin, JSON, method, and one write at a time', async () => {
    const rig = rigOf();
    expect((await postAsk(rig, 41, { note: 'x' }, { 'x-cc-token': undefined })).status).toBe(403);
    expect((await postAsk(rig, 41, { note: 'x' }, { 'x-cc-token': 'wrong' })).status).toBe(403);
    expect((await postAsk(rig, 41, { note: 'x' }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await postAsk(rig, 41, { note: 'x' }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await postAsk(rig, 41, { note: 'x' }, { host: 'evil.example' })).status).toBe(403);
    const get = await postAsk(rig, 41, null, {}, 'GET');
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST');
    // Same as the answer route: a path with no issue number is not a write path at all (405 from the method gate).
    expect((await postAsk(rig, 'abc', { note: 'x' })).status).toBe(405);
    expect(rig.writes()).toEqual([]);
  });

  it('pass line 9: when the label step fails the comment stays and a Retry adds the label only', async () => {
    const rig = rigOf();
    setRigMode(rig, { mode: 'write-fails', step: 'edit' });
    const failed = await postAsk(rig, 41, { note: 'Why?' });
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'label' });
    expect(commentsOf(rig, 41)).toHaveLength(1);
    expect(labelsOf(rig, 41)).toEqual(['decision']);

    setRigMode(rig, { mode: 'ok' });
    expect((await postAsk(rig, 41, { note: 'Why?' })).status).toBe(200);
    expect(commentsOf(rig, 41)).toHaveLength(1); // no second Question: comment
    expect(labelsOf(rig, 41)).toEqual(['decision', 'needs-info']);
  });

  it('pass line 9: when the comment step fails nothing is written, and a Retry writes the comment once', async () => {
    const rig = rigOf();
    setRigMode(rig, { mode: 'write-fails', step: 'comment' });
    const failed = await postAsk(rig, 41, { note: 'Why?' });
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'comment' });
    expect(commentsOf(rig, 41)).toHaveLength(0);
    expect(labelsOf(rig, 41)).toEqual(['decision']);
    setRigMode(rig, { mode: 'ok' });
    expect((await postAsk(rig, 41, { note: 'Why?' })).status).toBe(200);
    expect(commentsOf(rig, 41)).toHaveLength(1);
  });
});

describe('an answer on a decision that has needs-info (step 0)', () => {
  it('takes the label off first, then writes the comment, the label swap and the close', async () => {
    const rig = rigOf();
    await postAsk(rig, 41, { note: 'Why?' });
    const before = writesWith(rig).length;
    expect((await rig.post(41, { option: 'B', note: 'ok' })).status).toBe(200);
    expect(writesWith(rig).slice(before)).toEqual([
      'issue edit 41 --remove-label needs-info',
      'issue comment 41 --body Decision: B. ok',
      'issue edit 41 --add-label decided --remove-label decision',
      'issue close 41',
    ]);
    expect(labelsOf(rig, 41)).toEqual(['decided']);
    expect(issueOf(rig, 41).state).toBe('CLOSED');
  });

  it('pass line 9: a Retry after step 0 makes no second label removal and no second Decision: comment', async () => {
    const rig = rigOf();
    await postAsk(rig, 41, { note: 'Why?' });
    setRigMode(rig, { mode: 'write-fails', step: 'comment' });
    const failed = await rig.post(41, { option: 'B' });
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'comment' });
    setRigMode(rig, { mode: 'ok' });
    expect((await rig.post(41, { option: 'B' })).status).toBe(200);
    const removals = writesWith(rig).filter((words) => words === 'issue edit 41 --remove-label needs-info');
    expect(removals).toHaveLength(1);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(1);
  });

  it('a failure at step 0 writes nothing else and names the step unflag', async () => {
    const rig = rigOf();
    await postAsk(rig, 41, { note: 'Why?' });
    const before = writesWith(rig).length;
    setRigMode(rig, { mode: 'write-fails', step: 'edit' });
    const failed = await rig.post(41, { option: 'B' });
    expect(failed.status).toBe(502);
    expect(await bodyOf(failed)).toMatchObject({ ok: false, step: 'unflag' });
    expect(writesWith(rig).slice(before)).toEqual(['issue edit 41 --remove-label needs-info']);
    expect(commentsOf(rig, 41).filter((comment) => comment.body.startsWith('Decision:'))).toHaveLength(0);
  });
});
