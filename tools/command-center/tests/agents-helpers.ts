// Shared helpers for the tests of the agents module. This file has no tests of its own. Everything here is synthetic: the fixture world
// (tests/fixtures/claude) holds made-up sessions, made-up agents and made-up process files. Text in it that must never reach an answer starts
// with LEAK-, and text that may starts with ALLOWED-. The values that stand for the keys of a process file that never leave the server start
// with SENTINEL-.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from '../src/server/config';
import { createHub } from '../src/server/hub';
import { createAgentsSource } from '../src/server/agents/module';
import type { AgentsLive, ChangeEvent, LiveNode, LiveSession } from '../src/shared/types';
import { PACKAGE_DIR } from './helpers';
import { type Base, INSIDE, type Line, MIXED_FOLDER, NOW, WHOLE_FOLDER, at, sessionsConfig, setAge } from './sessions-helpers';

export { NOW, MIXED_FOLDER, WHOLE_FOLDER, at, jsonl, setAge, writeAged } from './sessions-helpers';

/** The committed fixture world: a process list (`sessions/`) and the session folders (`projects/`). */
const AGENT_FIXTURES = join(PACKAGE_DIR, 'tests', 'fixtures', 'claude');

// ---- the people of the fixture world ----

/** A: busy, in the whole folder, with agents (one nested, one with no call anywhere), a workflow and messages. */
export const SA = 'aaaaaaaa-0000-4000-8000-00000000000a';
/** B: idle, in the mixed folder with a working folder inside the repo, with a title of its own and one agent that has no end record. */
export const SB = 'bbbbbbbb-0000-4000-8000-00000000000b';
/** C: its process is gone. Its file must never be read. */
export const SC = 'cccccccc-0000-4000-8000-00000000000c';
/** D: a script started it (entrypoint sdk-py). */
export const SD = 'dddddddd-0000-4000-8000-00000000000d';
/** E: in the mixed folder, and it works outside every root. */
export const SE = 'eeeeeeee-0000-4000-8000-00000000000e';

/** The process ids of the process files. The tests inject which of them are alive. */
export const PID = { A: 7701001, B: 7701002, C: 7701003, D: 7701004, E: 7701005 } as const;

/** The pids that run, in the fixture world: every process but C. (Two more files in the folder are malformed and have no pid.) */
export const aliveSet = (): Set<number> => new Set([PID.A, PID.B, PID.D, PID.E]);

export const RUN = 'wf_00000001-fix';

/** Every sentinel of the process files: the answer must hold none of them. The pid sentinels are 7-digit numbers that no other number in an answer looks like. */
export const SENTINELS = [
  ...Object.values(PID).map(String),
  ...Object.values(PID).flatMap((pid) => [`SENTINEL-PROC-START-${pid}`, `SENTINEL-HOST-SESSION-${pid}`, `SENTINEL-SOCKET-PATH-${pid}`, `SENTINEL-NAME-${pid}`, `SENTINEL-BRIDGE-ID-${pid}`]),
  'SENTINEL-PEER-TOKEN-7701001',
  'SENTINEL-PROC-START-FT',
];

// ---- a copy of the world, with the ages of its files ----

export type World = { root: string; sessions: string; projects: string };

const whole = (...parts: string[]) => ['projects', WHOLE_FOLDER, ...parts].join('/');
const mixed = (...parts: string[]) => ['projects', MIXED_FOLDER, ...parts].join('/');

/**
 * How old each file is at NOW, in seconds, by its path inside the fixture world. A checkout gives every file the time of the checkout, and the module
 * reads the age of a file (a file written in the last 5 minutes is fresh), so the tests set the ages. A file that is not here is 60 seconds old.
 */
const DEFAULT_AGES: Record<string, number> = {
  [whole(`${SA}.jsonl`)]: 30,
  [whole(SA, 'subagents', 'agent-aa01.jsonl')]: 20,
  [whole(SA, 'subagents', 'agent-aa02.jsonl')]: 180, // it ended at 11:57, three minutes before NOW
  [whole(SA, 'subagents', 'agent-aa03.jsonl')]: 20,
  [whole(SA, 'subagents', 'agent-aa04.jsonl')]: 10,
  [whole(SA, 'subagents', 'workflows', RUN, 'journal.jsonl')]: 5,
  [whole(SA, 'subagents', 'workflows', RUN, 'agent-w1.jsonl')]: 900,
  [whole(SA, 'subagents', 'workflows', RUN, 'agent-w2.jsonl')]: 900,
  [whole(SA, 'subagents', 'workflows', RUN, 'agent-w3.jsonl')]: 5,
  [whole(`${SC}.jsonl`)]: 18_000, // five hours: for the fallback, where a session is idle after four
  [mixed(`${SB}.jsonl`)]: 1200,
  [mixed(SB, 'subagents', 'agent-bb01.jsonl')]: 600, // silent for ten minutes
};

let worlds = 0;

/** Copies the fixture world into `parent` and sets the age of every file. `ages` replaces ages by the path of the file in the world (forward slashes). */
export function copyAgentFixtures(parent: string, ages: Record<string, number> = {}): World {
  const root = join(parent, `world-${worlds++}`);
  cpSync(AGENT_FIXTURES, root, { recursive: true });
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, name);
      else setAge(path, ages[name] ?? DEFAULT_AGES[name] ?? 60);
    }
  };
  walk(root, '');
  return { root, sessions: join(root, 'sessions'), projects: join(root, 'projects') };
}

/** The config of a test over a world: the process list folder of the world, the two session folders, and roots that no file system has to hold. */
export function agentsConfig(world: World, claude: Partial<Config['claude']> = {}, agents: Partial<Config['agents']> = {}): Config {
  const config = sessionsConfig(world.projects, { sessionsRoot: world.sessions, ...claude });
  return { ...config, agents: { ...config.agents, ...agents } };
}

export const sessionFile = (world: World, folder: string, id: string): string => join(world.projects, folder, `${id}.jsonl`);
export const agentFile = (world: World, folder: string, sessionId: string, agentId: string): string => join(world.projects, folder, sessionId, 'subagents', `agent-${agentId}.jsonl`);

/** Writes a process file (the pid in its name), with the keys of a real one around the four that matter. */
export function writeProcessFile(world: World, pid: number, sessionId: string, status: 'busy' | 'idle', startedAtMs = NOW - 3_600_000): void {
  mkdirSync(world.sessions, { recursive: true });
  writeFileSync(
    join(world.sessions, `${pid}.json`),
    JSON.stringify({ pid, sessionId, cwd: '/fixture/repo', startedAt: startedAtMs, name: `SENTINEL-NAME-${pid}`, messagingSocketPath: `SENTINEL-SOCKET-PATH-${pid}`, bridgeSessionId: `SENTINEL-BRIDGE-ID-${pid}`, status }),
  );
}

/** Changes the `status` of a process file of the world and nothing else. */
export function setStatus(world: World, pid: number, status: 'busy' | 'idle'): void {
  const file = join(world.sessions, `${pid}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...json, status }));
}

// ---- lines for the files that a test makes ----

/** What every line of the conversation carries besides its own fields: the same shape as the lines of tests/sessions-helpers.ts. */
function lineBase(type: string, o: Base): Line {
  const line: Line = { type, timestamp: o.time ?? at(0), sessionId: 'fixture-session', gitBranch: o.branch ?? 'fixture-branch' };
  if (o.cwd !== null) line.cwd = o.cwd ?? INSIDE;
  if (o.entrypoint !== undefined) line.entrypoint = o.entrypoint;
  return line;
}

/** An assistant line with one tool call whose id the test names. */
function toolCall(name: string, id: string, input: Line, o: Base = {}): Line {
  return { ...lineBase('assistant', o), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } };
}

/** The call that starts an agent. */
export const agentCall = (id: string, o: Base = {}): Line => toolCall('Agent', id, { description: 'LEAK-call-description', prompt: 'LEAK-call-prompt' }, o);

/** The call that writes to an agent. */
export const sendMessage = (to: string, id: string, o: Base = {}): Line => toolCall('SendMessage', id, { to, message: 'LEAK-message-text' }, o);

/** A message from an agent to the session that started it, or its final report (`handback: true`). */
export function peerLine(from: string, handback: boolean | undefined, o: Base = {}): Line {
  return {
    ...lineBase('user', o),
    isMeta: true,
    origin: { kind: 'peer', from, name: 'general-purpose', senderTaskId: from, body: 'LEAK-peer-body', ...(handback === undefined ? {} : { handback }) },
    message: { role: 'user', content: 'LEAK-peer-content' },
  };
}

/** An agent's `.meta.json`, written beside its file. */
export function writeMeta(file: string, meta: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ spawnDepth: 1, agentType: 'general-purpose', ...meta }));
}

// ---- loading the module ----

export type Loaded = {
  data: AgentsLive;
  world: World;
  config: Config;
  source: ReturnType<typeof createAgentsSource>;
  events: ChangeEvent[];
  /** Which pids run. The set can change between two looks, as processes start and end. */
  alive: Set<number>;
};

type LoadOptions = {
  /** A world to look at again. Without it, `parent` is the folder where a new copy of the fixture world is made. */
  world?: World;
  parent?: string;
  ages?: Record<string, number>;
  claude?: Partial<Config['claude']>;
  agents?: Partial<Config['agents']>;
  nowMs?: number;
  alive?: Set<number>;
};

/** Makes a world (or takes the one given), builds the module over it with a fixed clock and an injected pid check, looks once, and gives the answer. */
export async function loadAgents(options: LoadOptions): Promise<Loaded> {
  if (options.world === undefined && options.parent === undefined) throw new Error('loadAgents needs a world or a folder to make one in');
  const world = options.world ?? copyAgentFixtures(options.parent as string, options.ages);
  const config = agentsConfig(world, options.claude, options.agents);
  const hub = createHub();
  const events: ChangeEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const alive = options.alive ?? aliveSet();
  const source = createAgentsSource({ config, hub, now: () => options.nowMs ?? NOW, isAlive: (pid) => alive.has(pid) });
  const panel = await source.get(true);
  if (!panel.ok) throw new Error(`the panel failed: ${panel.error.code}: ${panel.error.message}`);
  return { data: panel.data, world, config, source, events, alive };
}

/** The session with this id in an answer; the test fails when it is not there. */
export function sessionOf(data: AgentsLive, id: string): LiveSession {
  const session = data.sessions.find((candidate) => candidate.id === id);
  if (session === undefined) throw new Error(`session ${id} is not in the answer`);
  return session;
}

/** The node with this id in a session; the test fails when it is not there. */
export function nodeOf(session: LiveSession, id: string): LiveNode {
  const node = session.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`node ${id} is not in session ${session.id}`);
  return node;
}
