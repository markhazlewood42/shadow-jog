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
      if (!mem.enraged && self.hp / self.base.maxHp < 0.5) {
        mem.enraged = 1;
        const ab = ABILITIES.e_tidal!;
        return { ability: ab, target: -1, message: 'The Lurker thrashes, churning the black water!' };
      }
      if (mem.turn % 4 === 0) return { ability: ABILITIES.e_biolume!, target: -1 };
      break;
    }
    case 'warden': {
      // Telegraphed Pulse Cannon: charge on one turn, fire on the next.
      if (mem.charging) {
        mem.charging = 0;
        const ab = ABILITIES.e_pulse_cannon!;
        return { ability: ab, target: pickTarget(b, self, ab) };
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
        return { ability: ABILITIES.attack!, target: -1, message: 'WARDEN\'s cannon begins to whine. It\'s charging!', skip: true };
      }
      break;
    }
    case 'warden_spirit': {
      if (mem.turn === 1) return { ability: ABILITIES.e_soul_scream!, target: -1, message: 'The spirit tears free of the Warden\'s shell!' };
      if (mem.turn % 4 === 0) return { ability: ABILITIES.e_soul_scream!, target: -1 };
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
