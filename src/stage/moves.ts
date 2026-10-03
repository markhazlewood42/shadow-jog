/**
 * MOVES AS DATA (Phaser spike `spike/phaser-stage`, the "frame model" of `docs/TOOLING-UI.md` 4.2 and 6.2).
 *
 * A *move* is what a fighter does with its body during an action: Rook's overhead strike, an enemy's lunge, the
 * little flinch of a hit. The game's older battle code wrote each one as a script of `await wait(...)` calls. Here a
 * move is a LIST OF FRAMES, the way fighting-game engines (MUGEN, OpenBOR) store them, so that a tool can show it as
 * a timeline and a person can retime it without touching code. Each frame says:
 *
 *   - `still`   which picture to show (a name from `stills`, or `$idle` for "whatever the fighter's idle is");
 *   - `offset`  a small x,y nudge of that picture for this frame only (y points DOWN, like the screen);
 *   - `hold`    how many ticks the frame stays on screen (a tick is 1/60 s; the stage counts frames, not seconds);
 *   - `move`    how far the whole fighter travels during this frame (see "reach" below);
 *   - `events`  named cues on a tick of the frame: `hit` (the blow lands: hitstop, shake, where the spark goes) and `glow`.
 *
 * Because a move is only numbers, it is also easy to test: `compileMove` turns the list into a timeline and
 * `sampleMove(c, tick)` answers "what does the fighter look like on tick 33?" without any graphics at all.
 *
 * Three ideas worth knowing:
 *
 *  - **Facing-relative.** A hero faces right and an enemy faces left, so x numbers in a move mean "forward" (toward the
 *    other side) and "back"; the performer flips them for an enemy. One flinch move serves both sides.
 *  - **Reach.** A lunge cannot be a fixed number of pixels, because the distance to the target depends on the stage
 *    and the slot. So `move.dx` and `move.dz` are FRACTIONS of the reach: 0 is the fighter's home spot, 1 is the spot
 *    where the weapon meets the target (across the stage for dx, onto the target's depth row for dz). A frame with
 *    `dx: 0.25` advances a quarter of the way over its hold, spread evenly over its ticks. A move that goes out must
 *    come home, so the dx values sum to zero (`checkMoves` makes sure).
 *  - **Hitstop.** When a hit lands, everything freezes for a few ticks (the `stop` of the hit event): the one cheap
 *    trick that makes a punch feel heavy. The move's own tick counter simply does not advance while it lasts.
 *
 * This file is pure (no Phaser, no browser): it is loaded by the performer and by the unit tests.
 */

/** The still that means "the fighter's own idle picture" (a hero's looping sheet, an enemy's art with its sway). */
export const IDLE_STILL = '$idle';

/** The most ticks one frame may hold (10 seconds): a typo like 6000 should be refused, not played. */
export const HOLD_MAX = 600;

/** Which procedural picture a hit makes where it lands. */
export type HitEffect = 'cut' | 'blow' | 'spark' | 'heal' | 'none';

/** The blow lands on this tick. */
export interface HitEvent {
  type: 'hit';
  /** Tick within the frame (0 = the frame's first tick). Default 0. */
  at?: number;
  /** Ticks the whole stage freezes on contact (hitstop). */
  stop?: number;
  /** How many pixels the screen shakes while the hit settles (0 for none). */
  shake?: number;
  /**
   * Where the spark appears, measured from the attacker's axis (forward = toward the target, y down). `dx` defaults to the
   * move's `reach.forward` (the tip of the weapon), `dy` to the middle of the target's body.
   */
  contact?: { dx?: number; dy?: number };
  effect?: HitEffect;
  /** `heavy` hits make a bigger glow and more shards. Default `light`. */
  weight?: 'light' | 'heavy';
}

/** A light gathers around the fighter (the charge of a spell). */
export interface GlowEvent {
  type: 'glow';
  at?: number;
  color?: string;
}

export type MoveEvent = HitEvent | GlowEvent;

export interface MoveFrame {
  still: string;
  /** x forward (negative = back), y down; whole pixels. */
  offset?: [number, number];
  hold: number;
  /** Travel during this frame as fractions of the reach (see the file header). */
  move?: { dx?: number; dz?: number };
  /** Draw this fighter in front of its target from this frame on (it borrows the target's row, `lungeOverTarget`). */
  front?: boolean;
  /** Show the white hit-flash picture. */
  flash?: boolean;
  /** Opacity 0 to 1 (a defeated enemy blinks out). Default 1. */
  alpha?: number;
  events?: MoveEvent[];
  /** A word for a human reading the timeline ("wind-up", "swing"); never used by the engine. */
  label?: string;
}

/** How far a lunging move reaches. */
export interface Reach {
  /**
   * How far in front of the fighter's axis the weapon (or fist) reaches at contact, in pixels, or `body` for "the front
   * of the drawn figure" (a fighter with no weapon art). Rook's blade tip is 60 px in front of him in the follow-through.
   */
  forward: number | 'body';
  /** How far past the target's near edge the reach goes, so a cut passes INTO the body and not just up to it. */
  pierce: number;
  /** How much of the depth difference to the target's row the lunge closes (1 = lands on the target's row). Default 1. */
  lane?: number;
}

export interface MoveDef {
  id: string;
  name: string;
  /** `attack` moves must have a hit event; `reaction` moves (a flinch, a fall) are played on the one who was hit. */
  kind: 'attack' | 'reaction';
  reach?: Reach;
  frames: MoveFrame[];
  /** Why the move is timed the way it is (the "Note for Claude" every entry carries). */
  note?: string;
}

/** Where a still comes from (`stills.ts` builds the textures from this). */
export interface StillDef {
  /** `sf-rook`: Rook's strike frames, `sf-kit`: Kit's punch and kick, both built from Mark's Sprite Fusion stills. */
  art: 'sf-rook' | 'sf-kit';
  /** The key inside that art set (`dip`, `windup`...). */
  key: string;
  note?: string;
}

/** Which move a fighter performs for an ability. The first binding that fits wins. */
export interface Binding {
  actor?: string;
  side?: 'party' | 'enemy';
  /** Ability ids. */
  ability?: string[];
  /** Effect ids (`Ability.fx`). */
  fx?: string[];
  /** Ability kinds (`attack`, `tech`, `skill`, `enemy`, `combo`, `item`). */
  kind?: string[];
  /** Whether the ability aims at more than one target or at nobody in particular. */
  spread?: boolean;
  move: string;
}

export interface MoveFile {
  version: 1;
  stills: Record<string, StillDef>;
  moves: Record<string, MoveDef>;
  bindings: Binding[];
  /** The reactions every fighter has: the flinch when hit, the dodge, the fall. */
  reactions: { hurt: string; dodge: string; down: string; downHero: string };
}

// ------------------------------------------------------------------ checking a file

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a move file may refer to. */
export interface MoveKnown {
  /** Ability ids and effect ids the bindings may name (empty = do not check). */
  abilities?: ReadonlySet<string>;
  /** Crew ids the bindings may name. */
  actors?: ReadonlySet<string>;
}

/**
 * Check a parsed move file and list every problem in plain words, one per line (an empty list means it is fine).
 * Never throws on bad data; `loadMoves` throws with the whole list.
 */
export function checkMoves(raw: unknown, known: MoveKnown = {}): string[] {
  const out: string[] = [];
  if (!isObj(raw)) return ['The moves file is not an object.'];
  if (raw.version !== 1) out.push('The moves file must say "version": 1.');
  /** An object field, or a problem and an empty object. */
  const need = (v: unknown, problem: string): Record<string, unknown> => {
    if (isObj(v)) return v;
    out.push(problem);
    return {};
  };
  const stills = need(raw.stills, '"stills" must be an object.');
  const moves = need(raw.moves, '"moves" must be an object.');
  for (const [id, s] of Object.entries(stills)) {
    if (!isObj(s) || (s.art !== 'sf-rook' && s.art !== 'sf-kit') || typeof s.key !== 'string') out.push(`Still "${id}": needs "art": "sf-rook" or "sf-kit", and a "key".`);
  }
  const hasStill = (name: string): boolean => name === IDLE_STILL || name in stills;
  for (const [id, m] of Object.entries(moves)) {
    const at = `Move "${id}"`;
    if (!isObj(m)) {
      out.push(`${at} is not an object.`);
      continue;
    }
    if (m.id !== id) out.push(`${at}: its "id" must be "${id}".`);
    if (typeof m.name !== 'string' || !m.name) out.push(`${at}: needs a name.`);
    if (m.kind !== 'attack' && m.kind !== 'reaction') out.push(`${at}: "kind" must be "attack" or "reaction".`);
    const reach = m.reach;
    if (reach !== undefined) {
      if (!isObj(reach) || !(isNum(reach.forward) || reach.forward === 'body') || !isNum(reach.pierce)) out.push(`${at}: "reach" needs "forward" (pixels or "body") and "pierce" (pixels).`);
    }
    const frames = Array.isArray(m.frames) ? (m.frames as unknown[]) : null;
    if (!frames || frames.length === 0) {
      out.push(`${at}: needs at least one frame.`);
      continue;
    }
    let sumX = 0;
    let sumZ = 0;
    let hits = 0;
    frames.forEach((f, i) => {
      const fa = `${at}, frame ${i + 1}`;
      if (!isObj(f)) {
        out.push(`${fa} is not an object.`);
        return;
      }
      if (typeof f.still !== 'string' || !hasStill(f.still)) out.push(`${fa}: still "${String(f.still)}" is not in "stills" (use "${IDLE_STILL}" for the fighter's idle).`);
      if (!isInt(f.hold) || f.hold < 1 || f.hold > HOLD_MAX) out.push(`${fa}: "hold" must be a whole number of ticks from 1 to ${HOLD_MAX}.`);
      if (f.offset !== undefined && !(Array.isArray(f.offset) && f.offset.length === 2 && f.offset.every(isInt))) out.push(`${fa}: "offset" must be [x, y] in whole pixels.`);
      if (f.alpha !== undefined && !(isNum(f.alpha) && f.alpha >= 0 && f.alpha <= 1)) out.push(`${fa}: "alpha" must be between 0 and 1.`);
      if (isObj(f.move)) {
        if (f.move.dx !== undefined && !isNum(f.move.dx)) out.push(`${fa}: move.dx must be a number.`);
        if (f.move.dz !== undefined && !isNum(f.move.dz)) out.push(`${fa}: move.dz must be a number.`);
        sumX += isNum(f.move.dx) ? f.move.dx : 0;
        sumZ += isNum(f.move.dz) ? f.move.dz : 0;
      } else if (f.move !== undefined) out.push(`${fa}: "move" must be { dx, dz }.`);
      const hold = isInt(f.hold) ? f.hold : 1;
      for (const [j, e] of (Array.isArray(f.events) ? (f.events as unknown[]) : []).entries()) {
        const ea = `${fa}, event ${j + 1}`;
        if (!isObj(e) || (e.type !== 'hit' && e.type !== 'glow')) {
          out.push(`${ea}: "type" must be "hit" or "glow".`);
          continue;
        }
        if (e.at !== undefined && !(isInt(e.at) && e.at >= 0 && e.at < hold)) out.push(`${ea}: "at" must be a tick inside the frame (0 to ${hold - 1}).`);
        if (e.type === 'hit') {
          hits++;
          if (e.stop !== undefined && !(isInt(e.stop) && e.stop >= 0 && e.stop <= 30)) out.push(`${ea}: "stop" must be 0 to 30 ticks.`);
          if (e.shake !== undefined && !(isInt(e.shake) && e.shake >= 0 && e.shake <= 6)) out.push(`${ea}: "shake" must be 0 to 6 pixels.`);
        }
      }
    });
    if (Math.abs(sumX) > 1e-6) out.push(`${at}: the dx values add up to ${+sumX.toFixed(4)}, not 0, so the fighter would not come home.`);
    if (Math.abs(sumZ) > 1e-6) out.push(`${at}: the dz values add up to ${+sumZ.toFixed(4)}, not 0.`);
    if (m.kind === 'attack' && hits === 0) out.push(`${at}: an attack needs a "hit" event, or nothing would ever land.`);
    if ((sumX !== 0 || sumZ !== 0) && !m.reach) out.push(`${at}: it moves, so it needs a "reach".`);
  }
  const reactions = need(raw.reactions, '"reactions" must be an object naming hurt, dodge, down and downHero.');
  for (const k of ['hurt', 'dodge', 'down', 'downHero']) {
    const name = reactions[k];
    const mv = typeof name === 'string' ? moves[name] : undefined;
    if (typeof name !== 'string' || !isObj(mv)) out.push(`reactions.${k} must name a move in "moves".`);
    else if (mv.kind !== 'reaction') out.push(`reactions.${k}: move "${name}" must be of kind "reaction".`);
  }
  if (!Array.isArray(raw.bindings)) out.push('"bindings" must be a list.');
  const bindings = Array.isArray(raw.bindings) ? (raw.bindings as unknown[]) : [];
  bindings.forEach((b, i) => {
    const ba = `Binding ${i + 1}`;
    if (!isObj(b) || typeof b.move !== 'string') {
      out.push(`${ba}: needs a "move".`);
      return;
    }
    const mv = moves[b.move];
    if (!isObj(mv)) out.push(`${ba}: move "${b.move}" is not in "moves".`);
    else if (mv.kind !== 'attack') out.push(`${ba}: move "${b.move}" is a reaction, not an attack.`);
    if (b.actor !== undefined && known.actors && !known.actors.has(String(b.actor))) out.push(`${ba}: "${String(b.actor)}" is not a crew member.`);
    if (known.abilities) {
      for (const a of Array.isArray(b.ability) ? (b.ability as unknown[]) : []) if (!known.abilities.has(String(a))) out.push(`${ba}: "${String(a)}" is not an ability.`);
    }
  });
  if (!bindings.some((b) => isObj(b) && b.actor === undefined && b.side === undefined && b.ability === undefined && b.fx === undefined && b.kind === undefined && b.spread === undefined)) {
    out.push('The last binding must have no conditions at all, so every action finds a move.');
  }
  return out;
}

/** Parse and check a move file; throws one error listing every problem. */
export function loadMoves(raw: unknown, known: MoveKnown = {}): MoveFile {
  const problems = checkMoves(raw, known);
  if (problems.length) throw new Error(`The moves file has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}`);
  return raw as MoveFile;
}

/** What the engine tells us about an action, so a binding can be matched. */
export interface ActionInfo {
  actor: string;
  side: 'party' | 'enemy';
  ability: string;
  fx: string;
  kind: string;
  /** More than one target, or none in particular. */
  spread: boolean;
}

/** The move for an action: the first binding whose conditions all fit. */
export function pickMove(file: MoveFile, a: ActionInfo): string {
  for (const b of file.bindings) {
    if (b.actor !== undefined && b.actor !== a.actor) continue;
    if (b.side !== undefined && b.side !== a.side) continue;
    if (b.ability !== undefined && !b.ability.includes(a.ability)) continue;
    if (b.fx !== undefined && !b.fx.includes(a.fx)) continue;
    if (b.kind !== undefined && !b.kind.includes(a.kind)) continue;
    if (b.spread !== undefined && b.spread !== a.spread) continue;
    return b.move;
  }
  throw new Error('No binding fits this action (the last binding must have no conditions)');
}

// ------------------------------------------------------------------ the timeline

/** A move laid out on the tick clock. */
export interface CompiledMove {
  def: MoveDef;
  /** Total ticks, not counting hitstop. */
  length: number;
  /** For each frame: the tick it starts on and the fractions of reach travelled before it. */
  starts: number[];
  before: Array<{ x: number; z: number }>;
  /** Every hit event with the absolute tick it fires on, in order. */
  hits: Array<{ tick: number; frame: number; event: HitEvent }>;
  glows: Array<{ tick: number; frame: number; event: GlowEvent }>;
}

export function compileMove(def: MoveDef): CompiledMove {
  const starts: number[] = [];
  const before: Array<{ x: number; z: number }> = [];
  const hits: CompiledMove['hits'] = [];
  const glows: CompiledMove['glows'] = [];
  let tick = 0;
  let x = 0;
  let z = 0;
  def.frames.forEach((f, i) => {
    starts.push(tick);
    before.push({ x, z });
    for (const e of f.events ?? []) {
      const at = tick + (e.at ?? 0);
      if (e.type === 'hit') hits.push({ tick: at, frame: i, event: e });
      else glows.push({ tick: at, frame: i, event: e });
    }
    tick += f.hold;
    x += f.move?.dx ?? 0;
    z += f.move?.dz ?? 0;
  });
  return { def, length: tick, starts, before, hits, glows };
}

/** What a fighter looks like on one tick of a move. */
export interface MoveSample {
  frame: number;
  /** Ticks into the frame (0 = its first). */
  k: number;
  still: string;
  offset: [number, number];
  flash: boolean;
  front: boolean;
  alpha: number;
  /** How far along the reach the fighter has travelled, after this tick's step. */
  lunge: { x: number; z: number };
}

/** The frame index that shows on `tick` (past the end: the last frame). */
export function frameAt(c: CompiledMove, tick: number): number {
  const t = Math.max(0, tick);
  for (let i = c.starts.length - 1; i >= 0; i--) if (t >= (c.starts[i] ?? 0)) return i;
  return 0;
}

/** The sample for `tick`. Moves are evaluated AFTER the tick's step: on a frame's last tick the fighter has completed that frame's travel. */
export function sampleMove(c: CompiledMove, tick: number): MoveSample {
  const t = Math.min(Math.max(0, tick), c.length - 1);
  const i = frameAt(c, t);
  const f = c.def.frames[i];
  const start = c.starts[i];
  const base = c.before[i];
  if (!f || start === undefined || !base) throw new Error(`Move "${c.def.id}" has no frame ${i}`);
  const k = t - start;
  const share = (k + 1) / f.hold;
  return {
    frame: i,
    k,
    still: f.still,
    offset: f.offset ?? [0, 0],
    flash: !!f.flash,
    front: !!f.front,
    alpha: f.alpha ?? 1,
    lunge: { x: base.x + (f.move?.dx ?? 0) * share, z: base.z + (f.move?.dz ?? 0) * share },
  };
}

/** The ticks the cues fall on: what a timeline shows as markers. */
export function eventsAt(c: CompiledMove, tick: number): { hits: HitEvent[]; glows: GlowEvent[] } {
  return { hits: c.hits.filter((h) => h.tick === tick).map((h) => h.event), glows: c.glows.filter((g) => g.tick === tick).map((g) => g.event) };
}

/**
 * Fighting-game frame data worked out from the frames: STARTUP is the ticks before the first hit lands, ACTIVE the ticks
 * from the first hit to the last (hitstop not included), RECOVERY what is left until the fighter is home. `stop` is the
 * freeze all the hits add, so a human can see the real time the move takes on screen.
 */
export function frameData(c: CompiledMove): { startup: number; active: number; recovery: number; total: number; stop: number } {
  const first = c.hits[0];
  const last = c.hits[c.hits.length - 1];
  const stop = c.hits.reduce((n, h) => n + (h.event.stop ?? 0), 0);
  if (!first || !last) return { startup: c.length, active: 0, recovery: 0, total: c.length, stop: 0 };
  return { startup: first.tick, active: last.tick - first.tick + 1, recovery: c.length - (last.tick + 1), total: c.length + stop, stop };
}

/** The path of the lunge, one point per tick, as fractions of the reach (what a composer draws as a row of dots). */
export function lungePath(c: CompiledMove): Array<{ x: number; z: number }> {
  return Array.from({ length: c.length }, (_, t) => sampleMove(c, t).lunge);
}

// ------------------------------------------------------------------ where a lunge ends

/** What `reachVector` needs to know, all in screen pixels. */
export interface ReachInput {
  /** 1 for a hero (faces right), -1 for an enemy. */
  facing: 1 | -1;
  /** The attacker's home feet. */
  home: { x: number; y: number };
  /** The target's feet row and the x of its edge nearest the attacker. */
  targetEdgeX: number;
  targetY: number;
  /** The move's reach, with `forward` already resolved to pixels. */
  forward: number;
  pierce: number;
  lane: number;
}

/**
 * The full lunge as a vector from the home spot: where the attacker stands when its weapon is `pierce` pixels inside
 * the target's near edge (`dx`) and how far down or up the depth rows it has gone to meet the target (`dz`). A move's
 * `move.dx` and `move.dz` fractions multiply this. Pure, so a test can check any layout.
 */
export function reachVector(i: ReachInput): { dx: number; dz: number } {
  const contactX = i.targetEdgeX + i.facing * (i.pierce - i.forward);
  return { dx: contactX - i.home.x, dz: (i.targetY - i.home.y) * i.lane };
}
