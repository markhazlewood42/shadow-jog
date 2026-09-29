/** Enemy decision-making: weighted move tables with conditions, plus scripted boss routines. */
import { ABILITIES } from '../data/abilities';
import { ENEMIES, type EnemyMove } from '../data/enemies';
import type { Battle } from './engine';
import type { Ability, Combatant } from './types';

export interface EnemyChoice {
  ability: Ability;
  target: number;
  message?: string;
  /** Spend the turn without acting (e.g. charging). */
  skip?: boolean;
}

function moveOk(b: Battle, self: Combatant, m: EnemyMove): boolean {
  const allies = b.alive('enemy');
  const foes = b.alive('party');
  switch (m.when) {
    case undefined:
      return true;
    case 'ally_hurt':
      return allies.some((a) => a.hp / a.base.maxHp < 0.6);
    case 'shield_ally':
      return !b.has(self, 'cover') && allies.some((a) => a !== self && a.hp / a.base.maxHp < 0.7);
    case 'no_atk_buff':
      return !allies.some((a) => b.has(a, 'atk_up'));
    case 'no_def_buff':
      return !b.has(self, 'def_up');
    case 'no_res_buff':
      return !allies.some((a) => b.has(a, 'res_up'));
    case 'lockon_ready':
      return foes.some((f) => b.has(f, 'lockon'));
    case 'no_lockon':
      return !foes.some((f) => b.has(f, 'lockon'));
    case 'hp_below_half':
      return self.hp / self.base.maxHp < 0.5;
    case 'every_3':
      return b.round % 3 === 0;
  }
  return true;
}

function weightedPick(b: Battle, moves: EnemyMove[]): EnemyMove | null {
  const total = moves.reduce((n, m) => n + m.w, 0);
  if (total <= 0) return null;
  let r = b.rng.next() * total;
  for (const m of moves) {
    r -= m.w;
    if (r <= 0) return m;
  }
  return moves[moves.length - 1]!;
}

function pickTarget(b: Battle, self: Combatant, ab: Ability): number {
  const foes = b.alive('party');
  const allies = b.alive('enemy');
  if (ab.target === 'ally') {
    const hurt = [...allies].sort((a, c) => a.hp / a.base.maxHp - c.hp / c.base.maxHp);
    return hurt[0]?.uid ?? self.uid;
  }
  if (ab.target === 'enemy') {
    // Missiles go to whoever is locked on.
    if (ab.id === 'e_missile') {
      const locked = foes.find((f) => b.has(f, 'lockon'));
      if (locked) return locked.uid;
    }
    // Mild preference for wounded targets (predators smell blood).
    if (foes.length > 1 && b.rng.chance(0.3)) {
      const weakest = [...foes].sort((a, c) => a.hp - c.hp)[0]!;
      return weakest.uid;
    }
    return foes.length ? b.rng.pick(foes).uid : -1;
  }
  return -1;
}

export function chooseEnemyAction(b: Battle, self: Combatant): EnemyChoice | null {
  const def = ENEMIES[self.key];
  if (!def) return null;
  const mem = self.memory;
  mem.turn = (mem.turn ?? 0) + 1;

  switch (self.ai) {
    case 'lurker': {
      const hp = self.hp / self.base.maxHp;
      if (!mem.enraged && hp < 0.5) {
        mem.enraged = 1;
        const ab = ABILITIES.e_tidal!;
        return { ability: ab, target: -1, message: 'The Lurker thrashes, churning the black water!' };
      }
      // Second shift: near death it drops the lure and goes for the kill, crushing the weakest.
      if (!mem.desperate && hp < 0.25) {
        mem.desperate = 1;
        return { ability: ABILITIES.e_biolume!, target: -1, message: 'Its lure-lights flare white. It’s desperate now!' };
      }
      if (mem.desperate) {
        const ab = mem.turn % 2 ? ABILITIES.e_crush_coil! : ABILITIES.e_tidal!;
        const weakest = [...b.alive('party')].sort((x, y) => x.hp - y.hp)[0];
        return { ability: ab, target: ab.target === 'enemy' ? weakest?.uid ?? -1 : -1 };
      }
      if (mem.turn % 4 === 0) return { ability: ABILITIES.e_biolume!, target: -1 };
      break;
    }
    case 'warden': {
      // Telegraphed Pulse Cannon: charge on one turn, fire on the next.
      // It names its mark while charging, so the crew has a real answer: that member guards, or
      // Rook's Guardian takes the shot for them.
      if (mem.charging) {
        mem.charging = 0;
        const ab = ABILITIES.e_pulse_cannon!;
        const locked = mem.lock ? b.unit(mem.lock - 1) : undefined;
        mem.lock = 0;
        return { ability: ab, target: locked && locked.hp > 0 ? locked.uid : pickTarget(b, self, ab) };
      }
      const hp = self.hp / self.base.maxHp;
      if (hp < 0.7 && !mem.deployed1) {
        mem.deployed1 = 1;
        return { ability: ABILITIES.e_deploy!, target: -1 };
      }
      if (hp < 0.35 && !mem.deployed2) {
        mem.deployed2 = 1;
        return { ability: ABILITIES.e_deploy!, target: -1 };
      }
      if (mem.turn % 3 === 1) {
        mem.charging = 1;
        const mark = pickTarget(b, self, ABILITIES.e_pulse_cannon!);
        mem.lock = mark + 1;
        const name = b.unit(mark)?.name ?? 'the crew';
        return { ability: ABILITIES.attack!, target: -1, message: `WARDEN’s cannon whines, locking onto ${name}. Its cooling vents are open!`, skip: true };
      }
      break;
    }
    case 'turret': {
      // Spins up on a rhythm (telegraphed), then sweeps the whole crew. A jam or a stun in
      // between spins it down (see Battle.execute), so Scramble or Thunder Rift is the answer.
      if (mem.spin) {
        mem.spin = 0;
        return { ability: ABILITIES.e_full_auto!, target: -1 };
      }
      if (mem.turn % 3 === 2) {
        mem.spin = 1;
        return { ability: ABILITIES.attack!, target: -1, message: `${self.name} spins up. Its barrels glow white-hot!`, skip: true };
      }
      break;
    }
    case 'knuckles': {
      // The chapter's first tell, taught plainly: he squares up to someone by name, then swings a
      // turn later. Guard (or cover them) and it glances off; ignore it and it can stun.
      if (mem.charging) {
        mem.charging = 0;
        const ab = ABILITIES.e_wound_haymaker!;
        const mark = mem.lock ? b.unit(mem.lock - 1) : undefined;
        mem.lock = 0;
        return { ability: ab, target: mark && mark.hp > 0 ? mark.uid : pickTarget(b, self, ab) };
      }
      if (mem.turn % 3 === 2) {
        mem.charging = 1;
        const mark = pickTarget(b, self, ABILITIES.e_wound_haymaker!);
        mem.lock = mark + 1;
        const name = b.unit(mark)?.name ?? 'the crew';
        return { ability: ABILITIES.attack!, target: -1, message: `Knuckles cracks his chrome knuckles and squares up to ${name}.`, skip: true };
      }
      break;
    }
    case 'arcanist': {
      // A different shape from the cannon and the turret: she draws a surge for a turn, and it's
      // broken by pressure, not bracing. Blind her, or hit her for a fifth of her health while
      // she draws, and it comes apart in her hands.
      if (mem.surge) {
        mem.surge = 0;
        if (b.has(self, 'blind')) return { ability: ABILITIES.attack!, target: -1, message: `${self.name} can’t find her targets. The surge fizzles out.`, skip: true };
        if (self.hp <= (mem.surgeHp ?? self.hp) - self.base.maxHp * 0.2) return { ability: ABILITIES.attack!, target: -1, message: `The blows knock ${self.name}’s focus loose. The surge breaks apart.`, skip: true };
        return { ability: ABILITIES.e_mana_storm!, target: -1 };
      }
      if (mem.turn % 4 === 3) {
        mem.surge = 1;
        mem.surgeHp = self.hp;
        return { ability: ABILITIES.attack!, target: -1, message: `${self.name} draws the building’s current through her visor… hit her before it’s full!`, skip: true };
      }
      break;
    }
    case 'warden_spirit': {
      if (mem.turn === 1) return { ability: ABILITIES.e_soul_scream!, target: -1, message: 'The spirit tears free of the Warden’s shell!' };
      // After that, only on a rhythm and always telegraphed a turn ahead: a window to Guard or Ward.
      if (mem.breath) {
        mem.breath = 0;
        return { ability: ABILITIES.e_soul_scream!, target: -1 };
      }
      if (mem.turn % 4 === 0) {
        mem.breath = 1;
        return { ability: ABILITIES.attack!, target: -1, message: 'The spirit draws in a long, ragged breath…', skip: true };
      }
      break;
    }
  }

  const options = def.moves.filter((m) => moveOk(b, self, m));
  const pick = weightedPick(b, options.length ? options : def.moves);
  if (!pick) return null;
  const ab = ABILITIES[pick.id];
  if (!ab) return null;
  return { ability: ab, target: pickTarget(b, self, ab) };
}
