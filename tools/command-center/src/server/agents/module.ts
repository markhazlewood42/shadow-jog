import { join } from 'node:path';
import type { AgentsLive, LiveNode, LiveSession } from '../../shared/types';
import type { Config } from '../config';
import type { Hub } from '../hub';
import { say } from '../messages';
import { PanelError, type PanelSource, createPanelSource } from '../source';
import { type AgentFile, type FileStamp, type SessionFile, type SessionTree, type WorkflowFolder, keepSession, listSessionFiles, listSessionTree, sessionSources, stampOf } from '../sessions/discover';
import { applyAge, isSdkEntrypoint, readJournal, workflowStateOf } from '../sessions/parse';
import { type SessionFacts, codeOf, createSessionReader, createdMs, isoOf } from '../sessions/reader';
import { readTail } from '../sessions/tail';
import { type IsAlive, type ProcessEntry, processIsAlive, readProcessList } from './process-list';
import { type FileScan, MESSAGE_WINDOW_BYTES, type NodeCandidate, buildNodes, inOrderOfStart, liveStateOf, modelFamily, scanLines } from './tree';

// The agents module: the Claude sessions about Shadow Jog that are alive now, with their agents and workflows, as a tree. It is the data of the Agents
// page and of the Running panel of the Now page.
//
// It is not the sessions module (src/server/sessions), which lists the sessions of the last week for the Your move panel and looks every 10 seconds
// over all of their files. This one is cheap enough to look every 3 seconds, because it starts from the process list of Claude Code (the folder
// `~/.claude/sessions`, one small file for each Claude process that runs) and reads the files of those sessions only. A session whose process is gone
// is never opened. Both modules use the same reads (sessions/reader.ts) and the same rule for which sessions are Shadow Jog's, so a session has the same
// title in both, and one rule decides what the project is.
//
// When the process list cannot be used, the module says so (`source: 'file-age'`) and decides by the file ages of version 1: a session that works or
// waits is live, and one that works counts as busy.
//
// Only a few small things of a conversation get into the answer: the title of a session, the description of an agent, the name of a workflow, and the
// counts of messages. No message text, no prompt and no result leaves the files.

export type AgentsModuleDeps = {
  config: Config;
  hub: Hub;
  /** The clock, in milliseconds since 1970. The tests set it. `Date.now` when this is not given. */
  now?: () => number;
  /** Says whether a process runs. The tests set it, so no test needs a real process. `process.kill(pid, 0)` when this is not given (see agents/process-list.ts). */
  isAlive?: IsAlive;
};

/** What the process list says about a session: when its process started, and whether it is busy. */
type LiveProcess = { startedAtMs: number | null; busy: boolean };

/** A session that may be live: its file and what that file says, and what is known of its process. */
type Candidate = {
  file: SessionFile;
  facts: SessionFacts;
  /** Null when the file ages decide, because the process list cannot be used. */
  live: LiveProcess | null;
};

/** The items of a list that are there: the list with its nulls taken out. */
const present = <T>(items: readonly (T | null)[]): T[] => items.filter((item): item is T => item !== null);

/** What a candidate came to: not live (idle, in the fallback), a script's session that is hidden, or live. */
type Inspected = { kind: 'idle' } | { kind: 'hidden' } | { kind: 'live'; session: LiveSession };

const EMPTY_TREE: SessionTree = { agents: [], workflows: [] };

/**
 * The agents module, as a source of a Panel of AgentsLive. It looks every `agents.pollMs` (3 seconds), and when a page asks (see routes/panel.ts), and
 * it tells the open pages only when what it found is different from the last time.
 */
export function createAgentsSource(deps: AgentsModuleDeps): PanelSource<AgentsLive> {
  const { config, hub } = deps;
  const now = deps.now ?? Date.now;
  const isAlive = deps.isAlive ?? processIsAlive;
  const { projectsRoot, sessionsRoot, workingSeconds, recentSeconds } = config.claude;
  const lingerMs = config.agents.lingerSeconds * 1000;
  const workingMs = workingSeconds * 1000;
  const staleMs = config.agents.staleSeconds * 1000;

  const reader = createSessionReader(config, 'agents');

  // ---- which sessions ----

  /** The file of a session: `<projectsRoot>/<folder>/<id>.jsonl` in one of the folders that the config names (the whole ones first). Null when it is in none. */
  async function locate(sessionId: string): Promise<SessionFile | null> {
    for (const { folder, matchedBy } of sessionSources(config.claude)) {
      const path = join(projectsRoot, folder, `${sessionId}.jsonl`);
      const stamp = await reader.optional(path, null, () => stampOf(path));
      if (stamp !== null) return { ...stamp, id: sessionId, folder, matchedBy };
    }
    return null;
  }

  /** The facts of a session file. A file that cannot be read leaves the session out of this look (the console says so once): what is in it cannot be told. */
  async function candidate(file: SessionFile, live: LiveProcess | null): Promise<Candidate | null> {
    const facts = await reader.optional<SessionFacts | null>(file.path, null, () => reader.readSession(file));
    return facts === null ? null : { file, facts, live };
  }

  /** The sessions of the live processes. A process whose session is not in a folder that the config names is some other project's, and is not looked at further. */
  async function fromProcessList(entries: readonly ProcessEntry[]): Promise<Candidate[]> {
    const found = await Promise.all(
      entries.map(async (entry) => {
        const file = await locate(entry.sessionId);
        return file === null ? null : candidate(file, { startedAtMs: entry.startedAtMs, busy: entry.status === 'busy' });
      }),
    );
    return present(found);
  }

  /** The fallback: every session file of the named folders from the last `recentSeconds`, as the sessions module lists them. */
  async function fromFileAges(nowMs: number): Promise<Candidate[]> {
    const files = await listSessionFiles(config, nowMs);
    return present(await Promise.all(files.map((file) => candidate(file, null))));
  }

  // ---- the files of a parent ----

  /**
   * What the end of a parent's file says about the calls and the messages (see tree.ts). The answer is kept while the file is the same, under its own
   * key: the same file is read for its facts too. The read is bounded, so a file of hundreds of megabytes costs one window.
   */
  function scanFile(stamp: FileStamp): Promise<FileScan | null> {
    return reader.optional<FileScan | null>(stamp.path, null, () =>
      reader.memoRead(
        stamp,
        async () => {
          const { lines } = await readTail(stamp.path, { startBytes: MESSAGE_WINDOW_BYTES, maxBytes: MESSAGE_WINDOW_BYTES });
          return scanLines(lines, stamp.size > MESSAGE_WINDOW_BYTES);
        },
        `${stamp.path}#scan`,
      ),
    );
  }

  // ---- the nodes of a session ----

  /** An agent that is in the view, or null: it ended and its time is over, or it stopped. */
  async function agentCandidate(agent: AgentFile, busy: boolean, nowMs: number): Promise<NodeCandidate | null> {
    const [facts, meta] = await Promise.all([reader.readAgent(agent), reader.readAgentMeta(agent)]);
    const endedAt = facts.lastTime ?? isoOf(agent.mtimeMs);
    const state = liveStateOf({ ended: facts.ended, endedAtMs: Date.parse(endedAt), lastWriteMs: agent.mtimeMs, busy, nowMs, lingerMs, workingMs, staleMs });
    if (state === null) return null;
    return {
      id: agent.id,
      kind: 'agent',
      // An agent with no description (its meta file is missing) is named by the start of its id, so its box is not blank.
      label: meta.description === '' ? `Agent ${agent.id.slice(0, 8)}` : meta.description,
      model: modelFamily(meta.model),
      state,
      startedAt: facts.firstTime ?? isoOf(createdMs(agent)),
      endedAt: state === 'done' ? endedAt : null,
      filePath: agent.path,
      toolUseId: meta.toolUseId === '' ? null : meta.toolUseId,
    };
  }

  /** A run of a workflow that is in the view, or null. A run is one node, and its agents have none. */
  async function workflowCandidate(sessionId: string, run: WorkflowFolder, busy: boolean, nowMs: number): Promise<NodeCandidate | null> {
    const journal = run.journal === null ? readJournal([]) : await reader.readJournalFile(run.journal);
    const stamps = [...(run.journal === null ? [] : [run.journal]), ...run.agents];
    const lastWriteMs = Math.max(0, ...stamps.map((stamp) => stamp.mtimeMs));
    // A journal has no times: a run that is done ended with the last write to its files. (Whether the run is fresh decides nothing here: `workflowStateOf` says "done" or not.)
    const ended = workflowStateOf(journal, lastWriteMs >= nowMs - workingMs) === 'done';
    const state = liveStateOf({ ended, endedAtMs: lastWriteMs, lastWriteMs, busy, nowMs, lingerMs, workingMs, staleMs });
    if (state === null) return null;
    const phase = journal.phases.at(-1)?.name ?? '';
    return {
      id: run.id,
      kind: 'workflow',
      label: (await reader.scriptName(sessionId, run.id)) ?? run.id,
      model: null,
      state,
      // The journal has no time of its own. The time that its file was made is when the run was launched.
      startedAt: run.journal === null || run.journal.birthtimeMs <= 0 ? null : isoOf(run.journal.birthtimeMs),
      endedAt: state === 'done' ? isoOf(lastWriteMs) : null,
      filePath: run.journal === null ? null : run.journal.path,
      toolUseId: null,
      progress: { phase: phase === '' ? null : phase, done: journal.done, started: journal.started },
    };
  }

  /** The boxes under one session: the agents and the runs that are in the view, with who started each and how many messages passed. */
  async function nodesOf(file: SessionFile, tree: SessionTree, busy: boolean, nowMs: number): Promise<LiveNode[]> {
    const [agents, runs] = await Promise.all([
      Promise.all(tree.agents.map((agent) => agentCandidate(agent, busy, nowMs).then((node) => (node === null ? null : { node, file: agent })))),
      Promise.all(tree.workflows.map((run) => workflowCandidate(file.id, run, busy, nowMs))),
    ]);
    const shownAgents = present(agents);
    const candidates = [...shownAgents.map((entry) => entry.node), ...present(runs)];

    // The session's own file holds the calls of the agents that it started and the messages that went to them. The files of the agents are read only when
    // an agent's call is not in it: that agent was started by another agent (or its call is older than the window, and it hangs on the session).
    const scans = new Map<string, FileScan>();
    if (shownAgents.length > 0) {
      const own = await scanFile(file);
      if (own !== null) scans.set(file.id, own);
      if (shownAgents.some(({ node }) => node.toolUseId !== null && own?.calls.has(node.toolUseId) !== true)) {
        const scanned = await Promise.all(shownAgents.map(async ({ node, file: agent }) => [node.id, await scanFile(agent)] as const));
        for (const [id, scan] of scanned) if (scan !== null) scans.set(id, scan);
      }
    }
    return buildNodes(file.id, candidates, scans);
  }

  // ---- a session ----

  async function inspect(entry: Candidate, nowMs: number): Promise<Inspected> {
    const { file, facts, live } = entry;
    // A session that a script started is left out and counted, unless the config lists them (ruling R18).
    const script = !config.claude.includeSdk && isSdkEntrypoint(facts.entrypoint);
    const sessionDir = join(projectsRoot, file.folder, file.id);
    const listTree = () => reader.optional(sessionDir, EMPTY_TREE, () => listSessionTree(sessionDir, nowMs, recentSeconds));

    let busy: boolean;
    let tree: SessionTree;
    let startedAt: string | null;
    if (live !== null) {
      // The process list decides: a process that runs is live, and `busy` is "working". A script's session costs no more than the read of its own file.
      if (script) return { kind: 'hidden' };
      busy = live.busy;
      tree = await listTree();
      startedAt = live.startedAtMs === null ? null : isoOf(live.startedAtMs);
    } else {
      // The file ages decide, as in version 1: the session is as recent as the newest write for it, and a session that waits for a workflow writes nothing
      // itself. "Working" counts as busy and "waiting" as idle. A session that is neither is not live, a script's session included: only the ones that
      // would be live are counted as hidden, so the count means the same in both modes.
      tree = await listTree();
      const writes = [file, ...tree.agents, ...tree.workflows.flatMap((run) => [...(run.journal === null ? [] : [run.journal]), ...run.agents])];
      const { state } = applyAge(facts.activity, Math.max(...writes.map((stamp) => stamp.mtimeMs)), nowMs, config.claude);
      if (state !== 'working' && state !== 'waiting') return { kind: 'idle' };
      if (script) return { kind: 'hidden' };
      busy = state === 'working';
      startedAt = facts.firstTime ?? isoOf(createdMs(file));
    }

    return {
      kind: 'live',
      session: {
        id: file.id,
        title: await reader.titleOf(file, facts),
        state: busy ? 'working' : 'waiting',
        startedAt,
        filePath: file.path,
        nodes: await nodesOf(file, tree, busy, nowMs),
      },
    };
  }

  async function load(): Promise<AgentsLive> {
    try {
      const nowMs = now();
      const list = await readProcessList(sessionsRoot, isAlive);
      if (!list.ok) {
        // The page says "Process list unavailable"; the console says why, once. (An older Claude Code has no such folder; an update can change its files.)
        reader.reportOnce(`process-list ${list.reason}`, `The agents source cannot use the process list (${list.reason}${list.code === undefined ? '' : `, ${list.code}`}), and uses the file ages.`);
      }
      const source = list.ok ? 'process-list' : 'file-age';
      const candidates = list.ok ? await fromProcessList(list.entries) : await fromFileAges(nowMs);

      // The sessions about Shadow Jog: the folder, or a working folder inside a root (the rule of version 1). A session that works elsewhere is dropped, and not counted.
      const mine = candidates.filter((entry) => keepSession(entry.file.matchedBy, entry.facts.cwd, config.roots));
      const inspected = await Promise.all(mine.map((entry) => inspect(entry, nowMs)));

      const sessions = inspected.flatMap((entry) => (entry.kind === 'live' ? [entry.session] : []));
      sessions.sort(inOrderOfStart);
      return { sessions, hiddenScripts: inspected.filter((entry) => entry.kind === 'hidden').length, source };
    } catch (error) {
      // The message of a file system error holds the path of a file. The page gets the code, and the server console the rest.
      console.error('The agents source could not read the live sessions:', error);
      throw new PanelError('agents-failed', error instanceof PanelError ? error.message : say('agentsFailed', { code: codeOf(error) }));
    } finally {
      reader.endLoad();
    }
  }

  return createPanelSource<AgentsLive>({ name: 'agents', load, hub, everyMs: config.agents.pollMs });
}
