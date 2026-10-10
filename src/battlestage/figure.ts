/**
 * One standing figure on the battle stage, as a SORTING GROUP (docs/engine/scene-graph.md section 4). `Figure` is a class of ours (ours): Phaser has no such thing: a hero or an
 * enemy with its contact shadow, its ring and its body picture. In the Phaser spike this was the `Fighter` record, a bag of
 * state with several loose Phaser objects, and `perform.ts` and `battletest.ts` reached into its `sprite` and `home`
 * fields. The migration plan (migration.md section 6, "Changes that are not mechanical", item 2) gives it a class, so only this
 * file touches the display objects.
 *
 * How the sorting group works. The figure is a `Container` standing on the feet, at (`x`, `y`). Its depth is the one number
 * `depthFor` gives for those feet: whoever stands lower on the screen is nearer and draws on top. The parts are children of
 * the container and carry only a small local depth (`PART`: shadow -0.5, ring -0.4, body 0, smear 0.1, bar 0.25). A
 * container's children sort only with each other, so a nearer figure covers ALL of a farther one, health bar included. In the
 * spike every part had a flat depth of `figure depth + PART` in one big list; the order that comes out is the same, because the
 * figure depths differ by at least 1 and the parts only by fractions.
 *
 * Origin. The body's origin is the FEET as a fraction of its picture, so the position of the container is where the
 * figure stands, whatever the picture size. The shadow and ring pictures are even in both directions (`shadowSize`, `ringSize`),
 * so the default origin 0.5 is a whole pixel and they centre on the feet exactly.
 *
 * There is no `setSortingGroup` call (the design sketches one, scene-graph.md section 4). It is not needed: every container sorts its own children by `depth`,
 * so a plain `Container` with parts of small local depths IS a sorting group.
 *
 * The state of a live battle (M3 task 6) is plain fields the battle sets and `restyle` reads: `offX`/`offY` (a lunge, a hop), `bodyDx` (knock-back), `alpha`, `flash` (a
 * white blink of an enemy that is hit), `tint` (a red wash over a hero who is hit), `down` (a hero who has fallen sinks into the fog), `bar` (the on-stage health bar of an
 * enemy, when the stage asks for one). All of them start at rest, so a stage that never sets them draws what it always drew (the parity frames). Not here: the stills a
 * move puts on a hero and the dotted home ring (the move animations are a later step).
 */
import { type AnyScene, type Container, type Graphics, type ImageObject, PART, type Sprite, type TextureManager } from '../sje';
import { type AxisShift, type PartySlot, type StageConfig, depthFor, shadowHeight, shadowWidth, screenOf, slotPoint } from './config';
import { stageBarSize } from './hudlayout';
import { textAt, textTexture, UI } from './hudkit';
import { type IdleKind, enemyIdle, idleFrame } from './idle';
import { BAR_COLOURS, BAR_SHINE_ALPHA, DOWN_FOG, DOWN_FOG_AMOUNT } from './liveparams';
import { type FigureArt, flashTexture, hazedTexture, ringTexture, shadowTexture, tintTexture } from './textures';

export type Side = 'party' | 'enemy';

/** How a crew member's idle sheet plays: frames, speed and where in the loop this one starts. */
export interface SheetPlay {
  fps: number;
  count: number;
  phase: number;
}

/** What it takes to make a figure (the rest of its state starts at rest). */
export interface FigureSpec {
  id: string;
  side: Side;
  name: string;
  boss: boolean;
  slot: PartySlot;
  /** The picture it stands on: a baked crew sheet or an enemy's art. */
  baseTex: string;
  /** The figure as it appears on the screen (mirrored already for a mirrored enemy). */
  fig: FigureArt;
  /** The figure exactly as its art was drawn, never mirrored. */
  art: FigureArt;
  /** Whether the picture is drawn mirrored: an enemy whose art faces right is flipped to face the heroes. Always false for a hero. */
  mirror: boolean;
  idle: IdleKind;
  /** Keeps two of a kind out of step in their idle motion. */
  uid: number;
  /** The size of the picture's cell. */
  cellW: number;
  cellH: number;
  /** Which sprite this is for the foot-anchor corrections: a crew id, or an enemy's sprite key. */
  axisKey: string;
  /** A hero's idle sheet (frames come from the tick); absent for enemies, which sway instead. */
  sheet?: SheetPlay;
}

/** What `restyle` reads from the scene. */
export interface StyleContext {
  stage: StageConfig;
  textures: TextureManager;
  /** Ticks of WORLD time (it stops during a hitstop). The idle frame of a hero comes from it. */
  worldFrame: number;
}

/**
 * What a figure looks like to the display list, for tests and the lab hook. The body, shadow and ring are local to the group, as the engine holds them.
 * `idle` is the enemy's idle motion (heroes use their sheet).
 */
export interface FigureParts {
  idle: IdleKind;
  /** The group's depth (what sorts it against other figures) and its feet. */
  depth: number;
  x: number;
  y: number;
  body: { x: number; y: number; frame: string | number | undefined; texture: string; flipX: boolean; originX: number; originY: number };
  shadow: { visible: boolean; depth: number };
  ring: { visible: boolean; depth: number };
}

export class Figure {
  readonly id: string;
  readonly side: Side;
  readonly name: string;
  readonly boss: boolean;
  readonly axisKey: string;
  readonly uid: number;
  readonly idle: IdleKind;
  readonly sheet: SheetPlay | undefined;
  readonly cellW: number;
  readonly cellH: number;
  /** The picture before haze (a texture key). */
  readonly baseTex: string;
  /** The slot's feet (home) and where the feet are now (they differ while an attacker lunges). */
  baseX = 0;
  baseY = 0;
  x = 0;
  y = 0;
  /** Knockback of the body only (its shadow stays on the floor). */
  bodyDx = 0;
  /** The feet row this figure sorts by: its own, or while lunging in contact the target's row plus one. */
  sortY = 0;
  slot: PartySlot;
  /** The figure as measured from its pixels, before any foot-anchor correction. A mirrored enemy's is the measurement of the picture AS DRAWN, that is, reversed. */
  measured: FigureArt;
  /** The measurement with the foot-anchor correction applied. */
  fig: FigureArt;
  /** The figure exactly as its art was drawn, never mirrored. */
  readonly art: FigureArt;
  mirror: boolean;
  /** The ring under the feet: cyan for the acting hero, amber for the target; none otherwise. */
  active = false;
  target = false;
  /** The picture's opacity. */
  alpha = 1;
  /** The move's offset from the feet (facing already applied). */
  offX = 0;
  offY = 0;
  /** A white blink over the picture, 0 (none) to 1 (full): an enemy that is hit. */
  flash = 0;
  /** A red wash over the picture, 0 to 1: a hero who is hit. */
  tint = 0;
  /** A hero who has fallen: the picture sinks into the floor's fog. */
  down = false;
  /** The on-stage health bar (and the duplicate's letter), when the stage's HUD asks for bars on the stage and this is an enemy; null draws none. */
  bar: { ratio: number; tag: string } | null = null;
  /** The draw-order number now. */
  depth = 0;
  shadowW = 0;
  /** Which picture and frame the body shows now ("texture|frame"), so a restyle only touches the sprite when it changed. */
  private shown = '';

  /** The container: stands on the feet; its depth is the figure's depth. */
  private readonly group: Container;
  private readonly shadow: ImageObject;
  private readonly ring: ImageObject;
  private readonly body: Sprite;
  private barG: Graphics | null = null;
  private barTag: ImageObject | null = null;
  private barTagKey = '';
  private readonly host: AnyScene;

  constructor(scene: AnyScene, spec: FigureSpec, stage: StageConfig, firstFrame: number | undefined) {
    this.id = spec.id;
    this.side = spec.side;
    this.name = spec.name;
    this.boss = spec.boss;
    this.axisKey = spec.axisKey;
    this.uid = spec.uid;
    this.idle = spec.idle;
    this.sheet = spec.sheet;
    this.cellW = spec.cellW;
    this.cellH = spec.cellH;
    this.baseTex = spec.baseTex;
    this.slot = spec.slot;
    this.measured = spec.fig;
    this.fig = spec.fig;
    this.art = spec.art;
    this.mirror = spec.mirror;

    this.host = scene;
    this.group = scene.add.container(0, 0);
    this.group.name = `figure ${spec.id}`;
    // The parts, made in the scene and moved into the group (a child that has a parent leaves it first). Shadow and ring start
    // hidden with a stub picture; `restyle` gives them their real size.
    this.shadow = scene.add.image(0, 0, shadowTexture(scene.textures, 16, stage.shadow)).setVisible(false);
    this.ring = scene.add.image(0, 0, ringTexture(scene.textures, 24, '#3fe0f0')).setVisible(false);
    this.body = scene.add.sprite(0, 0, spec.baseTex, firstFrame);
    // (An image names itself after its texture whenever the texture changes, so the part's role is kept in its data bag.)
    this.shadow.setData('part', 'shadow');
    this.ring.setData('part', 'ring');
    this.body.setData('part', 'body');
    this.group.add([this.shadow, this.ring, this.body]);
  }

  /**
   * Set the feet from the measured ones plus the foot-anchor correction for this sprite (`axes.json`). The sprite's ORIGIN is
   * the point of the picture that stands at the sprite's position, so shifting the origin by one pixel moves the whole figure one
   * pixel the other way, which is exactly what a measured foot that was a pixel off needs.
   */
  applyAxis(shift: AxisShift): void {
    this.fig = { ...this.measured, foot: { x: this.measured.foot.x + shift.x, y: this.measured.foot.y + shift.y } };
    this.body.setOrigin(this.fig.foot.x / this.cellW, this.fig.foot.y / this.cellH);
  }

  /** Put the figure in a slot: position and depth follow from the stage config. */
  place(stage: StageConfig, slot: PartySlot): void {
    this.slot = slot;
    // `slotPoint` keeps the feet inside the floor, so nothing stands on the wall or off the bottom of the screen.
    const p = slotPoint(stage, slot);
    this.baseX = p.x;
    this.baseY = p.y;
    this.x = p.x;
    this.y = p.y;
    this.sortY = p.y;
    this.bodyDx = 0;
  }

  /**
   * Everything about the figure that follows from its state: which picture (hazed by depth), where each part sits and what
   * depth number it draws at, the shadow and ring sizes.
   */
  restyle(ctx: StyleContext): void {
    const st = ctx.stage;
    // The picture: a hit flash, else a fallen hero sunk into the fog, else the depth haze for this row (the acting hero and the target are exempt), else as drawn.
    let tex = this.baseTex;
    if (this.flash > 0) tex = flashTexture(ctx.textures, this.baseTex, this.flash);
    else if (this.down && this.side === 'party') tex = hazedTexture(ctx.textures, this.baseTex, DOWN_FOG, DOWN_FOG_AMOUNT);
    else {
      if (st.depthTint) {
        const amount = st.depthTint.exemptActive && (this.active || this.target) ? 0 : (st.depthTint.amounts[this.slot.row] ?? 0);
        tex = hazedTexture(ctx.textures, this.baseTex, st.depthTint.fog, amount);
      }
      // A red wash over a hero who has just been hit.
      if (this.tint > 0) tex = tintTexture(ctx.textures, tex, this.tint);
    }
    // A hero's idle picture is one cell of a sheet, so say which; an enemy's art is a single picture.
    const frame = this.sheet ? idleFrame(ctx.worldFrame, this.sheet.fps, this.sheet.count, this.sheet.phase) : undefined;
    const want = `${tex}|${frame ?? ''}`;
    if (this.shown !== want) {
      this.body.setTexture(tex, frame);
      this.shown = want;
      // A new texture rewrites the anchor from the origin, which is kept: the feet fraction does not change with the picture.
    }
    this.body.setAlpha(this.alpha).setFlipX(this.mirror);

    // The draw order: the whole figure sorts as one unit, by the group's depth. The parts only sort with each other.
    this.depth = depthFor(this.sortY, this.x, this.side, this.slot.order ?? 0, screenOf(st).w);
    this.group.setPosition(this.x, this.y).setDepth(this.depth);
    this.body.setPosition(this.bodyDx + this.offX, 1 + this.offY).setDepth(PART.BODY);

    // The contact shadow: a flat oval on the floor under the feet (it stays at floor height and follows only x and depth).
    const sprW = this.fig.box.x1 + 1 - this.fig.box.x0;
    this.shadowW = shadowWidth(st, sprW, this.boss);
    if (this.shadowW <= 0) this.shadow.setVisible(false);
    else this.shadow.setTexture(shadowTexture(ctx.textures, this.shadowW, st.shadow)).setVisible(true).setPosition(0, 1).setDepth(PART.SHADOW);
    this.shadow.setAlpha(this.alpha);

    // The ring under the acting hero (cyan) and the target (amber).
    const ringSpec = this.active ? st.shadow.activeRing : this.target ? { color: '#ffcc3d', extraW: st.shadow.activeRing?.extraW ?? 6 } : null;
    if (ringSpec && this.shadowW > 0) this.ring.setTexture(ringTexture(ctx.textures, this.shadowW + ringSpec.extraW, ringSpec.color)).setVisible(true).setPosition(0, 1).setDepth(PART.RING);
    else this.ring.setVisible(false);
    this.ring.setAlpha(this.alpha);
    this.drawBar(ctx);
  }

  /** The on-stage health bar under the shadow (and the letter of a duplicate beside it). It is part of the figure: it sorts with it, and fades with it. */
  private drawBar(ctx: StyleContext): void {
    const spec = ctx.stage.hud.enemyInfo.barsOnStage;
    const bar = this.side === 'enemy' && spec ? this.bar : null;
    if (!bar || !spec) {
      this.barG?.setVisible(false);
      this.barTag?.setVisible(false);
      return;
    }
    if (!this.barG) this.barG = this.host.add.graphics();
    const g = this.barG;
    if (g.parent !== this.group) this.group.add(g);
    g.setVisible(true).setDepth(PART.BAR).setAlpha(this.alpha).clear();
    // A boss gets a wide, taller bar (96 x 4): the one health bar in the fight that matters most should look it.
    const { w, h } = stageBarSize(this.boss, spec);
    const shadowH = this.shadowW > 0 ? shadowHeight(ctx.stage, this.shadowW) : 0;
    const by = 1 + Math.floor(shadowH / 2) + spec.gapBelowShadow;
    const ratio = Math.max(0, Math.min(1, bar.ratio));
    const colour = ratio > 0.5 ? BAR_COLOURS.high : ratio > 0.25 ? BAR_COLOURS.mid : BAR_COLOURS.low;
    const fw = Math.round(w * ratio);
    g.fillStyle(BAR_COLOURS.outline, 1).fillRect(-Math.floor(w / 2) - 1, by - 1, w + 2, h + 2);
    g.fillStyle(BAR_COLOURS.back, 1).fillRect(-Math.floor(w / 2), by, w, h);
    if (fw > 0) {
      g.fillStyle(colour, 1).fillRect(-Math.floor(w / 2), by, fw, h);
      g.fillStyle(0xffffff, BAR_SHINE_ALPHA).fillRect(-Math.floor(w / 2), by, fw, 1);
    }
    // A duplicate foe's letter (A, B...) beside its bar, so the A on the timeline and in the list can be found on the stage.
    if (bar.tag) {
      const t = textTexture(ctx.textures, bar.tag, { color: UI.text, shadow: false, outline: UI.outline, prefix: 'bartag-' });
      const at = textAt(t, bar.tag, -Math.floor(w / 2) - 7, by + Math.floor(h / 2) - 3, 'left');
      if (!this.barTag) {
        this.barTag = this.host.add.image(at.x, at.y, t.key).setOrigin(0, 0);
        this.group.add(this.barTag);
      } else if (this.barTagKey !== t.key) this.barTag.setTexture(t.key);
      this.barTagKey = t.key;
      this.barTag.setVisible(true).setPosition(at.x, at.y).setDepth(PART.BAR).setAlpha(this.alpha);
    } else this.barTag?.setVisible(false);
  }

  /**
   * One step of game time: a hero's idle loop shows the frame of the tick, an enemy sways. Everything that moves is chosen from the
   * tick number, never from a clock, so the same tick is always the same picture.
   */
  tick(worldFrame: number): void {
    if (this.sheet) {
      const frame = idleFrame(worldFrame, this.sheet.fps, this.sheet.count, this.sheet.phase);
      // Only when it changed: a frame is 7.5 ticks long, so most ticks leave the sprite alone.
      if (frame !== this.body.frame) {
        this.body.setFrame(frame);
        this.shown = `${this.body.texture.key}|${frame}`;
      }
    } else {
      const o = enemyIdle(this.idle, worldFrame, this.uid);
      this.body.setPosition(this.bodyDx + this.offX + o.x, 1 + this.offY + o.y);
    }
  }

  /** The sorting group (for tests that look at how the parts draw). */
  get container(): Container {
    return this.group;
  }

  /** The texture keys this figure's shadow and ring show (what `prune` must keep). */
  partTextures(): string[] {
    return [this.shadow.texture.key, this.ring.texture.key];
  }

  /** What a test reads: where the parts are and in what order they draw. */
  describe(): FigureParts {
    const b = this.body;
    return {
      idle: this.idle,
      depth: this.group.depth,
      x: this.group.x,
      y: this.group.y,
      body: { x: b.x, y: b.y, frame: b.frame, texture: b.texture.key, flipX: b.flipX, originX: b.originX, originY: b.originY },
      shadow: { visible: this.shadow.visible, depth: this.shadow.depth },
      ring: { visible: this.ring.visible, depth: this.ring.depth },
    };
  }

  /** Destroy every part (the container destroys its children). */
  destroy(): void {
    this.group.destroy();
  }
}

