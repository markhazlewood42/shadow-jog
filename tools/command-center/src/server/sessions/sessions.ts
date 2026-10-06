import { join } from 'node:path';
import type { AgentInfo, SessionInfo, SessionsInfo, WorkflowInfo, YourMoveBox } from '../../shared/types';
import type { Config } from '../config';
import type { Hub } from '../hub';
import { PanelError, type PanelSource, createPanelSource } from '../source';
import { type AgentFile, type FileStamp, type SessionFile, type WorkflowFolder, findScriptName, keepSession, listSessionFiles, listSessionTree, stampOf } from './discover';
import {
  type Activity,
  type Journal,
  agentStateOf,
  applyAge,
  clipText,
  countLineTypes,
  extractPrs,
  extractYourMove,
  hasConversationCwd,
  isDecisive,
  lastDecisiveTime,
  newestBranch,
  newestCwd,
  readActivity,
  readJournal,
  readTitles,
  workflowStateOf,
} from './parse';
import { TAIL_MAX_BYTES, readFirstTimestamp, readSmallJson, readTail } from './tail';

// The sessions module: the Claude Code sessions about Shadow Jog, with their agents and workflows.
//
// Claude Code writes every session as a file in `~/.claude/projects/<folder>/`, and every agent and
// workflow run in a folder named after the session. They are Mark's private conversations, they can be
// hundreds of megabytes, and their format can change with an update. So this module:
// - reads only the folders that the config names, one by one (discover.ts);
// - reads the end of a file, and the first 16 KB for the time it began (tail.ts), never the whole file;
// - reads a file again only when its size or its time of last write changed;
// - lets only a few small things of a conversation into the answer: the title of a session, the lines
//   of a "Your move" box and the description of an agent. Every other word stays in the file.

/** How often the module looks again: the sessions are the one source that changes all the time. A look reads no file that did not change. */
export const SESSIONS_POLL_MS = 10_000;

/** How many files are read at one time. A big workflow has hundreds of agent files, and each read holds a buffer. */
const READS_AT_ONCE = 16;

/** The first window of the end of an agent file. An agent's last line is short (its hand-back, or its last reply), so 16 KB almost always holds it. */
const AGENT_TAIL_BYTES = 16 * 1024;

/** An agent's description is a few words. Anything longer than this is cut. */
const MAX_DESCRIPTION_CHARS = 300;

export type SessionsModuleDeps = {
  config: Config;
  hub: Hub;
  /** The clock, in milliseconds since 1970. The tests set it. `Date.now` when this is not given. */
  now?: () => number;
};

// ---- a cache of what was read, by file ----

type Stamped = { size: number; mtimeMs: number };

/**
 * What each file said the last time it was read, kept by its path and used again while the size and the time of last
 * write are the same. `endLoad` forgets the files that the load did not ask about, so the cache never holds more than
 * the files of the week.
 */
function createFileCache() {
  const entries = new Map<string, Stamped & { value: unknown }>();
  let used = new Set<string>();
  return {
    async memo<T>(path: string, stamp: Stamped, read: () => Promise<T>): Promise<T> {
      used.add(path);
      const hit = entries.get(path);
      if (hit !== undefined && hit.size === stamp.size && hit.mtimeMs === stamp.mtimeMs) return hit.value as T;
      const value = await read();
      entries.set(path, { size: stamp.size, mtimeMs: stamp.mtimeMs, value });
      return value;
    },
    endLoad(): void {
      for (const path of entries.keys()) if (!used.has(path)) entries.delete(path);
      used = new Set();
    },
  };
}

/** Runs the work at once while fewer than `max` are running, and queues it otherwise. A finished piece of work hands its place to the next one in line. (Exported for its test.) */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function limit<T>(work: () => Promise<T>): Promise<T> {
    if (running >= max) await new Promise<void>((resume) => waiting.push(resume));
    else running += 1;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    }
  };
}

// ---- what is kept of each file ----

/** What the end and the start of a session file say. Nothing in it depends on the clock. */
type SessionFacts = {
  cwd: string | null;
  branch: string;
  titles: ReturnType<typeof readTitles>;
  firstTime: string | null;
  prs: SessionInfo['prs'];
  yourMove: YourMoveBox | null;
  activity: Activity;
  /** How many lines were read, and how many of those are of a type that this module knows. */
  lines: { read: number; known: number };
};

type AgentFacts = { firstTime: string | null; ended: boolean; lastTime: string | null };
type AgentMeta = { description: string; agentType: string; model: string };

/** A time in milliseconds as an ISO text. A file system keeps more than a millisecond, so this rounds to the nearest one. */
const isoOf = (ms: number): string => new Date(Math.round(ms)).toISOString();

/** The time that a file was made (the file system's), or its last write when the file system does not say. */
const createdMs = (stamp: FileStamp): number => (stamp.birthtimeMs > 0 ? stamp.birthtimeMs : stamp.mtimeMs);

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The code of a file system error, for a message that names no path. */
const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException | undefined)?.code ?? 'unknown error';

/**
 * The sessions module, as a source of a Panel of SessionsInfo. It looks every 10 seconds, and when a page asks
 * (see routes/panel.ts). Each look lists the files and reads only those that changed.
 */
export function createSessionsSource(deps: SessionsModuleDeps): PanelSource<SessionsInfo> {
  const { config, hub } = deps;
  const now = deps.now ?? Date.now;
  const { projectsRoot, workingSeconds, recentSeconds } = config.claude;

  const cache = createFileCache();
  const limit = createLimiter(READS_AT_ONCE);
  /** The names of workflow runs that were found. A name is a file name, and it does not change. */
  const scriptNames = new Map<string, string>();
  let namesUsed = new Set<string>();
  /** The files that could not be read, as `path` and error code, so that the console says it once and not at every look. */
  const reported = new Set<string>();

  /** A read that is kept while the file is the same, and that waits its turn among the other reads. */
  const memoRead = <T>(stamp: FileStamp, read: () => Promise<T>) => cache.memo(stamp.path, stamp, () => limit(read));

  /**
   * Runs a read of a file that only adds detail (an agent, a journal, a title). When it fails, the module goes on
   * without that detail and the server's console says so once: one locked file must not take the list of sessions
   * away. (A session file itself is different: it is counted as skipped, see `load`.)
   */
  async function optional<T>(path: string, fallback: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      const key = `${path} ${codeOf(error)}`;
      if (!reported.has(key)) {
        reported.add(key);
        console.error(`The sessions source could not read ${path} (${codeOf(error)}), and goes on without it.`);
      }
      return fallback;
    }
  }

  async function readSession(file: SessionFile): Promise<SessionFacts> {
    return memoRead(file, async () => {
      // The window grows until a line of the conversation that has a working folder is in it: the end of an idle session is notes
      // that have none, and attachments after the last reply can be big.
      const [{ lines }, firstTime] = await Promise.all([readTail(file.path, { until: hasConversationCwd }), readFirstTimestamp(file.path)]);
      return {
        cwd: newestCwd(lines),
        branch: newestBranch(lines) ?? '',
        titles: readTitles(lines),
        firstTime,
        prs: extractPrs(lines, config.githubRepo),
        yourMove: extractYourMove(lines, config.roots),
        activity: readActivity(lines),
        lines: { read: lines.length, known: countLineTypes(lines).known },
      };
    });
  }

  /** The title that Mark gave the session, kept by its own file. It is a second copy of the title line, for when that line is out of reach. */
  async function readTitleFile(file: SessionFile): Promise<string | null> {
    const path = join(projectsRoot, file.folder, file.id, 'custom-title.json');
    return optional(path, null, async () => {
      const stamp = await stampOf(path);
      if (stamp === null) return null;
      const json = await memoRead(stamp, () => readSmallJson(stamp.path));
      const title = textOf(json?.customTitle).trim();
      return title === '' ? null : clipText(title, 200);
    });
  }

  async function readAgent(file: AgentFile): Promise<AgentFacts> {
    return optional(file.path, { firstTime: null, ended: false, lastTime: null }, () =>
      memoRead(file, async () => {
        const [{ lines }, firstTime] = await Promise.all([readTail(file.path, { startBytes: AGENT_TAIL_BYTES, until: isDecisive }), readFirstTimestamp(file.path)]);
        return { firstTime, ended: readActivity(lines).kind === 'turn-ended', lastTime: lastDecisiveTime(lines) };
      }),
    );
  }

  async function readAgentMeta(file: AgentFile): Promise<AgentMeta> {
    const path = file.path.replace(/\.jsonl$/, '.meta.json');
    return optional(path, { description: '', agentType: '', model: '' }, async () => {
      const stamp = await stampOf(path);
      if (stamp === null) return { description: '', agentType: '', model: '' };
      return memoRead(stamp, async () => {
        const json = await readSmallJson(stamp.path);
        return { description: clipText(textOf(json?.description).trim(), MAX_DESCRIPTION_CHARS), agentType: textOf(json?.agentType), model: textOf(json?.model) };
      });
    });
  }

  /** The journal is read whole (up to the 4 MB cap): its phases are in the order of its rows, from the first. */
  async function readJournalFile(stamp: FileStamp): Promise<Journal> {
    return optional(stamp.path, readJournal([]), () => memoRead(stamp, async () => readJournal((await readTail(stamp.path, { startBytes: TAIL_MAX_BYTES })).lines)));
  }

  // ---- the agents and workflows of a session ----

  async function agentInfo(session: SessionFile, file: AgentFile, nowMs: number, resulted: ReadonlySet<string>): Promise<AgentInfo> {
    const [facts, meta] = await Promise.all([readAgent(file), readAgentMeta(file)]);
    const state = agentStateOf({ ended: facts.ended, fresh: file.mtimeMs >= nowMs - workingSeconds * 1000, hasResult: resulted.has(file.id) });
    return {
      id: file.id,
      sessionId: session.id,
      ...meta,
      state,
      startedAt: facts.firstTime ?? isoOf(createdMs(file)),
      endedAt: state === 'running' ? null : (facts.lastTime ?? isoOf(file.mtimeMs)),
      workflowId: file.workflowId,
    };
  }

  /** The journal and the agent files of a run: the files whose writes say that the run is alive. */
  const stampsOfRun = (run: WorkflowFolder): FileStamp[] => [...(run.journal === null ? [] : [run.journal]), ...run.agents];

  async function workflowInfo(session: SessionFile, run: WorkflowFolder, journal: Journal, nowMs: number): Promise<WorkflowInfo> {
    // The name is the script's file name. It is looked for once: a name that was found does not change.
    const key = `${session.id}/${run.id}`;
    namesUsed.add(key);
    let name = scriptNames.get(key) ?? null;
    if (name === null) {
      name = await findScriptName(config, session.id, run.id);
      if (name !== null) scriptNames.set(key, name);
    }
    const stamps = stampsOfRun(run);
    return {
      id: run.id,
      name: name ?? run.id,
      sessionId: session.id,
      state: workflowStateOf(journal, stamps.some((stamp) => stamp.mtimeMs >= nowMs - workingSeconds * 1000)),
      phases: journal.phases,
      started: journal.started,
      done: journal.done,
      // The journal has no times of its own. The time that its file was made is when the run was launched.
      startedAt: run.journal === null || run.journal.birthtimeMs <= 0 ? null : isoOf(run.journal.birthtimeMs),
      lastEventAt: isoOf(Math.max(0, ...stamps.map((stamp) => stamp.mtimeMs))),
    };
  }

  /** The newest first, by the time it began. A run with no start time goes last. */
  const newestFirst = <T extends { startedAt: string | null; id: string }>(a: T, b: T) => (Date.parse(b.startedAt ?? '') || 0) - (Date.parse(a.startedAt ?? '') || 0) || a.id.localeCompare(b.id);

  /** Everything about one session that is kept: its facts, its title, its agents and workflows, and its state at `nowMs`. */
  async function buildSession(file: SessionFile, facts: SessionFacts, nowMs: number): Promise<SessionInfo> {
    const sessionDir = join(projectsRoot, file.folder, file.id);
    const tree = await optional(sessionDir, { agents: [], workflows: [] }, () => listSessionTree(sessionDir, nowMs, recentSeconds));

    // An agent that the session started itself, and the agents of each workflow run. A result in a run's journal means that the
    // agent is done, whatever its own file says.
    const agents: AgentInfo[] = await Promise.all(tree.agents.map((agent) => agentInfo(file, agent, nowMs, new Set())));
    const workflows: WorkflowInfo[] = [];
    for (const run of tree.workflows) {
      const journal = run.journal === null ? readJournal([]) : await readJournalFile(run.journal);
      agents.push(...(await Promise.all(run.agents.map((agent) => agentInfo(file, agent, nowMs, new Set(journal.doneIds))))));
      workflows.push(await workflowInfo(file, run, journal, nowMs));
    }

    // The session is as recent as the newest write for it. A session that waits for a workflow writes nothing itself.
    const writes = [file, ...tree.agents, ...tree.workflows.flatMap(stampsOfRun)];
    const lastWriteMs = Math.max(...writes.map((stamp) => stamp.mtimeMs));
    const title = facts.titles.custom ?? (await readTitleFile(file)) ?? facts.titles.agent ?? facts.titles.slug ?? `Session ${file.id.slice(0, 8)}`;

    return {
      id: file.id,
      title,
      folder: file.folder,
      matchedBy: file.matchedBy,
      cwd: facts.cwd,
      branch: facts.branch,
      startedAt: facts.firstTime ?? isoOf(createdMs(file)),
      lastActivityAt: isoOf(lastWriteMs),
      state: applyAge(facts.activity, lastWriteMs, nowMs, config.claude).state,
      prs: facts.prs,
      yourMove: facts.yourMove,
      agents: agents.sort(newestFirst),
      workflows: workflows.sort(newestFirst),
    };
  }

  async function load(): Promise<SessionsInfo> {
    const nowMs = now();
    try {
      const files = await listSessionFiles(config, nowMs);

      // Read the end of every recent file. A file that cannot be read is skipped and counted, never the end of the module.
      const read = await Promise.all(
        files.map(async (file) => {
          try {
            return { file, facts: await readSession(file), failure: null };
          } catch (error) {
            return { file, facts: null, failure: codeOf(error) };
          }
        }),
      );
      const readable = read.flatMap((entry) => (entry.facts === null ? [] : [{ file: entry.file, facts: entry.facts }]));
      const failed = read.find((entry) => entry.failure !== null);
      if (failed !== undefined && readable.length === 0) {
        throw new PanelError('sessions-unreadable', `None of the ${files.length} recent session files could be read (${failed.failure}).`);
      }

      // Files that hold lines, and none of a type that this knows: Claude Code may have changed its file format. (An empty file says nothing.)
      const withLines = readable.filter((entry) => entry.facts.lines.read > 0);
      if (withLines.length > 0 && withLines.every((entry) => entry.facts.lines.known === 0)) {
        throw new PanelError(
          'sessions-unknown-format',
          `The session files have an unknown file format: none of the ${withLines.length} recent files holds a line that this page knows. Claude Code may have changed how it writes them.`,
        );
      }

      const kept = readable.filter((entry) => keepSession(entry.file.matchedBy, entry.facts.cwd, config.roots));
      const sessions = await Promise.all(kept.map((entry) => buildSession(entry.file, entry.facts, nowMs)));
      sessions.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.id.localeCompare(b.id));
      return { sessions, scanned: files.length, skipped: files.length - sessions.length };
    } catch (error) {
      if (error instanceof PanelError) throw error;
      // The message of a file system error holds the path of a file. The page gets the code, and the server console the rest.
      console.error('The sessions source could not read the session files:', error);
      throw new PanelError('sessions-failed', `The session files could not be read (${codeOf(error)}).`);
    } finally {
      cache.endLoad();
      for (const key of scriptNames.keys()) if (!namesUsed.has(key)) scriptNames.delete(key);
      namesUsed = new Set();
    }
  }

  return createPanelSource<SessionsInfo>({ name: 'sessions', load, hub, everyMs: SESSIONS_POLL_MS });
}
