import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentsSource } from '../src/server/agents/module';
import { MESSAGE_WINDOW_BYTES } from '../src/server/agents/tree';
import { isInside } from '../src/server/config';
import { createHub } from '../src/server/hub';
import { createSessionsSource } from '../src/server/sessions/sessions';
import type { AgentsLive, ChangeEvent } from '../src/shared/types';
import {
  MIXED_FOLDER,
  NOW,
  PID,
  RUN,
  SA,
  SB,
  SD,
  SE,
  SENTINELS,
  WHOLE_FOLDER,
  agentCall,
  agentFile,
  agentsConfig,
  aliveSet,
  at,
  copyAgentFixtures,
  jsonl,
  loadAgents,
  nodeOf,
  peerLine,
  sendMessage,
  sessionFile,
  sessionOf,
  setAge,
  setStatus,
  writeAged,
  writeMeta,
  writeProcessFile,
} from './agents-helpers';
import { makeTestConfig } from './helpers';
import { INSIDE, OUTSIDE, PREFIX_ONLY, ROOT_PHASER, assistantText, toolResult, userPrompt } from './sessions-helpers';

// The agents module over the synthetic fixture world of tests/fixtures/claude (see tests/agents-helpers.ts): a folder of process files, and the session
// folders that those processes run. The pid check is injected and the clock is fixed, so no test needs a real process or the real time. Text in the
// fixtures that must never reach an answer starts with LEAK-, and the text that may starts with ALLOWED-.
//
// The world at NOW (12:00:00): A is busy and has four agents, a workflow and some messages; B is idle (it has a title of its own and an agent that
// has been silent for ten minutes); C's process is gone; D was started by a script; E works outside the project.

const parent = mkdtempSync(join(tmpdir(), 'cc-agents-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

const load = (options: Parameters<typeof loadAgents>[0] = {}) => loadAgents({ parent, ...options });

/** Waits (with real timers) until the condition holds, and fails after three seconds. */
async function until(done: () => boolean): Promise<void> {
  for (let waited = 0; !done(); waited += 10) {
    if (waited > 3000) throw new Error('waited three seconds for the source');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The ids of the nodes of a session, in the order they come. */
const ids = (data: AgentsLive, session: string) => sessionOf(data, session).nodes.map((node) => node.id);

/** The fixture session file of A rewritten with these lines after a prompt, and a time of last write 30 s ago. */
function rewriteSessionA(world: ReturnType<typeof copyAgentFixtures>, lines: unknown[]): string {
  const file = sessionFile(world, WHOLE_FOLDER, SA);
  writeAged(file, jsonl([userPrompt('ALLOWED-first-prompt-of-session-a', { time: at(-3600), cwd: INSIDE }), ...lines, toolResult('x', { time: at(-60), cwd: INSIDE })]), 30);
  return file;
}

describe('which sessions are live', () => {
  it('state word follows busy and idle', async () => {
    const { data, world, source, alive } = await load();
    expect(data.source).toBe('process-list');
    // B is idle, A is busy. They come in order of start: B at 10:30, A at 11:00.
    expect(data.sessions.map((session) => [session.id, session.state, session.startedAt])).toEqual([
      [SB, 'waiting', at(-5400)],
      [SA, 'working', at(-3600)],
    ]);

    // The status is read at each look: the two swap, and so do the words.
    setStatus(world, PID.A, 'idle');
    setStatus(world, PID.B, 'busy');
    const swapped = await source.get(true);
    expect(swapped.ok && swapped.data.sessions.map((session) => [session.id, session.state])).toEqual([
      [SB, 'working'],
      [SA, 'waiting'],
    ]);

    // A process that ends takes its session out at the next look, whatever its status was.
    alive.delete(PID.A);
    const gone = await source.get(true);
    expect(gone.ok && gone.data.sessions.map((session) => session.id)).toEqual([SB]);
  });

  it('missing process list falls back to file ages and says so', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // The folder of the process list is not there. The sessions come from the file ages of version 1: A works (it ends in a tool result and was written
      // lately), B waits (its last reply ended the turn), C is idle (five hours old), D is a script's, E works elsewhere.
      const { data } = await load({ claude: { sessionsRoot: join(parent, 'there-is-no-process-list') } });
      expect(data.source).toBe('file-age');
      expect(data.sessions.map((session) => [session.id, session.state])).toEqual([
        [SB, 'waiting'],
        [SA, 'working'],
      ]);
      // A session has no process to start it here: its start is the time of its first line.
      expect(data.sessions.map((session) => session.startedAt)).toEqual(['2026-10-06T10:30:01.000Z', '2026-10-06T11:00:01.000Z']);
      expect(data.hiddenScripts).toBe(1); // D: a script's session that would be live is still hidden and counted
      // A folder that is there and holds no process file in the right shape is the same fallback.
      const changed = join(parent, 'changed-format');
      mkdirSync(changed, { recursive: true });
      writeFileSync(join(changed, '7709001.json'), '{"id":"x","state":"busy"}');
      const second = await load({ claude: { sessionsRoot: changed } });
      expect(second.data.source).toBe('file-age');
      expect(second.data.sessions.map((session) => session.id)).toEqual([SB, SA]);
      // An empty folder is not a fallback: it says that nothing runs.
      const empty = join(parent, 'empty-list');
      mkdirSync(empty, { recursive: true });
      const third = await load({ claude: { sessionsRoot: empty } });
      expect(third.data).toEqual({ sessions: [], hiddenScripts: 0, source: 'process-list' });
    } finally {
      quiet.mockRestore();
    }
  });

  it('the file-age fallback counts working as busy and waiting as idle for the agents', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const missing = { claude: { sessionsRoot: join(parent, 'no-process-list-here') } };
      // B waits, so its agent that has been silent for ten minutes is stopped and left out. A works, and its agents stay.
      const { data, world } = await load(missing);
      expect(sessionOf(data, SB).nodes).toEqual([]);
      expect(ids(data, SA)).toContain('aa01');
      // B is written to again and works: the same agent now counts as running, because a long tool call writes nothing.
      const file = sessionFile(world, MIXED_FOLDER, SB);
      appendFileSync(file, jsonl([toolResult('x', { time: at(-30), cwd: INSIDE })]));
      setAge(file, 20);
      const working = await loadAgents({ world, claude: missing.claude });
      expect(sessionOf(working.data, SB).state).toBe('working');
      expect(ids(working.data, SB)).toEqual(['bb01']);
    } finally {
      quiet.mockRestore();
    }
  });

  it('response carries no pid and no extra process file key', async () => {
    const { data } = await load();
    const text = JSON.stringify(data);
    // Not the pid, and not the process id of any file, whether the process runs or not. Not the socket path, the bridge id, the name, the host session,
    // the start of the process or the token of the key file: the process files hold them, and none of them is for a page.
    for (const sentinel of SENTINELS) expect(text, sentinel).not.toContain(sentinel);
    expect(text).not.toContain('"pid"');
    expect(text).not.toContain('socket');
    expect(text).not.toContain('bridge');
    // The session has exactly the keys of the type, and so has a node. The keys of a process file are not among them.
    for (const session of data.sessions) {
      expect(Object.keys(session).sort()).toEqual(['filePath', 'id', 'nodes', 'startedAt', 'state', 'title']);
      for (const node of session.nodes) {
        expect(Object.keys(node).sort()).toEqual(node.kind === 'workflow' ? ['endedAt', 'filePath', 'id', 'kind', 'label', 'messages', 'model', 'parentId', 'progress', 'startedAt', 'state'] : ['endedAt', 'filePath', 'id', 'kind', 'label', 'messages', 'model', 'parentId', 'startedAt', 'state']);
      }
    }
    expect(Object.keys(data).sort()).toEqual(['hiddenScripts', 'sessions', 'source']);
    // No text of a conversation but the titles and the labels: no prompt, no reply, no message, no result.
    expect(text).not.toContain('LEAK-');
  });

  it('sdk sessions are hidden and counted', async () => {
    const { data } = await load();
    // D runs, in the project, and a script started it: it is not listed, and it is counted. Nothing of it is in the answer: not its id, not its title, not its agent.
    expect(data.sessions.map((session) => session.id)).not.toContain(SD);
    expect(data.hiddenScripts).toBe(1);
    const text = JSON.stringify(data);
    for (const needle of [SD, 'dddddddd', 'LEAK-title-of-the-sdk-run', 'dd01', 'LEAK-sdk-agent']) expect(text, needle).not.toContain(needle);

    // With the setting, it is listed like any other, with its agent, and nothing is hidden.
    const shown = await load({ claude: { includeSdk: true } });
    expect(shown.data.hiddenScripts).toBe(0);
    expect(shown.data.sessions.map((session) => session.id)).toEqual([SB, SA, SD]);
    expect(ids(shown.data, SD)).toEqual(['dd01']);

    // The entrypoint says "sdk" in any case and with any ending. A session with no entrypoint is not one.
    for (const [entrypoint, hidden] of [['sdk-ts', 1], ['SDK-CLI', 1], ['sdk', 1], ['claude-desktop', 0], ['cli', 0]] as const) {
      const world = copyAgentFixtures(parent);
      writeAged(sessionFile(world, WHOLE_FOLDER, SD), jsonl([userPrompt('LEAK-p', { entrypoint, cwd: INSIDE }), toolResult('x', { entrypoint, cwd: INSIDE })]), 60);
      const result = await loadAgents({ world });
      expect(result.data.hiddenScripts, entrypoint).toBe(hidden);
      expect(result.data.sessions.map((session) => session.id).includes(SD), entrypoint).toBe(hidden === 0);
    }
  });

  it('a home-base session with a cwd inside the repo is kept', async () => {
    const { data, world } = await load();
    // B is in the mixed folder (the home-base folder). Its newest working folder is inside the repo, so it is Shadow Jog's.
    const b = sessionOf(data, SB);
    expect(b.filePath).toBe(sessionFile(world, MIXED_FOLDER, SB));
    // The title is the one that Mark gave it, and not the first line of its first prompt.
    expect(b.title).toBe('ALLOWED-title-of-session-b');

    // A working folder inside the second root (the other checkout) counts too, and so does a folder deep inside a root.
    for (const cwd of [ROOT_PHASER, `${ROOT_PHASER}/src`, INSIDE]) {
      const other = copyAgentFixtures(parent);
      writeAged(sessionFile(other, MIXED_FOLDER, SB), jsonl([userPrompt('ALLOWED-prompt', { cwd }), assistantText('done', { cwd })]), 60);
      const result = await loadAgents({ world: other });
      expect(result.data.sessions.map((session) => session.id), cwd).toContain(SB);
    }
  });

  it('a session with a cwd outside every root is dropped', async () => {
    const { data } = await load();
    // E runs in the mixed folder and works outside the project. It is not listed, and nothing of it is in the answer: it is not counted either.
    expect(data.sessions.map((session) => session.id)).not.toContain(SE);
    expect(data.hiddenScripts).toBe(1); // only D
    const text = JSON.stringify(data);
    for (const needle of [SE, 'eeeeeeee', 'LEAK-title-of-the-outside-session', 'LEAK-reply-of-the-outside-session']) expect(text, needle).not.toContain(needle);

    // The rule is the one of version 1, by whole path segments.
    const cases: [string, string | null, string, boolean][] = [
      ['a folder that only shares the start of a root name', PREFIX_ONLY, MIXED_FOLDER, false],
      ['a folder that has nothing to do with the roots', OUTSIDE, MIXED_FOLDER, false],
      ['a mixed folder and no working folder at all', null, MIXED_FOLDER, false],
      ['a whole folder and no working folder at all', null, WHOLE_FOLDER, true],
      ['a whole folder and a working folder that moved outside', OUTSIDE, WHOLE_FOLDER, false],
      ['a relative working folder', '.', MIXED_FOLDER, false],
    ];
    for (const [label, cwd, folder, kept] of cases) {
      const world = copyAgentFixtures(parent);
      // The file of B moves to the folder of the case, and its process runs it there.
      const lines = [userPrompt('ALLOWED-prompt', { cwd, time: at(-3000) }), assistantText('done', { cwd, time: at(-2900) })];
      writeAged(sessionFile(world, folder, SB), jsonl(lines), 60);
      const result = await loadAgents({ world });
      expect(result.data.sessions.map((session) => session.id).includes(SB), label).toBe(kept);
    }
  });

  it('a process whose session file is in no named folder is not listed, and a process with no session file does not break the others', async () => {
    const world = copyAgentFixtures(parent);
    writeProcessFile(world, 7702001, 'ffffffff-0000-4000-8000-0000000000f1', 'busy'); // no file anywhere
    mkdirSync(join(world.projects, 'fixture-shadow-jog-old'), { recursive: true }); // a folder that shares the start of a name: it is not named
    writeAged(join(world.projects, 'fixture-shadow-jog-old', 'ffffffff-0000-4000-8000-0000000000f2.jsonl'), jsonl([userPrompt('LEAK-prefix-folder', { cwd: INSIDE })]), 60);
    writeProcessFile(world, 7702002, 'ffffffff-0000-4000-8000-0000000000f2', 'busy');
    const { data } = await loadAgents({ world, alive: new Set([...aliveSet(), 7702001, 7702002]) });
    expect(data.sessions.map((session) => session.id)).toEqual([SB, SA]);
    expect(JSON.stringify(data)).not.toContain('LEAK-prefix-folder');
  });

  it('a session has the title that the sessions module gives it', async () => {
    const { data, world } = await load();
    // The rule is one function for both modules (the custom title, the title file, the name of the agent, the first prompt, the slug, the id).
    const sessions = createSessionsSource({ config: agentsConfig(world), hub: createHub(), now: () => NOW });
    const panel = await sessions.get(true);
    if (!panel.ok) throw new Error(panel.error.message);
    for (const live of data.sessions) {
      expect(live.title, live.id).toBe(panel.data.sessions.find((session) => session.id === live.id)?.title);
    }
    expect(sessionOf(data, SA).title).toBe('ALLOWED-first-prompt-of-session-a');
  });

  it('the sessions come in order of start, the oldest first, and a session with no start goes last', async () => {
    const world = copyAgentFixtures(parent);
    writeProcessFile(world, PID.A, SA, 'busy', Date.parse(at(-100))); // A started most recently
    writeFileSync(join(world.sessions, `${PID.D}.json`), JSON.stringify({ pid: PID.D, sessionId: SD, status: 'busy' })); // no start time (and a script's session)
    writeFileSync(join(world.sessions, `${PID.E}.json`), JSON.stringify({ pid: PID.E, sessionId: SB, status: 'idle', startedAt: 'yesterday' })); // a second process of B, with no usable start
    const { data } = await loadAgents({ world, claude: { includeSdk: true } });
    // B: the earliest start of its two processes (10:30); A: 100 s before NOW; D: no start.
    expect(data.sessions.map((session) => [session.id, session.startedAt])).toEqual([
      [SB, at(-5400)],
      [SA, at(-100)],
      [SD, null],
    ]);
  });
});

describe('the tree', () => {
  it('an agent links to its parent by toolUseId', async () => {
    const { data } = await load();
    const a = sessionOf(data, SA);
    // The call of aa01 is in the file of the session, so the session is its parent; the messages are the ones in that file: two calls to the agent, and one message from it.
    expect(nodeOf(a, 'aa01')).toMatchObject({ parentId: SA, kind: 'agent', messages: { count: 3, approximate: false } });
    expect(nodeOf(a, 'aa02')).toMatchObject({ parentId: SA });
    // The call of aa03 is in the file of aa01. It is the id of the call that decides, so a different id in the meta file moves the agent.
    expect(nodeOf(a, 'aa03').parentId).toBe('aa01');
    const world = copyAgentFixtures(parent);
    writeMeta(join(world.projects, WHOLE_FOLDER, SA, 'subagents', 'agent-aa03.meta.json'), { description: 'ALLOWED-check-the-schema', model: 'haiku', toolUseId: 'toolu_A02', spawnDepth: 2 });
    const moved = await loadAgents({ world });
    expect(nodeOf(sessionOf(moved.data, SA), 'aa03').parentId).toBe(SA); // the call of aa02 is in the file of the session
  });

  it('an agent with no matching call attaches to its session', async () => {
    const { data, world } = await load();
    // aa04 names a call that no file has. It is in the view, on the session, with no messages.
    expect(nodeOf(sessionOf(data, SA), 'aa04')).toMatchObject({ parentId: SA, state: 'running', messages: { count: 0, approximate: false } });

    // The same holds when the meta file has no id, when it is not there at all, and when it cannot be read as JSON: no agent is dropped for a missing link.
    const dir = join(world.projects, WHOLE_FOLDER, SA, 'subagents');
    writeMeta(join(dir, 'agent-aa04.meta.json'), { description: 'ALLOWED-orphan-task' }); // no toolUseId
    writeFileSync(join(dir, 'agent-aa03.meta.json'), '{ not json');
    rmSync(join(dir, 'agent-aa02.meta.json'));
    const result = await loadAgents({ world });
    const a = sessionOf(result.data, SA);
    expect(a.nodes.filter((node) => node.kind === 'agent').map((node) => [node.id, node.parentId])).toEqual([
      ['aa01', SA],
      ['aa02', SA],
      ['aa03', SA],
      ['aa04', SA],
    ]);
    // An agent with no meta file has no description to show: its label is "Agent" and the start of its id. It has no model.
    expect(nodeOf(a, 'aa02')).toMatchObject({ label: 'Agent aa02', model: null });
    expect(nodeOf(a, 'aa04').label).toBe('ALLOWED-orphan-task');
  });

  it('a nested agent attaches to its parent agent', async () => {
    const { data, world } = await load();
    const a = sessionOf(data, SA);
    expect(nodeOf(a, 'aa03')).toMatchObject({ parentId: 'aa01', messages: { count: 1, approximate: false } });
    // Every parent is the session or a node of the list, so a page can draw the line.
    const known = new Set([SA, ...a.nodes.map((node) => node.id)]);
    for (const node of a.nodes) expect(known.has(node.parentId), node.id).toBe(true);

    // Three levels: aa05 is started by aa03, whose file holds the call.
    const dir = join(world.projects, WHOLE_FOLDER, SA, 'subagents');
    appendFileSync(join(dir, 'agent-aa03.jsonl'), jsonl([agentCall('toolu_A05', { time: at(-50), cwd: INSIDE })]));
    setAge(join(dir, 'agent-aa03.jsonl'), 15);
    writeAged(join(dir, 'agent-aa05.jsonl'), jsonl([userPrompt('LEAK-aa05-prompt', { time: at(-45), cwd: INSIDE }), toolResult('x', { time: at(-10), cwd: INSIDE })]), 10);
    writeMeta(join(dir, 'agent-aa05.meta.json'), { description: 'ALLOWED-third-level', model: 'sonnet', toolUseId: 'toolu_A05', spawnDepth: 3 });
    const deep = await loadAgents({ world });
    expect(nodeOf(sessionOf(deep.data, SA), 'aa05')).toMatchObject({ parentId: 'aa03', label: 'ALLOWED-third-level' });

    // The parent of an agent has ended and left the view: the agent hangs on the session, and is not dropped.
    // aa06 was started by aa02, which finished 3 minutes before NOW and leaves the view 5 minutes after that.
    const world2 = copyAgentFixtures(parent);
    writeAged(join(world2.projects, WHOLE_FOLDER, SA, 'subagents', 'agent-aa02.jsonl'), jsonl([userPrompt('LEAK-aa02-prompt', { time: at(-2400), cwd: INSIDE }), agentCall('toolu_A06', { time: at(-2300), cwd: INSIDE }), assistantText('done', { time: at(-180), cwd: INSIDE })]), 180);
    writeAged(join(world2.projects, WHOLE_FOLDER, SA, 'subagents', 'agent-aa06.jsonl'), jsonl([userPrompt('LEAK-aa06-prompt', { time: at(-2290), cwd: INSIDE }), toolResult('x', { time: at(-5), cwd: INSIDE })]), 5);
    writeMeta(join(world2.projects, WHOLE_FOLDER, SA, 'subagents', 'agent-aa06.meta.json'), { description: 'ALLOWED-child-of-a-finished-agent', toolUseId: 'toolu_A06', spawnDepth: 2 });
    const whileLinger = await loadAgents({ world: world2 });
    expect(nodeOf(sessionOf(whileLinger.data, SA), 'aa06').parentId).toBe('aa02'); // aa02 is still in the view
    const afterLinger = await loadAgents({ world: world2, nowMs: NOW + 130_000 });
    expect(ids(afterLinger.data, SA)).not.toContain('aa02');
    expect(nodeOf(sessionOf(afterLinger.data, SA), 'aa06').parentId).toBe(SA); // aa02 left, so the session is the parent that can be drawn
  });

  it('message counts leave out the final report', async () => {
    const { data, world } = await load();
    const a = sessionOf(data, SA);
    // aa02 handed its final report back (a peer line with handback true). It is not a message: the one message is the call that wrote to the agent.
    expect(nodeOf(a, 'aa02').messages).toEqual({ count: 1, approximate: false });

    // The rule on lines that a test writes. Messages to aa01: two calls, one of them written twice. Messages from it: one that says handback false, one that
    // says nothing about it, and the final report. Messages that belong to others: a call to aa02, and a message from aa02 and from nobody.
    rewriteSessionA(world, [
      agentCall('toolu_A01', { time: at(-3000), cwd: INSIDE }),
      sendMessage('aa01', 'toolu_m1', { time: at(-2900), cwd: INSIDE }),
      sendMessage('aa01', 'toolu_m2', { time: at(-2800), cwd: INSIDE }),
      sendMessage('aa01', 'toolu_m2', { time: at(-2800), cwd: INSIDE }),
      peerLine('aa01', false, { time: at(-2700), cwd: INSIDE }),
      peerLine('aa01', undefined, { time: at(-2600), cwd: INSIDE }),
      peerLine('aa01', true, { time: at(-2500), cwd: INSIDE }),
      sendMessage('aa02', 'toolu_m3', { time: at(-2400), cwd: INSIDE }),
      peerLine('aa02', false, { time: at(-2300), cwd: INSIDE }),
    ]);
    const second = await loadAgents({ world });
    const counted = sessionOf(second.data, SA);
    expect(nodeOf(counted, 'aa01').messages).toEqual({ count: 4, approximate: false });
    expect(nodeOf(counted, 'aa02').messages).toEqual({ count: 2, approximate: false });
    expect(nodeOf(counted, 'aa04').messages).toEqual({ count: 0, approximate: false });
  });

  it('message count is approximate when the read bound cuts the file', async () => {
    const world = copyAgentFixtures(parent);
    const small = await loadAgents({ world });
    expect(nodeOf(sessionOf(small.data, SA), 'aa01').messages.approximate).toBe(false); // a small file is read whole

    // A session file bigger than the window: a call to aa01 at the start, then more than the window of other lines, then two calls at the end.
    const padding = `${JSON.stringify({ type: 'attachment', pad: 'x'.repeat(980) })}\n`.repeat(Math.ceil((MESSAGE_WINDOW_BYTES * 1.2) / 1000));
    const file = sessionFile(world, WHOLE_FOLDER, SA);
    writeAged(
      file,
      [
        jsonl([userPrompt('ALLOWED-first-prompt-of-session-a', { time: at(-3600), cwd: INSIDE }), agentCall('toolu_A01', { time: at(-3500), cwd: INSIDE }), sendMessage('aa01', 'toolu_old', { time: at(-3400), cwd: INSIDE })]),
        padding,
        jsonl([sendMessage('aa01', 'toolu_new1', { time: at(-120), cwd: INSIDE }), sendMessage('aa01', 'toolu_new2', { time: at(-100), cwd: INSIDE }), toolResult('x', { time: at(-60), cwd: INSIDE })]),
      ].join(''),
      30,
    );
    expect(statSync(file).size).toBeGreaterThan(MESSAGE_WINDOW_BYTES);
    const big = await loadAgents({ world });
    const aa01 = nodeOf(sessionOf(big.data, SA), 'aa01');
    // The old call is outside the window and is not counted; the count says that it may be short. The call that started aa01 is outside it too: aa01 still hangs on the session.
    expect(aa01.messages).toEqual({ count: 2, approximate: true });
    expect(aa01.parentId).toBe(SA);
    // Every agent whose parent is that file is approximate, also one with no messages at all.
    expect(nodeOf(sessionOf(big.data, SA), 'aa04').messages).toEqual({ count: 0, approximate: true });
  });

  it('a workflow is one node with progress and its agents have no nodes', async () => {
    const { data, world } = await load();
    const a = sessionOf(data, SA);
    const workflows = a.nodes.filter((node) => node.kind === 'workflow');
    expect(workflows).toHaveLength(1);
    const run = workflows[0];
    // The label is the name of the script file; the journal says: three agents started, two of them have a result, and Build is the newest phase.
    expect(run).toMatchObject({
      id: RUN,
      parentId: SA,
      kind: 'workflow',
      label: 'fixture-build',
      model: null,
      state: 'running',
      endedAt: null,
      filePath: join(world.projects, WHOLE_FOLDER, SA, 'subagents', 'workflows', RUN, 'journal.jsonl'),
      messages: { count: 0, approximate: false },
      progress: { phase: 'Build', done: 2, started: 3 },
    });
    // The time the journal was made is when the run was launched.
    expect(Math.abs(Date.parse(run?.startedAt as string) - statSync(run?.filePath as string).birthtimeMs)).toBeLessThanOrEqual(1);
    // The agents of the run have no node, and no agent has a `progress` key.
    for (const id of ['w1', 'w2', 'w3']) expect(ids(data, SA)).not.toContain(id);
    expect(ids(data, SA).sort()).toEqual(['aa01', 'aa02', 'aa03', 'aa04', RUN]);
    for (const node of a.nodes.filter((candidate) => candidate.kind === 'agent')) expect('progress' in node).toBe(false);
    expect(JSON.stringify(data)).not.toContain('LEAK-workflow-agent');

    // A run with no script file is named by its id. A run that is done (every agent has a result) stays for the linger time, like an agent.
    const bare = copyAgentFixtures(parent);
    rmSync(join(bare.projects, WHOLE_FOLDER, SA, 'workflows'), { recursive: true });
    appendFileSync(join(bare.projects, WHOLE_FOLDER, SA, 'subagents', 'workflows', RUN, 'journal.jsonl'), jsonl([{ type: 'result', key: 'Build/1', agentId: 'w3', result: 'LEAK-done' }]));
    setAge(join(bare.projects, WHOLE_FOLDER, SA, 'subagents', 'workflows', RUN, 'journal.jsonl'), 100);
    const finished = await loadAgents({ world: bare });
    expect(nodeOf(sessionOf(finished.data, SA), RUN)).toMatchObject({ label: RUN, state: 'done', progress: { phase: 'Build', done: 3, started: 3 } });
    // The journal was last written 100 s before NOW and the agent files before that: the run ended at the newest of those writes.
    expect(nodeOf(sessionOf(finished.data, SA), RUN).endedAt).toBe(at(-5)); // the newest file of the run: agent-w3.jsonl, 5 s old
    const gone = await loadAgents({ world: bare, nowMs: NOW + 400_000 });
    expect(ids(gone.data, SA)).not.toContain(RUN);
  });
});

describe('when a node is in the view', () => {
  it('a finished agent stays for the linger time and then leaves', async () => {
    // aa02 ended at 11:57:00, three minutes before NOW. It stays for 5 minutes after that.
    const { data, world, alive, source } = await load();
    expect(nodeOf(sessionOf(data, SA), 'aa02')).toMatchObject({ state: 'done', endedAt: '2026-10-06T11:57:00.000Z' });
    expect(nodeOf(sessionOf(data, SA), 'aa01')).toMatchObject({ state: 'running', endedAt: null });

    const at11_57 = Date.parse('2026-10-06T11:57:00.000Z');
    const lingering = await loadAgents({ world, nowMs: at11_57 + 299_000 });
    expect(ids(lingering.data, SA)).toContain('aa02');
    const left = await loadAgents({ world, nowMs: at11_57 + 300_000 }); // at the end of the five minutes
    expect(ids(left.data, SA)).not.toContain('aa02');
    expect(ids(left.data, SA)).toContain('aa01'); // an agent that still runs does not leave

    // The time is the setting `agents.lingerSeconds`.
    const short = await loadAgents({ world, agents: { lingerSeconds: 60 } });
    expect(ids(short.data, SA)).not.toContain('aa02');
    const long = await loadAgents({ world, nowMs: at11_57 + 3_000_000, agents: { lingerSeconds: 3600 } });
    expect(ids(long.data, SA)).toContain('aa02');
    const none = await loadAgents({ world, agents: { lingerSeconds: 0 } });
    expect(ids(none.data, SA)).not.toContain('aa02');

    // A closed session leaves at once, with its agents that are still in the linger time.
    expect(ids(data, SA)).toContain('aa02');
    alive.delete(PID.A);
    const closed = await source.get(true);
    expect(closed.ok && closed.data.sessions.map((session) => session.id)).toEqual([SB]);
    expect(JSON.stringify(closed)).not.toContain('aa02');
  });

  it('an agent with no end record runs while its session is busy and stops when idle', async () => {
    // bb01 has no end record and its file has been silent for 10 minutes. B is idle: the agent stopped, and it is not in the view.
    const { data, world } = await load();
    expect(sessionOf(data, SB).state).toBe('waiting');
    expect(sessionOf(data, SB).nodes).toEqual([]);

    // B works: a long tool call writes nothing, so the agent still runs.
    setStatus(world, PID.B, 'busy');
    const busy = await loadAgents({ world });
    expect(sessionOf(busy.data, SB).state).toBe('working');
    expect(nodeOf(sessionOf(busy.data, SB), 'bb01')).toMatchObject({ kind: 'agent', state: 'running', endedAt: null, label: 'ALLOWED-long-tool-call', model: 'opus', parentId: SB });

    // B waits again: the agent is gone with the next look.
    setStatus(world, PID.B, 'idle');
    expect(sessionOf((await loadAgents({ world })).data, SB).nodes).toEqual([]);

    // An agent whose file was written in the last 5 minutes runs, whatever its session does.
    setAge(agentFile(world, MIXED_FOLDER, SB, 'bb01'), 240);
    expect(ids((await loadAgents({ world })).data, SB)).toEqual(['bb01']);
    setAge(agentFile(world, MIXED_FOLDER, SB, 'bb01'), 301);
    expect(ids((await loadAgents({ world })).data, SB)).toEqual([]);
    // The time is the setting `claude.workingSeconds`.
    expect(ids((await loadAgents({ world, claude: { workingSeconds: 400 } })).data, SB)).toEqual(['bb01']);

    // An agent that ended is done whatever its session does, even when the session is busy: the end record decides.
    const ended = copyAgentFixtures(parent);
    setStatus(ended, PID.B, 'busy');
    writeAged(agentFile(ended, MIXED_FOLDER, SB, 'bb01'), jsonl([userPrompt('LEAK-p', { time: at(-900), cwd: INSIDE }), assistantText('finished', { time: at(-100), cwd: INSIDE })]), 100);
    expect(nodeOf(sessionOf((await loadAgents({ world: ended })).data, SB), 'bb01')).toMatchObject({ state: 'done', endedAt: at(-100) });
  });

  it('a silent agent stops after the stale time even when its session is busy', async () => {
    // An agent that Mark stops writes no end record, so the busy-session rule alone would show it as running for as long as the session works. It stops after
    // `agents.staleSeconds` (1800 s, 30 minutes) without a write. The agent is bb01 of session B: no end record, and a file with an age that the test sets.
    const STALE = 1800;
    const world = copyAgentFixtures(parent);
    const bb01 = agentFile(world, MIXED_FOLDER, SB, 'bb01');
    const bIds = async (options: Partial<Parameters<typeof loadAgents>[0]> = {}) => ids((await loadAgents({ world, ...options })).data, SB);

    // A busy session: the agent runs just inside the stale time, and at the bound. One second later it is gone, and the session is still there and works.
    setStatus(world, PID.B, 'busy');
    setAge(bb01, STALE - 1);
    expect(await bIds()).toEqual(['bb01']);
    setAge(bb01, STALE);
    expect(await bIds()).toEqual(['bb01']);
    setAge(bb01, STALE + 1);
    const outside = await loadAgents({ world });
    expect(sessionOf(outside.data, SB)).toMatchObject({ state: 'working', nodes: [] });
    setAge(bb01, 86_400); // a day
    expect(await bIds()).toEqual([]);

    // A write brings it back: the agent has a new line, so its file is fresh again.
    setAge(bb01, 5);
    expect(await bIds()).toEqual(['bb01']);

    // An idle session stops it at once, also just inside the stale time. A file written within the working time runs whatever the session does.
    setStatus(world, PID.B, 'idle');
    setAge(bb01, STALE - 1);
    expect(await bIds()).toEqual([]);
    setAge(bb01, 600);
    expect(await bIds()).toEqual([]);
    setAge(bb01, 240);
    expect(await bIds()).toEqual(['bb01']);

    // The time is the setting `agents.staleSeconds`. (It cannot make the working time shorter: a file written in the last 5 minutes runs whatever it says.)
    setStatus(world, PID.B, 'busy');
    setAge(bb01, 599);
    expect(await bIds({ agents: { staleSeconds: 600 } })).toEqual(['bb01']);
    setAge(bb01, 601);
    expect(await bIds({ agents: { staleSeconds: 600 } })).toEqual([]);
    setAge(bb01, 3 * 3600);
    expect(await bIds({ agents: { staleSeconds: 4 * 3600 } })).toEqual(['bb01']);
    setAge(bb01, 240);
    expect(await bIds({ agents: { staleSeconds: 60 } })).toEqual(['bb01']);

    // The file-age fallback has the same rule: there a session that works counts as busy.
    const fallback = { claude: { sessionsRoot: join(parent, 'no-process-list-for-the-stale-test') } };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const file = sessionFile(world, MIXED_FOLDER, SB);
      appendFileSync(file, jsonl([toolResult('x', { time: at(-20), cwd: INSIDE })]));
      setAge(file, 20); // B works
      setAge(bb01, STALE - 1);
      const inside = await bIds(fallback);
      expect(inside).toEqual(['bb01']);
      setAge(bb01, STALE + 1);
      const gone = await loadAgents({ world, ...fallback });
      expect(sessionOf(gone.data, SB)).toMatchObject({ state: 'working', nodes: [] });
    } finally {
      quiet.mockRestore();
    }
  });

  it('a workflow run that is silent for the stale time stops in a busy session too, and the agents that write stay', async () => {
    // Session A is busy. The files of its run (the journal and the three agents) have not been written for 31 minutes, and the run has no end: three agents
    // started and two have a result. The other agents of A write lately.
    const STALE = 1800;
    const run = ['journal.jsonl', 'agent-w1.jsonl', 'agent-w2.jsonl', 'agent-w3.jsonl'];
    const world = copyAgentFixtures(parent);
    const setRunAge = (age: number) => {
      for (const name of run) setAge(join(world.projects, WHOLE_FOLDER, SA, 'subagents', 'workflows', RUN, name), age);
    };
    setRunAge(STALE - 1);
    const inside = await loadAgents({ world });
    expect(nodeOf(sessionOf(inside.data, SA), RUN)).toMatchObject({ kind: 'workflow', state: 'running' });
    setRunAge(STALE + 1);
    const outside = await loadAgents({ world });
    expect(ids(outside.data, SA)).not.toContain(RUN);
    expect(ids(outside.data, SA)).toEqual(expect.arrayContaining(['aa01', 'aa02', 'aa03', 'aa04'])); // the agents that write stay
    // One write to any file of the run is a write of the run.
    setAge(join(world.projects, WHOLE_FOLDER, SA, 'subagents', 'workflows', RUN, 'agent-w3.jsonl'), 30);
    expect(ids((await loadAgents({ world })).data, SA)).toContain(RUN);
  });
});

describe('the source', () => {
  it('the live event for agents is sent only when the data changes', async () => {
    const { source, events, world } = await load();
    expect(events).toEqual([expect.objectContaining({ module: 'agents' })]); // the first look
    await source.get(true);
    await source.get(true);
    expect(events).toHaveLength(1); // nothing changed: a page is not told to load again

    // A process starts to be busy: the data changes, and one event goes out.
    setStatus(world, PID.B, 'busy');
    await source.get(true);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ module: 'agents' });
    await source.get(true);
    expect(events).toHaveLength(2);

    // A message goes to an agent: the count changes, and so does the data.
    const file = sessionFile(world, WHOLE_FOLDER, SA);
    appendFileSync(file, jsonl([sendMessage('aa04', 'toolu_late', { time: at(-5), cwd: INSIDE })]));
    setAge(file, 5);
    await source.get(true);
    expect(events).toHaveLength(3);

    // A file that is written without a change of what it says (the time of last write only) changes nothing that a page shows.
    setAge(file, 6);
    await source.get(true);
    expect(events).toHaveLength(3);
  });

  it('start() looks at once and then every agents.pollMs, and stop() ends it', async () => {
    // Only the timers of the interval are faked: the files are read for real, and the test waits for them with real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const world = copyAgentFixtures(parent);
      const config = agentsConfig(world, {}, { pollMs: 3000 });
      expect(config.agents.pollMs).toBe(3000);
      const hub = createHub();
      const events: ChangeEvent[] = [];
      hub.subscribe((event) => events.push(event));
      const alive = aliveSet();
      const source = createAgentsSource({ config, hub, now: () => NOW, isAlive: (pid) => alive.has(pid) });

      source.start();
      await until(() => events.length === 1); // the first look, at once
      setStatus(world, PID.B, 'busy');
      vi.advanceTimersByTime(2999);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1); // not yet
      vi.advanceTimersByTime(1);
      await until(() => events.length === 2); // 3 s after the start: it looked again and found the change

      source.stop();
      setStatus(world, PID.B, 'idle');
      vi.advanceTimersByTime(10_000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events).toHaveLength(2); // stopped: no more looks
    } finally {
      vi.useRealTimers();
    }
  });

  it('the interval is the setting agents.pollMs', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const world = copyAgentFixtures(parent);
      const hub = createHub();
      const events: ChangeEvent[] = [];
      hub.subscribe((event) => events.push(event));
      const source = createAgentsSource({ config: agentsConfig(world, {}, { pollMs: 500 }), hub, now: () => NOW, isAlive: (pid) => aliveSet().has(pid) });
      source.start();
      await until(() => events.length === 1);
      setStatus(world, PID.B, 'busy');
      vi.advanceTimersByTime(499);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await until(() => events.length === 2);
      source.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an answer is a Panel: the data, and the time it was made', async () => {
    const { source } = await load();
    const panel = await source.get();
    expect(panel).toMatchObject({ ok: true, data: { source: 'process-list', hiddenScripts: 1 } });
    expect(Number.isNaN(Date.parse(panel.updatedAt ?? ''))).toBe(false);
  });
});

describe('the tests never read the processes of this machine', () => {
  it('the test config and the configs of the fixture worlds name a folder of their own for the process list', () => {
    // Only the test that needs CC_REAL_AGENTS=1 reads the real folder (tests/agents-real.test.ts). Every other config points into the temp folder.
    const real = join(homedir(), '.claude');
    expect(isInside(tmpdir(), makeTestConfig().claude.sessionsRoot)).toBe(true);
    expect(isInside(real, makeTestConfig().claude.sessionsRoot)).toBe(false);
    const world = copyAgentFixtures(parent);
    expect(isInside(parent, agentsConfig(world).claude.sessionsRoot)).toBe(true);
  });
});

describe('failures', () => {
  afterEach(() => vi.restoreAllMocks());

  it('an unexpected failure is a panel error with the last good data, and the message names no path', async () => {
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const world = copyAgentFixtures(parent);
    const config = agentsConfig(world);
    let broken = false;
    const source = createAgentsSource({
      config,
      hub: createHub(),
      now: () => {
        if (broken) throw Object.assign(new Error(`cannot read ${world.root}`), { code: 'EACCES' });
        return NOW;
      },
      isAlive: (pid) => aliveSet().has(pid),
    });
    const first = await source.get(true);
    expect(first.ok).toBe(true);

    broken = true;
    const failed = await source.get(true);
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('agents-failed');
    expect(failed.error.message).toContain('EACCES');
    expect(failed.error.message).not.toContain(world.root);
    expect(failed.lastGood?.data.sessions.map((session) => session.id)).toEqual([SB, SA]); // a page can show the error and the last list together
    expect(complaints).toHaveBeenCalled();

    // The next look that works is a good panel again.
    broken = false;
    expect((await source.get(true)).ok).toBe(true);
  });

  it('a file system problem in the fallback folder listing is the same panel error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const world = copyAgentFixtures(parent);
    // The folder of the process list is missing, so the fallback lists the session folders. A folder name that no file system can read fails the listing.
    const config = agentsConfig(world, { sessionsRoot: join(parent, 'no-list'), folders: ['bad\0name'], cwdMatchFolders: [] });
    const source = createAgentsSource({ config, hub: createHub(), now: () => NOW });
    const panel = await source.get(true);
    expect(panel.ok).toBe(false);
    if (panel.ok) return;
    expect(panel.error.code).toBe('agents-failed');
    expect(panel.error.message).not.toContain(world.root);
  });

  it('a bad line never throws: a half-written last line, a long line and an unknown line type in the files of a session', async () => {
    const world = copyAgentFixtures(parent);
    const dir = join(world.projects, WHOLE_FOLDER, SA, 'subagents');
    const lines = jsonl([userPrompt('ALLOWED-first-prompt-of-session-a', { time: at(-3600), cwd: INSIDE }), agentCall('toolu_A01', { time: at(-3500), cwd: INSIDE }), toolResult('x', { time: at(-60), cwd: INSIDE })]);
    // The session file ends in half a line, the agent file is one line of a megabyte and a half, and the other holds a type that nobody knows.
    writeAged(sessionFile(world, WHOLE_FOLDER, SA), `${lines}{"type":"assistant","message":{"content":[{"type":"tool_use","na`, 30);
    writeAged(join(dir, 'agent-aa01.jsonl'), `${JSON.stringify({ type: 'user', pad: 'x'.repeat(1_500_000) })}\n`, 20);
    writeAged(join(dir, 'agent-aa03.jsonl'), `${JSON.stringify({ type: 'from-the-future', cwd: INSIDE })}\nnot json at all\n`, 20);
    const { data } = await loadAgents({ world });
    const a = sessionOf(data, SA);
    // Nobody is dropped. An agent whose end cannot be read is not known to have ended, and its file is fresh, so it runs.
    expect(ids(data, SA)).toEqual(expect.arrayContaining(['aa01', 'aa03', 'aa04']));
    expect(nodeOf(a, 'aa01')).toMatchObject({ state: 'running', parentId: SA });
  });
});
