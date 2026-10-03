/**
 * The performer (Phaser spike `spike/phaser-stage`): plays ONE action of a battle round on the stage, tick by tick.
 *
 * Division of labour in the Battle Test:
 *   - `battleflow.ts` runs the real battle engine and hands over an `ActionScript`: who acts, with what, and what lands
 *     on whom, already decided (damage numbers, misses, who goes down). It has no pictures.
 *   - THIS file turns that script into motion: it picks the actor's move from the data (`moves.json`), walks the move's
 *     frames on the fixed 60-tick clock, moves the fighter along its lunge, and when the move's `hit` event comes up it
 *     "lands" the script's next wave of impacts: the target's health bar drops, a flinch starts, the number floats up,
 *     the glow and shards fly, the world freezes for the hitstop. Nothing here asks the engine anything.
 *   - `livefx.ts` draws the sparks and numbers; `stagescene.ts` owns the fighters.
 *
 * Everything runs from `tick()`, which the scene calls once per 1/60 s (or twice at 2x speed). No timers, no tweens, no
 * `await`: the same sequence of ticks always gives the same picture, which is what lets a test say "step 40 ticks, then
 * check the target's health bar" and what makes hitstop (stop counting) trivial.
 *
 * Two clocks. The WORLD clock (the move's tick counter, reactions, idle animation) stops during a hitstop. The FX clock
 * (sparks, numbers, shake) does not.
 */
import type { Impact, ActionScript } from './battleflow';
import { applyEvent, type BattleFlow } from './battleflow';
import { partDepth } from './config';
import type { ActView } from './demo';
import { clearLane, contactY, nearEdge } from './contact';
import { compileMove, type CompiledMove, DOWN_STILL, type HitEvent, IDLE_STILL, type MoveFile, pickMove, reachVector, sampleMove } from './moves';
import type { LiveFx } from './livefx';
import type { Fighter, StageScene } from './stagescene';
import type { StillInfo } from './stills';
import { ringTexture } from './textures';
import { HIT_COLOUR, hitKind, numberScale, UI } from './hudkit';

/** A flinch, dodge or fall in progress on one fighter. */
interface Reaction {
  f: Fighter;
  move: CompiledMove;
  k: number;
  /** +1 for a hero (back is left), -1 for an enemy. */
  dir: 1 | -1;
  /** The fall: the fighter stays down when it ends. */
  fall: boolean;
  /** Pixels of jitter while the world is frozen (the hitstop shake). */
  shake: number;
  /** The strongest the white flash gets on this fighter (a jab flashes less than a finisher), 0 to 1. */
  peak: number;
}

/** A fighter fading in (a summon) or changing form (a boss phase), counted in world ticks. */
interface Entrance {
  f: Fighter;
  k: number;
  /** `appear` fades a new enemy in; `morph` flashes white, swaps the picture halfway and flashes out. */
  kind: 'appear' | 'morph';
  /** For a morph: the enemy it becomes (key of `ENEMIES`) and the uid the engine knows it by. */
  to?: string;
  uid?: number;
}

/** How long an entrance lasts in ticks. */
const APPEAR_TICKS = 16;
const MORPH_TICKS = 28;

/** The action being played. */
interface Playing {
  script: ActionScript;
  actor: Fighter | null;
  primary: Fighter | null;
  move: CompiledMove | null;
  home: { x: number; y: number };
  reach: { dx: number; dz: number };
  /** Pixels the attacker steps down the stage to run in front of its side-mates (1.0 of a move's `sw`). */
  clear: number;
  /** Whether the summons of the script have been shown yet. */
  summoned: boolean;
  facing: 1 | -1;
  /** World ticks played so far. */
  k: number;
  /** Which wave each hit event of the move lands, and the waves that come after the last hit. */
  waveForHit: Map<number, number>;
  pending: Array<{ at: number; wave: number }>;
  end: number;
  /** Ticks of quiet left after the move finished. */
  gap: number;
  banner: string;
  /** The last party hit's numbers, for the combo counter. */
  lastDamage: { dmg: number; crit: boolean } | null;
}

/** A pause of this many ticks between one action and the next. */
const GAP = 10;
/** The ticks a party combo counter stays alive after a hit. */
const COMBO_WINDOW = 90;

/** The highest a floating number's top may sit (just under the timeline and the banner; the CRIT / WEAK word rides 9 px above it). */
const NUMBER_FLOOR = 58;

export class Performer {
  /** Ticks of hitstop left (the world is frozen while it is above 0). */
  pause = 0;
  playing: Playing | null = null;
  private reactions: Reaction[] = [];
  private entrances: Entrance[] = [];
  /** The hitstop's full length, to fade the flash over its ticks. */
  private pauseTotal = 0;
  private compiled = new Map<string, CompiledMove>();
  /** Party hits this round and their total: the combo counter. */
  comboHits = 0;
  comboTotal = 0;
  private comboLeft = 0;
  /** Where the last floating number went for each fighter, so a second hit stacks above the first. */
  private numbers = new Map<string, { at: number; stack: number }>();
  /** Ticks this performer has run: the clock for seeds and number stacking (not the scene's, which also counts the time before a test starts). */
  private clock = 0;
  /** Everything the performer has done, for the log and for tests. */
  readonly log: string[] = [];
  /** Where each blow landed (screen pixels) and where each floating number was put, newest last: what a test asks to prove a blow touched its target and a number stands over the right head. */
  readonly landed: Array<{ target: string; x: number; y: number; clock: number }> = [];
  readonly numberLog: Array<{ target: string; text: string; x: number; y: number }> = [];

  constructor(
    private readonly scene: StageScene,
    private readonly flow: BattleFlow,
    private readonly fx: LiveFx,
    private readonly moves: MoveFile,
    private readonly stills: Record<string, StillInfo>,
  ) {}

  get frozen(): boolean {
    return this.pause > 0;
  }

  /** How many effects (glow, cut, shards, numbers) are alive. */
  get fxCount(): number {
    return this.fx.count;
  }

  /** True while an action, a flinch or a fall is still going on. */
  get busy(): boolean {
    return this.playing !== null || this.reactions.length > 0 || this.entrances.length > 0 || this.pause > 0;
  }

  /** Forget the round's combo (a new round of orders is about to open). */
  resetRound(): void {
    this.comboHits = 0;
    this.comboTotal = 0;
    this.comboLeft = 0;
    this.numbers.clear();
  }

  private move(id: string): CompiledMove {
    let c = this.compiled.get(id);
    if (!c) {
      const def = this.moves.moves[id];
      if (!def) throw new Error(`The moves file has no move "${id}"`);
      c = compileMove(def);
      this.compiled.set(id, c);
    }
    return c;
  }

  private fighterOf(uid: number): Fighter | null {
    if (uid < 0) return null;
    const slot = this.flow.slotOf(uid);
    const side = slot < 10 ? 'party' : 'enemy';
    return this.scene.fighters.filter((f) => f.side === side)[side === 'party' ? slot : slot - 10] ?? null;
  }

  // ---------------------------------------------------------------- starting an action

  /** The actor's move for this script (the first binding that fits). */
  private pickMove(script: ActionScript, actor: Fighter): string {
    const spread = script.targets.length !== 1 || script.targets[0] === script.actor;
    const target = this.fighterOf(script.targets[0] ?? -1);
    const targetHeight = target ? target.fig.box.y1 - target.fig.box.y0 + 1 : undefined;
    return pickMove(this.moves, { actor: this.flow.battle.unit(script.actor)?.key ?? '', side: actor.side, ability: script.abilityId, fx: script.fx, kind: script.kind, spread, ...(targetHeight !== undefined ? { targetHeight } : {}) });
  }

  /** Height of a figure's chest above its feet, as a (negative, up) contact height: where a blow with no drawn weapon lands. */
  private chestDy(t: Fighter): number {
    return -Math.round((t.fig.box.y1 - t.fig.box.y0 + 1) * 0.45);
  }

  /** The screen x of `t`'s silhouette on the side facing an attacker with `facing`, at `dy` above its feet. Falls back to the bounding box. */
  private edgeAt(t: Fighter, dy: number, facing: 1 | -1): number {
    const rel = nearEdge(t.fig, dy, facing);
    if (rel !== null) return t.baseX + rel;
    return facing > 0 ? t.baseX + (t.fig.box.x0 - t.fig.foot.x) : t.baseX + (t.fig.box.x1 + 1 - t.fig.foot.x);
  }

  /** Begin playing a script. */
  start(script: ActionScript): void {
    const actor = this.fighterOf(script.actor);
    const primary = this.fighterOf(script.targets[0] ?? script.waves[0]?.[0]?.target ?? -1);
    const actorName = this.flow.battle.unit(script.actor)?.name ?? '';
    const banner = script.name ? (actorName ? `${actorName}: ${script.name}` : script.name) : (script.messages[0] ?? '');
    const p: Playing = {
      script,
      actor,
      primary,
      move: null,
      home: { x: actor?.baseX ?? 0, y: actor?.baseY ?? 0 },
      reach: { dx: 0, dz: 0 },
      clear: 0,
      summoned: false,
      facing: actor?.side === 'enemy' ? -1 : 1,
      k: 0,
      waveForHit: new Map(),
      pending: [],
      end: 0,
      gap: GAP,
      banner,
      lastDamage: null,
    };
    for (const e of script.before) applyEvent(this.flow.disp, e);

    if (actor && script.actor >= 0 && (script.waves.length > 0 || script.name)) {
      const move = this.move(this.pickMove(script, actor));
      p.move = move;
      this.log.push(`${actorName} ${script.name} -> ${move.def.id}`);
      // The lunge's end point: the weapon `pierce` px inside the target's SILHOUETTE at the height the weapon strikes, on the
      // target's row. The first hit event says where the weapon is (contact); without one the front of the body at chest height.
      const def = move.def;
      if (def.reach && primary && primary !== actor) {
        const first = move.hits[0]?.event;
        const forward = first?.contact ? first.contact.dx : def.reach.forward === 'body' ? (p.facing > 0 ? actor.fig.box.x1 + 1 - actor.fig.foot.x : actor.fig.foot.x - actor.fig.box.x0) : def.reach.forward;
        const edge = this.edgeAt(primary, first?.contact?.dy ?? this.chestDy(primary), p.facing);
        p.reach = reachVector({ facing: p.facing, home: p.home, targetEdgeX: edge, targetY: primary.baseY, forward, pierce: def.reach.pierce, lane: def.reach.lane ?? 1 });
      }
      // The swerve (a move's `sw`): the way in front of the side-mates, measured from where they stand.
      const mates = this.scene.fighters.filter((f) => f.side === actor.side && f !== actor && !f.down).map((f) => f.baseY);
      p.clear = clearLane(p.home.y, mates);
      // Which wave lands on which hit: with fewer waves than hits the waves take the LAST hits (a combo's earlier blows are
      // only seen, the damage lands on the finisher); with more waves than hits, the extra waves follow the last hit.
      const nw = script.waves.length;
      const nh = move.hits.length;
      if (nh > 0) {
        for (let w = 0; w < nw; w++) {
          if (nw <= nh) p.waveForHit.set(nh - nw + w, w);
          else if (w < nh) p.waveForHit.set(w, w);
          else p.pending.push({ at: (move.hits[nh - 1]?.tick ?? 0) + 10 * (w - nh + 1), wave: w });
        }
      } else for (let w = 0; w < nw; w++) p.pending.push({ at: 12 + 14 * w, wave: w });
      p.end = Math.max(move.length, ...p.pending.map((x) => x.at + 1));
    } else {
      // No actor (the end of the round: poison, regen) or no move (a stunned turn): just the waves, one after another.
      for (let w = 0; w < script.waves.length; w++) p.pending.push({ at: 12 + 18 * w, wave: w });
      p.end = Math.max(30, ...p.pending.map((x) => x.at + 12));
    }
    this.playing = p;
    this.pushView(p);
    if (actor) {
      actor.active = false;
      this.scene.restyleFighter(actor);
    }
  }

  // ---------------------------------------------------------------- the clock

  /** One tick. */
  tick(): void {
    this.clock++;
    this.fx.tick();
    if (this.comboLeft > 0 && !this.playing && !this.frozen) this.comboLeft--;
    if (this.pause > 0) {
      this.pause--;
      // The target shakes in place while the world holds still, and its flash fades a step every other tick (a freeze of
      // 7 ticks on a flat white silhouette read as a cut-out; fading it keeps the "whiteout" and still shows the figure).
      for (const r of this.reactions) {
        if (r.shake > 0) {
          r.f.bodyDx = this.pause % 2 === 0 ? r.shake : -r.shake;
          if (this.pause === 0) r.f.bodyDx = 0;
        }
        this.freezeLook(r);
        this.scene.restyleFighter(r.f);
      }
      return;
    }
    this.stepReactions();
    this.stepEntrances();
    this.stepAction();
  }

  /** The flash and wash of a reaction while the world is frozen: full strength for two ticks, then 0.75, then 0.5 (of the hit's peak). */
  private freezeLook(r: Reaction): void {
    if (r.k > 1 || !r.f.flash) return;
    const elapsed = Math.max(0, this.pauseTotal - this.pause - 1);
    r.f.flashAmt = r.peak * (elapsed < 2 ? 1 : elapsed < 4 ? 0.75 : 0.5);
  }

  private stepReactions(): void {
    const done: Reaction[] = [];
    for (const r of this.reactions) {
      if (r.k >= r.move.length) {
        done.push(r);
        continue;
      }
      this.applyReaction(r, r.k);
      r.k++;
      if (r.k >= r.move.length) done.push(r);
    }
    for (const r of done) {
      this.reactions.splice(this.reactions.indexOf(r), 1);
      if (r.fall) {
        r.f.down = true;
        // The last sample stays: a hero lies dimmed, an enemy is gone.
        this.scene.restyleFighter(r.f);
      } else {
        r.f.offX = 0;
        r.f.offY = 0;
        r.f.flash = false;
        r.f.tintAmt = 0;
        r.f.alpha = 1;
        r.f.bodyDx = 0;
        this.scene.restyleFighter(r.f);
      }
    }
  }

  private applyReaction(r: Reaction, k: number): void {
    const s = sampleMove(r.move, k);
    r.f.offX = s.offset[0] * r.dir;
    r.f.offY = s.offset[1];
    r.f.flash = s.flash;
    r.f.flashAmt = Math.max(0.25, s.flashAmt * r.peak);
    // A hero who is hit gets a red wash; the foes just flash.
    r.f.tintAmt = r.f.side === 'party' ? s.tint : 0;
    r.f.alpha = s.alpha;
    // The fall shows the kneel (`$down`); anything else leaves the picture alone (the idle is the default).
    if (s.still === DOWN_STILL) r.f.still = this.scene.downStill(r.f);
    this.scene.restyleFighter(r.f);
  }

  private startReaction(f: Fighter, id: string, fall: boolean, shake: number, peak = 1): void {
    this.reactions = this.reactions.filter((r) => r.f !== f);
    const r: Reaction = { f, move: this.move(id), k: 0, dir: f.side === 'party' ? 1 : -1, fall, shake, peak };
    this.reactions.push(r);
    this.applyReaction(r, 0);
    r.k = 1;
  }

  private stepAction(): void {
    const p = this.playing;
    if (!p) return;
    if (p.k < p.end) {
      const k = p.k;
      if (p.move && p.actor && k < p.move.length) this.poseActor(p, k);
      // Cues of this tick.
      if (p.move) {
        for (const g of p.move.glows) if (g.tick === k && p.actor) this.fx.glow(p.actor.x + p.facing * 6, p.actor.y - 18, g.event.color ?? UI.cyan, p.actor.depth + 100, false);
        p.move.hits.forEach((h, i) => {
          if (h.tick === k) this.land(p, h.event, p.waveForHit.get(i));
        });
      }
      for (const q of p.pending) if (q.at === k) this.land(p, null, q.wave);
      p.k++;
      return;
    }
    if (p.gap > 0) {
      p.gap--;
      if (p.gap === GAP - 1) {
        this.finishActor(p);
        // A summon that never reached its release tick still arrives now, and a boss that changes form does it once the blows have landed.
        this.summon(p);
        this.startMorphs(p);
      }
      return;
    }
    // Hold the end of the action until a changing boss has finished its change.
    if (this.entrances.length > 0) return;
    this.playing = null;
    for (const e of p.script.after) {
      // A fighter who went down without an impact (a counter, a status) falls now.
      if (e.t === 'down') {
        const f = this.fighterOf(e.target);
        if (f && !f.down) this.startReaction(f, f.side === 'party' ? this.moves.reactions.downHero : this.moves.reactions.down, true, 0);
        applyEvent(this.flow.disp, e);
      }
    }
    this.flow.actionShown();
    this.flow.setPlaying(null);
  }

  // ---------------------------------------------------------------- summons and boss phases

  /** Show the enemies this action calls in (once): they appear in the slots the stage has for the bigger group, fading in under a violet glow. */
  private summon(p: Playing): void {
    if (p.summoned) return;
    p.summoned = true;
    for (const uids of p.script.summons) {
      const keys = uids.map((u) => this.flow.battle.unit(u)?.key ?? '').filter((k) => k !== '');
      const born = this.scene.addEnemies(keys);
      born.forEach((f, i) => {
        f.alpha = 0;
        this.scene.restyleFighter(f);
        this.entrances.push({ f, k: 0, kind: 'appear' });
        this.fx.glow(f.baseX, f.baseY - 14, UI.violet, f.depth + 100, true);
        this.log.push(`${f.name} joins the fight (${keys[i] ?? '?'})`);
      });
      this.flow.reveal(uids);
    }
    this.pushView(p);
  }

  /** Begin the change of form for each boss phase of the script (the Warden's shell breaks and the spirit steps out). */
  private startMorphs(p: Playing): void {
    for (const ph of p.script.phases) {
      const f = this.fighterOf(ph.target);
      if (!f) continue;
      this.entrances.push({ f, k: 0, kind: 'morph', to: ph.key, uid: ph.target });
      this.fx.shake(2, 10);
    }
  }

  /** One tick of every fighter fading in or changing form. */
  private stepEntrances(): void {
    const done: Entrance[] = [];
    for (const e of this.entrances) {
      const f = e.f;
      if (e.kind === 'appear') {
        // Opacity in quarter steps (pixel art stays crisp), a white wash that burns off over the first ticks.
        f.alpha = Math.min(1, Math.ceil((e.k / 10) * 4) / 4);
        f.flash = e.k < 8;
        f.flashAmt = Math.max(0.25, 1 - e.k / 8);
        if (e.k >= APPEAR_TICKS) {
          f.alpha = 1;
          f.flash = false;
          done.push(e);
        }
      } else {
        // First half: the shell whites out, ever brighter; at the middle the picture is swapped; second half: the new form burns in.
        const half = MORPH_TICKS / 2;
        f.flash = true;
        f.flashAmt = e.k < half ? Math.max(0.25, e.k / half) : Math.max(0.25, 1 - (e.k - half) / half);
        f.bodyDx = e.k % 2 === 0 ? 1 : -1;
        if (e.k === half && e.to) {
          this.scene.transformEnemy(f, e.to);
          if (e.uid !== undefined) this.flow.showForm(e.uid);
          this.fx.glow(f.baseX, f.baseY - 30, '#ffffff', f.depth + 100, true);
          this.log.push(`${f.name} changes form`);
          this.pushView();
        }
        if (e.k >= MORPH_TICKS) {
          f.flash = false;
          f.bodyDx = 0;
          done.push(e);
        }
      }
      e.k++;
      this.scene.restyleFighter(f);
    }
    for (const e of done) this.entrances.splice(this.entrances.indexOf(e), 1);
  }

  /** Put the actor in the pose and place of tick `k` of its move. */
  private poseActor(p: Playing, k: number): void {
    const move = p.move;
    const f = p.actor;
    if (!move || !f) return;
    const s = sampleMove(move, k);
    const still = s.still === IDLE_STILL ? null : (this.stills[s.still] ?? null);
    if (s.still !== IDLE_STILL && !still) throw new Error(`Move "${move.def.id}" shows "${s.still}", which was not built`);
    f.still = still;
    f.offX = s.offset[0] * p.facing;
    f.offY = s.offset[1];
    f.flash = s.flash;
    f.flashAmt = Math.max(0.25, s.flashAmt);
    f.alpha = s.alpha;
    f.x = Math.round(p.home.x + p.reach.dx * s.lunge.x);
    f.y = Math.round(p.home.y + p.reach.dz * s.lunge.z + p.clear * s.lunge.sw);
    // In contact (a `front` frame) the attacker borrows the target's row plus a pixel (the design's `lungeOverTarget`), so it
    // is drawn over the target. On the way it keeps its OWN row if that is nearer than the one it is crossing to, so a
    // lunge from the front row runs in front of the crewmates it passes and is not hidden behind them.
    f.sortY = s.front && p.primary ? p.primary.baseY + this.scene.config.sort.lungeOverTarget : Math.max(p.home.y, f.y);
    this.scene.restyleFighter(f);
    // The dotted ring at the spot it left.
    const away = Math.abs(f.x - f.baseX) + Math.abs(f.y - f.baseY) > 3;
    if (away) {
      f.home
        .setTexture(ringTexture(this.scene.textures, f.shadowW + (this.scene.config.shadow.activeRing?.extraW ?? 6), this.scene.config.shadow.activeRing?.color ?? '#3fe0f0', true))
        .setPosition(f.baseX, f.baseY + 1)
        .setDepth(partDepth(f.depth, 'ring'))
        .setVisible(true);
    } else f.home.setVisible(false);
  }

  private finishActor(p: Playing): void {
    const f = p.actor;
    if (!f) return;
    f.still = null;
    f.offX = 0;
    f.offY = 0;
    f.flash = false;
    f.alpha = 1;
    f.x = f.baseX;
    f.y = f.baseY;
    f.sortY = f.baseY;
    f.home.setVisible(false);
    this.scene.restyleFighter(f);
  }

  // ---------------------------------------------------------------- landing a hit

  /**
   * The point a blow lands on target `t`. For the target of a lunge it is WHERE THE WEAPON IS: the attacker's position plus
   * the hit event's `contact` (measured on the drawn frame), kept inside the target's drawn height so a fist swung higher
   * than a rat is a hit on its back. Otherwise (a second target, a spell, an idle-picture lunge) it is the target's near
   * edge at chest height, found from its pixels.
   */
  private contactPoint(p: Playing, ev: HitEvent | null, t: Fighter): { x: number; y: number } {
    const actor = p.actor;
    const def = p.move?.def;
    if (actor && def?.reach && t === p.primary) {
      const forward = ev?.contact ? ev.contact.dx : def.reach.forward === 'body' ? (p.facing > 0 ? actor.fig.box.x1 + 1 - actor.fig.foot.x : actor.fig.foot.x - actor.fig.box.x0) : def.reach.forward;
      const weaponY = ev?.contact ? actor.y + ev.contact.dy : t.baseY + this.chestDy(t);
      return { x: actor.x + p.facing * forward, y: contactY(weaponY, t.baseY, t.fig.box, t.fig.foot) };
    }
    const dy = this.chestDy(t);
    return { x: this.edgeAt(t, dy, p.facing) + p.facing * 3, y: t.baseY + dy };
  }

  /** The hit event (or a trailing wave) comes up: land its impacts. */
  private land(p: Playing, ev: HitEvent | null, waveIndex: number | undefined): void {
    const wave = waveIndex === undefined ? null : (p.script.waves[waveIndex] ?? null);
    const depthOf = (t: Fighter): number => Math.max(p.actor?.depth ?? 0, t.depth) + 100;
    const real = wave?.filter((i) => i.kind !== 'miss') ?? [];
    const weight = ev?.weight ?? 'light';
    const effect = ev?.effect ?? 'spark';
    // How hard the target whites out: the hit event's own strength, else a light hit is milder than a heavy one.
    const peak = ev?.flash ?? (weight === 'heavy' ? 1 : 0.6);
    if (ev && p.script.summons.length > 0) this.summon(p);

    if (wave) {
      let first = true;
      for (const imp of wave) {
        const t = this.fighterOf(imp.target);
        if (!t) continue;
        const at = first ? this.contactPoint(p, ev, t) : { x: t.baseX, y: t.baseY - Math.floor((t.fig.box.y1 - t.fig.box.y0 + 1) * 0.5) };
        this.landed.push({ target: t.id, x: at.x, y: at.y, clock: this.clock });
        if (this.landed.length > 60) this.landed.shift();
        this.impact(p, imp, t, at, ev, first ? effect : 'spark', weight, depthOf(t), peak);
        first = false;
      }
    } else if (p.primary || p.script.targets.length) {
      // A hit with no damage behind it (a combo's early blow, a buff's release): the picture without the number. A blow
      // that is only SEEN still shoves its target (the flinch), so the player counts three hits.
      const targets = effect === 'heal' ? p.script.targets.map((u) => this.fighterOf(u)).filter((f): f is Fighter => f !== null) : p.primary ? [p.primary] : [];
      for (const t of targets) {
        const at = this.contactPoint(p, ev, t);
        this.picture(p, effect, at, weight, depthOf(t), t);
        if (effect !== 'heal' && effect !== 'none' && t !== p.actor && !t.down) this.startReaction(t, this.moves.reactions.hurt, false, ev?.shake ? 1 : 0, peak);
      }
    }
    if (real.length > 0 || (!wave && ev)) {
      if (ev?.stop) {
        this.pause = Math.max(this.pause, ev.stop);
        this.pauseTotal = this.pause;
        // The first frozen picture is drawn now, not a tick late.
        for (const r of this.reactions) this.freezeLook(r);
      }
      if (ev?.shake) this.fx.shake(ev.shake, 6);
    }
    this.pushView(p);
  }

  /** The glow, the cut and the shards for one blow. */
  private picture(p: Playing, effect: HitEvent['effect'], at: { x: number; y: number }, weight: 'light' | 'heavy', depth: number, t: Fighter): void {
    const heavy = weight === 'heavy';
    const colour = effect === 'heal' ? UI.green : effect === 'blow' ? UI.cyan : '#ffffff';
    this.fx.glow(at.x, at.y, colour, depth, heavy);
    if (effect && effect !== 'heal' && effect !== 'none') {
      this.fx.blow(at.x, at.y, effect, p.facing, depth + 1, heavy);
      this.fx.shards(at.x, at.y, p.facing, heavy, (this.clock * 31 + t.uid * 17 + (t.side === 'enemy' ? 7 : 0)) >>> 0, depth + 2);
    }
  }

  /** One impact on one fighter. */
  private impact(p: Playing, imp: Impact, t: Fighter, at: { x: number; y: number }, ev: HitEvent | null, effect: HitEvent['effect'], weight: 'light' | 'heavy', depth: number, peak: number): void {
    const flow = this.flow;
    if (imp.kind === 'miss') {
      this.startReaction(t, this.moves.reactions.dodge, false, 0);
      this.number(t, 'MISS', UI.dim, null, UI.dim, 1);
      return;
    }
    // The displayed numbers catch up with the blow.
    const synthetic = imp.kind === 'heal' ? ({ t: 'heal', target: imp.target, amount: imp.amount, hp: imp.hp } as const) : imp.kind === 'tick' ? ({ t: 'tick', target: imp.target, amount: imp.amount, status: 'poison', hp: imp.hp } as const) : ({ t: 'damage', target: imp.target, amount: imp.amount, crit: imp.crit, element: imp.element, weak: imp.weak, resist: imp.resist, hp: imp.hp } as const);
    applyEvent(flow.disp, synthetic);
    if (imp.kind === 'heal') {
      this.picture(p, 'heal', at, 'light', depth, t);
      this.number(t, String(imp.amount), UI.green, imp.crit ? 'GREAT' : null, UI.green, 3);
      return;
    }
    this.picture(p, imp.kind === 'tick' ? 'spark' : effect, at, weight, depth, t);
    const shake = imp.kind === 'damage' ? (ev?.shake ?? 0) : 0;
    if (imp.down) {
      applyEvent(flow.disp, { t: 'down', target: imp.target });
      this.startReaction(t, t.side === 'party' ? this.moves.reactions.downHero : this.moves.reactions.down, true, shake, peak);
    } else this.startReaction(t, this.moves.reactions.hurt, false, shake, peak);
    // The number is tinted by the kind of hit (pale, amber for a critical, cyan for a weak spot), with the word over it in the same colour.
    const kind = hitKind(imp.crit, imp.weak);
    const label = kind === 'crit' ? 'CRIT' : kind === 'weak' ? 'WEAK' : null;
    // A critical or weak hit is a bigger number (4x) than an ordinary one (3x); the glyphs are 5 px tall at 1x.
    this.number(t, String(imp.amount), imp.kind === 'tick' ? UI.violet : HIT_COLOUR[kind], label, HIT_COLOUR[kind], imp.kind === 'tick' ? 2 : numberScale(kind));
    if (imp.kind === 'damage' && p.actor?.side === 'party') {
      this.comboHits++;
      this.comboTotal += imp.amount;
      this.comboLeft = COMBO_WINDOW;
      p.lastDamage = { dmg: imp.amount, crit: imp.crit };
    }
    this.log.push(`${t.name}: ${imp.kind} ${imp.amount}${imp.crit ? ' (crit)' : ''} -> ${imp.hp}${imp.down ? ' (down)' : ''}`);
  }

  /**
   * A floating number for a fighter, stacking above an earlier one that is still showing. A HERO's number floats over the hero's
   * head (where the player looks to see who was hurt); an ENEMY's rises from the point the blow landed, so a number on a tall boss
   * is next to the blade and not up by its head or off at its edge.
   */
  private number(t: Fighter, text: string, colour: string, label: string | null, labelColour: string, scale: number): void {
    const g = this.scene.figureGeo(t);
    const last = this.numbers.get(t.id);
    const stack = last && this.clock - last.at < 40 ? last.stack + 1 : 0;
    this.numbers.set(t.id, { at: this.clock, stack });
    const height = 7 * scale;
    // A hero's number floats over the hero's head. An enemy's stands above the head too, a little to the far side of its middle
    // (the blow lands lower, so the cut, the glow and the sparks stay clear of it); a target so tall that its head is under the
    // timeline and banner gets it on the shoulder line instead. A second hit stacks above the first.
    const aboveHead = g.top - height - (t.side === 'party' ? 8 : 6);
    const base = t.side === 'enemy' && aboveHead < NUMBER_FLOOR ? g.top + 10 : aboveHead;
    let nx = t.side === 'party' ? g.x : g.x + 10;
    let ny = base - stack * (height + 2);
    // Never over the timeline and banner at the top, nor off the sides, and never lower than the target's own feet.
    ny = Math.max(NUMBER_FLOOR, Math.min(g.y - 8, ny));
    nx = Math.max(16, Math.min(464, nx));
    this.fx.number(nx, ny, text, colour, label, scale, labelColour);
    this.numberLog.push({ target: t.id, text, x: nx, y: ny });
    if (this.numberLog.length > 60) this.numberLog.shift();
  }

  // ---------------------------------------------------------------- telling the HUD

  /** The combo counter as the HUD draws it, or null before the round's first party hit. */
  actView(p: Playing | null): ActView | null {
    // The counter is the PARTY's: it shows through the heroes' actions and goes away while an enemy acts.
    if (this.comboHits === 0 || (p && this.flow.slotOf(p.script.actor) >= 10)) return null;
    const target = p?.primary;
    return {
      attacker: p ? this.flow.slotOf(p.script.actor) : 0,
      target: target && target.side === 'enemy' ? this.scene.fighters.filter((f) => f.side === 'enemy').indexOf(target) : 0,
      skillName: p?.script.name ?? '',
      fx: 'cut',
      dmg: p?.lastDamage?.dmg ?? 0,
      crit: !!p?.lastDamage?.crit,
      hits: this.comboHits,
      total: this.comboTotal,
      liveNumbers: true,
      windowLeft: Math.max(0.05, Math.round((this.comboLeft / COMBO_WINDOW) * 8) / 8),
    };
  }

  /** Push the current state of the action to the flow and redraw the HUD. */
  pushView(p: Playing | null = this.playing): void {
    const target = p?.primary;
    this.flow.setPlaying(
      p
        ? {
            actor: this.flow.slotOf(p.script.actor),
            targetFoe: target && target.side === 'enemy' ? this.scene.fighters.filter((f) => f.side === 'enemy').indexOf(target) : null,
            banner: p.banner,
            act: this.actView(p),
          }
        : null,
    );
    this.scene.liveView = this.flow.view();
    this.scene.redrawLive();
  }
}
