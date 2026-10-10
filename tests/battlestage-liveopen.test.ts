/**
 * Opening the stage for a shipped battle (src/battlestage/liveopen.ts) and the lazy provider the boot glue registers (src/scenes/battlekit/stageseam.ts): M3 fix round 1, findings F1, F2, F4.
 *
 * A stage that cannot be made must not cost the player the fight: `open` answers null (the battle then draws itself with the old renderer), the game shows its notice bar saying
 * why, and nothing rejects. Each failure case has a control that does not fail: a stage is made and no notice shows.
 *
 * The page's loaders and the stage scene are stand-ins (a browser would load the sheets, and the real scene needs a GL context); the provider, `initFor`, the stage data and the
 * notice are the real ones.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { currentNotice } from '../src/engine/errors';
import type { BattleScene } from '../src/scenes/battle';
import { lazyStageProvider, STAGE_FAILED_NOTICE, type BattleStage, type BattleStageProvider } from '../src/scenes/battlekit/stageseam';

const h = vi.hoisted(() => ({
  /** What `game.run` does with the stage scene: set per test. */
  run: (_stage: unknown): Promise<unknown> => new Promise(() => undefined),
  /** Set to make the data load fail. */
  loadFails: false,
}));

vi.mock('../src/battlestage/boot', () => ({
  loadStageData: async () => {
    if (h.loadFails) throw new Error('the stage files did not load');
    const { fixtureStages } = await import('./stagefiles');
    return { stages: fixtureStages(), facing: {}, heroes: {}, axes: {} };
  },
  haveMarksSheets: async () => false,
  chooseSprites: async () => ({ metas: {}, standIns: {} }),
  loadStageAssets: async () => undefined,
}));

vi.mock('../src/battlestage/live', () => ({
  LiveStageScene: class {
    closed = false;
    topClear = 0;
    close(): void {
      this.closed = true;
    }
  },
}));

const { liveProvider } = await import('../src/battlestage/liveopen');

const scene = { setup: { bg: 'street' }, battle: { enemies: [{ key: 'rustfang_punk' }], party: [{ key: 'kit' }] } } as unknown as BattleScene;
const game = { textures: {}, run: (s: unknown) => h.run(s) } as never;

/** Each test starts on a later fake clock, so the notice of an earlier test has run out (a notice lives 6 s). */
let clock = 1_000_000;
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  h.loadFails = false;
  h.run = () => new Promise(() => undefined);
});
const newClock = (): void => {
  clock += 60_000;
  vi.spyOn(performance, 'now').mockReturnValue(clock);
};

/** Unhandled rejections seen while `body` runs and the loop turns a few times. */
async function unhandledDuring(body: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const on = (e: unknown): void => {
    seen.push(e);
  };
  process.on('unhandledRejection', on);
  try {
    await body();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    process.off('unhandledRejection', on);
  }
  return seen;
}

describe('liveProvider.open', () => {
  it('CONTROL: a stage that is made and stays open is returned, and no notice shows', async () => {
    newClock();
    // The scene is on the stack and waiting for the battle to end: its promise stays pending.
    h.run = () => new Promise(() => undefined);
    const seen = await unhandledDuring(async () => {
      const stage = await liveProvider.open(game, scene);
      expect(stage).not.toBeNull();
      expect((stage as unknown as { closed: boolean }).closed).toBe(false);
    });
    expect(currentNotice()).toBeNull();
    expect(seen).toEqual([]);
  });

  it('a create that throws at once: null, the notice shows, no unhandled rejection', async () => {
    newClock();
    h.run = () => Promise.reject(new Error('create threw'));
    const seen = await unhandledDuring(async () => {
      expect(await liveProvider.open(game, scene)).toBeNull();
    });
    expect(currentNotice()).toEqual({ text: STAGE_FAILED_NOTICE, tone: 'warn' });
    expect(seen).toEqual([]);
  });

  it('a create that fails later, through a chain of promises (F4): the same, where the old single wait saw a stage that was fine', async () => {
    newClock();
    h.run = () => Promise.resolve().then(() => undefined).then(() => undefined).then(() => undefined).then(() => Promise.reject(new Error('async create failed')));
    const seen = await unhandledDuring(async () => {
      expect(await liveProvider.open(game, scene)).toBeNull();
    });
    expect(currentNotice()).toEqual({ text: STAGE_FAILED_NOTICE, tone: 'warn' });
    expect(seen).toEqual([]);
  });

  it('a stage that closed as it started: null and the notice', async () => {
    newClock();
    h.run = (s) => {
      (s as { closed: boolean }).closed = true;
      return Promise.resolve();
    };
    expect(await liveProvider.open(game, scene)).toBeNull();
    expect(currentNotice()?.text).toBe(STAGE_FAILED_NOTICE);
  });

  it('a stage that fails after it came up is not an unhandled rejection', async () => {
    newClock();
    let fail: (e: unknown) => void = () => undefined;
    h.run = () => new Promise((_resolve, reject) => (fail = reject));
    const seen = await unhandledDuring(async () => {
      expect(await liveProvider.open(game, scene)).not.toBeNull();
      fail(new Error('failed much later'));
    });
    expect(seen).toEqual([]);
  });

  it('a data load that fails: null and the notice', async () => {
    newClock();
    h.loadFails = true;
    // The data of a set is kept once it has loaded (the 640 set did in the control above), so ask for the other set, which has not.
    (globalThis as { location?: unknown }).location = { search: '?stageset=480' };
    try {
      expect(await liveProvider.open(game, scene)).toBeNull();
    } finally {
      delete (globalThis as { location?: unknown }).location;
    }
    expect(currentNotice()).toEqual({ text: STAGE_FAILED_NOTICE, tone: 'warn' });
  });
});

describe('lazyStageProvider (what src/sje/boot.ts registers)', () => {
  const stage = { close: () => undefined } as unknown as BattleStage;

  it('CONTROL: a chunk that loads gives the real provider its battle, and no notice shows', async () => {
    newClock();
    const p = lazyStageProvider(async () => ({ open: async () => stage }) satisfies BattleStageProvider);
    expect(await p.open(game, scene)).toBe(stage);
    expect(currentNotice()).toBeNull();
  });

  it('a chunk that fails to load (the import rejects): null, the notice shows, no unhandled rejection, so the battle can start', async () => {
    newClock();
    const p = lazyStageProvider(async () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const seen = await unhandledDuring(async () => {
      expect(await p.open(game, scene)).toBeNull();
    });
    expect(currentNotice()).toEqual({ text: STAGE_FAILED_NOTICE, tone: 'warn' });
    expect(seen).toEqual([]);
  });

  it('a provider whose open throws is also caught', async () => {
    newClock();
    const p = lazyStageProvider(async () => ({
      open: async () => {
        throw new Error('open threw');
      },
    }));
    expect(await p.open(game, scene)).toBeNull();
    expect(currentNotice()?.text).toBe(STAGE_FAILED_NOTICE);
  });
});
