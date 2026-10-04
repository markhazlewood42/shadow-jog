import { describe, expect, it } from 'vitest';
import { fixtureStages } from './stagefiles';
import { ENEMIES } from '../src/data/enemies';
import { baseStatsAt, MEMBERS } from '../src/data/party';
import { flags } from '../src/game/state';
import type { MemberId } from '../src/game/state';
import { SET_KEYS, type StageFile, setSize, stageOf } from '../src/stage/config';
import { comboOf } from '../src/stage/combo';
import { buildHudView, demoParty, type Phase } from '../src/stage/demo';
import { isShown, type RegionName, timelineLayout } from '../src/stage/hudlayout';

const file: StageFile = fixtureStages();
const PHASES: Phase[] = ['choose', 'target', 'act'];
const REGIONS: RegionName[] = ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo'];

describe('the example fight is made from the game’s real data', () => {
  it('the crew’s health and resources are what the game’s stat code gives that level and gear', () => {
    for (const [id, stage] of Object.entries(file)) {
      const view = buildHudView(stage.demo, '3', 'choose');
      expect(view.party.map((m) => m.id)).toEqual(['kit', 'rook', 'hex', 'sable']);
      view.party.forEach((m, i) => {
        const level = stage.demo.party[i]?.level ?? 1;
        const base = baseStatsAt(m.id as MemberId, level);
        // Gear only adds: never below the unequipped character of that level.
        expect({ id, who: m.id, ok: m.maxHp >= base.hp }).toEqual({ id, who: m.id, ok: true });
        expect(m.hp).toBe(m.maxHp);
        expect(m.name).toBe(MEMBERS[m.id as MemberId].name);
        expect(m.resLabel).toBe(MEMBERS[m.id as MemberId].tpLabel);
      });
      // Rook has no resource (his real label is a dash), so the table draws one.
      const rook = view.party.find((m) => m.id === 'rook');
      expect([rook?.resLabel, rook?.resMax]).toEqual(['—', 0]);
      expect(view.party.filter((m) => m.resMax > 0)).toHaveLength(3);
    }
  });

  it('the enemies’ names and health are their definitions’, in every group on both stages', () => {
    for (const stage of Object.values(file))
      for (const key of SET_KEYS) {
        const roster = stage.demo.rosters[key] ?? [];
        const view = buildHudView(stage.demo, key, 'choose');
        expect(view.foes).toHaveLength(setSize(key));
        view.foes.forEach((f, i) => {
          const def = ENEMIES[roster[i] ?? ''];
          expect(f.defId).toBe(roster[i]);
          expect(f.maxHp).toBe(def?.hp);
          expect(f.sprite).toBe(def?.sprite);
          expect(f.boss).toBe(!!def?.boss);
          expect(f.name.startsWith(def?.name ?? '?')).toBe(true);
        });
      }
  });

  it('several of one kind get letters (A, B...), a lone one does not', () => {
    const street = stageOf(file, 'street');
    const three = buildHudView(street.demo, '3', 'choose').foes.map((f) => f.name);
    expect(three).toEqual(['Rustfang Punk A', 'Glowrat', 'Rustfang Punk B']);
    expect(buildHudView(street.demo, '1', 'choose').foes[0]?.name).toBe('Rustfang Punk');
  });

  it('a boss set puts the boss first, and a target shows its weak spot in words', () => {
    const view = buildHudView(stageOf(file, 'street').demo, 'boss+2', 'target');
    expect(view.foes[0]?.boss).toBe(true);
    expect(view.foes[0]?.tags.map((t) => t.text)).toEqual(['WEAK: CYBER']);
    expect(view.target).toBe(0);
  });

  it('the timeline holds every fighter once, and starts with the hero whose turn it is', () => {
    for (const stage of Object.values(file))
      for (const key of SET_KEYS)
        for (const phase of PHASES) {
          const v = buildHudView(stage.demo, key, phase);
          const names = v.turns.map((t) => `${t.side}${t.index}`);
          expect(new Set(names).size).toBe(names.length);
          expect(v.turns).toHaveLength(4 + setSize(key));
          expect(v.turns[0]).toEqual({ side: 'party', index: v.active });
        }
  });

  it('the three moments differ the way the design shows them', () => {
    const demo = stageOf(file, 'street').demo;
    const choose = buildHudView(demo, '3', 'choose');
    expect([choose.command.label, choose.command.selected, choose.banner, choose.target, choose.act]).toEqual(['Attack', 'attack', null, null, null]);
    const target = buildHudView(demo, '3', 'target');
    expect(target.banner).toBe(`${target.party[target.active]?.name}: pick a target`);
    expect(target.command.selected).toBe('skill');
    expect(target.command.cost).not.toBe('');
    expect(target.active).not.toBe(choose.active);
    const act = buildHudView(demo, '3', 'act');
    expect(act.act).not.toBeNull();
    expect(act.party[act.active]?.id).toBe(demo.act.attacker);
    expect(act.banner).toBe(`Rook: ${act.act?.skillName}`);
    expect(act.act?.dmg ?? 0).toBeGreaterThan(0);
    // The combo counter is made from the list of hits whose numbers are shown: the featured hit is in it, and the counter's total is their sum.
    const list = act.act?.hitList ?? [];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((h) => h.amount === act.act?.dmg)).toBe(true);
    expect(comboOf(list).total).toBe(list.reduce((n, h) => n + h.amount, 0));
    // The engine really took health off the target.
    const target0 = act.foes[act.target ?? 0];
    expect(target0 ? target0.hp < target0.maxHp : false).toBe(true);
  });

  it('is deterministic: the same demo gives the same view, and a different seed another round', () => {
    const demo = stageOf(file, 'street').demo;
    for (const phase of PHASES) expect(buildHudView(demo, '3', phase)).toEqual(buildHudView(demo, '3', phase));
    const orders = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) orders.add(JSON.stringify(buildHudView({ ...demo, seed }, '3', 'choose').turns));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('does not leave the story flags switched on, and a roster of the wrong size is refused', () => {
    const demo = stageOf(file, 'street').demo;
    expect(flags.has('rook_mended')).toBe(false);
    demoParty(demo);
    buildHudView(demo, '3', 'act');
    for (const f of ['stingray_seated', 'rook_tuned', 'rook_mended']) expect(flags.has(f)).toBe(false);
    expect(() => buildHudView(demo, '3', 'choose', ['rustfang_punk'])).toThrow(/does not fit/);
  });
});

describe('HUD layout rules', () => {
  it('shows each region as its rule says, with the two readings the design’s mockups need', () => {
    for (const r of REGIONS) {
      for (const p of PHASES) {
        expect(isShown(r, 'always', p)).toBe(true);
        expect(isShown(r, 'never', p)).toBe(false);
      }
    }
    // "input": while choosing or aiming, but the enemy box also stays up while an action plays.
    expect(PHASES.map((p) => isShown('commands', 'input', p))).toEqual([true, true, false]);
    expect(PHASES.map((p) => isShown('enemyInfo', 'input', p))).toEqual([true, true, true]);
    // "action": while an action plays, but the banner also shows its prompt while aiming.
    expect(PHASES.map((p) => isShown('combo', 'action', p))).toEqual([false, false, true]);
    expect(PHASES.map((p) => isShown('banner', 'action', p))).toEqual([false, true, true]);
  });

  it('the timeline puts heroes above the line and enemies below, in order, never overlapping and never leaving its box', () => {
    for (const stage of Object.values(file))
      for (const key of SET_KEYS) {
        const v = buildHudView(stage.demo, key, 'choose');
        const t = stage.hud.turnOrder;
        const place = timelineLayout(t, v.turns.slice(1));
        expect(place.chips).toHaveLength(v.turns.length - 1);
        for (const side of ['party', 'enemy'] as const) {
          const row = place.chips.filter((c) => c.side === side);
          row.forEach((c, i) => {
            expect(c.x).toBeGreaterThanOrEqual(place.line.x0);
            expect(c.x + t.chip).toBeLessThanOrEqual(place.line.x1);
            expect(c.y).toBe(side === 'party' ? place.line.y - t.chip - 1 : place.line.y + 2);
            if (i > 0) expect(c.x - (row[i - 1]?.x ?? 0)).toBeGreaterThanOrEqual(t.chip);
          });
        }
        // The turns come out left to right in the order given.
        const xs = place.chips.map((c) => c.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        expect(place.now.y + place.now.size).toBeLessThanOrEqual(t.h);
      }
  });
});
