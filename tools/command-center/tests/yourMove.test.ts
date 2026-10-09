import { describe, expect, it } from 'vitest';
import { type YourMoveSources, buildYourMove } from '../src/server/now/yourMove';
import { type Decision, type DecisionIssue, type DecisionsInfo, type GithubInfo, type Panel, type PullRequest, type SessionInfo, type SessionsInfo, type StatusInfo, type YourMoveBox, sessionAnchor, sessionHref } from '../src/shared/types';

// buildYourMove is a plain function from five panels to the list "Your move" of the Now page, so these tests feed it made-up panels:
// no server, no gh and no session file. Every name, title and line below is synthetic.

const T0 = '2026-10-06T10:00:00.000Z';

const good = <T>(data: T): Panel<T> => ({ ok: true, data, updatedAt: T0 });
const failed = <T>(code: string, message: string, lastGood: T | null = null): Panel<T> => ({
  ok: false,
  error: { code, message },
  updatedAt: lastGood === null ? null : T0,
  lastGood: lastGood === null ? null : { data: lastGood, updatedAt: T0 },
});

// ---- builders for the data of each source: every field has a value, and a test says only what it cares about ----

function issue(number: number, extra: Partial<DecisionIssue> = {}): DecisionIssue {
  return {
    number,
    title: `Decision: Question ${number}?`,
    url: `https://github.com/fixture-owner/fixture-repo/issues/${number}`,
    state: 'open',
    question: `Question ${number}?`,
    context: null,
    options: [{ id: 'A', text: 'Yes' }],
    recommended: null,
    docs: [],
    raisedBy: null,
    waitsOn: null,
    createdAt: '2026-10-05T08:00:00Z',
    answer: null,
    problem: null,
    ...extra,
  };
}

const decisions = (open: DecisionIssue[], recent: DecisionIssue[] = []): DecisionsInfo => ({ open, recent });

function box(extra: Partial<YourMoveBox> = {}): YourMoveBox {
  return { light: 'yellow', items: ['Review the diff'], nothing: false, at: '2026-10-06T09:30:00.000Z', answered: false, ...extra };
}

function session(id: string, extra: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    title: `Title of ${id}`,
    folder: 'fixture-shadow-jog',
    matchedBy: 'folder',
    cwd: '/fixture/repo',
    entrypoint: 'claude-desktop',
    branch: 'fixture-branch',
    startedAt: '2026-10-06T08:00:00.000Z',
    lastActivityAt: '2026-10-06T09:59:00.000Z',
    state: 'waiting',
    prs: [],
    yourMove: null,
    agents: [],
    workflows: [],
    ...extra,
  };
}

const sessionsInfo = (sessions: SessionInfo[]): SessionsInfo => ({ sessions, scanned: sessions.length, skipped: 0, hiddenSdk: 0 });

function pr(number: number, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `Title of PR ${number}`,
    url: `https://github.com/fixture-owner/fixture-repo/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    branch: `branch-${number}`,
    author: 'markhazlewood42',
    updatedAt: '2026-10-06T09:00:00Z',
    mergedAt: null,
    reviewDecision: null,
    reviews: [],
    checks: [],
    checksSummary: 'pass',
    attention: null,
    ...extra,
  };
}

function docDecision(id: string, extra: Partial<Decision> = {}): Decision {
  return {
    id,
    number: id.slice(1),
    source: 'engine',
    question: `Question of ${id}?`,
    answer: 'A',
    milestone: null,
    who: 'Mark',
    option: null,
    status: 'open',
    change: null,
    docSlug: 'engine/decisions',
    anchor: `${id.toLowerCase()}-heading`,
    ...extra,
  };
}

const statusInfo = (texts: string[]): StatusInfo => ({
  updated: '2026-10-06',
  nextUpForMark: texts.map((text) => ({ text, html: `<p>${text}</p>` })),
  milestone: { current: null, problem: null },
  milestones: [],
});

/** Five good panels with nothing in them. A test replaces the ones it cares about. */
function sources(extra: Partial<YourMoveSources> = {}): YourMoveSources {
  return {
    decisionIssues: good(decisions([])),
    sessions: good(sessionsInfo([])),
    status: good(statusInfo([])),
    github: good<GithubInfo>({ open: [], merged: [] }),
    docDecisions: good<Decision[]>([]),
    ...extra,
  };
}

describe('buildYourMove', () => {
  it('your move: open decision issues come first, then unanswered box items of non-idle sessions, PRs with attention, open doc decisions for Mark and status items', () => {
    const result = buildYourMove({
      // The sources are given in the opposite order of the list, so the order of the list cannot be an accident of the order of the arguments.
      status: good(statusInfo(['Pick the gadget color.', 'A short last item.'])),
      docDecisions: good([docDecision('E1', { status: 'approved' }), docDecision('D5', { source: 'phase-0.2', docSlug: 'PHASE-0.2', anchor: 'decisions-for-mark' }), docDecision('E2', { status: 'changed', change: 'edited' }), docDecision('C1', { source: 'engine-update', docSlug: 'engine/README', anchor: null })]),
      github: good<GithubInfo>({
        open: [pr(103, { checksSummary: 'pending' }), pr(101, { attention: 'merge' }), pr(102, { attention: 'fix', checksSummary: 'fail' }), pr(104, { author: 'someone-else' })],
        merged: [pr(100, { state: 'MERGED', attention: null })],
      }),
      sessions: good(
        sessionsInfo([
          session('s-working', { state: 'working', yourMove: box({ light: 'red', items: ['Answer the question', 'Tell me to commit'] }) }),
          session('s-answered', { yourMove: box({ answered: true }) }),
          session('s-idle', { state: 'idle', yourMove: box() }),
          session('s-no-box', { yourMove: null }),
          session('s-waiting', { state: 'waiting', yourMove: box({ light: null, items: ['Look at the picture'], at: '' }) }),
        ]),
      ),
      decisionIssues: good(decisions([issue(41), issue(43, { title: 'Where should the cache go?' })], [issue(44, { state: 'answered' })])),
    });

    expect(result.missing).toEqual([]);
    expect(result.items).toEqual([
      // 1. The open decision issues, oldest question first (the order of the source). The answered one (`recent`) waits for nothing.
      { source: 'decision-issue', text: 'Decision #41: Question 41?', href: '/decisions/41', light: null, at: '2026-10-05T08:00:00Z' },
      { source: 'decision-issue', text: 'Decision #43: Where should the cache go?', href: '/decisions/43', light: null, at: '2026-10-05T08:00:00Z' },
      // 2. One item for each line of the box of a session that is not idle, each linked to the place of its session on the Agents page. The answered box, the idle session and the session with no box give none.
      { source: 'session', text: 'Answer the question (session: Title of s-working)', href: '/agents#session-s-working', light: 'red', at: '2026-10-06T09:30:00.000Z' },
      { source: 'session', text: 'Tell me to commit (session: Title of s-working)', href: '/agents#session-s-working', light: 'red', at: '2026-10-06T09:30:00.000Z' },
      { source: 'session', text: 'Look at the picture (session: Title of s-waiting)', href: '/agents#session-s-waiting', light: null, at: null },
      // 3. The pull requests with attention, in the order of the source. A pull request that is only running its checks, and one of another account, are not in it.
      { source: 'pr', text: 'PR #101 is ready to merge: Title of PR 101', href: 'https://github.com/fixture-owner/fixture-repo/pull/101', light: null, at: '2026-10-06T09:00:00Z' },
      { source: 'pr', text: 'PR #102 needs a fix: Title of PR 102', href: 'https://github.com/fixture-owner/fixture-repo/pull/102', light: null, at: '2026-10-06T09:00:00Z' },
      // 4. The decisions of the docs that are open for Mark, each linked to its heading (or to the doc, when the page has no heading for it).
      { source: 'doc-decision', text: 'Decision D5: Question of D5?', href: '/docs/PHASE-0.2#decisions-for-mark', light: null, at: null },
      { source: 'doc-decision', text: 'Decision C1: Question of C1?', href: '/docs/engine/README', light: null, at: null },
      // 5. The "Next up for Mark" list of status.md, each item linked to the doc.
      { source: 'status', text: 'Pick the gadget color.', href: '/docs/status', light: null, at: null },
      { source: 'status', text: 'A short last item.', href: '/docs/status', light: null, at: null },
    ]);
  });

  it('a "nothing" box gives no item', () => {
    const result = buildYourMove(
      sources({
        sessions: good(
          sessionsInfo([
            session('s-nothing', { yourMove: box({ light: 'green', items: [], nothing: true }) }),
            // A box that says "nothing" has no lines. If one ever came with lines, the word of the box still wins.
            session('s-nothing-with-lines', { yourMove: box({ light: 'green', items: ['A line that must not show'], nothing: true }) }),
            // A box with a line is the control: the list is not empty for some other reason.
            session('s-real', { yourMove: box({ light: 'yellow', items: ['Review the diff'] }) }),
          ]),
        ),
      }),
    );
    expect(result.items.map((entry) => entry.text)).toEqual(['Review the diff (session: Title of s-real)']);
    expect(result.missing).toEqual([]);
  });

  it('a session item links to the place of its session on the Agents page: /agents#session-<id>', () => {
    const result = buildYourMove(
      sources({
        sessions: good(
          sessionsInfo([
            // Two lines of one box link to the same place, and two sessions link to two places. The id is the file name of the session (letters, digits, "_" and "-").
            session('e2e00000-0000-4000-8000-000000000002', { yourMove: box({ items: ['First line', 'Second line'] }) }),
            session('another_session-7', { yourMove: box({ items: ['Third line'] }) }),
          ]),
        ),
      }),
    );
    expect(result.items.map((entry) => [entry.text.split(' (')[0], entry.href])).toEqual([
      ['First line', '/agents#session-e2e00000-0000-4000-8000-000000000002'],
      ['Second line', '/agents#session-e2e00000-0000-4000-8000-000000000002'],
      ['Third line', '/agents#session-another_session-7'],
    ]);
    // The link is an address of this site (it starts with "/"), so the Now page opens it inside the app and not in a new tab.
    for (const entry of result.items) expect(entry.href?.startsWith('/agents#')).toBe(true);
    // The page finds the cluster of the session by the same words: the server and the page share one function for them (src/shared/types.ts), so the two cannot drift apart.
    expect(sessionHref('abc-1')).toBe('/agents#session-abc-1');
    expect(sessionHref('abc-1')).toBe(`/agents#${sessionAnchor('abc-1')}`);
    expect(sessionAnchor('abc-1')).toBe('session-abc-1');
  });

  it('a failed source goes to missing, never throws', () => {
    // gh is signed out: the decisions and the pull requests have no data at all. Sessions and status are fine.
    const signedOut = failed<DecisionsInfo>('gh-not-signed-in', 'gh is not signed in to GitHub.');
    const result = buildYourMove(
      sources({
        decisionIssues: signedOut,
        github: failed<GithubInfo>('gh-not-signed-in', 'gh is not signed in to GitHub.'),
        sessions: good(sessionsInfo([session('s-one', { yourMove: box() })])),
        status: good(statusInfo(['Pick the gadget color.'])),
      }),
    );
    expect(result.items.map((entry) => entry.source)).toEqual(['session', 'status']);
    expect(result.missing).toEqual([
      { source: 'decision-issue', message: 'gh is not signed in to GitHub.' },
      { source: 'pr', message: 'gh is not signed in to GitHub.' },
    ]);

    // A source with no data and no error text of its own still never throws, and every source can fail at once.
    const everything = buildYourMove({
      decisionIssues: failed('x', 'one'),
      sessions: failed('x', 'two'),
      status: failed('x', 'three'),
      github: failed('x', 'four'),
      docDecisions: failed('x', 'five'),
    });
    expect(everything.items).toEqual([]);
    expect(everything.missing.map((entry) => [entry.source, entry.message])).toEqual([
      ['decision-issue', 'one'],
      ['session', 'two'],
      ['pr', 'four'],
      ['doc-decision', 'five'],
      ['status', 'three'],
    ]);
  });

  it('reads the last good data of a failed source, and still names the source, as for a bad approvalRef and a missing milestone table', () => {
    // A bad approvalRef: the engine module says so with a failed panel that holds all the decisions (with no "changed" flags).
    // A missing migration doc: the status module says so with a failed panel that holds the status. Neither takes Mark's to-do list away.
    const result = buildYourMove(
      sources({
        docDecisions: failed('approval-check-failed', 'approvalRef "x" cannot be used.', [docDecision('D5'), docDecision('E1', { status: 'approved' })]),
        status: failed('milestones-doc-missing', 'docs/engine/migration.md was not found in the repo.', statusInfo(['Pick the gadget color.'])),
      }),
    );
    expect(result.items.map((entry) => entry.text)).toEqual(['Decision D5: Question of D5?', 'Pick the gadget color.']);
    expect(result.missing).toEqual([
      { source: 'doc-decision', message: 'approvalRef "x" cannot be used.' },
      { source: 'status', message: 'docs/engine/migration.md was not found in the repo.' },
    ]);
  });

  it('a decision issue with a problem shows as "Decision #n is unreadable: <problem>" and links to the issue', () => {
    const result = buildYourMove(
      sources({
        decisionIssues: good(
          decisions([
            issue(46, { title: 'Not the template', problem: 'The body does not follow the decision template (it has no "Question" heading).', question: '', options: [] }),
            issue(47, { title: 'Decision: A readable one' }),
          ]),
        ),
      }),
    );
    // It links to the issue on GitHub, where Mark can read it and mend the body, and not to the page of a decision that cannot be shown.
    expect(result.items[0]).toEqual({
      source: 'decision-issue',
      text: 'Decision #46 is unreadable: The body does not follow the decision template (it has no "Question" heading).',
      href: 'https://github.com/fixture-owner/fixture-repo/issues/46',
      light: null,
      at: '2026-10-05T08:00:00Z',
    });
    // The readable one after it is a plain item that links to its page.
    expect(result.items[1]).toMatchObject({ text: 'Decision #47: A readable one', href: '/decisions/47' });
  });

  it('shows the text of a session line as plain words, and leaves a pull request of another account out of the list', () => {
    const result = buildYourMove(
      sources({
        sessions: good(sessionsInfo([session('s-md', { title: '<b>Bold</b> title', yourMove: box({ items: ['Run `npm test` and read **the** [log](http://example.test)', '   '] }) })])),
        github: good<GithubInfo>({ open: [pr(7, { author: 'stranger', attention: null }), pr(8, { url: '', attention: 'merge' })], merged: [] }),
      }),
    );
    // Markdown marks are gone, an empty line gives no item, and the title is text: nothing is made into html here (the page shows every string as text).
    expect(result.items.map((entry) => entry.text)).toEqual(['Run npm test and read the log (session: <b>Bold</b> title)', 'PR #8 is ready to merge: Title of PR 8']);
    // A pull request with no usable address is listed without a link, never with an empty one.
    expect(result.items[1]?.href).toBeNull();
  });
});
