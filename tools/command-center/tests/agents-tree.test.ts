import { describe, expect, it } from 'vitest';
import { type FileScan, MESSAGE_WINDOW_BYTES, type NodeCandidate, buildNodes, liveStateOf, modelFamily, scanLines } from '../src/server/agents/tree';

// The tree builder: pure functions that turn what was read from the files of one session into the boxes under its session box. They read no file.
// The lines below are made up, in the shape of Claude Code's session files.

const SESSION = 'session-0001';

// ---- lines ----

const agentCall = (id: string): unknown => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { description: 'LEAK-agent-call-description', prompt: 'LEAK-agent-call-prompt' } }] },
});
const sendMessage = (to: string, id = `toolu_msg_${to}_${Math.random()}`): unknown => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'SendMessage', input: { to, message: 'LEAK-message-text' } }] },
});
const peer = (from: string, handback?: boolean): unknown => ({
  type: 'user',
  isMeta: true,
  origin: { kind: 'peer', from, name: 'general-purpose', ...(handback === undefined ? {} : { handback }) },
  message: { role: 'user', content: 'LEAK-peer-text' },
});

// ---- the model family ----

describe('modelFamily', () => {
  it('gives the family of a Claude model id, and the other values as they are, cut to 12 characters', () => {
    expect(modelFamily('claude-fable-5-1')).toBe('fable');
    expect(modelFamily('claude-opus-4-1-20250805')).toBe('opus');
    expect(modelFamily('claude-sonnet-4-5')).toBe('sonnet');
    // A family name stays.
    expect(modelFamily('fable')).toBe('fable');
    expect(modelFamily('haiku')).toBe('haiku');
    // Nothing: no model.
    expect(modelFamily('')).toBeNull();
    expect(modelFamily('   ')).toBeNull();
    // Not a Claude id of the new kind (the digits come first, or a capital letter): it stays, cut to 12 characters.
    expect(modelFamily('claude-3-5-sonnet-20241022')).toBe('claude-3-5-s');
    expect(modelFamily('Claude-Fable-5-1')).toBe('Claude-Fable');
    expect(modelFamily('a-very-long-model-name')).toBe('a-very-long-');
    expect(modelFamily('short-id')).toBe('short-id');
    // 12 characters, not 12 UTF-16 units: a picture is not cut in half.
    expect(modelFamily('🟢'.repeat(14))).toBe('🟢'.repeat(12));
  });
});

// ---- the state of a node ----

describe('liveStateOf', () => {
  const base = { endedAtMs: 1_000_000, fresh: false, busy: false, nowMs: 1_000_000, lingerMs: 300_000 };

  it('a node that ended stays for the linger time and then leaves, whatever its session does', () => {
    expect(liveStateOf({ ...base, ended: true, nowMs: 1_000_000 })).toBe('done');
    expect(liveStateOf({ ...base, ended: true, nowMs: 1_000_000 + 299_999 })).toBe('done');
    expect(liveStateOf({ ...base, ended: true, nowMs: 1_000_000 + 300_000 })).toBeNull(); // it stays until the end of the linger time
    expect(liveStateOf({ ...base, ended: true, nowMs: 1_000_000 + 900_000, busy: true, fresh: true })).toBeNull();
    // A linger time of 0 lets it leave at once.
    expect(liveStateOf({ ...base, ended: true, lingerMs: 0 })).toBeNull();
  });

  it('a node with no end record runs when its file is fresh or its session is busy, and is left out otherwise', () => {
    expect(liveStateOf({ ...base, ended: false, fresh: true })).toBe('running');
    expect(liveStateOf({ ...base, ended: false, busy: true })).toBe('running'); // a long tool call writes nothing
    expect(liveStateOf({ ...base, ended: false, fresh: true, busy: true })).toBe('running');
    expect(liveStateOf({ ...base, ended: false })).toBeNull(); // stopped
  });
});

// ---- what a parent's file says ----

describe('scanLines', () => {
  it('collects the ids of the Agent calls, and counts the messages for each agent in both directions', () => {
    const scan = scanLines([agentCall('toolu_1'), agentCall('toolu_2'), sendMessage('agent-a'), sendMessage('agent-a'), sendMessage('agent-b'), peer('agent-a'), peer('agent-c')], false);
    expect([...scan.calls].sort()).toEqual(['toolu_1', 'toolu_2']);
    expect(Object.fromEntries(scan.messages)).toEqual({ 'agent-a': 3, 'agent-b': 1, 'agent-c': 1 });
    expect(scan.approximate).toBe(false);
  });

  it('leaves out the final report: a peer line with handback true is not a message, and one with no handback is', () => {
    const scan = scanLines([peer('agent-a', true), peer('agent-a', false), peer('agent-a'), peer('agent-b', true)], true);
    expect(Object.fromEntries(scan.messages)).toEqual({ 'agent-a': 2 });
    expect(scan.approximate).toBe(true);
  });

  it('counts a call once, also when a line is written twice', () => {
    const call = sendMessage('agent-a', 'toolu_same');
    const scan = scanLines([call, call, sendMessage('agent-a', 'toolu_other')], false);
    expect(scan.messages.get('agent-a')).toBe(2);
  });

  it('reads past every line it does not know, and never throws', () => {
    const odd: unknown[] = [
      null,
      42,
      'text',
      [],
      {},
      { type: 'assistant' },
      { type: 'assistant', message: null },
      { type: 'assistant', message: { content: 'plain text' } },
      { type: 'assistant', message: { content: [null, 7, 'x', { type: 'tool_use' }, { type: 'tool_use', name: 'Agent' }, { type: 'tool_use', name: 'Agent', id: 5 }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SendMessage', id: 'toolu_x', input: null }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SendMessage', id: 'toolu_y', input: { to: 5 } }] } },
      { type: 'user', origin: null },
      { type: 'user', origin: 'peer' },
      { type: 'user', origin: { kind: 'peer' } },
      { type: 'user', origin: { kind: 'peer', from: 7 } },
      { type: 'user', origin: { kind: 'human', from: 'agent-a' } },
      { type: 'user', origin: { kind: 'task-notification', from: 'agent-a' } },
    ];
    const scan = scanLines(odd, false);
    expect(scan.calls.size).toBe(0);
    expect(scan.messages.size).toBe(0);
  });

  it('the window is 1 MiB', () => {
    expect(MESSAGE_WINDOW_BYTES).toBe(1024 * 1024);
  });
});

// ---- the tree ----

/** A node as the module hands it over before the tree is built: everything but the parent and the messages, and the id of the call that started it. */
function candidate(id: string, startedAt: string | null, toolUseId: string | null = null, extra: Partial<NodeCandidate> = {}): NodeCandidate {
  return { id, kind: 'agent', label: `label ${id}`, model: null, state: 'running', startedAt, endedAt: null, filePath: `/fixture/${id}.jsonl`, toolUseId, ...extra };
}

const scan = (calls: string[], messages: Record<string, number> = {}, approximate = false): FileScan => ({ calls: new Set(calls), messages: new Map(Object.entries(messages)), approximate });

const T = (minutes: number) => new Date(Date.UTC(2026, 9, 6, 12, minutes)).toISOString();

describe('buildNodes', () => {
  it('an agent whose call is in the file of the session hangs on the session, and its messages are counted in that file', () => {
    const nodes = buildNodes(SESSION, [candidate('a1', T(1), 'toolu_1')], new Map([[SESSION, scan(['toolu_1'], { a1: 3 })]]));
    expect(nodes).toEqual([expect.objectContaining({ id: 'a1', parentId: SESSION, messages: { count: 3, approximate: false } })]);
  });

  it('an agent whose call is in the file of another agent hangs on that agent, and its messages are counted in that agent file', () => {
    const scans = new Map([
      [SESSION, scan(['toolu_1'], { a1: 2, a2: 99 })], // the 99 is a message of the session to a2, and it is not the parent of a2
      ['a1', scan(['toolu_2'], { a2: 4 }, true)],
    ]);
    const nodes = buildNodes(SESSION, [candidate('a1', T(1), 'toolu_1'), candidate('a2', T(2), 'toolu_2')], scans);
    expect(nodes.map((node) => [node.id, node.parentId, node.messages])).toEqual([
      ['a1', SESSION, { count: 2, approximate: false }],
      ['a2', 'a1', { count: 4, approximate: true }],
    ]);
  });

  it('a chain of three agents hangs level by level', () => {
    const scans = new Map([
      [SESSION, scan(['toolu_1'])],
      ['a1', scan(['toolu_2'])],
      ['a2', scan(['toolu_3'])],
    ]);
    const nodes = buildNodes(SESSION, [candidate('a3', T(3), 'toolu_3'), candidate('a1', T(1), 'toolu_1'), candidate('a2', T(2), 'toolu_2')], scans);
    expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['a1', SESSION],
      ['a2', 'a1'],
      ['a3', 'a2'],
    ]);
  });

  it('an agent with no call anywhere, no id of a call, or a call in a file that was not read hangs on the session, and is never dropped', () => {
    const nodes = buildNodes(SESSION, [candidate('a1', T(1), 'toolu_nowhere'), candidate('a2', T(2), null), candidate('a3', T(3), 'toolu_in_a_file_not_read')], new Map([[SESSION, scan(['toolu_other'])]]));
    expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
      ['a1', SESSION],
      ['a2', SESSION],
      ['a3', SESSION],
    ]);
    // With no scan at all (the file could not be read) the same holds, and the count is 0.
    const unread = buildNodes(SESSION, [candidate('a1', T(1), 'toolu_1')], new Map());
    expect(unread).toEqual([expect.objectContaining({ id: 'a1', parentId: SESSION, messages: { count: 0, approximate: false } })]);
  });

  it('an agent never hangs on itself, and two agents that claim each other end as a tree, not a loop', () => {
    // a1 says that its own call is in its own file, and a2 and a3 say that theirs are in each other's.
    const scans = new Map([
      ['a1', scan(['toolu_1'])],
      ['a2', scan(['toolu_3'])],
      ['a3', scan(['toolu_2'])],
    ]);
    const nodes = buildNodes(SESSION, [candidate('a1', T(1), 'toolu_1'), candidate('a2', T(2), 'toolu_2'), candidate('a3', T(3), 'toolu_3')], scans);
    const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
    expect(parentOf.get('a1')).toBe(SESSION);
    // Walking up from each node reaches the session, and does not turn in a circle.
    for (const node of nodes) {
      let at: string | undefined = node.id;
      for (let steps = 0; at !== SESSION; steps += 1) {
        expect(steps, `the way up from ${node.id}`).toBeLessThan(nodes.length + 1);
        at = parentOf.get(at as string);
        expect(at).toBeDefined();
      }
    }
  });

  it('a workflow hangs on the session and has no messages, and keeps its progress', () => {
    const workflow = candidate('wf_1', T(1), null, { kind: 'workflow', label: 'build', progress: { phase: 'plan', done: 1, started: 3 }, filePath: '/fixture/journal.jsonl' });
    const nodes = buildNodes(SESSION, [workflow], new Map([[SESSION, scan([], { wf_1: 7 }, true)]]));
    expect(nodes).toEqual([
      {
        id: 'wf_1',
        parentId: SESSION,
        kind: 'workflow',
        label: 'build',
        model: null,
        state: 'running',
        startedAt: T(1),
        endedAt: null,
        filePath: '/fixture/journal.jsonl',
        messages: { count: 0, approximate: false },
        progress: { phase: 'plan', done: 1, started: 3 },
      },
    ]);
    // An agent has no `progress` key at all (not a key with no value).
    const agent = buildNodes(SESSION, [candidate('a1', T(1))], new Map())[0];
    expect(agent && 'progress' in agent).toBe(false);
    // The id of the call that started a node is for the tree only: it is not in the node.
    expect(agent && 'toolUseId' in agent).toBe(false);
  });

  it('the nodes come in order of start, a node with no start goes last, and a tie is broken by the id', () => {
    const nodes = buildNodes(SESSION, [candidate('late', T(9)), candidate('none-b', null), candidate('early', T(1)), candidate('none-a', null), candidate('tie-b', T(5)), candidate('tie-a', T(5))], new Map());
    expect(nodes.map((node) => node.id)).toEqual(['early', 'tie-a', 'tie-b', 'late', 'none-a', 'none-b']);
  });
});
