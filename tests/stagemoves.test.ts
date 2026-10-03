import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/data/abilities';
import movesJson from '../src/data/moves.json';
import { checkMoves, compileMove, eventsAt, frameAt, frameData, IDLE_STILL, loadMoves, lungePath, type MoveFile, pickMove, reachVector, sampleMove } from '../src/stage/moves';

const known = { abilities: new Set(Object.keys(ABILITIES)), actors: new Set(['kit', 'rook', 'hex', 'sable']) };
const file: MoveFile = loadMoves(movesJson, known);
const strike = compileMove(file.moves['rook-strike']!);

describe('the shipped move file', () => {
  it('passes its own checks', () => {
    expect(checkMoves(movesJson, known)).toEqual([]);
  });

  it('every move is made of whole ticks and every lunge comes home', () => {
    for (const m of Object.values(file.moves)) {
      const c = compileMove(m);
      expect(c.length, m.id).toBeGreaterThan(0);
      const end = sampleMove(c, c.length - 1).lunge;
      expect(Math.abs(end.x), m.id).toBeLessThan(1e-9);
      expect(Math.abs(end.z), m.id).toBeLessThan(1e-9);
    }
  });

  it('every attack has a hit and no reaction does', () => {
    for (const m of Object.values(file.moves)) {
      const c = compileMove(m);
      if (m.kind === 'attack') expect(c.hits.length, m.id).toBeGreaterThan(0);
      else expect(c.hits.length, m.id).toBe(0);
    }
  });
});

describe('Kit’s combo as data', () => {
  const kit = compileMove(file.moves['kit-punch']!);
  it('lands three blows (jab, cross, kick) at growing weight, the kick last and held longest', () => {
    expect(kit.hits.map((h) => h.tick)).toEqual([22, 33, 51]);
    expect(kit.hits.map((h) => h.event.stop)).toEqual([3, 6, 8]);
    expect(kit.hits.map((h) => h.event.weight ?? 'light')).toEqual(['light', 'heavy', 'heavy']);
    expect(kit.length).toBe(91);
    const d = frameData(kit);
    expect(d.startup).toBe(22);
    expect(d.active).toBe(30);
    expect(d.stop).toBe(17);
  });
  it('is at the target by the first blow, plants there, and walks home', () => {
    expect(sampleMove(kit, 22).lunge.x).toBeGreaterThan(0.9);
    expect(sampleMove(kit, 51).lunge.x).toBeCloseTo(1, 9);
    expect(sampleMove(kit, 90).lunge.x).toBeCloseTo(0, 9);
  });
});

describe('Rook’s strike as data', () => {
  it('runs the frames Mark drew in the order the side-view spike timed them', () => {
    const stills = file.moves['rook-strike']!.frames.map((f) => f.still);
    expect(stills).toEqual(['$idle', 'rook.dip', 'rook.riseA', 'rook.rise', 'rook.windup', 'rook.smearA', 'rook.mid', 'rook.smearB', 'rook.swingB', 'rook.followFade', 'rook.follow', 'rook.recover', '$idle', '$idle']);
  });

  it('is 69 ticks long with one hit on tick 33, and its frame data is startup 33, active 1, recovery 35', () => {
    expect(strike.length).toBe(69);
    expect(strike.hits.map((h) => h.tick)).toEqual([33]);
    const d = frameData(strike);
    expect(d).toEqual({ startup: 33, active: 1, recovery: 35, total: 69 + 7, stop: 7 });
  });

  it('is on the swing-B frame when the blade lands, having covered the whole reach', () => {
    const s = sampleMove(strike, 33);
    expect(s.still).toBe('rook.swingB');
    expect(s.lunge.x).toBeCloseTo(1, 9);
    expect(s.lunge.z).toBeCloseTo(1, 9);
    expect(s.front).toBe(true);
  });

  it('winds up (dips back a little) before it lunges, then goes out at a steady pace per frame', () => {
    const path = lungePath(strike);
    // The coil: the fighter is a little behind home before the swing starts.
    expect(Math.min(...path.slice(0, 23).map((p) => p.x))).toBeLessThan(-0.04);
    // After the swing starts it only moves forward until the hit.
    for (let t = 24; t <= 33; t++) expect(path[t]!.x).toBeGreaterThan(path[t - 1]!.x);
    // And the first swing tick is no more than a quarter of the reach: no teleport.
    for (let t = 1; t < path.length; t++) expect(Math.abs(path[t]!.x - path[t - 1]!.x)).toBeLessThan(0.16);
  });

  it('moves the same distance each tick inside a frame (a constant-rate dash)', () => {
    const a = sampleMove(strike, 31).lunge.x;
    const b = sampleMove(strike, 32).lunge.x;
    const c = sampleMove(strike, 33).lunge.x;
    expect(b - a).toBeCloseTo(c - b, 9);
  });

  it('puts the cues on the ticks the data says', () => {
    expect(eventsAt(strike, 33).hits).toHaveLength(1);
    expect(eventsAt(strike, 32).hits).toHaveLength(0);
    expect(eventsAt(strike, 33).hits[0]).toMatchObject({ stop: 7, effect: 'cut', weight: 'heavy' });
  });

  it('answers any tick, including past the end', () => {
    expect(frameAt(strike, -5)).toBe(0);
    expect(frameAt(strike, 999)).toBe(13);
    expect(sampleMove(strike, 999).lunge.x).toBeCloseTo(0, 9);
  });
});

describe('choosing a move for an action', () => {
  const base = { side: 'party' as const, ability: 'attack', fx: 'slash', kind: 'attack', spread: false };
  it('gives Rook his strike for his attack and his sword skills', () => {
    expect(pickMove(file, { ...base, actor: 'rook' })).toBe('rook-strike');
    expect(pickMove(file, { ...base, actor: 'rook', ability: 'arc_cut', kind: 'skill' })).toBe('rook-strike');
  });
  it('gives Kit her combo for an attack and the stand-in lunge for her skills and for Sable', () => {
    expect(pickMove(file, { ...base, actor: 'kit' })).toBe('kit-punch');
    expect(pickMove(file, { ...base, actor: 'kit', ability: 'flash_step', fx: 'flash_step', kind: 'tech' })).toBe('melee-hero');
    expect(pickMove(file, { ...base, actor: 'sable' })).toBe('melee-hero');
  });
  it('gives Hex her shot and spells a cast', () => {
    expect(pickMove(file, { ...base, actor: 'hex' })).toBe('shoot');
    expect(pickMove(file, { ...base, actor: 'sable', ability: 'wildfire', fx: 'fire_all', kind: 'tech', spread: true })).toBe('cast');
    expect(pickMove(file, { ...base, actor: 'sable', ability: 'mend', fx: 'heal', kind: 'tech' })).toBe('cast-support');
  });
  it('gives an enemy’s bite a lunge and its spit a cast', () => {
    expect(pickMove(file, { ...base, actor: 'punk', side: 'enemy', fx: 'bite', kind: 'enemy' })).toBe('melee-enemy');
    expect(pickMove(file, { ...base, actor: 'punk', side: 'enemy', fx: 'fire', kind: 'enemy' })).toBe('cast');
  });
});

describe('where a lunge ends', () => {
  it('stops the weapon `pierce` px inside the target’s near edge, on the target’s row', () => {
    // A hero at x 150, row y 190; a target whose left edge is at x 300 on row y 140. Rook's blade reaches 60 px and pierces 8.
    const v = reachVector({ facing: 1, home: { x: 150, y: 190 }, targetEdgeX: 300, targetY: 140, forward: 60, pierce: 8, lane: 1 });
    expect(v.dx).toBe(300 + 8 - 60 - 150);
    expect(v.dz).toBe(-50);
  });
  it('mirrors for an enemy lunging left at a hero', () => {
    const v = reachVector({ facing: -1, home: { x: 320, y: 140 }, targetEdgeX: 160, targetY: 190, forward: 20, pierce: 3, lane: 1 });
    expect(v.dx).toBe(160 - 3 + 20 - 320);
    expect(v.dz).toBe(50);
  });
});

describe('checking a move file', () => {
  const clone = (): any => JSON.parse(JSON.stringify(movesJson));
  it('refuses a lunge that does not come home', () => {
    const m = clone();
    m.moves['rook-strike'].frames[13].move.dx = -0.1;
    expect(checkMoves(m, known).join('\n')).toMatch(/rook-strike.*dx values add up/);
  });
  it('refuses a frame that shows a picture that does not exist', () => {
    const m = clone();
    m.moves['rook-strike'].frames[1].still = 'rook.nope';
    expect(checkMoves(m, known).join('\n')).toMatch(/frame 2: still "rook.nope"/);
  });
  it('refuses an attack with no hit, a zero hold and an event outside its frame', () => {
    const m = clone();
    delete m.moves.shoot.frames[1].events;
    m.moves.cast.frames[0].hold = 0;
    m.moves['melee-hero'].frames[3].events[0].at = 9;
    const text = checkMoves(m, known).join('\n');
    expect(text).toMatch(/"shoot": an attack needs a "hit" event/);
    expect(text).toMatch(/"cast", frame 1: "hold"/);
    expect(text).toMatch(/"melee-hero", frame 4, event 1: "at"/);
  });
  it('refuses a binding to a move that is not there or to a reaction, and a file with no catch-all', () => {
    const m = clone();
    m.bindings[0].move = 'ghost';
    m.bindings[1].move = 'hurt';
    m.bindings.pop();
    const text = checkMoves(m, known).join('\n');
    expect(text).toMatch(/Binding 1: move "ghost"/);
    expect(text).toMatch(/Binding 2: move "hurt" is a reaction/);
    expect(text).toMatch(/last binding must have no conditions/);
  });
  it('knows the idle still without declaring it', () => {
    expect(IDLE_STILL).toBe('$idle');
    expect(checkMoves(movesJson, known)).toEqual([]);
  });
});
