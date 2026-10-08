import { join } from 'node:path';
import type { SessionInfo, YourMoveBox } from '../../shared/types';
import type { Config } from '../config';
import { type AgentFile, type FileStamp, type SessionFile, findScriptName, stampOf } from './discover';
import {
  type Activity,
  type Journal,
  clipText,
  countLineTypes,
  extractPrs,
  extractYourMove,
  hasConversationCwd,
  isDecisive,
  lastDecisiveTime,
  newestBranch,
  newestCwd,
  newestEntrypoint,
  readActivity,
  readJournal,
  readTitles,
} from './parse';
import { TAIL_MAX_BYTES, readFirstTimestamp, readHead, readSmallJson, readTail } from './tail';

// The reads that the sessions module and the agents module share. Both look at the same files (a session file,
// its agents, its workflow journals, its title file), and both must answer the same way: the same session has the
// same title on the Your move panel and on the Agents page. So the reads live here once, and each module makes
// its own reader with `createSessionReader`. A reader keeps its own cache, so the two modules never share what
// they remember: each one forgets the files that its own last look did not ask about.

/** How many files are read at one time. A big workflow has hundreds of agent files, and each read holds a buffer. */
const READS_AT_ONCE = 16;

/** The first window of the end of an agent file. An agent's last line is short (its hand-back, or its last reply), so 16 KB almost always holds it. */
const AGENT_TAIL_BYTES = 16 * 1024;

/** An agent's description is a few words. Anything longer than this is cut. */
const MAX_DESCRIPTION_CHARS = 300;

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
export type SessionFacts = {
  cwd: string | null;
  /** How the session was started, from its newest line that says so (`claude-desktop`, `sdk-py`, ...), or null when none does. */
  entrypoint: string | null;
  branch: string;
  titles: ReturnType<typeof readTitles>;
  firstTime: string | null;
  /** The first line of the first prompt of Mark, cut to 80 characters: the title of a session that has none of its own. */
  firstPrompt: string | null;
  prs: SessionInfo['prs'];
  yourMove: YourMoveBox | null;
  activity: Activity;
  /** How many lines were read, and how many of those are of a type that this module knows. */
  lines: { read: number; known: number };
};

export type AgentFacts = { firstTime: string | null; ended: boolean; lastTime: string | null };

/**
 * What the `.meta.json` of an agent says. `toolUseId` is the id of the `Agent` call that started the agent: the agents module uses it to find the
 * parent. The sessions module does not show it, so it picks the other three fields and the answer of `GET /api/sessions` has no new key.
 */
export type AgentMeta = { description: string; agentType: string; model: string; toolUseId: string };

/** A time in milliseconds as an ISO text. A file system keeps more than a millisecond, so this rounds to the nearest one. */
export const isoOf = (ms: number): string => new Date(Math.round(ms)).toISOString();

/** The time that a file was made (the file system's), or its last write when the file system does not say. */
export const createdMs = (stamp: FileStamp): number => (stamp.birthtimeMs > 0 ? stamp.birthtimeMs : stamp.mtimeMs);

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The code of a file system error, for a message that names no path. */
export const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException | undefined)?.code ?? 'unknown error';

/**
 * A reader for one module. `source` is the module's name, which the console message names ("The sessions source could not read ...").
 *
 * Every method that reads a file keeps its answer while the size and the time of last write of the file are the same, and waits its
 * turn among the other reads (`READS_AT_ONCE`). The module calls `endLoad` when a look is over.
 */
export function createSessionReader(config: Config, source: string) {
  const { projectsRoot } = config.claude;

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
   * away. (A session file itself is different: the caller decides what a session that cannot be read means.)
   */
  async function optional<T>(path: string, fallback: T, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      const key = `${path} ${codeOf(error)}`;
      if (!reported.has(key)) {
        reported.add(key);
        console.error(`The ${source} source could not read ${path} (${codeOf(error)}), and goes on without it.`);
      }
      return fallback;
    }
  }

  async function readSession(file: SessionFile): Promise<SessionFacts> {
    return memoRead(file, async () => {
      // The window grows until a line of the conversation that has a working folder is in it: the end of an idle session is notes
      // that have none, and attachments after the last reply can be big. The first 16 KB give when the session began and its first prompt.
      const [{ lines }, head] = await Promise.all([readTail(file.path, { until: hasConversationCwd }), readHead(file.path)]);
      return {
        cwd: newestCwd(lines),
        entrypoint: newestEntrypoint(lines),
        branch: newestBranch(lines) ?? '',
        titles: readTitles(lines),
        firstTime: head.timestamp,
        firstPrompt: head.prompt,
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

  /**
   * The title of a session: the name that Mark gave it, else the name of its agent, else the first line of its first prompt, else the slug that
   * Claude Code made up, else its id (ruling R17). One rule for both modules, so a session has one title wherever it is shown.
   */
  async function titleOf(file: SessionFile, facts: SessionFacts): Promise<string> {
    return facts.titles.custom ?? (await readTitleFile(file)) ?? facts.titles.agent ?? facts.firstPrompt ?? facts.titles.slug ?? `Session ${file.id.slice(0, 8)}`;
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
    const none: AgentMeta = { description: '', agentType: '', model: '', toolUseId: '' };
    return optional(path, none, async () => {
      const stamp = await stampOf(path);
      if (stamp === null) return none;
      return memoRead(stamp, async () => {
        const json = await readSmallJson(stamp.path);
        return {
          description: clipText(textOf(json?.description).trim(), MAX_DESCRIPTION_CHARS),
          agentType: textOf(json?.agentType),
          model: textOf(json?.model),
          toolUseId: textOf(json?.toolUseId),
        };
      });
    });
  }

  /** The journal is read whole (up to the 4 MB cap): its phases are in the order of its rows, from the first. */
  async function readJournalFile(stamp: FileStamp): Promise<Journal> {
    return optional(stamp.path, readJournal([]), () => memoRead(stamp, async () => readJournal((await readTail(stamp.path, { startBytes: TAIL_MAX_BYTES })).lines)));
  }

  /** The name of a workflow run: its script's file name. It is looked for once: a name that was found does not change. */
  async function scriptName(sessionId: string, runId: string): Promise<string | null> {
    const key = `${sessionId}/${runId}`;
    namesUsed.add(key);
    let name = scriptNames.get(key) ?? null;
    if (name === null) {
      name = await findScriptName(config, sessionId, runId);
      if (name !== null) scriptNames.set(key, name);
    }
    return name;
  }

  return {
    optional,
    memoRead,
    readSession,
    titleOf,
    readAgent,
    readAgentMeta,
    readJournalFile,
    scriptName,
    /** Forgets what the look just over did not ask about (files that are gone, runs that ended), so the memory stays as big as one look. */
    endLoad(): void {
      cache.endLoad();
      for (const key of scriptNames.keys()) if (!namesUsed.has(key)) scriptNames.delete(key);
      namesUsed = new Set();
    },
  };
}

export type SessionReader = ReturnType<typeof createSessionReader>;
