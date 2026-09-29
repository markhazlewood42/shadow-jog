import { beforeEach, describe, expect, it } from 'vitest';

// Minimal localStorage for the node test environment.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

const { hasAnySave, latestSlot, loadSave, readMeta, slotStatus, unsavedFrames, validState, writeSave, applySave } = await import('../src/game/save');
const { addMember } = await import('../src/game/party');
const stateMod = await import('../src/game/state');
const { newState, setState } = stateMod;
const { streams } = await import('../src/engine/rng');
const rng = streams.encounter;

function freshGame(): void {
  setState(newState());
  const state = stateMod.state;
  addMember('kit', 3);
  addMember('rook', 4);
  state.map = 'lantern_row';
  state.x = 20;
  state.y = 9;
  state.cred = 777;
  state.inventory = { medkit: 2 };
  state.flags = { intro: true, met_dutch: true };
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage.clear();
  freshGame();
});

describe('save / load', () => {
  it('round-trips the full state, meta, play time and RNG', () => {
    rng.state = 123456;
    expect(writeSave(2, 4321)).toBe(true);
    const meta = readMeta(2)!;
    expect(meta.location).toBe('Lantern Row');
    expect(meta.leaderLevel).toBe(3);
    expect(meta.playFrames).toBe(4321);
    const s = loadSave(2)!;
    expect(s).not.toBeNull();
    expect(s.cred).toBe(777);
    expect(s.inventory).toEqual({ medkit: 2 });
    expect(s.flags.met_dutch).toBe(true);
    expect(s.members.kit!.level).toBe(3);
    expect(s.playFrames).toBe(4321);
    rng.state = 1;
    streams.battle.state = 7;
    applySave(s);
    expect(rng.state).toBe(123456);
    expect(streams.battle.state).not.toBe(7); // the battle stream is saved and restored too
  });

  it('reports the most recent slot', () => {
    writeSave(1, 10);
    writeSave('auto', 20);
    expect(hasAnySave()).toBe(true);
    expect(['auto', 1]).toContain(latestSlot());
  });

  it('rejects corrupt JSON, future versions and structurally broken saves', () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    ls.setItem('shadowjog.save.1', '{not json');
    expect(loadSave(1)).toBeNull();
    writeSave(2, 0);
    const raw = JSON.parse(ls.getItem('shadowjog.save.2')!);
    raw.state.version = 999;
    ls.setItem('shadowjog.save.2', JSON.stringify(raw));
    expect(loadSave(2)).toBeNull();
    writeSave(3, 0);
    const broken = JSON.parse(ls.getItem('shadowjog.save.3')!);
    delete broken.state.members.kit;
    ls.setItem('shadowjog.save.3', JSON.stringify(broken));
    expect(loadSave(3)).toBeNull();
  });

  it('rejects saves pointing at unknown maps', () => {
    stateMod.state.map = 'no_such_map';
    expect(validState(stateMod.state)).toBe(false);
  });

  it('loads a minimal older save: every later field gets a sensible default', () => {
    writeSave(1, 0);
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    const raw = JSON.parse(ls.getItem('shadowjog.save.1')!);
    for (const k of ['combos', 'bestiary', 'weakSeen', 'lastOrders', 'lastEntrance', 'battles', 'dir', 'steps', 'rngState']) delete raw.state[k];
    ls.setItem('shadowjog.save.1', JSON.stringify(raw));
    const s = loadSave(1)!;
    expect(s).not.toBeNull();
    expect(s.weakSeen).toEqual({});
    expect(s.battles).toBe(0);
    expect(s.dir).toBe('down');
    expect(s.steps).toBe(0);
    rng.state = 42;
    applySave(s);
    expect(rng.state).toBe(42); // no stored RNG: the current stream continues
  });

  it('fills fields added after a save was written', () => {
    writeSave(1, 0);
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    const raw = JSON.parse(ls.getItem('shadowjog.save.1')!);
    delete raw.state.combos;
    delete raw.state.bestiary;
    ls.setItem('shadowjog.save.1', JSON.stringify(raw));
    const s = loadSave(1)!;
    expect(s.combos).toEqual([]);
    expect(s.bestiary).toEqual({});
  });

  it('drops content ids that no longer exist instead of crashing a menu later', () => {
    const st = stateMod.state;
    st.inventory = { medkit: 2, no_such_item: 3, neurotab: -1 };
    st.members.kit!.equip = { weapon: 'no_such_blade', body: 'medkit' };
    st.members.kit!.uses = { iron_palm: 2, no_such_move: 1 };
    st.bestiary = { glowrat: 4, no_such_enemy: 2 };
    st.weakSeen = { glowrat: ['fire'], no_such_enemy: ['mana'] };
    st.combos = ['combo_lifeline', 'combo_gone'];
    st.lastOrders = { kit: { cmd: 'tech', id: 'no_such_move' }, rook: { cmd: 'attack' } };
    st.lastEntrance = { map: 'no_such_map', x: 1, y: 1 };
    writeSave(1, 0);
    const s = loadSave(1)!;
    expect(s.inventory).toEqual({ medkit: 2 });
    expect(s.members.kit!.equip).toEqual({}); // unknown blade, and a medkit is not body armour
    expect(Object.keys(s.members.kit!.uses)).toEqual(['iron_palm']);
    expect(s.bestiary).toEqual({ glowrat: 4 });
    expect(s.weakSeen).toEqual({ glowrat: ['fire'] });
    expect(s.combos).toEqual(['combo_lifeline']);
    expect(s.lastOrders).toEqual({ rook: { cmd: 'attack' } });
    expect(s.lastEntrance).toBeNull();
  });

  it('marks a slot damaged when the header parses but the state will not load', () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    writeSave(1, 0);
    writeSave(2, 0);
    const raw = JSON.parse(ls.getItem('shadowjog.save.2')!);
    raw.meta.when += 1000; // the newest save...
    delete raw.state.members.kit; // ...is the broken one
    ls.setItem('shadowjog.save.2', JSON.stringify(raw));
    expect(slotStatus(1)).toBe('ok');
    expect(slotStatus(2)).toBe('damaged');
    expect(slotStatus(3)).toBe('empty');
    expect(latestSlot()).toBe(2);
    expect(latestSlot(true)).toBe(1); // Continue and Game Over skip to the newest good save
    expect(hasAnySave()).toBe(true);
  });

  it('a new game counts unsaved progress from zero, whatever was loaded before in the tab', async () => {
    const { resetSaveBaseline } = await import('../src/game/save');
    writeSave(1, 50_000);
    applySave(loadSave(1)!);
    expect(unsavedFrames(1000)).toBe(0); // the old baseline would hide this new game's progress
    resetSaveBaseline();
    expect(unsavedFrames(1000)).toBe(1000);
  });

  it('tracks unsaved progress from the last save or load', () => {
    writeSave(1, 500);
    expect(unsavedFrames(500)).toBe(0);
    expect(unsavedFrames(900)).toBe(400);
    const s = loadSave(1)!;
    s.playFrames = 1200;
    applySave(s);
    expect(unsavedFrames(1200)).toBe(0);
  });

  it('stamps a migrated save with the current version', () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    writeSave(1, 0);
    const raw = JSON.parse(ls.getItem('shadowjog.save.1')!);
    raw.state.version = 0;
    ls.setItem('shadowjog.save.1', JSON.stringify(raw));
    expect(loadSave(1)!.version).toBe(stateMod.SAVE_VERSION);
  });

  it('rejects non-finite and off-map numbers, and clamps the ones that are only out of range', () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    // JSON can't write Infinity, but a hand-edited 1e999 parses to it.
    const tamper = (slot: 1 | 2 | 3, ...edits: [path: string, value: string][]) => {
      writeSave(slot, 0);
      const raw = JSON.parse(ls.getItem(`shadowjog.save.${slot}`)!);
      edits.forEach(([path, _], i) => {
        const parts = path.split('.');
        let o = raw;
        for (const p of parts.slice(0, -1)) o = o[p];
        o[parts.at(-1)!] = `__X${i}__`;
      });
      let text = JSON.stringify(raw);
      edits.forEach(([_, value], i) => {
        text = text.replace(`"__X${i}__"`, value);
      });
      ls.setItem(`shadowjog.save.${slot}`, text);
    };
    for (const [path, value] of [
      ['state.cred', '1e999'],
      ['state.members.kit.hp', '-1e999'],
      ['state.members.rook.level', '1e999'],
      ['state.x', '4.5'],
      ['state.y', '-3'],
      ['state.x', '100000'],
      ['state.lastTown.y', '1e999'],
      ['meta.cred', '1e999'],
    ] as const) {
      tamper(1, [path, value]);
      expect(slotStatus(1), `${path}=${value}`).toBe('damaged');
    }
    tamper(2, ['state.cred', '-50'], ['state.members.kit.level', '250']);
    const s = loadSave(2)!;
    expect(s.cred).toBe(0);
    expect(s.members.kit!.level).toBe(99);
    tamper(3, ['state.steps', '1e999']);
    expect(loadSave(3)!.steps).toBe(0);
  });

  it('treats storage that throws on read as empty, not as a crash', () => {
    writeSave(1, 0);
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    const real = ls.getItem;
    ls.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    try {
      expect(slotStatus(1)).toBe('empty');
      expect(loadSave(1)).toBeNull();
      expect(readMeta(1)).toBeNull();
      expect(hasAnySave()).toBe(false);
      expect(() => latestSlot()).not.toThrow();
    } finally {
      ls.getItem = real;
    }
  });

  it('structural migrations run as a chain, in order, from the save’s own version', async () => {
    const { MIGRATIONS, migrateTo } = await import('../src/game/save');
    const order: number[] = [];
    // Two future steps: v1 renames `cred` to `credits`, v2 renames it back and doubles it.
    MIGRATIONS[1] = (s) => {
      order.push(1);
      (s as unknown as { credits: number }).credits = s.cred;
    };
    MIGRATIONS[2] = (s) => {
      order.push(2);
      s.cred = (s as unknown as { credits: number }).credits * 2;
    };
    try {
      const s = JSON.parse(JSON.stringify(stateMod.state)) as typeof stateMod.state;
      s.version = 1;
      s.cred = 100;
      const out = migrateTo(s, 3);
      expect(order).toEqual([1, 2]);
      expect(out.cred).toBe(200);
      expect(out.version).toBe(3);
      // A save already at v2 only takes the v2 step.
      order.length = 0;
      const t = JSON.parse(JSON.stringify(stateMod.state)) as typeof stateMod.state;
      t.version = 2;
      (t as unknown as { credits: number }).credits = 5;
      expect(migrateTo(t, 3).cred).toBe(10);
      expect(order).toEqual([2]);
    } finally {
      delete MIGRATIONS[1];
      delete MIGRATIONS[2];
    }
  });

  it('rejects a header with missing fields', () => {
    const ls = (globalThis as unknown as { localStorage: MemStorage }).localStorage;
    writeSave(1, 0);
    const raw = JSON.parse(ls.getItem('shadowjog.save.1')!);
    delete raw.meta.location;
    ls.setItem('shadowjog.save.1', JSON.stringify(raw));
    expect(readMeta(1)).toBeNull();
    expect(slotStatus(1)).toBe('damaged');
  });
});

describe('a save from a shipped build keeps loading', () => {
  // A real save file written by version 1 of the save format (the Annex, the full crew), kept as
  // a fixture. Every later format change has to load it: that is what MIGRATIONS and backfill()
  // are for, and this is the save they are tested against.
  it('the version-1 Annex save loads, with its crew, place, money and story intact', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync('tests/fixtures/save-v1-annex.json', 'utf8');
    const file = JSON.parse(raw) as { state: { version: number } };
    expect(file.state.version).toBe(1);
    localStorage.clear();
    localStorage.setItem('shadowjog.save.2', JSON.stringify(file));
    expect(slotStatus(2)).toBe('ok');
    const s = loadSave(2)!;
    expect(s).not.toBeNull();
    expect(s.party).toEqual(['kit', 'rook', 'hex', 'sable']);
    expect(s.map).toBe('annex');
    expect(s.cred).toBe(1400);
    expect(s.members.sable?.level).toBeGreaterThanOrEqual(7);
    expect(s.flags.annex_key).toBeTruthy();
    // Loaded into the game, it's a playable state.
    applySave(s);
    expect(validState(stateMod.state)).toBe(true);
  });
});
