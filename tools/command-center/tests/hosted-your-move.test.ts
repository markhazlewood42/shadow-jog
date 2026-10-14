import { describe, expect, it } from 'vitest';
import { NOW, NOW_ISO, decision, liveAnswer, liveState, pr, snapshot } from '../fixtures/hosted/world';
import type { LiveAnswer } from '../src/hosted/live';
import type { LiveSessionRow } from '../src/shared/live';
import { readLive } from '../src/web/hosted/panels';
import type { Slot } from '../src/web/hosted/store';
import { buildHostedYourMove, liveAsksOf } from '../src/web/hosted/your-move';

// "Your move" on the hosted page: the same shared rule as the local page, with the live asks read from the `live` key. A reporter that is offline hides EVERY live ask.

const NOW_MS = NOW.getTime();
const minutesAgo = (minutes: number) => new Date(NOW_MS - minutes * 60_000).toISOString();

function slotOf(answer: LiveAnswer | null, error: Slot<LiveAnswer>['error'] = null): Slot<LiveAnswer> {
  return { data: answer, error, loaded: true, at: NOW_ISO };
}

function row(id: string, yourMove: LiveSessionRow['yourMove']): LiveSessionRow {
  return { id, title: `Title of ${id}`, branch: 'b', folder: 'f', state: 'waiting', startedAt: minutesAgo(90), agents: { running: 0, done: 0, names: [] }, yourMove };
}

const ask = (lines: string[], at = minutesAgo(30)) => ({ at, lines });

/** The answer of /api/live for a reporter that wrote `ageSeconds` ago. The server computes the state from the age with the 150 s limit. */
function answerAged(ageSeconds: number, sessions: LiveSessionRow[]): LiveAnswer {
  const writtenAt = new Date(NOW_MS - ageSeconds * 1000).toISOString();
  const live = liveState({ writtenAt, sessions });
  return { reporter: { state: ageSeconds > 150 ? 'offline' : 'online', writtenAt, ageSeconds, offlineAfterSeconds: 150 }, live };
}

const build = (slot: Slot<LiveAnswer>, extra: Parameters<typeof snapshot>[0] = {}, nowMs = NOW_MS) => buildHostedYourMove(snapshot(extra), readLive(slot), nowMs);

describe('"Your move" on the hosted page', () => {
  it('lists the open decisions first, then the live asks, then the PRs that wait for Mark, from the same rule as the local page', () => {
    const slot = slotOf(answerAged(4, [row('s-1', ask(['Look at the picture', 'Tell me to commit'])), row('s-2', null)]));
    const result = build(slot, {
      decisions: { open: [decision(12)], recent: [] },
      github: { open: [pr(30, 'alpha', { attention: 'merge' }), pr(31, 'other', { attention: null }), pr(32, 'draft', { attention: 'merge', isDraft: true })], merged: [] },
    });
    expect(result.missing).toEqual([]);
    expect(result.items.map((item) => [item.source, item.text, item.href])).toEqual([
      ['decision-issue', 'Decision #12: question 12', '/decisions/12'],
      ['session', 'Look at the picture (session: Title of s-1)', '/agents#session-s-1'],
      ['session', 'Tell me to commit (session: Title of s-1)', '/agents#session-s-1'],
      ['pr', 'PR #30 is ready to merge: Title of PR 30', 'https://github.com/fixture-owner/fixture-repo/pull/30'],
    ]);
  });

  it('no workstream file feeds the list any more: a card never makes an item', () => {
    const result = build(slotOf(answerAged(4, [])), { workstreams: [] });
    expect(result.items).toEqual([]);
    expect(result.items.map((item) => item.source)).not.toContain('workstream');
  });

  it('the reporter is offline when the live key is older than 150 s: "Reporter offline" shows and ALL live asks are hidden', () => {
    const sessions = [row('s-1', ask(['Look at the picture'])), row('s-2', ask(['Another line']))];
    // 149 s: online. 151 s: offline (the function says so).
    expect(build(slotOf(answerAged(149, sessions))).items).toHaveLength(2);
    const offline = build(slotOf(answerAged(151, sessions)), { decisions: { open: [decision(12)], recent: [] } });
    expect(offline.items.map((item) => item.source)).toEqual(['decision-issue']);
    expect(offline.missing).toHaveLength(1);
    expect(offline.missing[0]?.source).toBe('session');
    expect(offline.missing[0]?.message).toMatch(/^Reporter offline since \d\d:\d\d:\d\d\. Live asks are hidden\.$/);
  });

  it('a stale key hides the asks even when the server still says online: the page checks the age again with its own clock', () => {
    // The answer was good a while ago (online, 4 s old at the fetch), and this page has been open for 5 minutes since.
    const slot = slotOf(answerAged(4, [row('s-1', ask(['Look at the picture']))]));
    expect(build(slot, {}, NOW_MS + 4 * 60_000).items).toEqual([]);
    expect(build(slot, {}, NOW_MS + 4 * 60_000).missing[0]?.message).toContain('Reporter offline');
    // 100 s later it is still fresh.
    expect(build(slot, {}, NOW_MS + 100_000).items).toHaveLength(1);
  });

  it('a reporter that is not running, a key that cannot be read and a failed request each hide every ask, and say why', () => {
    const sessions = [row('s-1', ask(['Look at the picture']))];
    const notRunning = build(slotOf(liveAnswer('not-running')));
    expect(notRunning.items).toEqual([]);
    expect(notRunning.missing).toEqual([{ source: 'session', message: 'Reporter not running. Live asks are hidden.' }]);

    const odd = answerAged(4, sessions);
    const unreadable = build(slotOf({ ...odd, live: { writtenAt: odd.reporter.writtenAt, sessions: 'x', worktrees: [] } }));
    expect(unreadable.items).toEqual([]);
    expect(unreadable.missing[0]?.message).toMatch(/^Live asks are hidden: the live value is unreadable/);

    // No answer yet, and a failed request.
    const noAnswer = build(slotOf(null, { kind: 'network', code: 'network', message: 'The request failed.' }));
    expect(noAnswer.items).toEqual([]);
    expect(noAnswer.missing[0]?.message).toBe('Live asks are hidden: The request failed.');

    // A request that failed after a good one: the store keeps the old value, and the old asks must not show.
    const failedAfterGood = build(slotOf(answerAged(4, sessions), { kind: 'network', code: 'network', message: 'The request failed.' }));
    expect(failedAfterGood.items).toEqual([]);
    expect(failedAfterGood.missing[0]?.message).toBe('Live asks are hidden: The request failed.');
  });

  it('a failed reporter never shows old asks: the asks of a box older than 12 hours are hidden even when the reporter is fresh', () => {
    const slot = slotOf(answerAged(4, [row('s-old', ask(['Old line'], minutesAgo(13 * 60))), row('s-new', ask(['New line'], minutesAgo(11 * 60)))]));
    expect(build(slot).items.map((item) => item.text)).toEqual(['New line (session: Title of s-new)']);
  });

  it('F2: a live key written in the future is offline: asks are hidden', () => {
    const out = build(slotOf(answerAged(-3600, [row('s-1', ask(['x']))])));
    expect(out.items).toEqual([]);
    expect(out.missing[0]?.message).toContain('Reporter offline');
    // A few seconds ahead is two clocks that differ a little.
    expect(build(slotOf(answerAged(-20, [row('s-1', ask(['x']))]))).items).toHaveLength(1);
  });

  it('M9: a snapshot problem names the source it belongs to, and a problem that does not touch the list is not named', () => {
    const quiet = build(slotOf(answerAged(4, [])), { problems: [{ code: 'branches-truncated', message: 'branches' }] });
    expect(quiet.missing).toEqual([]);
    const decisions = build(slotOf(answerAged(4, [])), { problems: [{ code: 'decisions-waiting-truncated', message: 'More decision issues exist' }] });
    expect(decisions.missing).toEqual([{ source: 'decision-issue', message: 'Snapshot incomplete: More decision issues exist' }]);
    const prs = build(slotOf(answerAged(4, [])), { problems: [{ code: 'open-prs-truncated', message: 'More PRs exist' }] });
    expect(prs.missing[0]?.source).toBe('pr');
  });

  it('liveAsksOf names the state of the reporter in words and keeps the asks only when it is fresh', () => {
    const fresh = liveAsksOf(readLive(slotOf(answerAged(4, [row('s-1', ask(['x']))]))), NOW_MS);
    expect(fresh.message).toBeNull();
    expect(fresh.asks).toHaveLength(1);
    const gone = liveAsksOf(readLive(slotOf(answerAged(400, [row('s-1', ask(['x']))]))), NOW_MS);
    expect(gone.asks).toEqual([]);
    expect(gone.message).toContain('Reporter offline');
  });
});
