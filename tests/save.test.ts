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

const { hasAnySave, latestSlot, loadSave, readMeta, slotStatus, validState, writeSave, applySave } = await import('../src/game/save');
const { addMember } = await import('../src/game/party');
const stateMod = await import('../src/game/state');
const { newState, setState } = stateMod;
const { rng } = await import('../src/engine/rng');

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
    applySave(s);
    expect(rng.state).toBe(123456);
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
