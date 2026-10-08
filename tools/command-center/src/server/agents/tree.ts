import type { LiveNode } from '../../shared/types';
import { isLine } from '../sessions/parse';

// The tree builder of the agents module: pure functions that turn what was read from the files of one session into the boxes under its
// session box. They read no file, so they are tested with made-up lines. The module (module.ts) does the reading and hands the results here.
//
// The tree comes from calls. An agent's `.meta.json` holds `toolUseId`, the id of the `Agent` call that started it, and the call itself is a
// `tool_use` line in the file of whoever made it: the session, or another agent. The same file holds the messages that went between the two
// (a `SendMessage` call to the agent, and the messages that the agent sent back), so one read of the parent's file gives the link and the count.

/**
 * How much of the end of a parent's file is read for the calls and the messages: 1 MiB. A session file can be hundreds of megabytes, so the
 * read is bounded; a call or a message older than the window is not seen, and the count says so (`approximate`).
 */
export const MESSAGE_WINDOW_BYTES = 1024 * 1024;

// ---- the files of a session ----

// `newestWrite` lives in the sessions module (discover.ts), which both modules use; it is re-exported here for the callers of this file.
export { newestWrite } from '../sessions/discover';

// ---- the model ----

/** The family in a model id of Claude: `claude-fable-5-1` is `fable`. The digits after the family are the version. */
const MODEL_FAMILY = /^claude-([a-z]+)-\d/;

/** The longest model name that is kept when it is not a Claude id. */
const MAX_MODEL_CHARS = 12;

/** A box shows the family (`fable`), not the whole id. Another value stays as it is, cut to 12 characters. No model: null. */
export function modelFamily(raw: string): string | null {
  const model = raw.trim();
  if (model === '') return null;
  return MODEL_FAMILY.exec(model)?.[1] ?? [...model].slice(0, MAX_MODEL_CHARS).join('');
}

// ---- the state of a node ----

/**
 * Whether a node is in the view, and what it shows.
 * - It ended (it has an end record): `done`, until `lingerMs` after it ended. Then it leaves.
 * - It has no end record: `running` while its file was written within `workingMs`. A busy session keeps it running for longer, up to `staleMs`
 *   without a write, because a long tool call writes nothing (ruling R36). After that it counts as stopped even in a busy session, because an agent that
 *   Mark stops writes no end record (ruling R39). In an idle session it stops as soon as the working time is over.
 *
 * A node that stopped is not in the view: null. `lastWriteMs` is the last write to the file of the node (for a workflow run, the newest write to any file of
 * the run). A write a little ahead of the clock counts as a write that just happened.
 */
export function liveStateOf(input: {
  ended: boolean;
  endedAtMs: number;
  lastWriteMs: number;
  busy: boolean;
  nowMs: number;
  lingerMs: number;
  workingMs: number;
  staleMs: number;
}): 'running' | 'done' | null {
  if (input.ended) return input.nowMs < input.endedAtMs + input.lingerMs ? 'done' : null;
  const silentMs = input.nowMs - input.lastWriteMs;
  if (silentMs <= input.workingMs) return 'running';
  return input.busy && silentMs <= input.staleMs ? 'running' : null;
}

// ---- what a parent's file says ----

/** What the end of one parent's file (a session file or an agent file) says. */
export type FileScan = {
  /** The ids of the `Agent` calls in it: each is the `toolUseId` of an agent that this file started. */
  calls: ReadonlySet<string>;
  /** For each agent id, the messages in this file that went to the agent or came from it. The final report is not one. */
  messages: ReadonlyMap<string, number>;
  /** The file is larger than the part that was read, so a call or a message older than that part is missing. */
  approximate: boolean;
};

/** The blocks of the message of a line (text, tool calls ...), or none. */
function blocksOf(line: Record<string, unknown>): Record<string, unknown>[] {
  const content = isLine(line.message) ? line.message.content : undefined;
  return Array.isArray(content) ? content.filter(isLine) : [];
}

/**
 * Reads the lines of the end of a parent's file. It looks at three things and keeps no text of any of them:
 * - an `Agent` call (a `tool_use` block of an assistant line named `Agent`): its id;
 * - a `SendMessage` call: the parent wrote to the agent that `input.to` names. A call counts once, by the id of the call: a line that is written twice is one call;
 * - a message from an agent: a `user` line whose `origin` is `peer`, from the agent. When the agent hands back its final report, the line says
 *   `handback: true`, and that line is the end of the agent, not a message.
 *
 * It reads past every line it does not know. Nothing here throws.
 */
export function scanLines(lines: readonly unknown[], approximate: boolean): FileScan {
  const calls = new Set<string>();
  const messages = new Map<string, number>();
  const seenMessageCalls = new Set<string>();
  const count = (agentId: string) => messages.set(agentId, (messages.get(agentId) ?? 0) + 1);

  for (const line of lines) {
    if (!isLine(line)) continue;
    if (line.type === 'assistant') {
      for (const block of blocksOf(line)) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'Agent' && typeof block.id === 'string') {
          calls.add(block.id);
        } else if (block.name === 'SendMessage' && isLine(block.input) && typeof block.input.to === 'string') {
          if (typeof block.id === 'string') {
            if (seenMessageCalls.has(block.id)) continue;
            seenMessageCalls.add(block.id);
          }
          count(block.input.to);
        }
      }
    } else if (line.type === 'user' && isLine(line.origin) && line.origin.kind === 'peer' && typeof line.origin.from === 'string' && line.origin.handback !== true) {
      count(line.origin.from);
    }
  }
  return { calls, messages, approximate };
}

// ---- the tree ----

/**
 * A node as the module hands it over: everything of a `LiveNode` except the parent and the messages, which this file works out, and the id
 * of the call that started it (null when the agent's `.meta.json` has none, and always null for a workflow).
 */
export type NodeCandidate = Omit<LiveNode, 'parentId' | 'messages'> & { toolUseId: string | null };

/** A start as a number to sort by. A start that is missing, or is not a time, is infinitely late: it goes last. */
const startKey = (startedAt: string | null): number => {
  const ms = startedAt === null ? Number.NaN : Date.parse(startedAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
};

/** The earlier start first, a node with no start last, and the id to break a tie, so the order never changes between two looks. */
export const inOrderOfStart = (a: { startedAt: string | null; id: string }, b: { startedAt: string | null; id: string }): number => {
  const aKey = startKey(a.startedAt);
  const bKey = startKey(b.startedAt);
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * The boxes under one session, with who started each one and how many messages passed between them.
 *
 * `scans` has one entry for the session (by its id) and one for each agent whose file was read, by the agent's id. An agent hangs on the owner
 * of the call that started it: the session when its file has the call, else another agent whose file has it. When no file has the call (it is older
 * than the part that was read, or the agent has no `toolUseId`), the agent hangs on the session. No node is dropped for a missing link.
 * Every parent is the session or a node in the list, so a page can always draw the line.
 *
 * The messages of an agent are counted in the file of its parent only: the file of the agent itself says the same thing from the other side, and
 * a message would count twice. A workflow has none.
 */
export function buildNodes(sessionId: string, candidates: readonly NodeCandidate[], scans: ReadonlyMap<string, FileScan>): LiveNode[] {
  const byId = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const agents = byId.filter((node) => node.kind === 'agent');

  const parentOf = (node: NodeCandidate): string => {
    const call = node.kind === 'agent' ? node.toolUseId : null;
    if (call === null || call === '') return sessionId;
    if (scans.get(sessionId)?.calls.has(call)) return sessionId;
    // Not an agent's own call: a file that says so about itself is not the parent.
    return agents.find((other) => other.id !== node.id && scans.get(other.id)?.calls.has(call))?.id ?? sessionId;
  };
  const parents = new Map(byId.map((node) => [node.id, parentOf(node)] as const));

  // The files are Claude Code's, and a call cannot be in two files, so a loop of parents should not exist. A damaged or made-up file could still
  // make one, and a page that draws a loop never ends. A node that is in a loop hangs on the session instead, which breaks the loop.
  for (const node of byId) {
    // Walk up from the node. If the walk comes back to the node, it is in a loop. If it reaches a node it has passed before, the loop is
    // somewhere above and does not include this node: that loop is cut when its own members come up in this walk.
    const seen = new Set<string>();
    for (let at = parents.get(node.id); at !== undefined && at !== sessionId && !seen.has(at); at = parents.get(at)) {
      if (at === node.id) {
        parents.set(node.id, sessionId);
        break;
      }
      seen.add(at);
    }
  }

  return candidates
    .map((node): LiveNode => {
      const parentId = parents.get(node.id) ?? sessionId;
      const scan = scans.get(parentId);
      const live: LiveNode = {
        id: node.id,
        parentId,
        kind: node.kind,
        label: node.label,
        model: node.model,
        state: node.state,
        startedAt: node.startedAt,
        endedAt: node.endedAt,
        filePath: node.filePath,
        messages: node.kind === 'agent' ? { count: scan?.messages.get(node.id) ?? 0, approximate: scan?.approximate ?? false } : { count: 0, approximate: false },
      };
      if (node.progress !== undefined) live.progress = node.progress;
      return live;
    })
    .sort(inOrderOfStart);
}
