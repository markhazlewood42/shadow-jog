import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHub } from '../src/server/hub';
import { createSessionsSource } from '../src/server/sessions/sessions';
import { NOW, S1_PLACEHOLDER, sessionsConfigFor } from './sessions-many-stamps-helpers';

// A session with hundreds of thousands of files. The tree is made up here, and the reads of an agent are
// instant, so the test checks only the arithmetic of the module.

const COUNT = 200_000;

vi.mock('../src/server/sessions/discover', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/sessions/discover')>();
  return {
    ...real,
    listSessionTree: async () => ({
      agents: [],
      workflows: [
        {
          id: 'wf_many',
          journal: null,
          agents: Array.from({ length: 200_000 }, (_, i) => ({ path: `/x/agent-${i}.jsonl`, size: 1, mtimeMs: 1_000 + i, birthtimeMs: 1_000, id: `a${i}`, workflowId: 'wf_many' })),
        },
      ],
    }),
  };
});

vi.mock('../src/server/sessions/reader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/server/sessions/reader')>();
  return {
    ...real,
    createSessionReader: (...args: Parameters<typeof real.createSessionReader>) => ({
      ...real.createSessionReader(...args),
      readAgent: async () => ({ firstTime: null, ended: false, lastTime: null }),
      readAgentMeta: async () => ({ description: '', agentType: '', model: '', toolUseId: '' }),
    }),
  };
});

const parent = mkdtempSync(join(tmpdir(), 'cc-many-'));
afterAll(() => rmSync(parent, { recursive: true, force: true }));

describe('the sessions module with many files', () => {
  it('G1: the sessions module with 200000 file stamps does not throw', async () => {
    const projects = sessionsConfigFor(parent);
    const source = createSessionsSource({ config: projects, hub: createHub(), now: () => NOW });
    const panel = await source.get(true);
    if (!panel.ok) throw new Error(`the panel failed: ${panel.error.message}`);
    const session = panel.data.sessions.find((candidate) => candidate.id === S1_PLACEHOLDER);
    expect(session).toBeDefined();
    expect(COUNT).toBe(200_000);
    expect(session?.workflows[0]?.lastEventAt).toBe(new Date(1_000 + COUNT - 1).toISOString());
  });
});
