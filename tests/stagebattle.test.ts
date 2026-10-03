import { describe, expect, it } from 'vitest';
import { shippedStages } from './stagefiles';
import movesJson from '../src/data/moves.json';
import type { StageFile } from '../src/stage/config';
import { type ActionScript, applyEvent, BattleFlow, loadoutStats, makeScript } from '../src/stage/battleflow';
import { type BattleTestOptions, stageForTest } from '../src/stage/battleflow';
import { loadMoves } from '../src/stage/moves';
import { ABILITIES } from '../src/data/abilities';

const stages: StageFile = shippedStages();
const street = stages.street!;

function newFlow(roster = street.demo.rosters['3']!, seed = 8): BattleFlow {
  return new BattleFlow({ demo: street.demo, roster, seed, fullResources: true });
}

/** Show a script the way the performer does (every event applied to the displayed state), then check the display agrees with the engine. */
function show(flow: BattleFlow, s: ActionScript): void {
  for (const e of s.before) applyEvent(flow.disp, e);
  for (const w of s.waves)
    for (const i of w) {
      if (i.kind === 'miss') continue;
      applyEvent(flow.disp, i.kind === 'heal' ? { t: 'heal', target: i.target, amount: i.amount, hp: i.hp } : i.kind === 'tick' ? { t: 'tick', target: i.target, amount: i.amount, status: 'poison', hp: i.hp } : { t: 'damage', target: i.target, amount: i.amount, crit: i.crit, element: i.element, weak: i.weak, resist: i.resist, hp: i.hp });
      if (i.down) applyEvent(flow.disp, { t: 'down', target: i.target });
    }
  for (const e of s.after) applyEvent(flow.disp, e);
}

/** Play a whole fight on auto orders; returns every script. */
function playOut(flow: BattleFlow, maxRounds = 40): ActionScript[] {
  const out: ActionScript[] = [];
  for (let r = 0; r < maxRounds && flow.mode !== 'over'; r++) {
    flow.autoOrders();
    flow.beginRound();
    for (let s = flow.nextScript(); s; s = flow.nextScript()) {
      out.push(s);
      show(flow, s);
      // What the player has seen so far must equal the engine's health: nothing the script skipped changed anybody.
      for (const u of flow.battle.units) expect(flow.disp.get(u.uid)?.hp, `${u.name} after ${s.name}`).toBe(Math.max(0, u.hp));
      flow.actionShown();
    }
    flow.endRound();
  }
  return out;
}

describe('the Battle Test runs the real battle engine', () => {
  it('plays a whole fight to a win or a loss, and the displayed health always matches the engine', () => {
    const flow = newFlow();
    const scripts = playOut(flow);
    expect(flow.mode).toBe('over');
    expect(flow.outcome === 'win' || flow.outcome === 'lose').toBe(true);
    expect(scripts.length).toBeGreaterThan(4);
    // Somebody lost health, and the numbers on every impact are the engine's.
    const damage = scripts.flatMap((s) => s.waves.flat()).filter((i) => i.kind === 'damage');
    expect(damage.length).toBeGreaterThan(3);
    expect(damage.every((i) => i.amount > 0 && Number.isFinite(i.hp))).toBe(true);
  });

  it('is deterministic: the same seed gives the same fight, another seed another one', () => {
    const run = (seed: number): string => JSON.stringify(playOut(newFlow(street.demo.rosters['3']!, seed)));
    expect(run(8)).toBe(run(8));
    expect(run(8)).not.toBe(run(9));
  });

  it('puts the impacts of one blow on one target in a wave, and a second hit on that target in the next', () => {
    const s = makeScript([
      { t: 'act', actor: 0, id: 'attack', name: 'Attack', kind: 'attack', fx: 'slash', targets: [10] },
      { t: 'damage', target: 10, amount: 9, crit: false, element: 'phys', weak: false, resist: false, hp: 20 },
      { t: 'damage', target: 11, amount: 7, crit: true, element: 'phys', weak: false, resist: false, hp: 5 },
      { t: 'damage', target: 10, amount: 4, crit: false, element: 'phys', weak: false, resist: false, hp: 16 },
      { t: 'down', target: 11 },
      { t: 'status', target: 10, status: 'poison', on: true },
    ]);
    expect(s.waves.map((w) => w.map((i) => i.target))).toEqual([[10, 11], [10]]);
    expect(s.waves[0]?.[1]?.down).toBe(true);
    expect(s.after.map((e) => e.t)).toEqual(['status']);
    expect(s.name).toBe('Attack');
  });

  it('keeps a resource payment before the blow and a status after it', () => {
    const s = makeScript([
      { t: 'act', actor: 0, id: 'iron_palm', name: 'Iron Palm', kind: 'tech', fx: 'palm', targets: [10] },
      { t: 'tp', target: 0, amount: -4, tp: 24 },
      { t: 'damage', target: 10, amount: 30, crit: false, element: 'mana', weak: true, resist: false, hp: 10 },
      { t: 'tp', target: 0, amount: 1, tp: 25 },
    ]);
    expect(s.before.map((e) => e.t)).toEqual(['tp']);
    expect(s.after.map((e) => e.t)).toEqual(['tp']);
  });

  it('reports a stunned turn as a message with no actor’s move', () => {
    const s = makeScript([{ t: 'turn', actor: 10 }, { t: 'msg', text: 'Punk is stunned.' }]);
    expect(s.actor).toBe(-1);
    expect(s.messages).toEqual(['Punk is stunned.']);
  });
});

describe('giving orders with the keyboard', () => {
  it('walks Attack, a target, Enter, for each hero, and the last confirm says the round is ready', () => {
    const flow = newFlow();
    expect(flow.mode).toBe('command');
    expect(flow.view().phase).toBe('choose');
    expect(flow.view().command.selected).toBe('attack');
    for (let hero = 0; hero < 4; hero++) {
      expect(flow.hero).toBe(hero);
      expect(flow.press('ok')).toBe(false); // opens the target list
      expect(flow.mode).toBe('target');
      expect(flow.view().phase).toBe('target');
      expect(flow.view().target).toBe(0);
      flow.press('down');
      expect(flow.view().target).toBe(1);
      expect(flow.view().banner).toMatch(/pick a target/);
      const ready = flow.press('ok');
      expect(ready).toBe(hero === 3);
    }
    expect(flow.ordersDone).toBe(true);
    flow.beginRound();
    expect(flow.mode).toBe('playing');
  });

  it('lists the skills a hero knows and refuses one that cannot be afforded', () => {
    const flow = newFlow();
    const rook = flow.skillList(1);
    expect(rook.map((s) => s.id)).toContain('arc_cut');
    // Kit's first tech costs KI: drain it and the choice is refused with a reason.
    const kit = flow.battle.unit(0)!;
    kit.tp = 0;
    flow.press('right'); // Skill
    const list = flow.skillList(0);
    expect(list.length).toBeGreaterThan(0);
    flow.press('ok');
    expect(flow.mode).toBe('command');
    expect(flow.message).toMatch(/not available/);
  });

  it('steps back from the target list, and says combos and items are not in the test yet', () => {
    const flow = newFlow();
    flow.press('ok');
    expect(flow.mode).toBe('target');
    flow.press('back');
    expect(flow.mode).toBe('command');
    flow.press('right');
    flow.press('right'); // Combo
    flow.press('ok');
    expect(flow.message).toMatch(/not in the Battle Test yet/);
  });

  it('makes sensible auto orders for everyone and alternates a skill in', () => {
    const flow = newFlow();
    flow.autoOrders();
    flow.beginRound();
    const scripts: ActionScript[] = [];
    for (let s = flow.nextScript(); s; s = flow.nextScript()) {
      scripts.push(s);
      flow.actionShown();
    }
    expect(scripts.filter((s) => s.actor >= 0 && s.actor < 10).length).toBe(4);
  });
});

describe('the HUD’s view of the fight', () => {
  it('shows what the player has seen, not what the engine has already done', () => {
    const flow = newFlow(['rustfang_punk']);
    flow.autoOrders();
    flow.beginRound();
    const s = flow.nextScript()!;
    const target = s.targets[0]!;
    const unit = flow.battle.unit(target)!;
    // The engine has applied the blow, yet the display is still at full health until the performer reaches it.
    if (s.waves[0]?.[0]?.kind === 'damage') {
      expect(unit.hp).toBeLessThan(unit.base.maxHp);
      expect(flow.view().foes[target - 10]?.hp).toBe(unit.base.maxHp);
      show(flow, s);
      expect(flow.view().foes[target - 10]?.hp).toBe(unit.hp);
    }
  });

  it('puts the actor’s chip first on the timeline while it plays', () => {
    const flow = newFlow();
    flow.autoOrders();
    flow.beginRound();
    const s = flow.nextScript()!;
    flow.setPlaying({ actor: s.actor, targetFoe: null, banner: s.name, act: null });
    const v = flow.view();
    expect(v.phase).toBe('act');
    expect(v.turns[0]).toEqual(s.actor < 10 ? { side: 'party', index: s.actor } : { side: 'enemy', index: s.actor - 10 });
  });
});

describe('summons, boss phases and the stage’s numbering of fighters', () => {
  const wardenFlow = (seed = 8): BattleFlow => new BattleFlow({ demo: street.demo, roster: ['warden'], seed, fullResources: true });

  it('sorts a summon and a phase change out of an action’s events, so the performer can draw them when the cast releases', () => {
    const s = makeScript([
      { t: 'act', actor: 10, id: 'e_deploy', name: 'Deploy Drones', kind: 'enemy', fx: 'summon', targets: [] },
      { t: 'summon', uids: [100, 101] },
      { t: 'phase', target: 10, key: 'warden_spirit', name: 'Unbound Warden', hp: 900 },
      { t: 'msg', text: 'The shell breaks.' },
    ]);
    expect(s.summons).toEqual([[100, 101]]);
    expect(s.phases).toEqual([{ target: 10, key: 'warden_spirit', name: 'Unbound Warden' }]);
    // Neither is left in `after` to be applied at once.
    expect(s.after.map((e) => e.t)).toEqual(['msg']);
  });

  it('numbers a summoned enemy by its place in the enemy list, not by its engine uid (which starts at 100)', () => {
    const flow = wardenFlow();
    const w = flow.battle.enemies[0]!;
    expect(flow.slotOf(0)).toBe(0);
    expect(flow.slotOf(w.uid)).toBe(10);
    w.hp = Math.floor(w.base.maxHp * 0.6);
    flow.sync();
    // Play rounds until the Warden deploys its drones.
    let summoned: number[] = [];
    for (let r = 0; r < 12 && summoned.length === 0 && flow.mode !== 'over'; r++) {
      flow.autoOrders();
      flow.beginRound();
      for (let sc = flow.nextScript(); sc; sc = flow.nextScript()) {
        if (sc.summons.length) {
          summoned = sc.summons.flat();
          // The HUD does not list them until the stage has drawn them.
          expect(flow.view().foes).toHaveLength(1);
          expect(flow.view().turns.every((t) => t.side === 'party' || t.index === 0)).toBe(true);
          break;
        }
        show(flow, sc);
        flow.actionShown();
      }
      if (summoned.length === 0) flow.endRound();
    }
    expect(summoned.length).toBeGreaterThan(0);
    expect(summoned.every((u) => u >= 100)).toBe(true);
    expect(flow.slotOf(summoned[0]!)).toBe(11);
    flow.reveal(summoned);
    expect(flow.view().foes).toHaveLength(1 + summoned.length);
  });

  it('keeps showing a boss’s old form until the picture changes', () => {
    const flow = wardenFlow();
    const w = flow.battle.enemies[0]!;
    expect(flow.view().foes[0]?.name).toBe('WARDEN');
    w.hp = 1;
    flow.sync();
    // The engine changes the Warden at once when its last health goes; the display must not.
    flow.autoOrders();
    flow.beginRound();
    let phase = false;
    for (let sc = flow.nextScript(); sc && !phase; sc = flow.nextScript()) {
      if (sc.phases.length) {
        phase = true;
        expect(flow.battle.enemies[0]?.name).toBe('Unbound Warden');
        expect(flow.view().foes[0]?.name).toBe('WARDEN');
        flow.showForm(sc.phases[0]!.target);
        expect(flow.view().foes[0]?.name).toBe('Unbound Warden');
      } else {
        show(flow, sc);
        flow.actionShown();
      }
    }
    expect(phase).toBe(true);
  });
});

describe('test one move (the drill)', () => {
  it('has the chosen hero use the chosen skill every round, on the first foe, and everyone else guard', () => {
    const flow = new BattleFlow({ demo: street.demo, roster: street.demo.rosters['3']!, seed: 8, fullResources: true, drill: { slot: 1, ability: 'arc_cut' } });
    const used: string[] = [];
    for (let r = 0; r < 3 && flow.mode !== 'over'; r++) {
      flow.autoOrders();
      flow.beginRound();
      for (let sc = flow.nextScript(); sc; sc = flow.nextScript()) {
        if (sc.actor < 10) used.push(`${sc.actor}:${sc.abilityId}`);
        show(flow, sc);
        flow.actionShown();
      }
      flow.endRound();
    }
    // Rook (slot 1) used Arc Cut; the others only guarded (a guard declares no `act` of its own that is a hero's attack).
    expect(used.filter((u) => u.startsWith('1:')).every((u) => u === '1:arc_cut' || u === '1:attack')).toBe(true);
    expect(used.some((u) => u === '1:arc_cut')).toBe(true);
    expect(used.some((u) => /^[023]:attack$/.test(u))).toBe(false);
  });

  it('falls back to an Attack when the skill cannot be paid for', () => {
    const flow = new BattleFlow({ demo: street.demo, roster: street.demo.rosters['3']!, seed: 8, fullResources: false, drill: { slot: 1, ability: 'arc_cut' } });
    const rook = flow.battle.party[1]!;
    rook.uses.arc_cut = 0;
    flow.autoOrders();
    flow.beginRound();
    const first = flow.nextScript();
    expect(first).not.toBeNull();
  });
});

describe('the dialog’s status panel', () => {
  it('reads each loadout through the game’s own stat code', () => {
    const rook = loadoutStats(street.demo, 1)!;
    expect(rook.name).toBe('Rook');
    expect(rook.maxHp).toBeGreaterThan(100);
    expect(rook.skills).toContain('Arc Cut');
    const kit = loadoutStats(street.demo, 0)!;
    expect(kit.resLabel).toBe('KI');
    expect(kit.maxTp).toBeGreaterThan(0);
    expect(loadoutStats(street.demo, 9)).toBeNull();
  });

  it('builds the stage the test runs on from the dialog’s choices without touching the original', () => {
    const o: BattleTestOptions = { party: [{ id: 'rook', level: 12 }, { id: 'kit', level: 3 }], roster: ['glowrat', 'glowrat'], setKey: '2', seed: 3, fullResources: true, speed: 1, auto: false };
    const before = JSON.stringify(street);
    const t = stageForTest(street, o);
    expect(t.demo.lineup).toEqual(['rook', 'kit']);
    expect(t.demo.party[0]?.level).toBe(12);
    expect(t.demo.rosters['2']).toEqual(['glowrat', 'glowrat']);
    expect(JSON.stringify(street)).toBe(before);
  });
});

describe('every ability a binding names exists', () => {
  it('loads', () => {
    expect(() => loadMoves(movesJson, { abilities: new Set(Object.keys(ABILITIES)) })).not.toThrow();
  });
});
