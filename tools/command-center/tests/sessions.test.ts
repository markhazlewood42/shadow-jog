import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createHub } from '../src/server/hub';
import type { Config } from '../src/server/config';
import { createSessionsSource } from '../src/server/sessions/sessions';
import type { ChangeEvent, SessionInfo, SessionsInfo } from '../src/shared/types';
import { CLAUDE_FIXTURES, INSIDE, MIXED_FOLDER, NOW, WHOLE_FOLDER, assistantText, assistantToolUse, at, attachment, box, copyClaudeFixtures, jsonl, lastPrompt, sessionsConfig, setAge, toolResult, userPrompt, writeAged } from './sessions-helpers';

// The sessions module over the synthetic Claude folders of fixtures/claude/projects (see
// tests/sessions-helpers.ts). The fixtures are copied for each test and their times of last write are set
// to the minute before NOW, because a checkout gives every file the time of the checkout. Text in the
// fixtures that must never reach the answer starts with LEAK-, and text that may starts with ALLOWED-.

const parent = mkdtempSync(join(tmpdir(), 'cc-sessions-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const S1 = '11111111-1111-4111-8111-111111111111'; // works in the repo, with agents and a workflow
const S2 = '22222222-2222-4222-8222-222222222222'; // its newest cwd is outside the roots
const S3 = '33333333-3333-4333-8333-333333333333'; // a box was written outside the roots; its title is in custom-title.json
const S4 = '44444444-4444-4444-8444-444444444444'; // no line has a cwd
const S5 = '55555555-5555-4555-8555-555555555555'; // no line of a type that this knows
const S6 = '66666666-6666-4666-8666-666666666666'; // in the mixed folder, and its newest cwd is inside
const S7 = '77777777-7777-4777-8777-777777777777'; // in the mixed folder, and it works elsewhere
const S8 = '88888888-8888-4888-8888-888888888888'; // in the mixed folder, no line has a cwd
const S9 = '99999999-9999-4999-8999-999999999999'; // in a folder that only shares a name prefix
const RUN1 = 'wf_00000001-aaa';
const RUN2 = 'wf_00000002-bbb';

let copies = 0;
/** Copies the fixtures into a new folder and gives its path. `ages` sets the age of a file, in seconds. */
const freshProjects = (ages: Record<string, number> = {}): string => copyClaudeFixtures(join(parent, `projects-${copies++}`), ages);

type Loaded = { info: SessionsInfo; projects: string; config: Config; source: ReturnType<typeof createSessionsSource>; events: ChangeEvent[] };

/** Builds a source over a copy of the fixtures, loads it once, and gives the answer. */
async function load(options: { ages?: Record<string, number>; claude?: Partial<Config['claude']>; nowMs?: number; projects?: string } = {}): Promise<Loaded> {
  const projects = options.projects ?? freshProjects(options.ages);
  const config = sessionsConfig(projects, options.claude);
  const hub = createHub();
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const source = createSessionsSource({ config, hub, now: () => options.nowMs ?? NOW });
  const panel = await source.get(true);
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return { info: panel.data, projects, config, source, events };
}

const find = (info: SessionsInfo, id: string): SessionInfo => {
  const session = info.sessions.find((candidate) => candidate.id === id);
  if (session === undefined) throw new Error(`session ${id} is not in the answer`);
  return session;
};

/** Every LEAK- and ALLOWED- marker in the files of the fixtures. */
function markersIn(prefix: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else for (const marker of readFileSync(path, 'utf8').matchAll(new RegExp(`${prefix}-[A-Za-z0-9-]+`, 'g'))) found.add(marker[0]);
    }
  };
  walk(CLAUDE_FIXTURES);
  return [...found].sort();
}

describe('which sessions are listed', () => {
  it('lists exactly the sessions that the rules keep, with the folder that holds them, and counts the files that it looked at', async () => {
    const { info } = await load();
    // Kept: the whole folder's sessions (a session with no cwd, and one in a format that is not known, are still its own) and the one
    // session of the mixed folder whose newest cwd is inside a root. All have the same age here, so they come by id.
    expect(info.sessions.map((session) => [session.id, session.folder, session.matchedBy])).toEqual([
      [S1, WHOLE_FOLDER, 'folder'],
      [S3, WHOLE_FOLDER, 'folder'],
      [S4, WHOLE_FOLDER, 'folder'],
      [S5, WHOLE_FOLDER, 'folder'],
      [S6, MIXED_FOLDER, 'cwd'],
    ]);
    // Eight files of the two named folders were looked at. Three are left out: S2 (its newest cwd is outside, though it began inside),
    // S7 (it works elsewhere) and S8 (a mixed folder, and nothing says where it works). The folder that only shares a name prefix was not read.
    expect(info.scanned).toBe(8);
    expect(info.skipped).toBe(3);
    expect(info.sessions.map((session) => session.id)).not.toContain(S2);
  });

  it('a non-matching session never appears in the response', async () => {
    const { info } = await load();
    const text = JSON.stringify(info);
    // Not by its id, its title, its box, its agents, or its pull request. S9 is in a folder that is not named, so it was never read at all.
    for (const needle of [S2, S7, S8, S9, '22222222', '77777777', '88888888', '99999999']) expect(text, needle).not.toContain(needle);
    for (const needle of [
      'LEAK-title-of-the-session-that-moved-out',
      'LEAK-item-of-the-session-that-moved-out',
      'LEAK-title-of-another-project',
      'LEAK-item-of-another-project',
      'LEAK-description-of-an-agent-of-another-project',
      'LEAK-title-of-the-session-with-no-cwd',
      'LEAK-title-of-the-prefix-folder-session',
      '/pull/77', // a pull request of this repository, in a session that is not Shadow Jog's
    ]) {
      expect(text, needle).not.toContain(needle);
    }
    // The same holds for the ones that were listed: every session and agent in the answer is one that was kept.
    const listed = new Set(info.sessions.map((session) => session.id));
    for (const session of info.sessions) {
      for (const agent of session.agents) expect(listed.has(agent.sessionId)).toBe(true);
      for (const run of session.workflows) expect(listed.has(run.sessionId)).toBe(true);
    }
  });

  it('a session whose file is older than the week is left out, and the week is the config setting', async () => {
    const week = 604_800;
    const { info } = await load({ ages: { [`${WHOLE_FOLDER}/${S3}.jsonl`]: week + 1, [`${WHOLE_FOLDER}/${S4}.jsonl`]: week - 1 } });
    expect(info.sessions.map((session) => session.id)).toEqual([S1, S5, S6, S4]); // S4 was written the longest ago
    expect(info.scanned).toBe(7);
    const short = await load({ claude: { recentSeconds: 30 } });
    expect(short.info).toEqual({ sessions: [], scanned: 0, skipped: 0 });
  });

  it('the newest comes first, by the last write for the session', async () => {
    const { info } = await load({
      ages: { [`${WHOLE_FOLDER}/${S1}.jsonl`]: 3000, [`${WHOLE_FOLDER}/${S3}.jsonl`]: 20, [`${WHOLE_FOLDER}/${S4}.jsonl`]: 7000, [`${MIXED_FOLDER}/${S6}.jsonl`]: 500 },
    });
    // S1 has agents that were written a minute ago, and the session is as recent as them.
    // S3 was written 20 s ago. S1, S5 and S6 have something that was written 60 s ago (an agent file, for S1 and S6), and come by id. S4 is the oldest.
    expect(info.sessions.map((session) => session.id)).toEqual([S3, S1, S5, S6, S4]);
    expect(find(info, S1).lastActivityAt).toBe(at(-60)); // not 3000 seconds ago: its agent files are newer
    expect(find(info, S3).lastActivityAt).toBe(at(-20));
    expect(find(info, S4).lastActivityAt).toBe(at(-7000));
  });

  it('a missing Claude folder is a machine with no sessions, not an error', async () => {
    const { info } = await load({ projects: join(parent, 'no-claude-here') });
    expect(info).toEqual({ sessions: [], scanned: 0, skipped: 0 });
  });
});

describe('what a session says', () => {
  it('a session that works in the repo: its title, folder, cwd, branch, times, state, pull requests and box', async () => {
    const { info } = await load();
    const session = find(info, S1);
    expect(session).toMatchObject({
      id: S1,
      title: 'ALLOWED-title-from-the-line', // the custom title wins over the agent name
      folder: WHOLE_FOLDER,
      matchedBy: 'folder',
      cwd: INSIDE, // the newest line that has one: a reply and a system and an attachment line after it, all in this folder
      branch: 'fixture-branch',
      startedAt: '2026-10-06T10:00:00.000Z', // the first line is a queue-operation, and that is long in real files; its time is read
      lastActivityAt: at(-60),
      state: 'waiting', // its last reply ended its turn, a minute ago
      prs: [{ number: 12, url: 'https://github.com/octo-owner/octo-repo/pull/12' }], // the pull request of another repository is not in it
      yourMove: { light: 'yellow', items: ['ALLOWED-item-review-the-diff', 'ALLOWED-item-tell-me-to-commit'], nothing: false, at: '2026-10-06T10:30:00.000Z', answered: false },
    });
  });

  it('the title is the custom title of the file, else the custom-title.json next to it, else the agent name, else the slug, else the id', async () => {
    const { info } = await load();
    expect(find(info, S1).title).toBe('ALLOWED-title-from-the-line');
    expect(find(info, S3).title).toBe('ALLOWED-title-from-the-json-file'); // no title line: custom-title.json
    expect(find(info, S4).title).toBe('ALLOWED-title-of-the-session-with-no-cwd');
    expect(find(info, S5).title).toBe('Session 55555555'); // nothing names it

    // The agent name and the slug come next. A title line beats a custom-title.json, which beats the agent name.
    const projects = freshProjects();
    const whole = join(projects, WHOLE_FOLDER);
    writeAged(join(whole, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), jsonl([userPrompt('x'), assistantText('y'), { type: 'agent-name', agentName: 'Only an agent name' }]));
    writeAged(join(whole, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), jsonl([{ ...userPrompt('x'), slug: 'a-made-up-slug' }, assistantText('y')]));
    writeAged(join(whole, 'aaaaaaaa-0000-4000-8000-000000000003.jsonl'), jsonl([userPrompt('x'), assistantText('y'), { type: 'agent-name', agentName: 'Loses to the json' }]));
    writeAged(join(whole, 'aaaaaaaa-0000-4000-8000-000000000003', 'custom-title.json'), '{"customTitle":"Wins over the agent name"}');
    const named = await load({ projects });
    expect(find(named.info, 'aaaaaaaa-0000-4000-8000-000000000001').title).toBe('Only an agent name');
    expect(find(named.info, 'aaaaaaaa-0000-4000-8000-000000000002').title).toBe('a-made-up-slug');
    expect(find(named.info, 'aaaaaaaa-0000-4000-8000-000000000003').title).toBe('Wins over the agent name');
  });

  it('a box written while cwd was outside a root is not the box of the session: the last box inside is', async () => {
    const { info } = await load();
    // S3 wrote a box inside, then one outside (newer), then a reply with no box. The box that counts is the one inside.
    expect(find(info, S3).yourMove).toEqual({ light: 'red', items: ['ALLOWED-item-the-box-written-inside'], nothing: false, at: '2026-10-06T08:10:00.000Z', answered: false });
    expect(JSON.stringify(info)).not.toContain('LEAK-item-of-the-box-written-outside');
    // A session that has not written a box has none.
    expect(find(info, S4).yourMove).toBeNull();
    expect(find(info, S5).yourMove).toBeNull();
  });

  it('a session with no cwd in a whole folder is kept with cwd null, and one in a format that is not known has state unknown', async () => {
    const { info } = await load();
    expect(find(info, S4)).toMatchObject({ cwd: null, branch: '', state: 'unknown', prs: [], agents: [], workflows: [] });
    // S5 has a line of an unknown type with a cwd. The folder of the newest line that has one is the folder of the session, whatever type that line has.
    expect(find(info, S5)).toMatchObject({ cwd: '/fixture/repo', state: 'unknown' });
  });

  it('a session of the mixed folder that moved into the repo is listed by its cwd, and its box from before the move is not its box', async () => {
    const { info } = await load();
    expect(find(info, S6)).toMatchObject({
      title: 'ALLOWED-title-of-the-home-base-session',
      folder: MIXED_FOLDER,
      matchedBy: 'cwd',
      cwd: '/fixture/repo',
      state: 'waiting',
      prs: [{ number: 12, url: 'https://github.com/octo-owner/octo-repo/pull/12' }],
      yourMove: { light: 'yellow', items: ['ALLOWED-item-of-the-home-base-session'], answered: false },
    });
    expect(JSON.stringify(info)).not.toContain('LEAK-item-written-before-moving-into-the-repo');
  });

  it('the state follows the clock: a turn that ended waits for four hours, and is idle after', async () => {
    expect(find((await load({ nowMs: NOW + 14_000_000 })).info, S1).state).toBe('waiting');
    expect(find((await load({ nowMs: NOW + 14_400_000 })).info, S1).state).toBe('idle'); // the file is 14 460 s old
  });

  it('a session that works is working while it is written, and idle when it is not', async () => {
    const projects = freshProjects();
    const file = join(projects, WHOLE_FOLDER, `${S3}.jsonl`);
    appendFileSync(file, jsonl([assistantToolUse('Bash', { command: 'x' }, { cwd: INSIDE })]));
    setAge(file, 60);
    expect(find((await load({ projects })).info, S3).state).toBe('working');
    setAge(file, 301);
    expect(find((await load({ projects })).info, S3).state).toBe('idle');
  });

  it('a session that waits for its agents is as recent as the newest agent file, and works while one is written', async () => {
    // S6 ends in a tool call. Its own file is three hours old. The agent of its workflow was written a minute ago.
    const projects = freshProjects();
    const file = join(projects, MIXED_FOLDER, `${S6}.jsonl`);
    appendFileSync(file, jsonl([assistantToolUse('Workflow', {}, { cwd: '/fixture/repo' })]));
    setAge(file, 10_800);
    const agentFile = join(projects, MIXED_FOLDER, S6, 'subagents', 'workflows', RUN2, 'agent-r0000001.jsonl');
    const journal = join(projects, MIXED_FOLDER, S6, 'subagents', 'workflows', RUN2, 'journal.jsonl');
    setAge(journal, 10_800);

    const working = find((await load({ projects })).info, S6);
    expect(working.state).toBe('working');
    expect(working.lastActivityAt).toBe(at(-60));
    // When everything of the session is old, it is idle.
    setAge(agentFile, 10_800);
    const idle = find((await load({ projects })).info, S6);
    expect(idle.state).toBe('idle');
    expect(idle.lastActivityAt).toBe(at(-10_800));
  });
});

describe('agents and workflows', () => {
  it('lists the agents of a session, the newest first, with their description from the .meta.json and their state', async () => {
    const { info } = await load();
    const agents = find(info, S1).agents;
    expect(agents.map((agent) => agent.id)).toEqual(['w0000003', 'w0000001', 'w0000002', 'a0000002', 'a0000001']);

    // An agent that ended with its reply: done, with the time of its last line.
    expect(agents.find((agent) => agent.id === 'a0000001')).toEqual({
      id: 'a0000001',
      sessionId: S1,
      description: 'ALLOWED-description-explore-the-engine',
      agentType: 'general-purpose',
      model: 'sonnet',
      state: 'done',
      startedAt: '2026-10-06T10:10:00.000Z',
      endedAt: '2026-10-06T10:12:00.000Z',
      workflowId: null,
    });
    // An agent whose last line is a tool call, in a file that was written a minute ago, is running and has no end. No model in its meta is "".
    expect(agents.find((agent) => agent.id === 'a0000002')).toMatchObject({ state: 'running', endedAt: null, model: '', agentType: 'Explore', workflowId: null });
    // The agents of a run have its id. One that handed its result back (a tool that ends the turn) is done.
    expect(agents.find((agent) => agent.id === 'w0000001')).toMatchObject({ state: 'done', workflowId: RUN1, endedAt: '2026-10-06T10:41:00.000Z', description: 'ALLOWED-description-research-one' });
    expect(agents.find((agent) => agent.id === 'w0000002')).toMatchObject({ state: 'done', workflowId: RUN1, endedAt: '2026-10-06T10:42:00.000Z' });
    expect(agents.find((agent) => agent.id === 'w0000003')).toMatchObject({ state: 'running', workflowId: RUN1, endedAt: null, model: 'haiku' });
  });

  it('an agent that has not ended and was not written for a while has stopped, and one whose workflow has its result is done', async () => {
    const stale = await load({ ages: { [`${WHOLE_FOLDER}/${S1}/subagents/agent-a0000002.jsonl`]: 3600 } });
    expect(find(stale.info, S1).agents.find((agent) => agent.id === 'a0000002')).toMatchObject({ state: 'stopped', endedAt: '2026-10-06T10:20:30.000Z' });

    // w0000003 has no end in its own file, and the journal has its result: it is done.
    const projects = freshProjects();
    const journalFile = join(projects, WHOLE_FOLDER, S1, 'subagents', 'workflows', RUN1, 'journal.jsonl');
    appendFileSync(journalFile, jsonl([{ type: 'result', key: 'Build/1', agentId: 'w0000003', result: 'x' }]));
    setAge(journalFile, 60);
    const done = await load({ projects });
    expect(find(done.info, S1).agents.find((agent) => agent.id === 'w0000003')).toMatchObject({ state: 'done', endedAt: '2026-10-06T10:43:30.000Z' });
  });

  it('workflow: phases in first-seen order with started and done counts, running while an agent file is fresh, done when every start has a result, else stopped', async () => {
    const runPath = `${WHOLE_FOLDER}/${S1}/subagents/workflows/${RUN1}`;

    // Research was named first, Build second. Two agents of Research started and both have a result. Build's one has none.
    const { info, projects } = await load();
    const run = find(info, S1).workflows[0];
    expect(find(info, S1).workflows).toHaveLength(1);
    expect(run).toMatchObject({
      id: RUN1,
      name: 'fixture-build', // the script file's name without the run id
      sessionId: S1,
      phases: [
        { name: 'Research', started: 2, done: 2 },
        { name: 'Build', started: 1, done: 0 },
      ],
      started: 3,
      done: 2,
      state: 'running', // an agent file was written a minute ago, and one agent has no result
      lastEventAt: at(-60),
    });
    expect(Number.isNaN(Date.parse(run?.startedAt ?? ''))).toBe(false); // the time that the journal file was made

    // Done when every start has a result: even while the files are fresh.
    appendFileSync(join(projects, runPath, 'journal.jsonl'), jsonl([{ type: 'result', key: 'Build/1', agentId: 'w0000003', result: 'x' }]));
    setAge(join(projects, runPath, 'journal.jsonl'), 60);
    const done = find((await load({ projects })).info, S1).workflows[0];
    expect(done).toMatchObject({ state: 'done', started: 3, done: 3 });
    expect(done?.phases).toEqual([
      { name: 'Research', started: 2, done: 2 },
      { name: 'Build', started: 1, done: 1 },
    ]);

    // Else stopped: one start has no result, and nothing of the run was written for longer than workingSeconds (300).
    const ageOfRun = (seconds: number) => Object.fromEntries(['journal.jsonl', 'agent-w0000001.jsonl', 'agent-w0000002.jsonl', 'agent-w0000003.jsonl'].map((name) => [`${runPath}/${name}`, seconds]));
    expect(find((await load({ ages: ageOfRun(3600) })).info, S1).workflows[0]).toMatchObject({ state: 'stopped', started: 3, done: 2, lastEventAt: at(-3600) });
    // One fresh agent file is enough for running, and the journal alone is too (a run that has just started writes it first).
    expect(find((await load({ ages: { ...ageOfRun(3600), [`${runPath}/agent-w0000003.jsonl`]: 100 } })).info, S1).workflows[0]?.state).toBe('running');
    expect(find((await load({ ages: { ...ageOfRun(3600), [`${runPath}/journal.jsonl`]: 100 } })).info, S1).workflows[0]?.state).toBe('running');
    // The limit is workingSeconds: 300 s is fresh and 301 s is not.
    expect(find((await load({ ages: ageOfRun(300) })).info, S1).workflows[0]?.state).toBe('running');
    expect(find((await load({ ages: ageOfRun(301) })).info, S1).workflows[0]?.state).toBe('stopped');
  });

  it('the name of a run is found in the folder of the launch cwd, which can be another named folder than the one of the session file', async () => {
    const { info } = await load();
    // S6 is in the mixed folder. Its script is in the whole folder, where the workflow was launched.
    expect(find(info, S6).workflows).toEqual([
      expect.objectContaining({ id: RUN2, name: 'fixture-review', sessionId: S6, state: 'done', started: 1, done: 1, phases: [{ name: 'Review', started: 1, done: 1 }] }),
    ]);
    expect(find(info, S6).agents.map((agent) => [agent.id, agent.workflowId, agent.state])).toEqual([['r0000001', RUN2, 'done']]);
    // With no script file, the run is named by its id.
    const projects = freshProjects();
    rmSync(join(projects, WHOLE_FOLDER, S6, 'workflows'), { recursive: true });
    expect(find((await load({ projects })).info, S6).workflows[0]?.name).toBe(RUN2);
  });

  it('a run with a journal that has no row that this knows is unknown, and a run with no journal has no progress', async () => {
    const projects = freshProjects();
    const run = join(projects, WHOLE_FOLDER, S1, 'subagents', 'workflows', RUN1);
    writeFileSync(join(run, 'journal.jsonl'), '{"type":"from-the-future"}\nnot json\n');
    setAge(join(run, 'journal.jsonl'), 60);
    expect(find((await load({ projects })).info, S1).workflows[0]).toMatchObject({ state: 'unknown', phases: [], started: 0, done: 0 });
    rmSync(join(run, 'journal.jsonl'));
    expect(find((await load({ projects })).info, S1).workflows[0]).toMatchObject({ state: 'unknown', phases: [], started: 0, done: 0, startedAt: null });
  });
});

describe('what may leave the files', () => {
  it('the response holds no transcript text outside title, box items and agent descriptions (marker scan)', async () => {
    const { info } = await load();
    const text = JSON.stringify(info);

    // Every made-up word that sits in a prompt, a reply, a tool call or its result, a system line, an attachment, a queued prompt,
    // a note at the end of a file, the label of a journal row, an agent's prompt or reply, or the name of a title that lost: none is in the answer.
    const leaks = markersIn('LEAK');
    expect(leaks.length).toBeGreaterThan(40); // the scan has something to look for
    expect(leaks.filter((marker) => text.includes(marker))).toEqual([]);
    // The scan can fail: the same check finds a marker when one is there.
    expect(leaks.filter((marker) => `${text} LEAK-first-user-prompt`.includes(marker))).toEqual(['LEAK-first-user-prompt']);

    // What may be in it is: the titles of the sessions that were listed, the lines of their boxes, and the descriptions of their agents.
    const allowedHere = [
      'ALLOWED-title-from-the-line',
      'ALLOWED-title-from-the-json-file',
      'ALLOWED-title-of-the-session-with-no-cwd',
      'ALLOWED-title-of-the-home-base-session',
      'ALLOWED-item-review-the-diff',
      'ALLOWED-item-tell-me-to-commit',
      'ALLOWED-item-the-box-written-inside',
      'ALLOWED-item-of-the-home-base-session',
      'ALLOWED-description-explore-the-engine',
      'ALLOWED-description-still-working',
      'ALLOWED-description-research-one',
      'ALLOWED-description-research-two',
      'ALLOWED-description-build-one',
      'ALLOWED-description-review-one',
    ];
    expect(allowedHere.filter((marker) => !text.includes(marker))).toEqual([]);
    expect(markersIn('ALLOWED').filter((marker) => !allowedHere.includes(marker))).toEqual([]); // every marker of that kind is accounted for
  });

  it('the answer names no path of this machine: a folder is a name, and a cwd is the text of a line', async () => {
    const { info, projects } = await load();
    const text = JSON.stringify(info);
    // JSON writes a backslash as two, so both spellings of the folder are looked for.
    for (const path of [projects, parent]) {
      expect(text).not.toContain(path);
      expect(text).not.toContain(path.replace(/\\/g, '\\\\'));
    }
  });

  it('a title, an item and a description are cut to a length that a page can show', async () => {
    const projects = freshProjects();
    const whole = join(projects, WHOLE_FOLDER);
    const id = 'bbbbbbbb-0000-4000-8000-000000000001';
    writeAged(join(whole, `${id}.jsonl`), jsonl([userPrompt('x'), assistantText(`### 👉 Your move\n- [ ] ${'item '.repeat(400)}`), { type: 'custom-title', customTitle: 'title '.repeat(200) }]));
    writeAged(join(whole, id, 'subagents', 'agent-big.jsonl'), jsonl([userPrompt('x'), assistantText('y')]));
    writeAged(join(whole, id, 'subagents', 'agent-big.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'words '.repeat(500) }));
    const session = find((await load({ projects })).info, id);
    expect(session.title.length).toBe(200);
    expect(session.yourMove?.items[0]?.length).toBe(500);
    expect(session.agents[0]?.description.length).toBe(300);
  });
});

describe('a file that is not what it should be', () => {
  /** A session file in the whole folder with these lines and text after them, one minute old. */
  function sessionFile(projects: string, id: string, content: string): string {
    return writeAged(join(projects, WHOLE_FOLDER, `${id}.jsonl`), content);
  }

  it('a half-written last line, an unknown line type and a line that is not JSON are read past', async () => {
    const projects = freshProjects();
    const id = 'cccccccc-0000-4000-8000-000000000001';
    sessionFile(
      projects,
      id,
      `${jsonl([userPrompt('go'), assistantText('Done.', { time: at(-50) }), { type: 'from-the-future', data: 1 }])}not json at all\n{"type":"assistant","message":{"role":"assistant","stop_reason":"end_t`,
    );
    expect(find((await load({ projects })).info, id)).toMatchObject({ state: 'waiting', cwd: INSIDE });
  });

  it('a trailing metadata line without a cwd does not hide the cwd: the module reads further back until it finds one', async () => {
    const projects = freshProjects();
    const id = 'cccccccc-0000-4000-8000-000000000002';
    // The last reply has the cwd. After it come 200 KB of notes that have none, more than the first window of 64 KB.
    const notes = Array.from({ length: 2000 }, (_, i) => ({ type: 'file-history-snapshot', messageId: `m${i}`, snapshot: { pad: 'x'.repeat(60) } }));
    writeAged(join(projects, MIXED_FOLDER, `${id}.jsonl`), jsonl([userPrompt('go', { cwd: '/fixture/home-base' }), assistantText('Done.', { cwd: '/fixture/repo/tools' }), ...notes]));
    const session = find((await load({ projects })).info, id);
    expect(session).toMatchObject({ cwd: '/fixture/repo/tools', matchedBy: 'cwd', state: 'waiting' });
  });

  it('big attachments after the last reply do not hide it: the module reads further back until it finds a line of the conversation', async () => {
    // Seen in real files: a few large attachments (listings of skills, for example) after the last reply fill the first 64 KB, and all of
    // them have a cwd. A window that stopped at the first cwd would hold no reply, and the session would have no state and no box.
    const projects = freshProjects();
    const id = 'cccccccc-0000-4000-8000-000000000006';
    const bigAttachment = (n: number) => attachment(`LEAK-attachment-${n} ${'x'.repeat(30 * 1024)}`, { cwd: INSIDE, time: at(-40 + n) });
    writeAged(
      join(projects, WHOLE_FOLDER, `${id}.jsonl`),
      jsonl([userPrompt('go'), assistantText(box(['ALLOWED-item-behind-the-attachments']), { time: at(-50) }), bigAttachment(1), bigAttachment(2), bigAttachment(3), lastPrompt()]),
    );
    const session = find((await load({ projects })).info, id);
    expect(session).toMatchObject({ state: 'waiting', cwd: INSIDE, yourMove: { items: ['ALLOWED-item-behind-the-attachments'], answered: false } });
  });

  it('a line that is far bigger than the window is never read, and the lines after it are', async () => {
    const projects = freshProjects();
    const id = 'cccccccc-0000-4000-8000-000000000003';
    const huge = { type: 'attachment', cwd: '/fixture/elsewhere', attachment: { type: 'file', content: 'x'.repeat(6 * 1024 * 1024) } };
    sessionFile(projects, id, jsonl([userPrompt('go'), huge, assistantText('Done.', { cwd: INSIDE })]));
    expect(find((await load({ projects })).info, id)).toMatchObject({ state: 'waiting', cwd: INSIDE });
  });

  it('a file whose last line is bigger than the cap gives no state and is not an error', async () => {
    const projects = freshProjects();
    const id = 'cccccccc-0000-4000-8000-000000000004';
    const huge = { type: 'attachment', cwd: INSIDE, attachment: { type: 'file', content: 'x'.repeat(5 * 1024 * 1024) } };
    sessionFile(projects, id, jsonl([userPrompt('go'), huge]));
    const { info } = await load({ projects });
    expect(find(info, id)).toMatchObject({ state: 'unknown', cwd: null }); // nothing could be read from the end, and the folder is a whole one
  });

  it('an empty file is a session with no state, and not an unknown format', async () => {
    const projects = freshProjects();
    const id = 'cccccccc-0000-4000-8000-000000000005';
    sessionFile(projects, id, '');
    const { info } = await load({ projects });
    expect(find(info, id)).toMatchObject({ state: 'unknown', cwd: null });
    expect(info.sessions.length).toBeGreaterThan(1);

    // Only an empty file: there is no format to be wrong about.
    const only = join(parent, 'only-empty');
    writeAged(join(only, WHOLE_FOLDER, `${id}.jsonl`), '');
    expect((await load({ projects: only })).info.sessions.map((session) => session.id)).toEqual([id]);
  });

  it('files that hold lines and none of a known type give the error "unknown file format", with the last good data kept', async () => {
    const projects = freshProjects();
    const { source } = await load({ projects });
    const good = await source.get();
    expect(good.ok).toBe(true);

    // Claude Code writes a new format: every file now holds lines that this does not know.
    for (const folder of [WHOLE_FOLDER, MIXED_FOLDER]) {
      for (const entry of readdirSync(join(projects, folder), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) writeAged(join(projects, folder, entry.name), '{"kind":"greeting","text":"LEAK-new-format"}\n{"kind":"reply"}\n');
      }
    }
    const broken = await source.get(true);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error.code).toBe('sessions-unknown-format');
    expect(broken.error.message).toContain('unknown file format');
    expect(broken.error.message).not.toContain('LEAK-new-format');
    expect(broken.lastGood?.data.sessions.length).toBe(5); // the page still has the last list to show under the error
  });

  it('a folder that cannot be read is an error that names the folder and no path', async () => {
    const projects = freshProjects();
    const config = sessionsConfig(projects, { folders: ['bad\0name'], cwdMatchFolders: [] });
    const source = createSessionsSource({ config, hub: createHub(), now: () => NOW });
    const panel = await source.get(true);
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('sessions-unreadable');
    expect(panel.error.message).toContain('bad');
    expect(panel.error.message).not.toContain(projects);
  });
});

describe('the source', () => {
  it('publishes a change event when the sessions change, and none when they do not', async () => {
    const { source, events, projects } = await load();
    expect(events).toEqual([expect.objectContaining({ module: 'sessions' })]); // the first load
    await source.get(true);
    await source.get(true);
    expect(events).toHaveLength(1); // nothing changed: the page is not told to load again

    const file = join(projects, WHOLE_FOLDER, `${S3}.jsonl`);
    appendFileSync(file, jsonl([toolResult('x', { cwd: INSIDE })]));
    setAge(file, 30);
    await source.get(true);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ module: 'sessions' });
  });

  it('an answer is a Panel: the data, and the time it was made', async () => {
    const { source } = await load();
    const panel = await source.get();
    expect(panel).toMatchObject({ ok: true, data: { scanned: 8, skipped: 3 } });
    expect(Number.isNaN(Date.parse(panel.updatedAt ?? ''))).toBe(false);
  });

  it('the fixtures are what the tests say they are: eight files in the two named folders, and a ninth in a folder that is not named', () => {
    const count = (folder: string) => readdirSync(join(CLAUDE_FIXTURES, folder)).filter((name) => name.endsWith('.jsonl')).length;
    expect([count(WHOLE_FOLDER), count(MIXED_FOLDER), count('fixture-shadow-jog-old')]).toEqual([5, 3, 1]);
    expect(statSync(join(CLAUDE_FIXTURES, 'fixture-shadow-jog-old', `${S9}.jsonl`)).isFile()).toBe(true);
  });
});
