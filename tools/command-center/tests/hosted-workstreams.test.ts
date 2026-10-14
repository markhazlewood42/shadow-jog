import { describe, expect, it } from 'vitest';
import { NOW, ROADMAP, richWorld, goodFile, liveState, pr, row, snapshot, workstreamText } from '../fixtures/hosted/world';
import { parseLive } from '../src/shared/live';
import { parseWorkstream } from '../src/shared/workstream';
import { type LiveStatus, buildWorkstreamsView, cardAnchor, parseRoadmapLanes, visibleCards } from '../src/web/hosted/workstreams';

// The data of the Workstreams view and the contract of the live key: the join of branches, PRs, files and live rows (design 5.9).

const ONLINE: LiveStatus = { state: 'online', writtenAt: NOW.toISOString() };
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const view = (rows = snapshot().workstreams, extra: Parameters<typeof snapshot>[0] = {}, live = liveState(), liveStatus: LiveStatus = ONLINE) =>
  buildWorkstreamsView({ snapshot: snapshot({ workstreams: rows, ...extra }), live, liveStatus, now: NOW });

describe('the lanes', () => {
  it('groups cards by the lane of their roadmap item, in the order of the roadmap, and keeps empty lanes out', () => {
    const rows = [row('b-side', { workstream: goodFile('b-side', { roadmap: 'S1' }) }), row('a-engine', { workstream: goodFile('a-engine', { roadmap: 'M1' }) })];
    const result = view(rows);
    expect(result.lanes.map((lane) => [lane.title, lane.cards.map((card) => card.branch)])).toEqual([
      ['Engine path', ['a-engine']],
      ['Side paths', ['b-side']],
    ]);
  });

  it('puts a workstream whose roadmap item is unknown under "No roadmap lane"', () => {
    const result = view([row('lost', { workstream: goodFile('lost', { roadmap: 'X9' }) })]);
    expect(result.lanes.map((lane) => lane.title)).toEqual(['No roadmap lane']);
  });

  it('says why when the roadmap cannot be read, and still shows the cards', () => {
    const result = view([row('a')], { main: { status: null, roadmap: '{ not json', migration: null } });
    expect(result.roadmapProblem).toMatch(/not valid JSON/);
    expect(visibleCards(result)).toHaveLength(1);
    expect(view([row('a')], { main: { status: null, roadmap: null, migration: null } }).roadmapProblem).toMatch(/missing/);
    expect(view([row('a')]).roadmapProblem).toBeNull();
  });

  it('sorts the cards of a lane: review and blocked first, then active, parked, merged', () => {
    const rows = ['parked', 'active', 'review', 'blocked'].map((state) => row(`w-${state}`, { workstream: goodFile(`w-${state}`, { state }) }));
    expect(view(rows).lanes[0]?.cards.map((card) => card.state)).toEqual(['review', 'blocked', 'active', 'parked']);
  });
});

describe('red rows and neutral rows', () => {
  it('shows an invalid file as a row with its path and its error, apart from the cards', () => {
    const bad = parseWorkstream('docs/workstreams/broken.md', workstreamText('broken', { state: 'done' }));
    const result = view([row('broken', { workstream: bad }), row('good')]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]).toMatchObject({ branch: 'broken', path: 'docs/workstreams/broken.md' });
    expect(result.invalid[0]?.message).toMatch(/state must be one of/);
    expect(visibleCards(result).map((card) => card.branch)).toEqual(['good']);
  });

  it('shows a branch with no file as a neutral "no workstream" row, never as invalid', () => {
    const result = view([row('dependabot/npm_and_yarn/x', { workstream: null, pr: pr(3, 'dependabot/npm_and_yarn/x') })]);
    expect(result.invalid).toEqual([]);
    expect(result.none).toEqual([expect.objectContaining({ kind: 'none', branch: 'dependabot/npm_and_yarn/x' })]);
  });
});

describe('merged workstreams', () => {
  it('lets the PR decide: a merged PR makes the card merged whatever the file says', () => {
    const merged = pr(9, 'done-branch', { state: 'MERGED', mergedAt: daysAgo(1) });
    const result = view([row('done-branch', { pr: merged, workstream: goodFile('done-branch', { state: 'active' }) })]);
    const card = visibleCards(result)[0];
    expect(card?.state).toBe('merged');
    expect(card?.fileState).toBe('active');
  });

  it('hides a card whose PR merged more than 14 days ago, and counts it', () => {
    const old = row('old', { pr: pr(1, 'old', { state: 'MERGED', mergedAt: daysAgo(15) }) });
    const recent = row('recent', { pr: pr(2, 'recent', { state: 'MERGED', mergedAt: daysAgo(13) }) });
    const result = view([old, recent]);
    expect(visibleCards(result).map((card) => card.branch)).toEqual(['recent']);
    expect(result.hiddenMerged).toBe(1);
  });

  it('keeps the card of a branch that has a newer open PR, because a new branch may have reused the name', () => {
    // The snapshot lists the old merged PR and an open PR from the same branch name.
    const reused = row('reused', { pr: pr(5, 'reused') });
    const result = view([reused], { github: { open: [pr(5, 'reused')], merged: [pr(4, 'reused', { state: 'MERGED', mergedAt: daysAgo(30) })] } });
    expect(visibleCards(result).map((card) => card.branch)).toEqual(['reused']);
    expect(result.hiddenMerged).toBe(0);
  });

  it('hides an old merged row that has no file, too', () => {
    const result = view([row('gone', { workstream: null, pr: pr(1, 'gone', { state: 'MERGED', mergedAt: daysAgo(20) }) })]);
    expect(result.none).toEqual([]);
    expect(result.hiddenMerged).toBe(1);
  });

  it('hides an old merged invalid file, too', () => {
    const bad = parseWorkstream('docs/workstreams/old-bad.md', 'no frontmatter');
    const result = view([row('old-bad', { workstream: bad, pr: pr(1, 'old-bad', { state: 'MERGED', mergedAt: daysAgo(20) }) })]);
    expect(result.invalid).toEqual([]);
    expect(result.hiddenMerged).toBe(1);
  });
});

describe('live rows', () => {
  const live = liveState({
    sessions: [
      { id: 's1', title: 'Session one', branch: 'alpha', folder: 'shadow-jog', state: 'working', startedAt: daysAgo(0), agents: { running: 1, done: 0, names: ['x'] }, yourMove: null },
      { id: 's2', title: 'Session two', branch: 'beta', folder: 'shadow-jog', state: 'waiting', startedAt: null, agents: { running: 0, done: 0, names: [] }, yourMove: null },
    ],
    worktrees: [{ path: 'C:/work/alpha', branch: 'alpha', dirty: 3 }],
  });

  it('puts the sessions and the worktree of a branch on its card', () => {
    const cards = visibleCards(view([row('alpha'), row('beta')], {}, live));
    expect(cards.find((card) => card.branch === 'alpha')).toMatchObject({ sessions: [{ id: 's1' }], worktrees: [{ path: 'C:/work/alpha', dirty: 3 }] });
    expect(cards.find((card) => card.branch === 'beta')).toMatchObject({ sessions: [{ id: 's2' }], worktrees: [] });
  });

  it('shows no live rows, and the reporter state, when there is no live data', () => {
    const result = buildWorkstreamsView({ snapshot: snapshot({ workstreams: [row('alpha')] }), live: null, liveStatus: { state: 'not-running' }, now: NOW });
    expect(visibleCards(result)[0]).toMatchObject({ sessions: [], worktrees: [] });
    expect(result.live).toEqual({ state: 'not-running' });
  });
});

describe('cardAnchor and parseRoadmapLanes', () => {
  it('makes an anchor from a branch with slashes', () => {
    expect(cardAnchor('spike/foo-bar')).toBe('ws-spike_x2f_foo-bar');
  });

  it('gives two different branches two different anchors', () => {
    expect(cardAnchor('feature/a-b')).not.toBe(cardAnchor('feature-a/b'));
    expect(cardAnchor('a/b')).not.toBe(cardAnchor('a-b'));
    expect(cardAnchor('a_b')).not.toBe(cardAnchor('a/b'));
    expect(cardAnchor('a_x2f_b')).not.toBe(cardAnchor('a/b'));
    expect(cardAnchor('Fix/X')).not.toBe(cardAnchor('fix/x'));
    expect(cardAnchor('a//b')).not.toBe(cardAnchor('a/b'));
  });

  it('keeps the case of a branch and leaves no dash artifacts', () => {
    const anchor = cardAnchor('Fix/X');
    expect(anchor).toBe('ws-_ufix_x2f__ux');
    expect(anchor).not.toMatch(/--|-$/);
    expect(anchor).toMatch(/^[a-z0-9_-]+$/);
  });

  it('is the id of the card and the target of its Your move link', () => {
    const world = richWorld();
    const view = buildWorkstreamsView({ snapshot: world.snapshot, live: null, liveStatus: { state: 'not-running' }, now: NOW });
    for (const card of visibleCards(view)) expect(cardAnchor(card.branch)).toMatch(/^ws-[a-z0-9_-]+$/);
  });

  it('reads the real shape of roadmap.json, and refuses other shapes with a reason', () => {
    expect(parseRoadmapLanes(ROADMAP)).toMatchObject({ ok: true });
    expect(parseRoadmapLanes('[]')).toMatchObject({ ok: false });
    expect(parseRoadmapLanes('{"lanes":1,"items":[]}')).toMatchObject({ ok: false });
  });
});

describe('the contract of the live key', () => {
  const good = { writtenAt: '2026-10-12T12:00:00.000Z', sessions: [{ id: 's', title: 't', branch: 'b', folder: 'f', state: 'working', startedAt: null, agents: { running: 0, done: 1, names: ['n'] } }], worktrees: [{ path: '/p', branch: null, dirty: 0 }] };

  it('reads a good value, ignores fields it does not know, and defaults missing agent names', () => {
    expect(parseLive(good)).toMatchObject({ ok: true });
    expect(parseLive({ ...good, extra: 1 })).toMatchObject({ ok: true });
    const noNames = { ...good, sessions: [{ ...good.sessions[0], agents: { running: 0, done: 0 } }] };
    expect(parseLive(noNames)).toMatchObject({ ok: true, live: { sessions: [{ agents: { names: [] } }] } });
  });

  it('reads the ask of a session, and holds it to 6 lines of 160 characters even if the reporter sent more', () => {
    const at = '2026-10-12T11:00:00.000Z';
    const ask = (yourMove: unknown) => ({ ...good, sessions: [{ ...good.sessions[0], yourMove }] });
    expect(parseLive(ask({ at, lines: ['one', 'two'] }))).toMatchObject({ ok: true, live: { sessions: [{ yourMove: { at, lines: ['one', 'two'] } }] } });
    // Missing and null are "no ask" (an older reporter has no such field).
    expect(parseLive(good)).toMatchObject({ ok: true, live: { sessions: [{ yourMove: null }] } });
    expect(parseLive(ask(null))).toMatchObject({ ok: true, live: { sessions: [{ yourMove: null }] } });
    // The caps hold on the reading side too.
    const long = parseLive(ask({ at, lines: Array.from({ length: 9 }, (_, i) => `${i}${'x'.repeat(300)}`) }));
    expect(long.ok && long.live.sessions[0]?.yourMove?.lines).toHaveLength(6);
    expect(long.ok && long.live.sessions[0]?.yourMove?.lines.every((line) => line.length <= 160)).toBe(true);
  });

  it.each([
    ['an ask that is not an object', { ...good, sessions: [{ ...good.sessions[0], yourMove: 'text' }] }],
    ['an ask with a bad time', { ...good, sessions: [{ ...good.sessions[0], yourMove: { at: 'soon', lines: [] } }] }],
    ['an ask whose lines are not texts', { ...good, sessions: [{ ...good.sessions[0], yourMove: { at: '2026-10-12T11:00:00.000Z', lines: [1] } }] }],
    ['not an object', 'text'],
    ['no writtenAt', { ...good, writtenAt: undefined }],
    ['a bad time', { ...good, writtenAt: 'soon' }],
    ['sessions not a list', { ...good, sessions: {} }],
    ['a session state outside the set', { ...good, sessions: [{ ...good.sessions[0], state: 'busy' }] }],
    ['a negative count', { ...good, sessions: [{ ...good.sessions[0], agents: { running: -1, done: 0 } }] }],
    ['a worktree with no dirty count', { ...good, worktrees: [{ path: '/p', branch: null }] }],
  ])('refuses %s, with a reason', (_name, value) => {
    const result = parseLive(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});
