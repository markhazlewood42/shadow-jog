/** The field: towns, interiors, dungeons and the world map. Hosts story scripts. */
import type { Dir } from '../art/chars';
import { sfx } from '../audio/sfx';
import { placeMusic } from '../audio/music';
import type { Ctx } from '../engine/canvas';
import { drawText, measure, wrap } from '../engine/font';
import { Scene, W, H } from '../engine/game';
import { Rng } from '../engine/rng';
import { Actor, DIRS, opposite } from '../field/actor';
import type { SortedSprite } from '../field/bake';
import { FieldMap } from '../field/fieldmap';
import { Lighting } from '../field/lighting';
import { TS } from '../field/tiles';
import type { ChestDef, EventDef, MapDef, WarpDef } from '../field/types';
import { Weather } from '../field/weather';
import type { ScriptApi, ScriptFn } from '../game/script';
import { flags, state } from '../game/state';
import { LOOKS } from '../data/looks';
import { getMap } from '../data/maps';
import { chestHalo, chestSprites } from '../field/chests';
import { bandGradient, UI } from '../ui/draw';
import { FIELD_OBJ_W } from '../ui/layout';
import { fieldHooks } from '../game/hooks';
import { reportError } from '../engine/errors';
import { scriptApi } from './fieldkit/api';
import { blit, byBaseY, drawEmote, drawShell, inView, type DrawEntry } from './fieldkit/draw';
import { Dust } from './fieldkit/dust';

const WALK = 12;
const DASH = 7;
/** Ground that throws up dust under a dashing foot. */
const SOFT_GROUND = new Set(['dirt', 'w_barrens', 'rubble', 'sand', 'grass', 'w_park']);
const mapCache = new Map<string, FieldMap>();
const MAP_CACHE_MAX = 8;

function loadMap(id: string): FieldMap {
  const def = getMap(id);
  // Everything that bakes differently by story flag is part of the key.
  const bits = (xs: { when?: ((f: Record<string, unknown>) => boolean) | undefined }[]) => xs.map((x) => (!x.when || x.when(state.flags) ? 1 : 0)).join('');
  const sig = `${id}:${bits(def.patches ?? [])}:${bits(def.props ?? [])}:${bits(def.lights ?? [])}`;
  let m = mapCache.get(sig);
  if (m) {
    // Refresh LRU position.
    mapCache.delete(sig);
    mapCache.set(sig, m);
    return m;
  }
  m = new FieldMap(def);
  mapCache.set(sig, m);
  while (mapCache.size > MAP_CACHE_MAX) mapCache.delete(mapCache.keys().next().value!);
  return m;
}

/** Drop a baked map (e.g. after a story change alters its layout). */
export function invalidateMap(id: string): void {
  mapCache.delete(id);
}

export interface Chest {
  def: ChestDef;
  open: boolean;
}

export class FieldScene extends Scene<void> {
  map!: FieldMap;
  def!: MapDef;
  party: Actor[] = [];
  npcs: Actor[] = [];
  chests: Chest[] = [];
  trail: [number, number][] = [];
  camX = 0;
  camY = 0;
  camOverride: { x: number; y: number } | null = null;
  private lighting = new Lighting();
  private weather = new Weather();
  busy = 0;
  /**
   * What Confirm would reach from where the leader stands (an NPC, a closed chest, something to
   * examine), in world pixels, for the small marker over it; null when nothing is. Worked out every
   * few frames, and only while the field takes input.
   */
  private cue: { x: number; y: number } | null = null;
  private frame = 0;
  private lastBump = -99;
  private banner: { text: string; sub: string; t: number } | null = null;
  private rng = new Rng(4242);
  followersVisible = true;
  /** Steps since the last random battle. */
  stepsSinceBattle = 0;
  private pendingWarp = false;
  objectiveText = '';
  private objKey = '';
  private objLines: string[] = [];
  private objW = 0;
  private objFlash = 0;

  constructor(mapId: string, x: number, y: number, dir: Dir = 'down') {
    super();
    this.load(mapId, x, y, dir);
  }

  get leader(): Actor {
    return this.party[0]!;
  }

  // ------------------------------------------------------------------ loading
  load(mapId: string, x: number, y: number, dir: Dir): void {
    this.map = loadMap(mapId);
    this.def = this.map.def;
    state.map = mapId;
    if (this.def.kind !== 'interior') state.flags[`visit:${mapId}`] = true;
    state.x = x;
    state.y = y;
    state.dir = dir;
    if (this.def.town) state.lastTown = { map: mapId, x, y };
    if (this.def.entrance) state.lastEntrance = { ...this.def.entrance };
    this.lighting.ambient = this.def.ambient;
    this.weather.set(this.def.weather ?? 'none');
    this.buildParty(x, y, dir);
    this.buildNpcs();
    this.chests = (this.def.chests ?? []).filter((c) => !c.when || c.when(state.flags)).map((c) => ({ def: c, open: flags.has(`chest:${mapId}:${c.id}`) }));
    for (const c of this.chests) this.map.solid[c.def.y * this.map.w + c.def.x] = 1;
    this.snapCamera();
    this.stepsSinceBattle = 0;
  }

  private buildParty(x: number, y: number, dir: Dir): void {
    const ids = state.party.length ? state.party : ['kit'];
    this.party = ids.map((id, i) => {
      const a = new Actor(id, LOOKS[id as keyof typeof LOOKS], x, y, dir);
      a.follower = i > 0;
      return a;
    });
    this.trail = ids.map(() => [x, y] as [number, number]);
  }

  refreshParty(): void {
    const l = this.leader;
    this.buildParty(l.x, l.y, l.dir);
  }

  private buildNpcs(): void {
    this.npcs = [];
    for (const n of this.def.npcs ?? []) {
      if (n.when && !n.when(state.flags)) continue;
      const a = new Actor(n.id, n.look, n.x, n.y, n.dir ?? 'down');
      if (n.critter) a.useCritter(n.critter);
      a.npc = n;
      a.idle = this.rng.int(30, 120);
      this.npcs.push(a);
    }
  }

  override enter(): void {
    this.game.countPlayTime = true;
    if (this.def.music) placeMusic(this.def.music, this.def.space);
    void this.onMapEnter();
  }

  private async onMapEnter(): Promise<void> {
    if (this.def.banner) this.showBanner(this.def.banner, this.def.bannerSub ?? '');
    if (this.def.onEnter) await this.runScript(this.def.onEnter);
    fieldHooks.onEnterMap?.(this);
  }

  showBanner(text: string, sub = ''): void {
    this.banner = { text, sub, t: 0 };
  }

  // ------------------------------------------------------------------ queries
  actorAt(x: number, y: number, except?: Actor): Actor | null {
    for (const a of this.npcs) if (a !== except && a.visible && a.solid && a.x === x && a.y === y) return a;
    return null;
  }

  find(id: string): Actor | null {
    if (id === 'player') return this.leader;
    return this.party.find((a) => a.id === id) ?? this.npcs.find((a) => a.id === id) ?? null;
  }

  canEnter(x: number, y: number, mover: Actor): boolean {
    if (this.map.isSolid(x, y)) {
      // Door tiles are walkable only if a warp is there.
      return false;
    }
    if (this.actorAt(x, y, mover)) return false;
    if (mover !== this.leader && !mover.follower) {
      for (const p of this.party) if (p.x === x && p.y === y && (this.followersVisible || p === this.leader)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ update
  update(): void {
    this.frame++;
    const prevCamX = this.camX, prevCamY = this.camY;
    // Actors
    let leaderArrived = false;
    for (const p of this.party) {
      const scripted = p.path.length > 0 || p.onPathDone !== null;
      const done = p.update();
      if (p === this.leader && done && !scripted) leaderArrived = true;
      if (!p.moving && p.path.length) this.advancePath(p);
    }
    for (const n of this.npcs) {
      const done = n.update();
      if (done || !n.moving) this.npcTick(n);
    }
    if (this.banner) {
      this.banner.t++;
      if (this.banner.t > 200) this.banner = null;
    }
    if (leaderArrived) this.onLeaderArrive();
    if (!this.busy && !this.pendingWarp) this.handleInput();
    if (this.frame % 4 === 0) this.cue = !this.busy && !this.pendingWarp && !this.leader.moving ? this.interactTarget() : null;
    else if (this.busy || this.leader.moving) this.cue = null;
    this.updateCamera();
    this.weather.update(this.camX - prevCamX, this.camY - prevCamY);
  }

  private handleInput(): void {
    const inp = this.game.input;
    const l = this.leader;
    if (l.moving) {
      // Let go mid-step and the crew eases to a stop rather than halting on the tile line.
      if (!inp.dir()) for (const a of this.party) a.settle();
      return;
    }
    const d = inp.dir();
    if (d) {
      // Walking into a wall thuds once per press (and slowly while held), never every frame.
      if (!this.tryStep(d, inp.down('dash') ? DASH : WALK) && (inp.pressed(d) || this.frame - this.lastBump > 24)) {
        this.lastBump = this.frame;
        sfx('bump');
      }
      return;
    }
    if (inp.pressed('confirm')) {
      void this.interact();
      return;
    }
    if (inp.pressed('cancel') || inp.pressed('menu')) {
      fieldHooks.openMenu?.(this);
    }
  }

  tryStep(d: Dir, dur: number): boolean {
    const l = this.leader;
    const [dx, dy] = DIRS[d];
    const nx = l.x + dx, ny = l.y + dy;
    l.dir = d;
    if (!this.canEnter(nx, ny, l)) {
      if (this.warpAt(nx, ny)) {
        // Door on a solid facade tile: allow walking into it.
      } else return false;
    }
    const from: [number, number] = [l.x, l.y];
    l.step(d, dur);
    this.trail.unshift(from);
    this.trail.length = Math.max(this.party.length, 1);
    for (let i = 1; i < this.party.length; i++) {
      const f = this.party[i]!;
      const [tx, ty] = this.trail[i - 1]!;
      f.stepTo(tx, ty, dur);
    }
    return true;
  }

  /** Footstep for the tile the leader just reached: surface decides the sound, feet alternate pitch. */
  private footstep(x: number, y: number): void {
    const t = this.map.at(x, y);
    const kind = t === 'd_catwalk' || t === 'grate' || t === 'floor_metal' || t === 'bridge' || t === 'w_bridge' ? 'step_metal'
      : t === 'd_shallow' || t === 'puddle' ? 'step_water'
      : t === 'grass' || t === 'w_park' || t === 'dirt' || t === 'w_barrens' || t === 'floor_carpet' ? 'step_soft'
      : 'step';
    sfx(kind, state.steps % 2 ? 1 : 0.86);
  }

  private onLeaderArrive(): void {
    const l = this.leader;
    const dashing = this.game.input.down('dash');
    const soft = SOFT_GROUND.has(this.map.at(l.x, l.y));
    if (this.lastStepDash && !this.game.input.dir()) this.dust.kick(l.px, l.py, 6, true);
    else if (dashing && soft) this.dust.kick(l.px, l.py, 2, false);
    this.lastStepDash = dashing;
    state.x = l.x;
    state.y = l.y;
    state.dir = l.dir;
    state.steps++;
    this.footstep(l.x, l.y);
    // Warps
    const warp = this.warpAt(l.x, l.y);
    if (warp) {
      void this.doWarp(warp);
      return;
    }
    // Touch events
    const ev = this.eventAt(l.x, l.y, 'touch');
    if (ev) {
      void this.fireEvent(ev);
      return;
    }
    // Continuous walking: start the next step this same tick so no stand frame flashes.
    if (!this.busy) {
      if (fieldHooks.onStep?.(this)) return;
      const d = this.game.input.dir();
      if (d) this.tryStep(d, this.game.input.down('dash') ? DASH : WALK);
    }
  }

  warpAt(x: number, y: number): WarpDef | null {
    for (const w of this.def.warps ?? []) {
      if (x >= w.x && x < w.x + (w.w ?? 1) && y >= w.y && y < w.y + (w.h ?? 1)) return w;
    }
    return null;
  }

  private eventAt(x: number, y: number, on: 'touch' | 'action'): EventDef | null {
    for (const e of this.def.events ?? []) {
      if (e.on !== on) continue;
      if (e.once && flags.has(`ev:${this.def.id}:${e.id}`)) continue;
      if (e.when && !e.when(state.flags)) continue;
      if (x >= e.x && x < e.x + (e.w ?? 1) && y >= e.y && y < e.y + (e.h ?? 1)) return e;
    }
    return null;
  }

  private async fireEvent(e: EventDef): Promise<void> {
    const key = `ev:${this.def.id}:${e.id}`;
    // Marked done as it starts (a scripted walk over its own tile mustn't fire it again), and
    // unmarked if it throws partway: a story beat that aborted can be walked into again, rather
    // than leaving the chapter unfinishable (round 13's stability review).
    if (e.once) flags.set(key);
    if (!(await this.runScript(e.run)) && e.once) flags.clear(key);
  }

  async doWarp(w: WarpDef): Promise<void> {
    if (w.when && !w.when(state.flags)) {
      if (w.blocked) {
        await this.runScript(w.blocked);
        await this.stepBack();
      }
      return;
    }
    if (w.confirm) {
      let go = false;
      await this.runScript(async (s) => {
        go = (await s.ask(null, w.confirm!, ['Go', 'Not yet'], { cancel: 1 })) === 0;
      });
      if (!go) {
        await this.stepBack();
        return;
      }
    }
    this.pendingWarp = true;
    try {
      if (w.door !== false) sfx('door');
      await this.warp(w.to, w.tx, w.ty, w.dir ?? this.leader.dir);
    } finally {
      this.pendingWarp = false;
    }
  }

  /** Step back off a warp tile the crew didn't take. */
  private async stepBack(): Promise<void> {
    const back = opposite(this.leader.dir);
    this.busy++;
    try {
      this.tryStep(back, WALK);
      await this.waitIdle();
    } finally {
      this.busy--;
    }
  }

  async warp(mapId: string, x: number, y: number, dir: Dir, fade = true): Promise<void> {
    this.busy++;
    try {
      if (fade) await this.game.fadeOut(14);
      const prevMusic = this.def.music;
      this.load(mapId, x, y, dir);
      if (this.def.music && (this.def.music !== prevMusic || this.def.space)) placeMusic(this.def.music, this.def.space);
      fieldHooks.onWarp?.(this);
    } catch (e) {
      reportError(e);
    } finally {
      if (fade) await this.game.fadeIn(14);
      this.busy--;
    }
    await this.onMapEnter();
  }

  private waitIdle(): Promise<void> {
    return new Promise((res) => {
      const check = () => {
        if (!this.party.some((p) => p.moving)) res();
        else void this.game.wait(1).then(check);
      };
      check();
    });
  }

  // ------------------------------------------------------------------ interaction
  /**
   * Where the marker goes for what interact() would reach, without doing it (the same order: an
   * NPC, across a counter too; a chest; an action event). Added after Mark's first playthrough
   * (2026-09-29: interactive things "blend into the background").
   */
  private interactTarget(): { x: number; y: number } | null {
    const l = this.leader;
    const [dx, dy] = DIRS[l.dir];
    const ax = l.x + dx, ay = l.y + dy;
    let npc = this.actorAt(ax, ay);
    if (!npc && this.counterAt(ax, ay)) npc = this.actorAt(ax + dx, ay + dy);
    if (npc?.npc) return { x: npc.px, y: npc.drawY() - 3 };
    for (const c of this.chests) if (!c.open && c.def.x === ax && c.def.y === ay) return { x: ax * TS + 8, y: ay * TS - 1 };
    const ev = this.eventAt(ax, ay, 'action');
    if (ev) return { x: ax * TS + 8, y: ay * TS - 2 };
    return null;
  }

  /** Is there a counter (bar, table, stall) on this tile, to talk across? */
  private counterAt(x: number, y: number): boolean {
    for (const p of this.def.props ?? []) {
      if ((p.kind === 'counter' || p.kind === 'bar' || p.kind === 'table' || p.kind === 'stall') && x >= p.x && x < p.x + (p.w ?? 1) && y === p.y) return true;
    }
    return false;
  }

  /** The interact marker: a small bobbing chevron in the menu cursor's cyan, outlined dark. */
  private drawCue(ctx: Ctx, x: number, y: number, f: number): void {
    const b = Math.round(Math.sin(f * 0.15) * 1.5);
    const top = Math.round(y - 5 + b), left = Math.round(x) - 3;
    ctx.fillStyle = '#0a0913';
    ctx.fillRect(left - 1, top - 1, 9, 2);
    for (let i = 0; i < 4; i++) ctx.fillRect(left - 1 + i, top + i, 9 - i * 2, 2);
    ctx.fillStyle = UI.cyan;
    for (let i = 0; i < 4; i++) ctx.fillRect(left + i, top + i, 7 - i * 2, 1);
  }

  private async interact(): Promise<void> {
    const l = this.leader;
    const [dx, dy] = DIRS[l.dir];
    let tx = l.x + dx, ty = l.y + dy;
    // Talk across counters.
    const counterAhead = (this.def.props ?? []).some(
      (p) => (p.kind === 'counter' || p.kind === 'bar' || p.kind === 'table' || p.kind === 'stall') && tx >= p.x && tx < p.x + (p.w ?? 1) && ty === p.y,
    );
    let npc = this.actorAt(tx, ty);
    if (!npc && counterAhead) {
      tx += dx;
      ty += dy;
      npc = this.actorAt(tx, ty);
    }
    if (npc?.npc) {
      await this.talkTo(npc);
      return;
    }
    const chest = this.chests.find((c) => c.def.x === l.x + dx && c.def.y === l.y + dy);
    if (chest) {
      await this.openChest(chest);
      return;
    }
    const ev = this.eventAt(l.x + dx, l.y + dy, 'action') ?? this.eventAt(tx, ty, 'action');
    if (ev) await this.fireEvent(ev);
  }

  private async talkTo(npc: Actor): Promise<void> {
    const def = npc.npc!;
    if (!def.fixedDir) npc.dir = opposite(this.leader.dir);
    const t = def.talk;
    if (!t) return;
    if (typeof t === 'function') await this.runScript(t);
    else
      await this.runScript(async (s) => {
        for (const line of t) await s.say(def.name ?? null, line);
      });
    if (!def.fixedDir && def.dir) npc.dir = def.dir;
  }

  private async openChest(c: Chest): Promise<void> {
    if (c.open) {
      await this.runScript(async (s) => s.narrate('{d}It’s empty.{/}'));
      return;
    }
    c.open = true;
    flags.set(`chest:${this.def.id}:${c.def.id}`);
    sfx('chest');
    await this.runScript(async (s) => {
      if (c.def.cred) await s.cred(c.def.cred);
      if (c.def.item) await s.give(c.def.item, c.def.qty ?? 1);
    });
  }

  private npcTick(n: Actor): void {
    const def = n.npc;
    if (!def || this.busy || n.path.length) {
      if (n.path.length && !n.moving) this.advancePath(n);
      return;
    }
    const mv = def.move ?? 'static';
    if (mv === 'static') return;
    if (--n.idle > 0) return;
    n.idle = this.rng.int(40, 160);
    if (mv === 'wander') {
      const d = this.rng.pick(['up', 'down', 'left', 'right'] as const);
      const [dx, dy] = DIRS[d];
      const nx = n.x + dx, ny = n.y + dy;
      const r = def.radius ?? 2;
      if (Math.abs(nx - n.home[0]) > r || Math.abs(ny - n.home[1]) > r) {
        n.dir = d;
        return;
      }
      if (this.canEnter(nx, ny, n) && !this.warpAt(nx, ny)) n.step(d, 18);
      else n.dir = d;
    }
  }

  advancePath(a: Actor): void {
    const d = a.path.shift()!;
    // Scripted moves ignore collision so cutscenes can't deadlock.
    a.dir = d;
    if (a === this.leader) {
      const from: [number, number] = [a.x, a.y];
      a.step(d, a.pathSpeed);
      this.trail.unshift(from);
      this.trail.length = Math.max(this.party.length, 1);
      for (let i = 1; i < this.party.length; i++) {
        const f = this.party[i]!;
        if (!f.follower) continue;
        const [tx, ty] = this.trail[i - 1]!;
        f.stepTo(tx, ty, a.pathSpeed);
      }
    } else a.step(d, a.pathSpeed);
    if (!a.path.length) {
      const cb = a.onPathDone;
      a.onPathDone = null;
      // Resolve after the final step finishes.
      if (cb) {
        const wait = () => (a.moving ? void this.game.wait(1).then(wait) : cb());
        wait();
      }
    }
  }

  // ------------------------------------------------------------------ scripts
  /** Run a story script with the field locked; false if it threw (reported, not rethrown). */
  async runScript(fn: ScriptFn): Promise<boolean> {
    this.busy++;
    try {
      await fn(this.api);
      return true;
    } catch (e) {
      reportError(e);
      return false;
    } finally {
      this.busy--;
    }
  }

  // ------------------------------------------------------------------ camera
  targetCam(): { x: number; y: number } {
    const mw = this.map.w * TS, mh = this.map.h * TS;
    const fx = this.camOverride?.x ?? this.leader.px;
    const fy = this.camOverride?.y ?? this.leader.py - 8;
    let x = Math.round(fx - W / 2);
    let y = Math.round(fy - H / 2);
    x = mw <= W ? Math.round((mw - W) / 2) : Math.max(0, Math.min(mw - W, x));
    y = mh <= H ? Math.round((mh - H) / 2) : Math.max(0, Math.min(mh - H, y));
    return { x, y };
  }

  snapCamera(): void {
    const t = this.targetCam();
    this.camX = t.x;
    this.camY = t.y;
  }

  panTarget: { x: number; y: number; frames: number; t: number; sx: number; sy: number; res: () => void } | null = null;

  private updateCamera(): void {
    if (this.panTarget) {
      const p = this.panTarget;
      p.t++;
      const k = Math.min(1, p.t / p.frames);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.camX = Math.round(p.sx + (p.x - p.sx) * e);
      this.camY = Math.round(p.sy + (p.y - p.sy) * e);
      if (k >= 1) {
        this.panTarget = null;
        p.res();
      }
      return;
    }
    const t = this.targetCam();
    this.camX = t.x;
    this.camY = t.y;
  }

  // ------------------------------------------------------------------ render
  render(ctx: Ctx): void {
    // Shake moves the camera (the world); the banner and objective are drawn in screen space.
    const cx = this.camX - this.game.shakeX, cy = this.camY - this.game.shakeY;
    const f = this.frame;
    ctx.fillStyle = this.def.voidColor ?? '#07060d';
    ctx.fillRect(0, 0, W, H);
    if (this.def.kind === 'interior') drawShell(ctx, this.map.w * TS, this.map.h * TS, cx, cy);
    this.lighting.build(this.map.lights, cx, cy, f);
    blit(ctx, this.map.ground, cx, cy);
    for (const a of this.map.anims) if (a.lit && inView(a, cx, cy)) a.draw(ctx, f, cx, cy);
    // Soft contact shadows
    const actors = this.visibleActors();
    ctx.fillStyle = 'rgba(5,4,12,0.5)';
    for (const a of actors) {
      const sx = Math.round(a.px - cx), sy = Math.round(a.py - cy);
      ctx.fillRect(sx - 4, sy - 1, 9, 2);
      ctx.fillRect(sx - 3, sy - 2, 7, 1);
      ctx.fillRect(sx - 3, sy + 1, 7, 1);
    }
    this.lighting.apply(ctx);
    blit(ctx, this.map.emit, cx, cy);
    for (const a of this.map.anims) if (!a.lit && inView(a, cx, cy)) a.draw(ctx, f, cx, cy);

    // Depth-sorted sprites (pooled entries; no per-frame closures or objects).
    let n = 0;
    for (const s of this.map.sprites) {
      if (s.x - cx > W || s.y - cy > H || s.x + s.canvas.width - cx < 0 || s.y + s.canvas.height - cy < 0) continue;
      n = this.pushDraw(n, s.baseY, 0, s);
    }
    for (const c of this.chests) n = this.pushDraw(n, (c.def.y + 1) * TS - 1, 1, c);
    for (const a of actors) n = this.pushDraw(n, a.py, 2, a);
    const list = this.drawList;
    list.length = n;
    for (let i = 0; i < n; i++) list[i] = this.drawPool[i]!;
    list.sort(byBaseY);
    for (const it of list) {
      if (it.kind === 0) this.drawSprite(ctx, it.ref as SortedSprite, cx, cy, f);
      else if (it.kind === 1) {
        const c = it.ref as Chest;
        const spr = chestSprites(c.def.kind ?? 'crate');
        const img = c.open ? spr.open : spr.closed;
        const x = c.def.x * TS - cx, y = (c.def.y + 1) * TS - img.height - cy;
        if (!c.open) {
          // A closed chest breathes a soft halo in its trim colour, whatever the room's light.
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(f * 0.06 + c.def.x * 1.7);
          ctx.drawImage(chestHalo(spr.trim), x - 12, y - 4);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        this.lighting.drawLit(ctx, img, x, y);
        if (!c.open) {
          // Its trim and lock lit (unlit by the room), and now and then a glint across the lid.
          ctx.drawImage(spr.glow, x, y);
          const g = (f + c.def.x * 37 + c.def.y * 53) % 160;
          if (g < 10) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x + 2 + g, y + 6, 1, 1);
            if (g > 2 && g < 8) {
              ctx.fillRect(x + 2 + g, y + 5, 1, 3);
              ctx.fillRect(x + 1 + g, y + 6, 3, 1);
            }
          }
        }
      } else {
        const a = it.ref as Actor;
        this.lighting.drawLit(ctx, a.frame(), a.drawX() - cx, a.drawY() - cy);
      }
    }

    if (this.map.hasOver) {
      this.lighting.drawLitLayer(ctx, this.map.over, cx, cy);
      blit(ctx, this.map.overEmit, cx, cy);
    }
    this.lighting.bloom(ctx, this.map.lights, cx, cy, f, this.def.kind === 'interior' ? 0.08 : 0.14);
    this.dust.render(ctx, cx, cy);
    this.weather.render(ctx);
    for (const a of actors) if (a.emote) drawEmote(ctx, a, cx, cy);
    if (this.cue) this.drawCue(ctx, this.cue.x - cx, this.cue.y - cy, f);
    this.renderBanner(ctx);
    this.renderObjective(ctx);
    fieldHooks.renderOverlay?.(this, ctx);
  }

  /**
   * The current objective, always on screen in the top-left corner (dimmer while walking,
   * hidden during cutscenes and dialogue); it flashes amber for a moment when it changes.
   */
  private renderObjective(ctx: Ctx): void {
    const text = this.objective;
    if (!text || this.busy || this.def.kind === 'interior') return;
    if (text !== this.objKey) {
      this.objFlash = this.objKey ? 150 : 0;
      this.objKey = text;
      this.objLines = wrap(text, FIELD_OBJ_W);
      this.objW = Math.max(...this.objLines.map(measure)) + 16;
    }
    if (this.objFlash > 0) this.objFlash--;
    const flash = this.objFlash > 0 && Math.floor(this.objFlash / 10) % 2 === 0;
    ctx.globalAlpha = this.leader.moving ? 0.55 : 0.9;
    ctx.fillStyle = 'rgba(10,9,19,0.78)';
    ctx.fillRect(4, 4, this.objW, 4 + this.objLines.length * 10);
    ctx.fillStyle = flash ? '#ffcc3d' : '#6a5a2a';
    ctx.fillRect(4, 4, 2, 4 + this.objLines.length * 10);
    for (let i = 0; i < this.objLines.length; i++) drawText(ctx, (i === 0 ? '{y}▶{/} ' : '   ') + this.objLines[i], 9, 6 + i * 10, { color: flash ? '#ffe7a0' : '#d8d6ec', shadow: false });
    ctx.globalAlpha = 1;
  }

  private drawSprite(ctx: Ctx, s: SortedSprite, cx: number, cy: number, f: number): void {
    const sx = s.x - cx, sy = s.y - cy;
    this.lighting.drawLit(ctx, s.canvas, sx, sy);
    if (s.emit) ctx.drawImage(s.emit, sx, sy);
    s.anim?.(ctx, f, sx, sy);
  }

  /** Dust kicked up by dashing and by stopping out of a dash. */
  private dust = new Dust();

  private lastStepDash = false;
  private visibleBuf: Actor[] = [];
  private drawPool: DrawEntry[] = [];
  private bannerGrad: { x: number; g: CanvasGradient } | null = null;

  /** Fill (or reuse) draw-list slot `n`; returns the next free slot. */
  private pushDraw(n: number, baseY: number, kind: 0 | 1 | 2, ref: SortedSprite | Chest | Actor): number {
    const e = this.drawPool[n];
    if (!e) this.drawPool[n] = { baseY, kind, ref };
    else {
      e.baseY = baseY;
      e.kind = kind;
      e.ref = ref;
    }
    return n + 1;
  }
  private drawList: DrawEntry[] = [];

  /** Actors to draw this frame (reuses one buffer; call once per frame). */
  private visibleActors(): Actor[] {
    const out = this.visibleBuf;
    out.length = 0;
    for (const n of this.npcs) if (n.visible) out.push(n);
    for (let i = 0; i < this.party.length; i++) {
      const p = this.party[i]!;
      if (!p.visible) continue;
      if (i > 0 && p.follower && !this.followersVisible) continue;
      // Stacked followers (after a warp) hide behind the leader.
      if (i > 0 && p.follower && p.x === this.leader.x && p.y === this.leader.y && !p.moving) continue;
      out.push(p);
    }
    return out;
  }

  private renderBanner(ctx: Ctx): void {
    if (!this.banner) return;
    const t = this.banner.t;
    const a = t < 20 ? t / 20 : t > 170 ? Math.max(0, (200 - t) / 30) : 1;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    const text = this.banner.text;
    const w = measure(text) + 40;
    const x = Math.round((W - w) / 2), y = 18;
    // One gradient per banner (its width is fixed while it shows), not one per frame.
    if (this.bannerGrad?.x !== x) this.bannerGrad = { x, g: bandGradient(ctx, x, w, 0.2, 0.85) };
    ctx.fillStyle = this.bannerGrad.g;
    ctx.fillRect(x, y, w, 26);
    ctx.fillStyle = UI.pink;
    const lw = Math.min(w - 40, Math.round((t / 30) * (w - 40)));
    ctx.fillRect(Math.round(W / 2 - lw / 2), y + 13, lw, 1);
    drawText(ctx, text, W / 2, y + 3, { align: 'center', color: '#ffffff' });
    if (this.banner.sub) drawText(ctx, this.banner.sub, W / 2, y + 16, { align: 'center', color: UI.dim });
    ctx.restore();
  }

  // ------------------------------------------------------------------ script API
  /** What story scripts can do on this field (fieldkit/api.ts). */
  readonly api: ScriptApi = scriptApi(this);

  get objective(): string {
    return (flags.get('objective') as string) ?? this.objectiveText;
  }
}
