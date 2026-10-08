import { join } from 'node:path';
import type { AgentInfo, SessionInfo, SessionsInfo, WorkflowInfo } from '../../shared/types';
import type { Config } from '../config';
import type { Hub } from '../hub';
import { PanelError, type PanelSource, createPanelSource } from '../source';
import { type AgentFile, type FileStamp, type SessionFile, type WorkflowFolder, keepSession, listSessionFiles, listSessionTree } from './discover';
import { type Journal, agentStateOf, applyAge, isSdkEntrypoint, readJournal, workflowStateOf } from './parse';
import { type SessionFacts, codeOf, createSessionReader, createdMs, isoOf } from './reader';

// The limiter lives with the other shared reads (reader.ts). Its test imports it from here, where it used to be.
export { createLimiter } from './reader';

// The sessions module: the Claude Code sessions about Shadow Jog, with their agents and workflows.
//
// Claude Code writes every session as a file in `~/.claude/projects/<folder>/`, and every agent and
// workflow run in a folder named after the session. They are Mark's private conversations, they can be
// hundreds of megabytes, and their format can change with an update. So this module:
// - reads only the folders that the config names, one by one (discover.ts);
// - reads the end of a file, and the first 16 KB for the time it began (tail.ts), never the whole file;
// - reads a file again only when its size or its time of last write changed;
// - lets only a few small things of a conversation into the answer: the title of a session (the first line of its
//   first prompt, when it has no title of its own), the lines of a "Your move" box and the description of an agent.
//   Every other word stays in the file;
// - leaves out the sessions that a script started (the entrypoint starts with "sdk": `sdk-py`, `sdk-ts`, `sdk-cli`) unless the config says
//   `claude.includeSdk`, and counts them in `hiddenSdk` (ruling R18). A machine can hold hundreds of them for a few sessions of Mark's.
//
// The reads themselves (the cache, the limit on open files, the facts of a session, an agent and a journal) are in reader.ts, which the
// agents module uses too.

/** How often the module looks again: the sessions are the one source that changes all the time. A look reads no file that did not change. */
export const SESSIONS_POLL_MS = 10_000;

export type SessionsModuleDeps = {
  config: Config;
  hub: Hub;
  /** The clock, in milliseconds since 1970. The tests set it. `Date.now` when this is not given. */
  now?: () => number;
};

/**
 * The sessions module, as a source of a Panel of SessionsInfo. It looks every 10 seconds, and when a page asks
 * (see routes/panel.ts). Each look lists the files and reads only those that changed.
 */
export function createSessionsSource(deps: SessionsModuleDeps): PanelSource<SessionsInfo> {
  const { config, hub } = deps;
  const now = deps.now ?? Date.now;
  const { projectsRoot, workingSeconds, recentSeconds } = config.claude;

  const reader = createSessionReader(config, 'sessions');

  // ---- the agents and workflows of a session ----

  async function agentInfo(session: SessionFile, file: AgentFile, nowMs: number, resulted: ReadonlySet<string>): Promise<AgentInfo> {
    const [facts, meta] = await Promise.all([reader.readAgent(file), reader.readAgentMeta(file)]);
    const state = agentStateOf({ ended: facts.ended, fresh: file.mtimeMs >= nowMs - workingSeconds * 1000, hasResult: resulted.has(file.id) });
    return {
      id: file.id,
      sessionId: session.id,
      description: meta.description,
      agentType: meta.agentType,
      model: meta.model,
      state,
      startedAt: facts.firstTime ?? isoOf(createdMs(file)),
      endedAt: state === 'running' ? null : (facts.lastTime ?? isoOf(file.mtimeMs)),
      workflowId: file.workflowId,
    };
  }

  /** The journal and the agent files of a run: the files whose writes say that the run is alive. */
  const stampsOfRun = (run: WorkflowFolder): FileStamp[] => [...(run.journal === null ? [] : [run.journal]), ...run.agents];

  async function workflowInfo(session: SessionFile, run: WorkflowFolder, journal: Journal, nowMs: number): Promise<WorkflowInfo> {
    // The name is the script's file name.
    const name = await reader.scriptName(session.id, run.id);
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
    const tree = await reader.optional(sessionDir, { agents: [], workflows: [] }, () => listSessionTree(sessionDir, nowMs, recentSeconds));

    // An agent that the session started itself, and the agents of each workflow run. A result in a run's journal means that the
    // agent is done, whatever its own file says.
    const agents: AgentInfo[] = await Promise.all(tree.agents.map((agent) => agentInfo(file, agent, nowMs, new Set())));
    const workflows: WorkflowInfo[] = [];
    for (const run of tree.workflows) {
      const journal = run.journal === null ? readJournal([]) : await reader.readJournalFile(run.journal);
      agents.push(...(await Promise.all(run.agents.map((agent) => agentInfo(file, agent, nowMs, new Set(journal.doneIds))))));
      workflows.push(await workflowInfo(file, run, journal, nowMs));
    }

    // The session is as recent as the newest write for it. A session that waits for a workflow writes nothing itself.
    const writes = [file, ...tree.agents, ...tree.workflows.flatMap(stampsOfRun)];
    const lastWriteMs = Math.max(...writes.map((stamp) => stamp.mtimeMs));

    return {
      id: file.id,
      title: await reader.titleOf(file, facts),
      folder: file.folder,
      matchedBy: file.matchedBy,
      cwd: facts.cwd,
      entrypoint: facts.entrypoint,
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
            return { file, facts: await reader.readSession(file), failure: null };
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

      // The sessions about Shadow Jog. Of those, a session that a script started is left out and counted, unless the config lists them (ruling R18).
      // It is left out before its agents and workflows are read, so a hidden run costs the read of its own file and nothing more. A file that is not
      // Shadow Jog's is `skipped` whatever started it, so every file is in exactly one of the three counts: scanned = sessions + hiddenSdk + skipped.
      const matching = readable.filter((entry) => keepSession(entry.file.matchedBy, entry.facts.cwd, config.roots));
      const shown = config.claude.includeSdk ? matching : matching.filter((entry) => !isSdkEntrypoint(entry.facts.entrypoint));
      const hiddenSdk = matching.length - shown.length;
      const sessions = await Promise.all(shown.map((entry) => buildSession(entry.file, entry.facts, nowMs)));
      sessions.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.id.localeCompare(b.id));
      return { sessions, scanned: files.length, skipped: files.length - matching.length, hiddenSdk };
    } catch (error) {
      if (error instanceof PanelError) throw error;
      // The message of a file system error holds the path of a file. The page gets the code, and the server console the rest.
      console.error('The sessions source could not read the session files:', error);
      throw new PanelError('sessions-failed', `The session files could not be read (${codeOf(error)}).`);
    } finally {
      reader.endLoad();
    }
  }

  return createPanelSource<SessionsInfo>({ name: 'sessions', load, hub, everyMs: SESSIONS_POLL_MS });
}
