import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { type Config, isInside } from '../config';
import { isMissing } from '../fs-errors';
import { PanelError } from '../source';

// Which files and folders of `~/.claude/projects` belong to Shadow Jog. This is the allow-list of the
// sessions module: the session folders are named in the config, one by one, and every other folder
// is never read. It lists files and folders (names and times) and never opens one.

// ---- the folders and the working folder ----

export type MatchedBy = 'folder' | 'cwd';

/** A folder that holds session files, and why its sessions may be shown. */
export type SessionSource = { folder: string; matchedBy: MatchedBy };

/**
 * The folders to read, as the config names them. `folders` are all Shadow Jog's. `cwdMatchFolders` mix
 * projects (a session that Mark starts in `home-base` is kept there, whatever it works on), so a session
 * is shown only when its working folder proves that it is Shadow Jog's. A name in both lists is a whole folder, once.
 */
export function sessionSources(claude: Pick<Config['claude'], 'folders' | 'cwdMatchFolders'>): SessionSource[] {
  const sources: SessionSource[] = [];
  const named = new Set<string>();
  const add = (folder: string, matchedBy: MatchedBy) => {
    if (named.has(folder)) return;
    named.add(folder);
    sources.push({ folder, matchedBy });
  };
  for (const folder of claude.folders) add(folder, 'folder');
  for (const folder of claude.cwdMatchFolders) add(folder, 'cwd');
  return sources;
}

/**
 * Whether a working folder is a root or inside one, compared by whole path segments (so `shadow-jog-old`
 * is not inside `shadow-jog`). A working folder that is not a full path is outside: `isInside` would
 * read it against the folder that the server runs in, which is inside the repo, and "." would count.
 */
export function cwdInsideRoots(cwd: string, roots: readonly string[]): boolean {
  if (!isAbsolute(cwd)) return false;
  return roots.some((root) => isInside(root, cwd));
}

/**
 * Whether a session is listed, from the folder it sits in and its newest working folder (null when no line
 * that was read names one). A session whose newest working folder is outside every root is dropped, even
 * when it began inside one: the session has moved on. A session that does not say where it works is kept
 * in a whole folder, where everything is Shadow Jog's, and dropped in a mixed one, where nothing is proven.
 */
export function keepSession(matchedBy: MatchedBy, cwd: string | null, roots: readonly string[]): boolean {
  if (cwd === null) return matchedBy === 'folder';
  return cwdInsideRoots(cwd, roots);
}

// ---- the files ----

/** What a directory listing and a `stat` tell about a file. No file is opened to get it. */
export type FileStamp = { path: string; size: number; mtimeMs: number; birthtimeMs: number };

export type SessionFile = FileStamp & { id: string; folder: string; matchedBy: MatchedBy };

/** The name of a session file: the session id (a UUID in practice) and `.jsonl`. */
const SESSION_FILE = /^([\w-]+)\.jsonl$/;

/** The reason a folder could not be read, as the sentence of the panel's error. It names the folder and the error code, never a path. */
function unreadable(folder: string, error: unknown): PanelError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? 'unknown error';
  return new PanelError('sessions-unreadable', `The session folder "${folder}" cannot be read (${code}).`);
}

export async function stampOf(path: string): Promise<FileStamp | null> {
  try {
    const { size, mtimeMs, birthtimeMs } = await stat(path);
    return { path, size, mtimeMs, birthtimeMs };
  } catch (error) {
    // A file that was there a moment ago (a session ends and its files are cleaned up) is gone. That is not a failure.
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * The session files of the named folders that were written in the last `recentSeconds`, folder by folder.
 * A folder that is not there is a folder with no sessions. Only a folder that is there and cannot be read
 * is an error, and it stops the listing: a list that silently left one out would be wrong.
 */
export async function listSessionFiles(config: Config, nowMs: number): Promise<SessionFile[]> {
  const { projectsRoot, recentSeconds } = config.claude;
  const oldest = nowMs - recentSeconds * 1000;
  const found: SessionFile[] = [];
  for (const { folder, matchedBy } of sessionSources(config.claude)) {
    let ids: string[];
    try {
      const entries = await readdir(join(projectsRoot, folder), { withFileTypes: true });
      ids = entries.flatMap((entry) => {
        const id = entry.isFile() ? SESSION_FILE.exec(entry.name)?.[1] : undefined;
        return id === undefined ? [] : [id];
      });
    } catch (error) {
      if (isMissing(error)) continue;
      throw unreadable(folder, error);
    }
    const stamps = await Promise.all(ids.sort().map(async (id) => ({ id, stamp: await stampOf(join(projectsRoot, folder, `${id}.jsonl`)) })));
    for (const { id, stamp } of stamps) {
      if (stamp !== null && stamp.mtimeMs >= oldest) found.push({ ...stamp, id, folder, matchedBy });
    }
  }
  return found;
}

// ---- the agents and workflows of a session ----

export type AgentFile = FileStamp & {
  /** The id in `agent-<id>.jsonl`. */
  id: string;
  /** The run (`wf_...`) whose folder the file is in, or null for an agent that the session started itself. */
  workflowId: string | null;
};

/** One run of a workflow: its folder under `subagents/workflows`, its journal, and the agents that it started. */
export type WorkflowFolder = { id: string; journal: FileStamp | null; agents: AgentFile[] };

export type SessionTree = { agents: AgentFile[]; workflows: WorkflowFolder[] };

const AGENT_FILE = /^agent-([\w-]+)\.jsonl$/;
const RUN_FOLDER = /^[\w-]+$/;

/** The names in a folder, or none when it is not there. */
async function namesIn(dir: string): Promise<{ name: string; isFolder: boolean }[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).map((entry) => ({ name: entry.name, isFolder: entry.isDirectory() }));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** The agent files in a folder that were written since `oldest`. */
async function agentsIn(dir: string, workflowId: string | null, oldest: number): Promise<AgentFile[]> {
  const ids = (await namesIn(dir)).flatMap((entry) => {
    const id = entry.isFolder ? undefined : AGENT_FILE.exec(entry.name)?.[1];
    return id === undefined ? [] : [id];
  });
  const stamps = await Promise.all(ids.sort().map(async (id) => ({ id, stamp: await stampOf(join(dir, `agent-${id}.jsonl`)) })));
  return stamps.flatMap(({ id, stamp }) => (stamp === null || stamp.mtimeMs < oldest ? [] : [{ ...stamp, id, workflowId }]));
}

/**
 * The agents of one session, from its folder (`<projects>/<folder>/<session id>`): the agents that the
 * session started (`subagents/agent-<id>.jsonl`) and, for each run of a workflow, its journal and its agents
 * (`subagents/workflows/<run>/`). Only files written in the last `recentSeconds` are listed, and a session
 * that has no folder has none.
 */
export async function listSessionTree(sessionDir: string, nowMs: number, recentSeconds: number): Promise<SessionTree> {
  const oldest = nowMs - recentSeconds * 1000;
  const subagents = join(sessionDir, 'subagents');
  const agents = await agentsIn(subagents, null, oldest);

  const workflows: WorkflowFolder[] = [];
  for (const run of await namesIn(join(subagents, 'workflows'))) {
    if (!run.isFolder || !RUN_FOLDER.test(run.name)) continue;
    const runDir = join(subagents, 'workflows', run.name);
    const [journal, runAgents] = await Promise.all([stampOf(join(runDir, 'journal.jsonl')), agentsIn(runDir, run.name, oldest)]);
    // A run whose journal and agents are all older than the week is not shown.
    const recent = (journal !== null && journal.mtimeMs >= oldest) || runAgents.length > 0;
    if (recent) workflows.push({ id: run.name, journal, agents: runAgents });
  }
  return { agents, workflows };
}

/**
 * The name of a workflow run: its script file is `<name>-<run id>.js`, in `<session id>/workflows/scripts`
 * under the folder of the cwd that the workflow was launched from. That is not always the folder of the
 * session file (a session that Mark starts in `home-base` and then moves into the repo keeps its file in
 * the first and its scripts in the second), so every named folder is looked in. Null when there is no
 * script. A name is only a label, so a folder that cannot be read just has no name in it.
 */
export async function findScriptName(config: Config, sessionId: string, workflowId: string): Promise<string | null> {
  const suffix = `-${workflowId}.js`;
  for (const { folder } of sessionSources(config.claude)) {
    const scripts = join(config.claude.projectsRoot, folder, sessionId, 'workflows', 'scripts');
    const names = await readdir(scripts).catch(() => [] as string[]);
    const hit = names.find((name) => name.endsWith(suffix) && name.length > suffix.length);
    if (hit !== undefined) return hit.slice(0, -suffix.length);
  }
  return null;
}
