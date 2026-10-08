import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProcessList } from '../src/server/agents/process-list';
import { createAgentsSource } from '../src/server/agents/module';
import { loadConfig } from '../src/server/config';
import { createHub } from '../src/server/hub';
import type { AgentsLive } from '../src/shared/types';
import { PACKAGE_DIR } from './helpers';

// A check against the real machine, so it runs only on demand and not in the default suite (the same way as CC_REAL_NAV in tests/docs-routes.test.ts):
//   CC_REAL_AGENTS=1 npx vitest run tests/agents-real.test.ts
// It reads the real folder of the process list (~/.claude/sessions, from the real config) and checks the shape only: what the process files hold, and what
// the module makes of them. The sessions on the machine are Mark's private conversations, so this test prints nothing of them: no title, no label and no
// path appears in its output, also when it fails (a failure names the problem and the id of the node, never its text).

const REAL_CONFIG = join(PACKAGE_DIR, 'command-center.config.json');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isIsoOrNull = (value: unknown) => value === null || (typeof value === 'string' && ISO.test(value));

/** What is wrong with an answer, one sentence each. The sentences name an id and a field, and never repeat a word of a session. */
function problemsOf(data: AgentsLive): string[] {
  const problems: string[] = [];
  const say = (problem: string) => problems.push(problem);
  if (data.source !== 'process-list' && data.source !== 'file-age') say('source is neither process-list nor file-age');
  if (!Number.isInteger(data.hiddenScripts) || data.hiddenScripts < 0) say('hiddenScripts is not a count');
  const startKey = (startedAt: string | null) => (startedAt === null ? Number.POSITIVE_INFINITY : Date.parse(startedAt));
  data.sessions.forEach((session, index) => {
    const at = `session ${session.id}`;
    if (!/^[\w-]+$/.test(session.id)) say(`${at}: the id is not a file name`);
    if (typeof session.title !== 'string' || session.title === '') say(`${at}: the title is empty`);
    if (session.state !== 'working' && session.state !== 'waiting') say(`${at}: the state is not working or waiting`);
    if (!isIsoOrNull(session.startedAt)) say(`${at}: startedAt is not a time`);
    if (typeof session.filePath !== 'string' || !session.filePath.endsWith(`${session.id}.jsonl`)) say(`${at}: filePath is not the session file`);
    const previous = data.sessions[index - 1];
    if (previous !== undefined && startKey(previous.startedAt) > startKey(session.startedAt)) say(`${at}: the sessions are not in order of start`);
    const known = new Set([session.id, ...session.nodes.map((node) => node.id)]);
    session.nodes.forEach((node, nodeIndex) => {
      const where = `${at}, node ${node.id}`;
      if (!known.has(node.parentId)) say(`${where}: the parent is neither the session nor a node`);
      if (node.parentId === node.id) say(`${where}: the node is its own parent`);
      if (node.kind !== 'agent' && node.kind !== 'workflow') say(`${where}: the kind is unknown`);
      if (typeof node.label !== 'string' || node.label === '') say(`${where}: the label is empty`);
      if (node.model !== null && (typeof node.model !== 'string' || node.model === '' || [...node.model].length > 12)) say(`${where}: the model is not a family name`);
      if (node.state !== 'running' && node.state !== 'done') say(`${where}: the state is not running or done`);
      if (!isIsoOrNull(node.startedAt) || !isIsoOrNull(node.endedAt)) say(`${where}: a time is not a time`);
      if ((node.state === 'done') !== (node.endedAt !== null)) say(`${where}: endedAt does not follow the state`);
      if (node.filePath !== null && typeof node.filePath !== 'string') say(`${where}: filePath is not a path`);
      if (!Number.isInteger(node.messages.count) || node.messages.count < 0 || typeof node.messages.approximate !== 'boolean') say(`${where}: messages is not a count`);
      if ((node.kind === 'workflow') !== ('progress' in node)) say(`${where}: progress is not on exactly the workflows`);
      if (node.progress !== undefined && (!Number.isInteger(node.progress.done) || !Number.isInteger(node.progress.started) || node.progress.done > node.progress.started)) say(`${where}: progress is not counts`);
      const before = session.nodes[nodeIndex - 1];
      if (before !== undefined && startKey(before.startedAt) > startKey(node.startedAt)) say(`${where}: the nodes are not in order of start`);
    });
  });
  const text = JSON.stringify(data);
  if (/"pid"|messagingSocketPath|bridgeSessionId|peerToken/.test(text)) say('the answer holds a key of a process file');
  return problems;
}

describe('the real process list', () => {
  // Run it on demand: CC_REAL_AGENTS=1 npx vitest run tests/agents-real.test.ts
  it.skipIf(process.env.CC_REAL_AGENTS !== '1')('real process list has the expected shape', async () => {
    const config = loadConfig(REAL_CONFIG);

    // The folder is there and its files have the shape that the reader expects. (An empty folder is a list too: nothing runs.)
    const list = await readProcessList(config.claude.sessionsRoot);
    expect(list.ok ? 'ok' : `not ok: ${list.reason}`).toBe('ok');
    if (!list.ok) return;
    for (const entry of list.entries) {
      expect(Object.keys(entry).sort()).toEqual(['sessionId', 'startedAtMs', 'status']);
      expect(/^[\w-]{1,128}$/.test(entry.sessionId)).toBe(true);
      expect(entry.status === 'busy' || entry.status === 'idle').toBe(true);
      expect(entry.startedAtMs === null || Number.isFinite(entry.startedAtMs)).toBe(true);
    }

    // The module over the real files, with the real pid check: a good Panel in the shape of the type, from the process list.
    const source = createAgentsSource({ config, hub: createHub() });
    const panel = await source.get(true);
    expect(panel.ok ? 'ok' : `not ok: ${panel.error.code}`).toBe('ok');
    if (!panel.ok) return;
    expect(panel.data.source).toBe('process-list');
    expect(problemsOf(panel.data)).toEqual([]);
    // A session is live only when its process is: at most as many sessions as processes (two processes can run one session).
    expect(panel.data.sessions.length + panel.data.hiddenScripts).toBeLessThanOrEqual(list.entries.length);
  });
});
