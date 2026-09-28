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

const { hasAnySave, latestSlot, loadSave, readMeta, validState, writeSave, applySave } = await import('../src/game/save');
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
});
