import { describe, expect, it } from 'vitest';
import { LIVE_ITEM_LIMITS, parseLive } from '../src/shared/live';

// The `agents.items` field of the live contract (src/shared/live.ts): present, missing (an older reporter), and bad.

const item = (extra: Record<string, unknown> = {}) => ({ label: 'Check the diff', state: 'running', model: 'sonnet', startedAt: '2026-10-14T08:00:00.000Z', endedAt: null, ...extra });
const value = (agents: Record<string, unknown>) => ({
  writtenAt: '2026-10-14T08:01:00.000Z',
  sessions: [{ id: 's1', title: 't', branch: 'b', folder: 'f', state: 'working', startedAt: null, agents: { running: 1, done: 0, names: ['Check the diff'], ...agents }, yourMove: null }],
  worktrees: [],
});
const reason = (agents: Record<string, unknown>) => {
  const parsed = parseLive(value(agents));
  return parsed.ok ? null : parsed.reason;
};

describe('parseLive: agents.items', () => {
  it('accepts a row with items and keeps them', () => {
    const parsed = parseLive(value({ items: [item(), item({ label: 'Done one', state: 'done', model: null, endedAt: '2026-10-14T08:00:30.000Z' })] }));
    expect(parsed.ok && parsed.live.sessions[0]?.agents.items).toEqual([
      item(),
      { label: 'Done one', state: 'done', model: null, startedAt: '2026-10-14T08:00:00.000Z', endedAt: '2026-10-14T08:00:30.000Z' },
    ]);
  });

  it('accepts a row without items (an older reporter) and adds no items key', () => {
    const parsed = parseLive(value({}));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && 'items' in (parsed.live.sessions[0]?.agents ?? {})).toBe(false);
  });

  it('builds each item again from the named fields only', () => {
    const parsed = parseLive(value({ items: [item({ filePath: 'C:\\secret', prompt: 'SECRET' })] }));
    expect(parsed.ok && Object.keys(parsed.live.sessions[0]?.agents.items?.[0] ?? {}).sort()).toEqual(['endedAt', 'label', 'model', 'startedAt', 'state']);
  });

  it('refuses bad items with a reason that names the field', () => {
    expect(reason({ items: 'x' })).toMatch(/agents\.items must be a list/);
    expect(reason({ items: [item({ state: 'stopped' })] })).toMatch(/items\[0\]\.state/);
    expect(reason({ items: [item({ label: 4 })] })).toMatch(/items\[0\]\.label/);
    expect(reason({ items: [item({ label: 'x'.repeat(LIVE_ITEM_LIMITS.label + 1) })] })).toMatch(/items\[0\]\.label/);
    expect(reason({ items: [item({ model: 'x'.repeat(LIVE_ITEM_LIMITS.model + 1) })] })).toMatch(/items\[0\]\.model/);
    expect(reason({ items: [item({ model: 5 })] })).toMatch(/items\[0\]\.model/);
    expect(reason({ items: [item({ startedAt: 'yesterday-ish' })] })).toMatch(/items\[0\]\.startedAt/);
    expect(reason({ items: [item({ endedAt: 12 })] })).toMatch(/items\[0\]\.endedAt/);
    expect(reason({ items: [item({ startedAt: undefined })] })).toMatch(/items\[0\]\.startedAt/);
    expect(reason({ items: [null] })).toMatch(/items\[0\] is not an object/);
  });

  it('refuses more items than the cap, and accepts exactly the cap', () => {
    expect(reason({ items: Array.from({ length: LIVE_ITEM_LIMITS.items }, () => item()) })).toBeNull();
    expect(reason({ items: Array.from({ length: LIVE_ITEM_LIMITS.items + 1 }, () => item()) })).toMatch(/more than 20 items/);
  });
});
