/**
 * Battle playback against a recording view: the sequencing rules the eye depends on, checked
 * without a canvas — the timed-press ring meets the hit, a combo's name clears before its numbers,
 * an area attack freezes once, a kill is recorded.
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/battle/engine';
import { enemyParty, partyCombatant } from '../src/battle/setup';
import type { BattleEvent, Combatant } from '../src/battle/types';
import type { Pt } from '../src/battle/fx';
import { Rng } from '../src/engine/rng';
import { createMember } from '../src/game/party';
import { state } from '../src/game/state';
import { playEvent, type PlaybackView } from '../src/scenes/battlekit/playback';
import { RING_LEAD } from '../src/scenes/battlekit/timing';
import type { Disp } from '../src/scenes/battlekit/types';

const IMPACT = 7;

/** A view that records what playback asked for, on a clock of waited frames. */
function recorder(armed = false) {
  const party: Combatant[] = [partyCombatant(createMember('kit', 5), 0, 0), partyCombatant(createMember('rook', 5), 1, 1)];
  const battle = new Battle(party, enemyParty(['glowrat', 'glowrat', 'glowrat']), new Rng(1));
  const log: string[] = [];
  let clock = 0;
  let ringOpen = !armed;
  const disp = new Map<number, Disp>();
  const d = (uid: number): Disp => {
    let x = disp.get(uid);
    if (!x) {
      x = { hp: 0, tp: 0, shownHp: 0, shownTp: 0, lagHp: 0, lagHold: 0, flash: 0, shake: 0, hop: 0, alpha: 1, dying: 0, lunge: 0, hidden: false, pose: 'idle', poseT: 0, afterimage: 0 };
      disp.set(uid, x);
    }
    return x;
  };
  const wait = (n: number) => {
    clock += n;
    return Promise.resolve();
  };
  const view: PlaybackView = {
    battle,
    fx: {
      play: (id: string) => {
        log.push(`fx:${id}@${clock}`);
        return { impact: IMPACT, total: 20 };
      },
      impactOf: () => IMPACT,
    } as unknown as PlaybackView['fx'],
    game: { wait, shake: () => undefined, flash: () => undefined, frame: 0 } as unknown as PlaybackView['game'],
    lastActor: null,
    d,
    pos: (): Pt => ({ x: 0, y: 0 }),
    enemyBox: () => null,
    feetOf: () => 0,
    w: wait,
    // Animation frames map one to one here (the scene's FX_PACE is a presentation choice).
    anim: (n) => n,
    label: (u) => u.name,
    deckCutin: () => undefined,
    floatOn: (uid, text) => log.push(`float:${uid}:${text}`),
    say: (text) => log.push(`say:${text}`),
    tell: (text, actor) => log.push(`tell:${actor}:${text}`),
    showBanner: (text) => log.push(`banner:${text}`),
    setBanner: (b) => log.push(`setBanner:${b.text}`),
    endBanner: () => log.push(`endBanner@${clock}`),
    setPose: () => undefined,
    initDisp: () => undefined,
    cutin: () => undefined,
    cutinCount: () => 0,
    hitstop: (frames) => {
      log.push(`hitstop:${frames}`);
      return wait(frames);
    },
    markDead: (uid) => log.push(`dead:${uid}`),
    impact: (uid) => log.push(`impact:${uid}`),
    relayout: () => undefined,
    comboId: (name) => name,
    timingArmed: () => (ringOpen ? null : 'normal'),
    openTiming: (lead) => {
      ringOpen = true;
      log.push(`ring:${lead}@${clock}`);
    },
  };
  return { view, battle, log, clock: () => clock };
}

const act = (actor: number, targets: number[], kind: 'attack' | 'tech' = 'attack'): BattleEvent => ({ t: 'act', actor, id: 'attack', name: 'Attack', kind, fx: 'slash', targets });
const hit = (target: number, amount: number, hp: number, crit = false): BattleEvent => ({ t: 'damage', target, amount, crit, element: 'phys', weak: false, resist: false, hp });

describe('battle playback', () => {
  it('a timed press: the ring opens with a readable lead and closes as the effect lands', async () => {
    const r = recorder(true);
    const kit = r.battle.party[0]!.uid, rat = r.battle.enemies[0]!.uid;
    await playEvent(r.view, act(kit, [rat]));
    const ring = r.log.find((l) => l.startsWith('ring:'))!;
    const fx = r.log.find((l) => l.startsWith('fx:'))!;
    const [lead, opened] = ring.slice(5).split('@').map(Number) as [number, number];
    const at = Number(fx.split('@')[1]);
    expect(lead).toBeGreaterThanOrEqual(RING_LEAD);
    // The effect starts so that its impact lands exactly when the ring meets the mark.
    expect(at + IMPACT).toBe(opened + lead);
    expect(r.clock()).toBe(opened + lead);
  });

  it('without a press armed, no ring opens', async () => {
    const r = recorder(false);
    await playEvent(r.view, act(r.battle.party[0]!.uid, [r.battle.enemies[0]!.uid]));
    expect(r.log.some((l) => l.startsWith('ring:'))).toBe(false);
    expect(r.log.some((l) => l.startsWith('fx:'))).toBe(true);
  });

  it("a combo's name clears before its effect plays (its numbers never land under it)", async () => {
    const r = recorder();
    const [kit, rook] = r.battle.party.map((p) => p.uid) as [number, number];
    await playEvent(r.view, { t: 'combo', name: 'Thunder Rift', actors: [kit, rook], fx: 'slash', targets: [r.battle.enemies[0]!.uid] });
    const end = r.log.findIndex((l) => l.startsWith('endBanner'));
    const fx = r.log.findIndex((l) => l.startsWith('fx:'));
    expect(r.log.some((l) => l.startsWith('setBanner:★ THUNDER RIFT'))).toBe(true);
    expect(end).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThan(fx);
  });

  it('an area attack freezes time once, on its first heavy hit, not once per target', async () => {
    const r = recorder();
    const rats = r.battle.enemies.map((e) => e.uid);
    await playEvent(r.view, act(r.battle.party[0]!.uid, rats, 'tech'));
    for (const uid of rats) await playEvent(r.view, hit(uid, 60, 5, true));
    expect(r.log.filter((l) => l.startsWith('hitstop')).length).toBe(1);
    // The next action gets its own.
    await playEvent(r.view, act(r.battle.party[1]!.uid, [rats[0]!]));
    await playEvent(r.view, hit(rats[0]!, 60, 0, true));
    expect(r.log.filter((l) => l.startsWith('hitstop')).length).toBe(2);
    // Criticals get the impact frame, once per action.
    expect(r.log.filter((l) => l.startsWith('impact')).length).toBe(2);
  });

  it('numbers and their words: a critical says so, and a kill is recorded in the bestiary', async () => {
    const r = recorder();
    const rat = r.battle.enemies[0]!;
    await playEvent(r.view, hit(rat.uid, 44, 0, true));
    expect(r.log).toContain(`float:${rat.uid}:44`);
    expect(r.log).toContain(`float:${rat.uid}:CRITICAL`);
    const before = state.bestiary[rat.key] ?? 0;
    await playEvent(r.view, { t: 'down', target: rat.uid });
    expect(r.log).toContain(`dead:${rat.uid}`);
    expect(r.view.d(rat.uid).dying).toBe(1);
    expect(state.bestiary[rat.key]).toBe(before + 1);
  });
});
