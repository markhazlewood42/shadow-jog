import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { E2E_DIR } from './fake-gh';

// The made-up world of the Agents page tests (e2e/agents.spec.ts): process files, session files, agent files and workflow journals, written into the folders that the end-to-end
// config names (e2e/server.ts), and deleted afterwards. Nothing here is real: every title, label and message is invented, and no real session text is in it.
//
// The page lists a session while its Claude process runs, so a made-up session needs a made-up process file. The server reads the pid from the file, not from its name, and checks
// that a program with that pid runs. The test process itself runs, so its pid stands for a live process, and the pid of a program that has already ended stands for a closed one.
// The name of a process file only has to be a number, so one live pid can stand for as many live processes as a test needs.

export const REPO = join(E2E_DIR, 'repo'); // the one root of the end-to-end config
export const PROCESSES = join(E2E_DIR, 'claude-sessions'); // `claude.sessionsRoot`: the process list
export const PROJECTS = join(E2E_DIR, 'claude-projects'); // `claude.projectsRoot`
export const WHOLE = join(PROJECTS, 'fixture-shadow-jog'); // `claude.folders`: every session in it is Shadow Jog's
export const MIXED = join(PROJECTS, 'fixture-home-base'); // `claude.cwdMatchFolders`: a session counts only when its working folder is inside the root
export const ELSEWHERE = join(E2E_DIR, 'elsewhere'); // a working folder that is not inside the root

export const ID = (n: number) => `e2e0c000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Line = Record<string, unknown>;

/**
 * One moment for a whole fixture. Every time in it is counted from this one moment, so the length between two of its times is exact: the real clock moves a little between two
 * calls of Date.now, and a length that comes out a few milliseconds short would show as one minute less.
 */
export function clock() {
  const base = Date.now();
  return { at: (secondsAgo: number) => new Date(base - secondsAgo * 1000).toISOString(), ms: (secondsAgo: number) => base - secondsAgo * 1000 };
}

// ---- lines of a session file ----

const line = (type: 'user' | 'assistant', timestamp: string, message: Line, extra: Line = {}): Line => ({ type, timestamp, cwd: REPO, gitBranch: 'fixture-branch', sessionId: 'e2e', entrypoint: 'claude-desktop', message, ...extra });

export const prompt = (text: string, timestamp: string, extra: Line = {}): Line => line('user', timestamp, { role: 'user', content: text }, extra);
export const reply = (text: string, timestamp: string): Line => line('assistant', timestamp, { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] });
/** A tool result after the last reply: the session (or agent) works again. */
export const toolResult = (timestamp: string): Line => line('user', timestamp, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_e2e', content: 'made up' }] }, { toolUseResult: { ok: true } });
/** The call that starts an agent. Its id is the `toolUseId` in the agent's meta file. */
export const agentCall = (toolUseId: string, timestamp: string): Line =>
  line('assistant', timestamp, { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { description: 'LEAK-call-description', prompt: 'LEAK-call-prompt' } }] });
/** A message from the parent to an agent. The words of the message are never on the page. */
export const sendMessage = (to: string, callId: string, timestamp: string): Line =>
  line('assistant', timestamp, { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: callId, name: 'SendMessage', input: { to, message: 'LEAK-message-text' } }] });
/** A message from an agent to its parent. */
export const peerMessage = (from: string, timestamp: string): Line => line('user', timestamp, { role: 'user', content: 'LEAK-peer-text' }, { origin: { kind: 'peer', from, handback: false } });
/** The "Your move" box of a reply. */
export const yourMoveBox = (light: string, items: string[]) => `${light} Two files changed.\n\n---\n### 👉 Your move\n${items.map((item) => `- [ ] ${item}`).join('\n')}`;
/** One long line that no parser needs, to make a file larger than the part of it that is read (1 MiB). */
export const filler = (bytes: number): Line => ({ type: 'attachment', filler: 'x'.repeat(bytes) });

// ---- files ----

export function writeLines(file: string, lines: Line[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

/** Sets the time of last write of a file: the module reads the age of a file that has no end record. */
export function touch(file: string, ms: number): void {
  utimesSync(file, new Date(ms), new Date(ms));
}

export const sessionFile = (id: string, folder: string = WHOLE): string => join(folder, `${id}.jsonl`);
export const agentFile = (sessionId: string, agentId: string, folder: string = WHOLE): string => join(folder, sessionId, 'subagents', `agent-${agentId}.jsonl`);
export const journalFile = (sessionId: string, run: string, folder: string = WHOLE): string => join(folder, sessionId, 'subagents', 'workflows', run, 'journal.jsonl');

export function writeSession(id: string, lines: Line[], folder: string = WHOLE): string {
  const file = sessionFile(id, folder);
  writeLines(file, lines);
  return file;
}

export type AgentOptions = { description: string; model: string; toolUseId?: string; lines: Line[]; touchedAt?: number; folder?: string };

/** An agent of a session: its file, and its meta file with the label, the model and the call that started it. */
export function writeAgent(sessionId: string, agentId: string, options: AgentOptions): string {
  const file = agentFile(sessionId, agentId, options.folder);
  writeLines(file, options.lines);
  writeFileSync(join(dirname(file), `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: options.description, model: options.model, ...(options.toolUseId === undefined ? {} : { toolUseId: options.toolUseId }) }));
  if (options.touchedAt !== undefined) touch(file, options.touchedAt);
  return file;
}

export type Phase = { name: string; started: number; done: number };

/** A workflow run: its journal (rows `started` and `result`), its script (the name of the workflow) and one agent file for each agent that is still at work. */
export function writeWorkflow(sessionId: string, run: string, name: string, phases: Phase[], working: string[] = [], folder: string = WHOLE): string {
  const journal = journalFile(sessionId, run, folder);
  const rows: Line[] = [{ type: 'launched' }];
  for (const phase of phases) {
    for (let i = 1; i <= phase.started; i += 1) rows.push({ type: 'started', key: `${phase.name}/${i}`, agentId: `${phase.name.toLowerCase()}${i}`, label: 'made up', phase: phase.name });
    for (let i = 1; i <= phase.done; i += 1) rows.push({ type: 'result', key: `${phase.name}/${i}`, agentId: `${phase.name.toLowerCase()}${i}`, result: 'made up' });
  }
  writeLines(journal, rows);
  for (const agent of working) writeLines(join(dirname(journal), `agent-${agent}.jsonl`), [prompt('made up', new Date().toISOString()), toolResult(new Date().toISOString())]);
  mkdirSync(join(folder, sessionId, 'workflows', 'scripts'), { recursive: true });
  writeFileSync(join(folder, sessionId, 'workflows', 'scripts', `${name}-${run}.js`), '// made up\n');
  return journal;
}

// ---- processes ----

/** The pid of a program that has ended: nothing runs under it any more. */
export function endedPid(): number {
  const run = spawnSync(process.execPath, ['-e', '0']);
  if (run.pid === undefined || run.pid <= 0) throw new Error('could not start a program to get a pid that has ended');
  return run.pid;
}

/**
 * The process file of a session. `slot` is only the number in the name of the file (two processes need two names). The pid is that of this test process, which runs, unless
 * `alive` is false: then it is the pid of a program that has ended. The server keeps the session id, the start and the status of a file, and nothing else.
 */
export function writeProcess(slot: number, sessionId: string, status: 'busy' | 'idle', ranSeconds: number, alive = true): void {
  mkdirSync(PROCESSES, { recursive: true });
  writeFileSync(join(PROCESSES, `${slot}.json`), JSON.stringify({ pid: alive ? process.pid : endedPid(), sessionId, cwd: REPO, startedAt: Date.now() - ranSeconds * 1000, status }));
}

/** Deletes everything the tests wrote: the session files and the process files. */
export function resetWorld(): void {
  rmSync(PROJECTS, { recursive: true, force: true });
  rmSync(PROCESSES, { recursive: true, force: true });
}

// ---- the world of most tests ----

/** The titles of the three sessions of `writeWorld`, in the order of their start: the oldest first. */
export const TITLES = ['Build the Agents page of the command center', 'Review the engine docs for the fixture', 'Update the glossary from the home-base folder'] as const;

/** The labels of the agents and the workflow of the first session that are drawn, in the order the page draws them. */
export const LABELS = { done: 'Check the milestone table', running: 'Explore the fixture engine docs', nested: 'Read one doc of the fixture', workflow: 'fixture-build' } as const;

export const WORKFLOW_RUN = 'wf_00000001-aaa';

/**
 * Three live sessions:
 *  1 works (40 min): the first prompt has a second line. Its agents and workflow, in the order of their start:
 *    - `done0001` "Check the milestone table" (sonnet), finished 2 min ago, so it is drawn dimmed, "sonnet · done";
 *    - `run00001` "Explore the fixture engine docs" (fable), at work, with 2 messages from its parent;
 *    - `nest0001` "Read one doc of the fixture" (haiku), started by `run00001`, at work, with 1 message;
 *    - the workflow "fixture-build" with 2 of 3 agents done in the phase "Build";
 *    and three agents that are NOT drawn: one silent for 90 minutes (stopped), one that finished 15 min ago (past the 5 minutes), and an agent of the workflow.
 *  2 waits for Mark (12 min), with a yellow "Your move" box.
 *  3 works (1 min), in the home-base folder with a working folder inside the root.
 * Plus a fourth session whose process ended: it must not be drawn.
 */
export function writeWorld(): void {
  const c = clock();

  const first = ID(1);
  writeSession(first, [
    prompt('Build the Agents page of the command center\nsecond line of the prompt', c.at(2400)),
    agentCall('toolu_done', c.at(650)),
    agentCall('toolu_run', c.at(260)),
    sendMessage('run00001', 'toolu_m1', c.at(200)),
    sendMessage('run00001', 'toolu_m2', c.at(100)),
    toolResult(c.at(4)),
  ]);
  writeAgent(first, 'done0001', { description: LABELS.done, model: 'claude-sonnet-5-5', toolUseId: 'toolu_done', lines: [prompt('made up', c.at(600)), reply('Done.', c.at(120))] });
  writeAgent(first, 'run00001', {
    description: LABELS.running,
    model: 'claude-fable-5-1',
    toolUseId: 'toolu_run',
    lines: [prompt('made up', c.at(250)), agentCall('toolu_nest', c.at(195)), peerMessage('nest0001', c.at(100)), toolResult(c.at(5))],
  });
  writeAgent(first, 'nest0001', { description: LABELS.nested, model: 'claude-haiku-4-5', toolUseId: 'toolu_nest', lines: [prompt('made up', c.at(190)), toolResult(c.at(8))] });
  writeAgent(first, 'stop0001', { description: 'Retry the stalled export', model: 'claude-sonnet-5-5', lines: [prompt('made up', c.at(5400)), toolResult(c.at(5300))], touchedAt: c.ms(5300) });
  writeAgent(first, 'gone0001', { description: 'Check an old table', model: 'claude-sonnet-5-5', lines: [prompt('made up', c.at(1200)), reply('Done.', c.at(900))], touchedAt: c.ms(900) });
  writeWorkflow(first, WORKFLOW_RUN, LABELS.workflow, [{ name: 'Research', started: 2, done: 2 }, { name: 'Build', started: 1, done: 0 }], ['build1']);

  const second = ID(2);
  writeSession(second, [prompt('Review the engine docs for the fixture', c.at(1000)), reply(yourMoveBox('🟡', ['Review the diff', 'Tell me to commit']), c.at(600))]);

  const third = ID(3);
  writeSession(third, [prompt('Update the glossary from the home-base folder', c.at(120)), toolResult(c.at(3))], MIXED);

  const closed = ID(4);
  writeSession(closed, [prompt('LEAK-title-of-the-session-whose-process-ended', c.at(900)), toolResult(c.at(30))]);

  writeProcess(1, first, 'busy', 40 * 60);
  writeProcess(2, second, 'idle', 12 * 60);
  writeProcess(3, third, 'busy', 90);
  writeProcess(4, closed, 'busy', 15 * 60, false);
}
