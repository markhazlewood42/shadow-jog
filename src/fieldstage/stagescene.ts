/**
 * The field as a scene of the Shadow Jog Engine (M5 task 5; docs/engine/m5-brief.md). `FieldStageScene` draws the field with engine objects instead of one Canvas 2D:
 *
 *   the map's 4 baked layers (ground, emit, over, overEmit)       ->  4 `ImageObject`s from the baked canvases (adopted as textures, not copied)
 *   props (`SortedSprite`), chests, actors                        ->  one `Container` with `ySort` on: each is a small container with its lit picture, its emissive half and its animation
 *   the surround behind a small map                               ->  a pinned `CanvasImage`, painted by the old painter only when it changes
 *   the animations (`AnimFx`)                                     ->  two pinned `CanvasImage`s (lit: before the light map; unlit: after)
 *   the light map and the haze                                    ->  `LightRig`: `Lights` painting a pinned `CanvasImage`, shown with a multiply blend, and an additive one for the haze
 *   dust, weather, curtains, emotes, cue, banner, objective      ->  one pinned `CanvasImage`, painted by the field's own painters (`FieldStageSource.paintScreen`)
 *   the camera                                                    ->  `cameras.main.setScroll` to the field's camera (the field owns the camera RULE: `cameraOrigin`, the pan easing, the pop-in boxes)
 *
 * HOW IT FITS. The scene is a pure view. `fieldopen.ts` puts it on the scene stack UNDER the field scene (`Game.runBeneath`); the field makes itself non-opaque so the
 * stage shows, and keeps running all its rules. Each frame (`prerender`) the stage asks its source for the view (`FieldStageSource.view`), loads the map if it is not the
 * one it shows, and updates what it draws. Nothing in a tick: the field's tick is the only one that changes the world, so there is no copy of the field's state to drift.
 *
 * "Pinned" layers are screen-sized pictures that are moved to the camera each frame, so they stay on the screen while the world scrolls under them (the old field drew them
 * straight onto the screen). The layer order is the order of the old `FieldScene.render` (`params.ts` `LAYER`).
 *
 * The editor contract (principle 11; docs/engine/m5-brief.md section 5). No Pixi object leaves the scene. `loadMap` checks the map first (`checkStageMap`) and bad data
 * leaves the old map shown. `snapshot()` is plain JSON; `restore(snapshot())` shows the same world frame (the screen-fixed layer is the field's own state and is left out
 * while a snapshot is shown); `release()` goes back to the live view. What stays in code on purpose, because it is the form and not the tuning: the layer order, the sort
 * rule (`Container.ySort`), the lighting formula (`Lights`), the shadow shape.
 */
import { postfx } from '../engine/postfx';
import { blit, inView } from '../scenes/fieldkit/draw';
import { drawSurround, surroundFor, type SurroundView, voidShows } from '../scenes/fieldkit/surround';
import { chestHalo, chestSprites } from '../field/chests';
import type { Rect } from '../field/overrects';
import { TS } from '../field/tiles';
import type { FieldStage, FieldStageSource, FieldStageView, StageActor, StageChest, StageMap } from '../scenes/fieldkit/fieldseam';
import { CanvasImage, Container, type GameObject, Graphics, H, ImageObject, must, Scene, W } from '../sje';
import { LightRig } from './lightrig';
import { isBlank, LitPicture } from './lit';
import { ANIM_MARGIN, BLOOM, CHEST_GLINT, CHEST_HALO_AT, CHEST_PULSE, GLOW, LAYER, SHADOW } from './params';
import { checkStageMap } from './view';

/** A prop on the map. Its container exists from the map load, in the map's order (the sort breaks ties by that order); its pictures are made when it first comes into view. */
interface PropItem {
  readonly sprite: StageMap['sprites'][number];
  readonly root: Container;
  lit: LitPicture | null;
  emit: ImageObject | null;
  /** The sprite's emissive half has no pixel (so it is neither a texture nor fed to the glow layer). */
  emitBlank: boolean;
  anim: CanvasImage | null;
}

interface ChestItem {
  readonly def: StageChest;
  readonly root: Container;
  readonly lit: LitPicture;
  readonly halo: ImageObject;
  readonly glow: ImageObject;
  readonly glint: Graphics;
  glinting: boolean;
}

interface ActorItem {
  readonly root: Container;
  /** One lit picture for each picture size the actor shows (a critter's frames and a person's differ). Only the one in use is visible. */
  readonly lits: Map<number, LitPicture>;
}

interface OverItem {
  readonly rect: Rect;
  readonly src: HTMLCanvasElement;
  readonly pic: LitPicture;
}

/** The scene's state as plain JSON (`JSON.parse(JSON.stringify(s))` equals `s`). Pictures are numbered by the scene (see `snapshot`). */
export interface FieldStageSnapshot {
  version: 1;
  mapId: string;
  frame: number;
  camX: number;
  camY: number;
  cx: number;
  cy: number;
  actors: Array<{ ref: number; image: number; x: number; y: number; px: number; py: number }>;
  chests: StageChest[];
}

/** What `describe` returns (the DEV hook and the tests). */
export interface FieldStageDescription {
  mapId: string | null;
  frame: number;
  scroll: { x: number; y: number };
  props: { total: number; built: number; shown: number };
  chests: number;
  actors: number;
  overRects: number;
  lights: number;
  lightPaints: number;
  litPaints: number;
  surroundShown: boolean;
  screenShown: boolean;
  pinned: boolean;
  /** Map pictures held as textures. */
  textures: number;
}

let current: FieldStageScene | null = null;
/** The running stage (null when no field is staged): for the DEV hook and the tests. */
export function fieldStage(): FieldStageScene | null {
  return current;
}

/** The size of a picture as one number, to key a map of lit pictures. */
const sizeKey = (w: number, h: number): number => w * 65536 + h;

export class FieldStageScene extends Scene<void> implements FieldStage {
  private map: StageMap | null = null;
  /** Makes the texture keys of one map load different from the last one's. */
  private serial = 0;
  private keys: string[] = [];
  private ground: ImageObject | null = null;
  private emit: ImageObject | null = null;
  private overEmit: ImageObject | null = null;
  private overs: OverItem[] = [];
  private props: PropItem[] = [];
  private chestItems: ChestItem[] = [];
  private actorItems = new Map<object, ActorItem>();
  private actorOrder: object[] = [];
  private sort!: Container;
  private rig!: LightRig;
  private surround!: CanvasImage;
  private litAnims!: CanvasImage;
  private unlitAnims!: CanvasImage;
  private screen!: CanvasImage;
  private shadows!: Graphics;
  private readonly pinned: GameObject[] = [];
  private surroundKey = '';
  private litAnimsOn = false;
  private unlitAnimsOn = false;
  private frame = 0;
  private builtProps = 0;
  private shownProps = 0;
  private litPaints = 0;
  /** The view of the last frame, for `snapshot`. */
  private last: FieldStageView | null = null;
  /** While a snapshot is shown (`restore`): the view to draw instead of the source's. */
  private held: FieldStageView | null = null;
  private readonly surroundView: SurroundView = { id: '', ground: null as unknown as HTMLCanvasElement, mw: 0, mh: 0, cx: 0, cy: 0, camX: 0, camY: 0, frame: 0 };
  /** Pictures and actor objects get numbers when a snapshot first meets them, so a snapshot is plain JSON and `restore` can find them again. */
  private readonly interned = new Map<object, number>();
  private readonly byNumber = new Map<number, object>();

  constructor(private readonly source: FieldStageSource) {
    super();
  }

  override create(): void {
    current = this;
    const world = this.sys.world;
    this.sort = new Container(this, 0, 0, 'sort');
    this.sort.ySort = true;
    this.sort.setDepth(LAYER.SORT);
    world.add(this.sort);
    const pin = (depth: number): CanvasImage => {
      const img = this.add.canvasImage(0, 0, W, H).setDepth(depth);
      this.pinned.push(img);
      return img;
    };
    this.surround = pin(LAYER.SURROUND);
    this.litAnims = pin(LAYER.LIT_ANIMS);
    this.unlitAnims = pin(LAYER.UNLIT_ANIMS);
    this.screen = pin(LAYER.SCREEN);
    for (const img of [this.surround, this.litAnims, this.unlitAnims, this.screen]) img.visible = false;
    this.rig = new LightRig(this, (o) => {
      world.add(o);
      this.pinned.push(o);
    });
    this.shadows = this.add.graphics().setDepth(LAYER.SHADOWS);
    this.events.on('prerender', this.draw, this);
    this.events.once('shutdown', () => {
      if (current === this) current = null;
      this.releaseMap();
      this.map = null;
      this.last = null;
      this.held = null;
    });
  }

  /** The field's tick is the only one that changes the world; the stage keeps no clock of its own. */
  fixedUpdate(): void {}

  // ---------------------------------------------------------------- the editor contract

  /** The map on show (null before the first frame). */
  get mapId(): string | null {
    return this.map?.def.id ?? null;
  }

  /** Show this map. It is checked first (`checkStageMap`); bad data throws one readable message and the scene keeps the map it had. */
  loadMap(next: StageMap): void {
    const problems = checkStageMap(next);
    if (problems.length > 0) throw new Error(`The map "${next.def.id}" is not valid, so the stage keeps ${this.map ? `"${this.map.def.id}"` : 'no map'}:\n - ${problems.join('\n - ')}`);
    this.releaseMap();
    this.map = next;
    this.serial++;
    this.buildMap(next);
  }

  /** The state of the last frame as plain JSON. `restore` on this scene shows the same world frame. */
  snapshot(): FieldStageSnapshot {
    const v = must(this.last, 'a frame to take a snapshot of (the scene has not drawn yet)');
    return JSON.parse(
      JSON.stringify({
        version: 1,
        mapId: v.map.def.id,
        frame: v.frame,
        camX: v.camX,
        camY: v.camY,
        cx: v.cx,
        cy: v.cy,
        actors: v.actors.map((a) => ({ ref: this.intern(a.ref), image: this.intern(a.image), x: a.x, y: a.y, px: a.px, py: a.py })),
        chests: v.chests.map((c) => ({ tx: c.tx, ty: c.ty, kind: c.kind, open: c.open })),
      } satisfies FieldStageSnapshot),
    ) as FieldStageSnapshot;
  }

  /**
   * Show the state of a snapshot from this scene, on the map it was taken on (the scene must still show that map: another map needs the source to load it). Bad data
   * throws and changes nothing. The live view comes back with `release()`.
   */
  restore(s: FieldStageSnapshot): void {
    if (s.version !== 1) throw new Error(`Cannot restore a field snapshot of version ${String(s.version)} (this is version 1)`);
    const map = this.map;
    if (!map || map.def.id !== s.mapId) throw new Error(`The snapshot is of the map "${s.mapId}" but the stage shows ${map ? `"${map.def.id}"` : 'no map'}`);
    const actors: StageActor[] = s.actors.map((a) => {
      const ref = this.byNumber.get(a.ref);
      const image = this.byNumber.get(a.image);
      if (!ref || !image) throw new Error('The snapshot names an actor or a picture this scene has not seen');
      return { ref, image: image as HTMLCanvasElement, x: a.x, y: a.y, px: a.px, py: a.py };
    });
    this.held = { map, frame: s.frame, camX: s.camX, camY: s.camY, cx: s.cx, cy: s.cy, actors, chests: s.chests.map((c) => ({ ...c })) };
  }

  /** Go back to the live view after `restore`. */
  release(): void {
    this.held = null;
  }

  get isHeld(): boolean {
    return this.held !== null;
  }

  /** Counts for the DEV hook and the tests. */
  describe(): FieldStageDescription {
    return {
      mapId: this.mapId,
      frame: this.frame,
      scroll: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
      props: { total: this.props.length, built: this.builtProps, shown: this.shownProps },
      chests: this.chestItems.length,
      actors: this.actorOrder.length,
      overRects: this.overs.length,
      lights: this.rig.lights.count,
      lightPaints: this.rig.paints,
      litPaints: this.litPaints,
      surroundShown: this.surround.visible,
      screenShown: this.screen.visible,
      pinned: this.held !== null,
      textures: this.keys.length,
    };
  }

  /** The screen snapshot of a battle's intro: the field's old-look picture (the stage has no canvas to copy). */
  override paintSnapshot(ctx: CanvasRenderingContext2D): void {
    this.source.paintLegacy(ctx);
  }

  private intern(o: object): number {
    let n = this.interned.get(o);
    if (n === undefined) {
      n = this.interned.size + 1;
      this.interned.set(o, n);
      this.byNumber.set(n, o);
    }
    return n;
  }

  // ---------------------------------------------------------------- building a map

  /** Free what the map made: the layers, the props, the chests, the actors' views, and the textures (after the objects that show them). */
  private releaseMap(): void {
    for (const o of [this.ground, this.emit, this.overEmit]) o?.destroy();
    this.ground = null;
    this.emit = null;
    this.overEmit = null;
    for (const o of this.overs) o.pic.image.destroy();
    this.overs = [];
    // The container destroys its children: the props, the chests and the actors with their lit pictures. An actor's view that is not in the list now is not a child: free it too.
    for (const item of this.actorItems.values()) item.root.destroy();
    this.sort.removeAll(true);
    this.props = [];
    this.chestItems = [];
    this.actorItems.clear();
    this.actorOrder = [];
    this.builtProps = 0;
    for (const key of this.keys) this.textures.remove(key);
    this.keys = [];
    this.surroundKey = '';
    this.litAnimsOn = false;
    this.unlitAnimsOn = false;
  }

  private texture(name: string, canvas: HTMLCanvasElement): string {
    const key = `field-${this.serial}-${name}`;
    this.textures.addCanvas(key, canvas);
    this.keys.push(key);
    return key;
  }

  private layer(name: string, canvas: HTMLCanvasElement, depth: number): ImageObject {
    return this.add.image(0, 0, this.texture(name, canvas)).setOrigin(0, 0).setDepth(depth);
  }

  private buildMap(map: StageMap): void {
    this.ground = this.layer('ground', map.ground, LAYER.GROUND);
    this.emit = this.layer('emit', map.emit, LAYER.EMIT);
    if (map.hasOver) {
      this.overEmit = this.layer('overEmit', map.overEmit, LAYER.OVER_EMIT);
      this.overs = map.overRects.map((rect) => {
        // The part of the overhead layer, as its own picture: lit by itself, the way the old field lit each part (`drawLitLayer`).
        const src = document.createElement('canvas');
        src.width = rect.w;
        src.height = rect.h;
        const sctx = must(src.getContext('2d'), 'a 2D canvas context');
        sctx.drawImage(map.over, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const pic = new LitPicture(this, rect.w, rect.h);
        pic.image.setDepth(LAYER.OVER).setPosition(rect.x, rect.y);
        this.sys.world.add(pic.image);
        return { rect, src, pic };
      });
    }
    // The props, in the map's order and before any chest or actor: the sort breaks ties by the order the children were added, and the old draw list was filled in this order.
    this.props = map.sprites.map((sprite) => {
      const root = new Container(this, sprite.x, sprite.y, 'prop');
      root.setYSortOrigin(sprite.baseY - sprite.y);
      this.sort.add(root);
      return { sprite, root, lit: null, emit: null, emitBlank: false, anim: null };
    });
    this.rig.load(map);
  }

  private buildProp(item: PropItem): void {
    const s = item.sprite;
    const w = s.canvas.width;
    const h = s.canvas.height;
    item.lit = new LitPicture(this, w, h);
    item.root.add(item.lit.image);
    if (s.emit) {
      item.emitBlank = isBlank(s.emit);
      if (!item.emitBlank) {
        item.emit = new ImageObject(this, 0, 0, this.texture(`emit-${this.props.indexOf(item)}`, s.emit)).setOrigin(0, 0);
        item.root.add(item.emit);
      }
    }
    if (s.anim) {
      item.anim = new CanvasImage(this, -ANIM_MARGIN, -ANIM_MARGIN, w + 2 * ANIM_MARGIN, h + 2 * ANIM_MARGIN);
      item.root.add(item.anim);
    }
    this.builtProps++;
  }

  /** The chests and the actors, rebuilt when the list changes. They are added after the props and in this order, so a tie in the sort goes the way the old draw list did. */
  private syncSort(v: FieldStageView): void {
    const chestsSame = v.chests.length === this.chestItems.length && v.chests.every((c, i) => {
      const d = this.chestItems[i]?.def;
      return d !== undefined && d.tx === c.tx && d.ty === c.ty && d.kind === c.kind;
    });
    const actorsSame = v.actors.length === this.actorOrder.length && v.actors.every((a, i) => a.ref === this.actorOrder[i]);
    if (chestsSame && actorsSame) return;
    // Take the actors out first (their views stay), so the chests that follow are added before them.
    for (const item of this.actorItems.values()) if (item.root.parent) this.sort.remove(item.root);
    if (!chestsSame) {
      for (const c of this.chestItems) c.root.destroy();
      this.chestItems = v.chests.map((c) => this.makeChest(c));
    }
    this.actorOrder = v.actors.map((a) => a.ref);
    for (const a of v.actors) {
      let item = this.actorItems.get(a.ref);
      if (!item) {
        item = { root: new Container(this, a.x, a.y, 'actor'), lits: new Map() };
        this.actorItems.set(a.ref, item);
      }
      this.sort.add(item.root);
    }
  }

  private makeChest(def: StageChest): ChestItem {
    const art = chestSprites(def.kind);
    const y = (def.ty + 1) * TS - art.closed.height;
    const root = new Container(this, def.tx * TS, y, 'chest');
    root.setYSortOrigin((def.ty + 1) * TS - 1 - y);
    const haloKey = `field-halo-${art.trim}`;
    const haloTex = this.textures.addCanvasOnce(haloKey, () => chestHalo(art.trim));
    const glowKey = `field-chestglow-${def.kind}`;
    this.textures.addCanvasOnce(glowKey, () => art.glow);
    const halo = new ImageObject(this, CHEST_HALO_AT.x, CHEST_HALO_AT.y, haloTex.key).setOrigin(0, 0).setBlendMode('add');
    const lit = new LitPicture(this, art.closed.width, art.closed.height);
    const glow = new ImageObject(this, 0, 0, glowKey).setOrigin(0, 0);
    const glint = new Graphics(this);
    root.add([halo, lit.image, glow, glint]);
    this.sort.add(root);
    return { def: { ...def }, root, lit, halo, glow, glint, glinting: false };
  }

  // ---------------------------------------------------------------- one frame

  private draw(): void {
    try {
      this.drawFrame();
    } catch (e) {
      this.fail(e);
    }
  }

  /** A draw threw: the field takes back its own drawing (and says so), and this scene goes. It never throws out of the draw phase. */
  private fail(error: unknown): void {
    console.warn(`[field stage] a frame failed, so the field draws itself: ${error instanceof Error ? error.message : String(error)}`);
    try {
      this.source.stageFailed(error);
    } finally {
      this.close();
    }
  }

  private drawFrame(): void {
    const v = this.held ?? this.source.view();
    if (v.map !== this.map) this.loadMap(v.map);
    this.last = v;
    const map = v.map;
    // The ambient color is map data a tool or a script can change while the map is on: follow it.
    if (map.def.ambient !== this.rig.lights.ambientColor) this.rig.setAmbient(map.def.ambient);
    const { cx, cy, frame } = v;
    this.frame = frame;
    this.cameras.main.setScroll(cx, cy);
    const scrollX = this.cameras.main.scrollX;
    const scrollY = this.cameras.main.scrollY;
    for (const p of this.pinned) p.setPosition(scrollX, scrollY);
    const interior = map.def.kind === 'interior';
    const lights = this.rig.lights;
    const flickers = lights.hasFlicker;
    const mapCanvas = lights.enabled ? this.rig.mapCanvas : null;
    const boost = lights.spriteBoost;

    this.paintSurround(v);
    this.rig.paint(cx, cy, frame, interior ? BLOOM.interior : BLOOM.outdoors);
    this.litAnimsOn = this.paintAnims(this.litAnims, true, this.litAnimsOn, v);
    this.paintShadows(v);

    // GPU effects: the same light into the glow layer, so neon, lamps and lit windows bloom for real (the props add theirs below). Towns glow harder than rooms.
    const glow = postfx.glowLayer();
    if (glow) {
      postfx.bloom = interior ? GLOW.interior : GLOW.outdoors;
      blit(glow, map.emit, cx, cy);
    }
    this.unlitAnimsOn = this.paintAnims(this.unlitAnims, false, this.unlitAnimsOn, v);

    this.syncSort(v);
    this.drawProps(v, mapCanvas, boost, flickers, glow);
    this.drawChests(v, mapCanvas, boost, flickers);
    this.drawActors(v, mapCanvas, boost, flickers);
    this.drawOver(v, mapCanvas, flickers);

    // The screen-fixed layer is the field's own state (dust, rain, the banner): a snapshot shows the world only.
    if (this.held) this.screen.visible = false;
    else {
      const ctx = this.screen.ctx;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      const drew = this.source.paintScreen(ctx, cx, cy);
      ctx.restore();
      this.screen.visible = drew;
      if (drew) this.screen.refresh();
    }
  }

  /** What is behind a map smaller than the view, or the void behind a map's edge. Painted by the old painter only when what it depends on changed. */
  private paintSurround(v: FieldStageView): void {
    const map = v.map;
    const mw = map.w * TS;
    const mh = map.h * TS;
    const entry = surroundFor(map.def.id);
    const plain = !entry || (mw >= W && mh >= H);
    const shows = !plain || voidShows(v.cx, v.cy, mw, mh);
    this.surround.visible = shows;
    if (!shows) return;
    // The Dock's water is the one moving part of a surround: it also depends on the frame.
    const moving = entry?.option === 'b2' && entry.theme === 'dock';
    const key = `${map.def.id}|${v.cx}|${v.cy}|${v.camX}|${v.camY}|${moving ? v.frame : 0}`;
    if (key === this.surroundKey) return;
    this.surroundKey = key;
    const sv = this.surroundView;
    sv.id = map.def.id;
    sv.voidColor = map.def.voidColor;
    sv.ground = map.ground;
    sv.mw = mw;
    sv.mh = mh;
    sv.cx = v.cx;
    sv.cy = v.cy;
    sv.camX = v.camX;
    sv.camY = v.camY;
    sv.frame = v.frame;
    const ctx = this.surround.ctx;
    ctx.clearRect(0, 0, W, H);
    drawSurround(ctx, sv);
    this.surround.refresh();
  }

  /** The animations of one group (lit, or not), drawn by their painters onto a pinned picture that is cleared first. Returns whether the picture has anything. */
  private paintAnims(img: CanvasImage, lit: boolean, was: boolean, v: FieldStageView): boolean {
    let any = false;
    const ctx = img.ctx;
    for (const a of v.map.anims) {
      if (!!a.lit !== lit || !inView(a, v.cx, v.cy)) continue;
      if (!any) {
        ctx.clearRect(0, 0, W, H);
        any = true;
      }
      a.draw(ctx, v.frame, v.cx, v.cy);
    }
    if (any) {
      img.refresh();
      img.visible = true;
    } else if (was) img.visible = false;
    return any;
  }

  private paintShadows(v: FieldStageView): void {
    const g = this.shadows;
    g.clear();
    g.fillStyle(SHADOW.color, SHADOW.alpha);
    for (const a of v.actors) {
      const x = Math.round(a.px - v.cx) + v.cx;
      const y = Math.round(a.py - v.cy) + v.cy;
      for (const [dx, dy, w, h] of SHADOW.rects) g.fillRect(x + dx, y + dy, w, h);
    }
  }

  private drawProps(v: FieldStageView, mapCanvas: HTMLCanvasElement | null, boost: number, flickers: boolean, glow: CanvasRenderingContext2D | null): void {
    const { cx, cy, frame } = v;
    const lights = this.rig.lights;
    const epoch = this.rig.epoch;
    let shown = 0;
    for (const item of this.props) {
      const s = item.sprite;
      const w = s.canvas.width;
      const h = s.canvas.height;
      const sx = s.x - cx;
      const sy = s.y - cy;
      // The old cull: a prop wholly off the screen is not drawn.
      if (sx > W || sy > H || sx + w < 0 || sy + h < 0) {
        if (item.root.visible) item.root.visible = false;
        continue;
      }
      item.root.visible = true;
      shown++;
      if (!item.lit) this.buildProp(item);
      const sig = flickers ? lights.flickerSignature(s.x, s.y, w, h, frame) : 0;
      if (item.lit?.relight(s.canvas, null, mapCanvas, boost, s.x, s.y, sx, sy, sig, epoch)) this.litPaints++;
      if (item.emit && !item.emitBlank && s.emit) glow?.drawImage(s.emit, sx, sy);
      if (item.anim && s.anim) {
        const ctx = item.anim.ctx;
        ctx.clearRect(0, 0, item.anim.canvas.width, item.anim.canvas.height);
        s.anim(ctx, frame, ANIM_MARGIN, ANIM_MARGIN);
        item.anim.refresh();
      }
    }
    this.shownProps = shown;
  }

  private drawChests(v: FieldStageView, mapCanvas: HTMLCanvasElement | null, boost: number, flickers: boolean): void {
    const { cx, cy, frame } = v;
    const lights = this.rig.lights;
    const epoch = this.rig.epoch;
    v.chests.forEach((def, i) => {
      const item = this.chestItems[i];
      if (!item) return;
      item.def.open = def.open;
      const art = chestSprites(def.kind);
      const img = def.open ? art.open : art.closed;
      const x = def.tx * TS;
      const y = (def.ty + 1) * TS - img.height;
      const sig = flickers ? lights.flickerSignature(x, y, img.width, img.height, frame) : 0;
      if (item.lit.relight(img, null, mapCanvas, boost, x, y, x - cx, y - cy, sig, epoch)) this.litPaints++;
      // A closed chest breathes a soft halo in its trim color whatever the room's light, keeps its trim and lock lit, and now and then glints across the lid.
      item.halo.visible = !def.open;
      item.glow.visible = !def.open;
      if (def.open) {
        if (item.glinting) item.glint.clear();
        item.glinting = false;
        return;
      }
      item.halo.alpha = CHEST_PULSE.base + CHEST_PULSE.swing * Math.sin(frame * CHEST_PULSE.rate + def.tx * CHEST_PULSE.phase);
      const g = (frame + def.tx * CHEST_GLINT.tileX + def.ty * CHEST_GLINT.tileY) % CHEST_GLINT.period;
      if (g < CHEST_GLINT.length) {
        item.glint.clear().fillStyle(0xffffff, 1);
        item.glint.fillRect(2 + g, 6, 1, 1);
        if (g > 2 && g < 8) {
          item.glint.fillRect(2 + g, 5, 1, 3);
          item.glint.fillRect(1 + g, 6, 3, 1);
        }
        item.glinting = true;
      } else if (item.glinting) {
        item.glint.clear();
        item.glinting = false;
      }
    });
  }

  private drawActors(v: FieldStageView, mapCanvas: HTMLCanvasElement | null, boost: number, flickers: boolean): void {
    const { cx, cy, frame } = v;
    const lights = this.rig.lights;
    const epoch = this.rig.epoch;
    for (const a of v.actors) {
      const item = this.actorItems.get(a.ref);
      if (!item) continue;
      const w = a.image.width;
      const h = a.image.height;
      const k = sizeKey(w, h);
      let lit = item.lits.get(k);
      if (!lit) {
        lit = new LitPicture(this, w, h);
        item.root.add(lit.image);
        item.lits.set(k, lit);
      }
      for (const [key, other] of item.lits) other.image.visible = key === k;
      item.root.setPosition(a.x, a.y);
      item.root.setYSortOrigin(a.py - a.y);
      const sx = a.x - cx;
      const sy = a.y - cy;
      // The old drawLit left out a picture wholly off the screen.
      const off = sx + w < 0 || sy + h < 0 || sx > W || sy > H;
      item.root.visible = !off;
      if (off) continue;
      const sig = flickers ? lights.flickerSignature(a.x, a.y, w, h, frame) : 0;
      if (lit.relight(a.image, null, mapCanvas, boost, a.x, a.y, sx, sy, sig, epoch)) this.litPaints++;
    }
  }

  private drawOver(v: FieldStageView, mapCanvas: HTMLCanvasElement | null, flickers: boolean): void {
    const { cx, cy, frame } = v;
    const lights = this.rig.lights;
    const epoch = this.rig.epoch;
    for (const o of this.overs) {
      const r = o.rect;
      const sx = r.x - cx;
      const sy = r.y - cy;
      const on = !(sx > W || sy > H || sx + r.w < 0 || sy + r.h < 0);
      o.pic.image.visible = on;
      if (!on) continue;
      // The overhead layer is lit by the whole light map, with no boost (`drawLitLayer`).
      const sig = flickers ? lights.flickerSignature(r.x, r.y, r.w, r.h, frame) : 0;
      if (o.pic.relight(o.src, null, mapCanvas, 0, r.x, r.y, sx, sy, sig, epoch)) this.litPaints++;
    }
  }
}
