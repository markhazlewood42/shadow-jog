import { describe, expect, it } from 'vitest';
import { buildYourMove } from '../src/server/now/yourMove';
import { extractYourMove } from '../src/server/sessions/parse';
import { type AgentsLive, type DecisionIssue, type DecisionsInfo, type LiveSession, type Panel, type SessionInfo, type SessionsInfo, type YourMoveBox, sessionAnchor, sessionHref } from '../src/shared/types';
import { ASK_MAX_AGE_MS, ASK_MAX_CHARS, ASK_MAX_LINES, type LiveAsk, askStatus, buildYourMoveItems } from '../src/shared/your-move';
import { ROOT, assistantText, at, box as boxText, userPrompt } from './sessions-helpers';
import type { YourMoveSources } from '../src/server/now/yourMove';

// The shared rule of "Your move" (src/shared/your-move.ts) and the local list made from it (src/server/now/yourMove.ts). The rule has two sources: decision issues
// and live asks. A pull request is never an item (Mark, 2026-10-13: the Pull requests panel lists them). A live ask hides when ANY of four rules holds, and each rule has its own test below. Every name, title and line is synthetic.

const T0 = '2026-10-06T10:00:00.000Z';
const NOW_MS = Date.parse(T0);
const hoursAgo = (hours: number) => new Date(NOW_MS - hours * 3_600_000).toISOString();

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
  return { light: 'yellow', items: ['Review the diff'], nothing: false, at: hoursAgo(0.5), answered: false, ...extra };
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
    startedAt: hoursAgo(2),
    lastActivityAt: hoursAgo(0.1),
    state: 'waiting',
    prs: [],
    yourMove: null,
    agents: [],
    workflows: [],
    ...extra,
  };
}

const sessionsInfo = (sessions: SessionInfo[]): SessionsInfo => ({ sessions, scanned: sessions.length, skipped: 0, hiddenSdk: 0 });

const liveSession = (id: string): LiveSession => ({ id, title: `Title of ${id}`, state: 'waiting', startedAt: hoursAgo(2), filePath: '', nodes: [] });
const liveOf = (...ids: string[]): Panel<AgentsLive> => good<AgentsLive>({ sessions: ids.map(liveSession), hiddenScripts: 0, source: 'process-list' });

/** Three good panels with nothing in them. A test replaces the ones it cares about. */
function sources(extra: Partial<YourMoveSources> = {}): YourMoveSources {
  return {
    decisionIssues: good(decisions([])),
    sessions: good(sessionsInfo([])),
    agents: liveOf(),
    ...extra,
  };
}

/** The texts of the live asks of a list for the given sessions, all of them live. */
function askTexts(sessions: SessionInfo[], live: string[] = sessions.map((entry) => entry.id), nowMs = NOW_MS): string[] {
  return buildYourMove(sources({ sessions: good(sessionsInfo(sessions)), agents: liveOf(...live) }), nowMs).items.map((item) => item.text);
}

describe('the two sources of "Your move"', () => {
  it('lists the open decision issues first, then the live asks, and nothing else', () => {
    const result = buildYourMove(
      sources({
        sessions: good(
          sessionsInfo([
            session('s-working', { state: 'working', yourMove: box({ light: 'red', items: ['Answer the question', 'Tell me to commit'] }) }),
            session('s-answered', { yourMove: box({ answered: true }) }),
            session('s-not-live', { yourMove: box() }),
            session('s-no-box', { yourMove: null }),
          ]),
        ),
        agents: liveOf('s-working', 's-answered', 's-no-box'),
        decisionIssues: good(decisions([issue(41), issue(43, { title: 'Where should the cache go?' })], [issue(44, { state: 'answered' })])),
      }),
      NOW_MS,
    );

    expect(result.missing).toEqual([]);
    expect(result.items).toEqual([
      { source: 'decision-issue', text: 'Decision #41: Question 41?', href: '/decisions/41', light: null, at: '2026-10-05T08:00:00Z' },
      { source: 'decision-issue', text: 'Decision #43: Where should the cache go?', href: '/decisions/43', light: null, at: '2026-10-05T08:00:00Z' },
      { source: 'session', text: 'Answer the question (session: Title of s-working)', href: '/agents#session-s-working', light: 'red', at: hoursAgo(0.5) },
      { source: 'session', text: 'Tell me to commit (session: Title of s-working)', href: '/agents#session-s-working', light: 'red', at: hoursAgo(0.5) },
    ]);
  });

  it('a decision issue clears when it is closed: the answered and closed ones are not in the list, even if a list holds them', () => {
    const items = buildYourMoveItems({ decisions: [issue(1), issue(2, { state: 'closed' }), issue(3, { state: 'answered' })], asks: [], nowMs: NOW_MS });
    expect(items.map((item) => item.text)).toEqual(['Decision #1: Question 1?']);
  });

  it('a pull request makes no item: the local builder has no panel of them, and a PR address in a session box stays a session item', () => {
    expect(Object.keys(sources()).sort()).toEqual(['agents', 'decisionIssues', 'sessions']);
    const result = buildYourMove(
      sources({ sessions: good(sessionsInfo([session('s-1', { yourMove: box({ items: ['PR #999 is ready to merge: merge it now'] }), prs: [{ number: 999, url: 'https://github.com/fixture-owner/fixture-repo/pull/999' }] })])), agents: liveOf('s-1') }),
      NOW_MS,
    );
    expect(result.items.map((item) => item.source)).toEqual(['session']);
    expect(result.items[0]?.href).toBe('/agents#session-s-1');
  });

  it('every item links to a place to act: a decision page or a live session. An item with no usable link is left out', () => {
    const result = buildYourMove(
      sources({
        decisionIssues: good(decisions([issue(46, { problem: 'The body does not follow the template.' }), issue(47, { url: '', problem: 'No address.' }), issue(48)])),
        sessions: good(sessionsInfo([session('s-1', { yourMove: box() })])),
        agents: liveOf('s-1'),
      }),
      NOW_MS,
    );
    expect(result.items.map((item) => item.href)).toEqual([
      'https://github.com/fixture-owner/fixture-repo/issues/46',
      '/decisions/48',
      '/agents#session-s-1',
    ]);
    for (const item of result.items) expect(item.href === null || item.href.startsWith('/decisions/') || item.href.startsWith('/agents#session-') || item.href.startsWith('https://github.com/')).toBe(true);
    // A decision that cannot be read says so, and links to the issue, where Mark can mend it.
    expect(result.items[0]?.text).toBe('Decision #46 is unreadable: The body does not follow the template.');
  });

  it('a session item links to the place of its session on the Agents page: /agents#session-<id>', () => {
    const result = buildYourMove(
      sources({
        sessions: good(sessionsInfo([session('e2e00000-0000-4000-8000-000000000002', { yourMove: box({ items: ['First line', 'Second line'] }) }), session('another_session-7', { yourMove: box({ items: ['Third line'] }) })])),
        agents: liveOf('e2e00000-0000-4000-8000-000000000002', 'another_session-7'),
      }),
      NOW_MS,
    );
    expect(result.items.map((entry) => [entry.text.split(' (')[0], entry.href])).toEqual([
      ['First line', '/agents#session-e2e00000-0000-4000-8000-000000000002'],
      ['Second line', '/agents#session-e2e00000-0000-4000-8000-000000000002'],
      ['Third line', '/agents#session-another_session-7'],
    ]);
    expect(sessionHref('abc-1')).toBe(`/agents#${sessionAnchor('abc-1')}`);
  });

  it('the status.md "Next up for Mark" list and the open decisions of the engine docs are not sources any more', () => {
    // The local builder takes three panels and no more: there is no panel of either of the two to give it.
    const result = buildYourMove(sources(), NOW_MS);
    expect(result.items).toEqual([]);
    expect(Object.keys(sources()).sort()).toEqual(['agents', 'decisionIssues', 'sessions']);
  });
});

describe('a live ask hides when any one of the four rules holds', () => {
  const base = (id: string, extra: Partial<YourMoveBox> = {}) => session(id, { yourMove: box(extra) });

  it('the control: a live session, not answered, a box with a line, half an hour old, is shown', () => {
    expect(askTexts([base('s-1')])).toEqual(['Review the diff (session: Title of s-1)']);
  });

  it('rule 1: the session is not live (its process was not seen)', () => {
    // The sessions module counts the session, and the process list does not have it.
    expect(askTexts([base('s-1')], [])).toEqual([]);
    // Another session is live, not this one.
    expect(askTexts([base('s-1')], ['s-other'])).toEqual([]);
  });

  it('rule 1: a process list that cannot be read now hides every ask, also when its last good data had the session', () => {
    const result = buildYourMove(
      sources({
        sessions: good(sessionsInfo([base('s-1')])),
        agents: failed('agents-failed', 'The process list could not be read.', { sessions: [liveSession('s-1')], hiddenScripts: 0, source: 'process-list' }),
      }),
      NOW_MS,
    );
    expect(result.items).toEqual([]);
    expect(result.missing).toEqual([{ source: 'session', message: 'The process list could not be read.' }]);
  });

  it('rule 1: a session read that failed now hides every ask, also when its last good data had a box', () => {
    const result = buildYourMove(sources({ sessions: failed('sessions-failed', 'The session files could not be read.', sessionsInfo([base('s-1')])), agents: liveOf('s-1') }), NOW_MS);
    expect(result.items).toEqual([]);
    expect(result.missing).toEqual([{ source: 'session', message: 'The session files could not be read.' }]);
  });

  it('rule 2: Mark answered after the box', () => {
    expect(askTexts([base('s-1', { answered: true })])).toEqual([]);
    expect(askStatus({ nothing: false, answered: true, at: hoursAgo(1) }, true, NOW_MS)).toBe('answered');
  });

  it('rule 3: the box says "Your move: nothing"', () => {
    expect(askTexts([base('s-1', { nothing: true, items: [] })])).toEqual([]);
    // A box that says nothing wins over lines that came with it.
    expect(askTexts([base('s-1', { nothing: true, items: ['A line that must not show'] })])).toEqual([]);
    expect(askStatus(null, true, NOW_MS)).toBe('nothing');
  });

  it('rule 3: a newer box replaced the older one, and a newer reply with no box leaves the box', () => {
    const roots = [ROOT];
    const first = assistantText(boxText(['Old line']), { time: at(-300) });
    const second = assistantText(boxText(['New line']), { time: at(-200) });
    const nothing = assistantText(boxText([], { heading: '### 👉 Your move: nothing' }), { time: at(-100) });
    const short = assistantText('A short status line, no box.', { time: at(-50) });
    // Lines are timed against the helper clock; the session list below carries the box that `extractYourMove` kept, as the sessions module does.
    const lineBox = (lines: unknown[]) => extractYourMove(lines, roots);
    const shown = (lines: unknown[]) => {
      const kept = lineBox(lines);
      return kept === null ? [] : askTexts([session('s-1', { yourMove: { ...kept, at: hoursAgo(0.5) } })]);
    };
    // Two boxes: only the newer one shows.
    expect(shown([first, second])).toEqual(['New line (session: Title of s-1)']);
    // A newer box that says "nothing" replaces the older one, and hides it.
    expect(shown([first, second, nothing])).toEqual([]);
    // A newer reply with no box leaves the box where it is.
    expect(shown([first, second, short])).toEqual(['New line (session: Title of s-1)']);
    // Mark's prompt after the newer box answers it (rule 2 again, through the real parser).
    expect(shown([first, second, userPrompt('Done', { time: at(-150) })])).toEqual([]);
  });

  it('rule 4: the box is more than 12 hours old', () => {
    expect(ASK_MAX_AGE_MS).toBe(12 * 3_600_000);
    expect(askTexts([base('s-1', { at: hoursAgo(11.9) })])).toEqual(['Review the diff (session: Title of s-1)']);
    expect(askTexts([base('s-1', { at: hoursAgo(12) })])).toEqual(['Review the diff (session: Title of s-1)']);
    expect(askTexts([base('s-1', { at: hoursAgo(12.1) })])).toEqual([]);
    expect(askTexts([base('s-1', { at: hoursAgo(40) })])).toEqual([]);
    expect(askStatus({ nothing: false, answered: false, at: hoursAgo(13) }, true, NOW_MS)).toBe('old');
  });

  it('rule 4: a box with a time more than a minute in the future is hidden, in askStatus and again at the shared list', () => {
    const future = (ms: number) => new Date(NOW_MS + ms).toISOString();
    expect(askStatus({ nothing: false, answered: false, at: future(9e9) }, true, NOW_MS)).toBe('old');
    expect(askStatus({ nothing: false, answered: false, at: future(61_000) }, true, NOW_MS)).toBe('old');
    expect(askStatus({ nothing: false, answered: false, at: future(30_000) }, true, NOW_MS)).toBe('show');
    expect(askTexts([base('s-1', { at: future(3_600_000) })])).toEqual([]);
    const ask: LiveAsk = { sessionId: 's-1', title: 'T', lines: ['A line'], at: future(9e9), light: null };
    expect(buildYourMoveItems({ decisions: [], asks: [ask], nowMs: NOW_MS })).toEqual([]);
  });

  it('rule 4: a box with no usable time is hidden, because its age cannot be shown to be inside the limit', () => {
    expect(askTexts([base('s-1', { at: '' })])).toEqual([]);
    expect(askTexts([base('s-1', { at: 'not a time' })])).toEqual([]);
    expect(askStatus({ nothing: false, answered: false, at: null }, true, NOW_MS)).toBe('old');
  });

  it('rule 4 again at the shared rule: a list that was made long ago does not show a box that has grown old since', () => {
    const ask: LiveAsk = { sessionId: 's-1', title: 'T', lines: ['A line'], at: hoursAgo(11), light: null };
    expect(buildYourMoveItems({ decisions: [], asks: [ask], nowMs: NOW_MS })).toHaveLength(1);
    expect(buildYourMoveItems({ decisions: [], asks: [ask], nowMs: NOW_MS + 2 * 3_600_000 })).toHaveLength(0);
  });

  it('a session that is not live shows nothing even when it is the only thing in the list, and the other asks stay', () => {
    expect(askTexts([base('s-live', { items: ['Keep me'] }), base('s-gone', { items: ['Hide me'] })], ['s-live'])).toEqual(['Keep me (session: Title of s-live)']);
  });
});

describe('the lines of an ask', () => {
  const live = (box: YourMoveBox) => askTexts([session('s-1', { title: '<b>Bold</b> title', yourMove: box })]);

  it('shows the text of a line as plain words: markdown marks are gone, an empty line gives no item, and the title is text', () => {
    expect(live(box({ items: ['Run `npm test` and read **the** [log](http://example.test)', '   '] }))).toEqual(['Run npm test and read the log (session: <b>Bold</b> title)']);
  });

  it('shows at most 6 lines of a box, each cut to 160 characters', () => {
    const lines = live(box({ items: Array.from({ length: 9 }, (_, index) => `Line ${index + 1} ${'x'.repeat(300)}`) }));
    expect(ASK_MAX_LINES).toBe(6);
    expect(ASK_MAX_CHARS).toBe(160);
    expect(lines).toHaveLength(6);
    for (const [index, text] of lines.entries()) {
      const line = text.replace(' (session: <b>Bold</b> title)', '');
      expect(line.length).toBeLessThanOrEqual(160);
      expect(line.startsWith(`Line ${index + 1} `)).toBe(true);
      expect(line.endsWith('…')).toBe(true);
    }
  });
});

describe('failed sources', () => {
  it('a failed source goes to missing and never throws; the others go on', () => {
    const signedOut = failed<DecisionsInfo>('gh-not-signed-in', 'gh is not signed in to GitHub.');
    const result = buildYourMove(
      sources({
        decisionIssues: signedOut,
        sessions: good(sessionsInfo([session('s-one', { yourMove: box() })])),
        agents: liveOf('s-one'),
      }),
      NOW_MS,
    );
    expect(result.items.map((entry) => entry.source)).toEqual(['session']);
    expect(result.missing).toEqual([{ source: 'decision-issue', message: 'gh is not signed in to GitHub.' }]);

    const everything = buildYourMove({ decisionIssues: failed('x', 'one'), sessions: failed('x', 'two'), agents: failed('x', 'three') }, NOW_MS);
    expect(everything.items).toEqual([]);
    expect(everything.missing.map((entry) => [entry.source, entry.message])).toEqual([
      ['decision-issue', 'one'],
      ['session', 'two'],
      ['session', 'three'],
    ]);
  });

  it('the decisions read the last good data of a failed source (a list a little old is still the list), and the source is still named', () => {
    const result = buildYourMove(sources({ decisionIssues: failed('gh-failed', 'gh failed.', decisions([issue(5)])) }), NOW_MS);
    expect(result.items.map((entry) => entry.text)).toEqual(['Decision #5: Question 5?']);
    expect(result.missing).toHaveLength(1);
  });
});
