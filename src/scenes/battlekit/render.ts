/**
 * Battle rendering: the backdrop, fighters, effects and floaters, drawn from the scene's state into the scene's canvas. The scene (scenes/battle.ts) owns state and
 * flow (command entry, the round, playback); this owns the ART pixels. It reads the scene, and never changes game state. Every window, text, bar and menu of the
 * battle is a kit part in the scene's ui layer (battlekit/hud.ts and panels.ts, M8c group G), so none is painted here.
 */
import type { Pose } from '../../art/battlers';
import { enemyArt } from '../../art/enemies';
import type { Combatant } from '../../battle/types';
import { ENEMIES } from '../../data/enemies';
import { MEMBERS } from '../../data/party';
import { surface, type Ctx, type Surface } from '../../engine/canvas';
import { drawText } from '../../engine/font';
import { H, W } from '../../sje/core/size';
import type { MemberId } from '../../game/state';
import type { BattleScene } from '../battle';
import { BHT, BW, floaterMotion, IMPACT_LINE_REACH, PARTY_BOTTOM, WORLD_SCALE } from './geom';
import { ACTIVE, AIMING } from './hud';
import { INTRO_T, ShatterIntro } from './intro';
import { PARTY_POSE_T, swingBeat } from './motion';
import { DISSOLVE_STEPS, ENEMY_POSE_T, dissolved, marked, mirrored, rimOf, silhouetteCache, variant } from './sprites';
import { AFTERIMAGES } from './tables';
import { drawRing } from './timing';

/** Glyph effects (spell runes, numbers) don't glow: the glow pass skips them. */
const NO_GLYPH = (): void => undefined;

/**
 * The Warden's conduits, relative to its sprite: [from x (from the left edge if ≥ 0, else from the
 * right), from y, to x (screen-world), to y, sag]. A constant, so drawing them allocates nothing.
 * Both y values are in sprite space (the draw adds the sprite's top and scales by its size), so the
 * `0`, `4`, `58` and `62` stay fixed on purpose: they say where each cable ends relative to the
 * Warden, not where on the backdrop, and neither `HORIZON` nor `BW` moves them. Only the far x ends
 * (`-6`, `BW + 6`) follow the world's width.
 */
const CONDUITS: readonly (readonly [number, number, number, number, number])[] = [
  [10, 24, -6, 4, 10],
  [-10, 24, BW + 6, 0, 12],
  [14, 44, -6, 58, 6],
  [-14, 44, BW + 6, 62, 6],
];

/** Draw an enemy-art canvas at its battle-world size (its art may be finer than the world). */
function putArt(g: Ctx, c: HTMLCanvasElement, x: number, y: number, res: number): void {
  g.drawImage(c, x, y, c.width / res, c.height / res);
}

export class BattleRenderer {
  constructor(private readonly s: BattleScene) {}

  render(ctx: Ctx): void {
    if (this.s.stage) {
      this.renderOverStage(ctx);
      return;
    }
    // Three layers: the backdrop (world scale), the enemies (screen resolution, drawn through a
    // 2x transform so world coordinates still place them), then the party, effects and numbers
    // (a clear world-scale layer). Creatures paint finer than the world; everything else is as was.
    const back = this.s.world.ctx;
    const f = this.s.frame;
    back.imageSmoothingEnabled = false;
    back.drawImage(this.s.bg.canvas, 0, 0);
    if (this.s.bg.glow) back.drawImage(this.s.bg.glow, 0, 0);
    this.s.bg.anim?.(back, f);
    const el = this.s.enemyLayer.ctx;
    el.setTransform(1, 0, 0, 1, 0, 0);
    el.clearRect(0, 0, W, H);
    el.setTransform(WORLD_SCALE, 0, 0, WORLD_SCALE, 0, 0);
    el.imageSmoothingEnabled = false;
    const g = this.s.front.ctx;
    g.clearRect(0, 0, BW, BHT);
    g.imageSmoothingEnabled = false;
    // Enemies, back to front
    // Back to front, into a reused buffer.
    const order = this.s.drawOrder;
    order.length = 0;
    for (const e of this.s.battle.enemies) if (this.s.d(e.uid).alpha > 0.01) order.push(e);
    order.sort(this.s.byFeet);
    for (const e of order) this.drawEnemy(el, e, f);
    el.setTransform(1, 0, 0, 1, 0, 0);
    // Party (back view)
    for (const p of this.s.battle.party) this.drawPartyMember(g, p, f);
    // Foreground framing (rails, cables) over the fighters; FX and numbers stay on top of it.
    if (this.s.bg.fg) g.drawImage(this.s.bg.fg, 0, 0);
    this.s.fx.render(g, (c, ch, x, y, col) => drawText(c, ch, x, y, { color: col, shadow: false }));
    // A timed press: the ring closing on each target.
    const tp = this.s.timing.prompt;
    if (tp && this.s.timing.isOpen) {
      for (const uid of tp.targets) {
        const p = this.s.pos(uid);
        drawRing(g, p.x, p.y, this.s.game.frame, this.s.timing);
      }
    }
    // Targeting arrows (world space)
    if (this.s.mode === 'target') {
      const t = this.s.targetList[this.s.targetIdx];
      if (t !== undefined) this.drawArrow(g, t, f, AIMING);
    }
    // While the round plays, the arrow rides whoever's turn it is (both partners of a combo).
    if (this.s.mode === 'play') {
      const acts = this.s.battle.roundOrder[this.s.battle.roundAt];
      if (acts) for (const uid of acts) if ((this.s.battle.unit(uid)?.hp ?? 0) > 0) this.drawArrow(g, uid, f, ACTIVE);
    }
    // Floaters
    for (const fl of this.s.floaters) {
      // Hits and labels pop up, hold and drift together (so a WEAK!/CRITICAL keeps its row over
      // its number the whole time); only the hit bounces. DoT ticks sink. (The rule is floaterMotion in geom.ts.)
      const m = floaterMotion(fl.style, fl.t);
      g.globalAlpha = m.alpha;
      drawText(g, fl.text, Math.round(fl.x), Math.round(fl.y - m.rise - m.bounce), { color: fl.color, align: 'center', shadow: '#0a0913' });
      g.globalAlpha = 1;
    }
    ctx.imageSmoothingEnabled = false;
    // Shake moves the battlefield only: HP bars, numbers and menus stay put.
    const shx = this.s.game.shakeX, shy = this.s.game.shakeY;
    if (shx || shy) {
      ctx.fillStyle = '#07060d';
      ctx.fillRect(0, 0, W, H);
    }
    const push = this.s.push;
    if (push && push.t < push.life) {
      // The camera leans in on a big hit: a quick push toward the target, easing back out.
      const k = push.t < 4 ? push.t / 4 : 1 - (push.t - 4) / (push.life - 4);
      const z = 1 + 0.09 * k * k;
      const sw = BW / z, sh = BHT / z;
      const sx = Math.max(0, Math.min(BW - sw, push.x - sw / 2)), sy = Math.max(0, Math.min(BHT - sh, push.y - sh / 2));
      ctx.drawImage(this.s.world.canvas, sx, sy, sw, sh, shx, shy, W, H);
      ctx.drawImage(this.s.enemyLayer.canvas, sx * WORLD_SCALE, sy * WORLD_SCALE, sw * WORLD_SCALE, sh * WORLD_SCALE, shx, shy, W, H);
      ctx.drawImage(this.s.front.canvas, sx, sy, sw, sh, shx, shy, W, H);
    } else {
      ctx.drawImage(this.s.world.canvas, shx, shy, W, H);
      ctx.drawImage(this.s.enemyLayer.canvas, shx, shy);
      ctx.drawImage(this.s.front.canvas, shx, shy, W, H);
    }
    if (this.s.impactT > 0 && this.s.impactOn) this.renderImpact(ctx, shx, shy);
    if (this.s.defeatT > 0) {
      // The killing blow drains the frame toward red-black.
      this.s.defeatT++;
      ctx.fillStyle = `rgba(36,0,10,${Math.min(0.62, this.s.defeatT / 70).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    // Intro shatter
    if (this.s.setup.intro && this.s.introT < INTRO_T) {
      if (!this.shatter) this.shatter = new ShatterIntro(this.s.setup.intro);
      this.shatter.draw(ctx, this.s.introT);
    }
    // GPU effects: what glows goes into the glow layer, framed like the world; the UI goes on
    // its own layer, laid over after bloom and shockwaves so it never smears.
    // No light through the impact frame's blackout; the defeat drain dims it with the rest.
    const dark = (this.s.setup.intro && this.s.introT < INTRO_T) || (this.s.impactT > 0 && !!this.s.impactOn);
    const fx = this.s.game.fx;
    const glow = dark ? null : fx.glowLayer();
    if (glow) {
      fx.bloom = 0.7 * (1 - Math.min(0.62, this.s.defeatT / 70));
      this.renderGlow(glow, shx, shy);
    }
  }

  /**
   * The battle under a stage (battlekit/stageseam.ts): the stage scene below draws the backdrop, the figures, the effects, the HUD and the numbers, so this draws only what is
   * still the old UI, on a canvas that starts clear every frame: the impact frame, the intro's shattering glass, the bloom's light (the menus, panels and cut-ins are kit parts: battlekit/hud.ts).
   */
  private renderOverStage(ctx: Ctx): void {
    ctx.imageSmoothingEnabled = false;
    const shx = this.s.game.shakeX, shy = this.s.game.shakeY;
    if (this.s.impactT > 0 && this.s.impactOn) this.renderImpact(ctx, shx, shy);
    // The killing blow drains the frame toward red-black: the stage draws the wash from this count, which only this draw advances (as in the old picture).
    if (this.s.defeatT > 0) this.s.defeatT++;
    if (this.s.setup.intro && this.s.introT < INTRO_T) {
      if (!this.shatter) this.shatter = new ShatterIntro(this.s.setup.intro);
      this.shatter.draw(ctx, this.s.introT);
    }
    const dark = (this.s.setup.intro && this.s.introT < INTRO_T) || (this.s.impactT > 0 && !!this.s.impactOn);
    const fx = this.s.game.fx;
    const glow = dark ? null : fx.glowLayer();
    if (glow) {
      fx.bloom = 0.7 * (1 - Math.min(0.62, this.s.defeatT / 70));
      this.renderGlow(glow, shx, shy);
    }
  }

  /**
   * What the old picture drew into its world layer that the stage does not: the ring of a timed press closing on each target. The stage calls this with the
   * 2D context of its effects layer (world pixels), right after the effects themselves.
   */
  drawOverStage(g: Ctx): void {
    const tp = this.s.timing.prompt;
    if (!tp || !this.s.timing.isOpen) return;
    for (const uid of tp.targets) {
      const p = this.s.pos(uid);
      drawRing(g, p.x, p.y, this.s.game.frame, this.s.timing);
    }
  }

  /** The battle's light for the bloom: the backdrop's neon and every effect in flight. */
  private glowWorld: Surface | null = null;
  private renderGlow(glow: Ctx, shx: number, shy: number): void {
    this.glowWorld ??= surface(BW, BHT);
    const g = this.glowWorld.ctx;
    g.clearRect(0, 0, BW, BHT);
    // Under a stage the backdrop is the stage's own picture, which the old backdrop's neon does not match: only the effects light the bloom.
    if (this.s.bg.glow && !this.s.stage) g.drawImage(this.s.bg.glow, 0, 0);
    this.s.fx.render(g, NO_GLYPH, true);
    glow.imageSmoothingEnabled = false;
    const push = this.s.push;
    if (push && push.t < push.life) {
      const k = push.t < 4 ? push.t / 4 : 1 - (push.t - 4) / (push.life - 4);
      const z = 1 + 0.09 * k * k;
      const sw = BW / z, sh = BHT / z;
      const sx = Math.max(0, Math.min(BW - sw, push.x - sw / 2)), sy = Math.max(0, Math.min(BHT - sh, push.y - sh / 2));
      glow.drawImage(this.glowWorld.canvas, sx, sy, sw, sh, shx, shy, W, H);
    } else glow.drawImage(this.glowWorld.canvas, shx, shy, W, H);
  }

  /**
   * An impact frame, for the hits that end things (a critical, a combo landing): two frames where
   * the world drops to near-black, the target is a white cut-out and speed lines burst from it.
   * A different kind of event from a normal hit, not just more sparks.
   */
  private renderImpact(ctx: Ctx, shx: number, shy: number): void {
    const u = this.s.impactOn!;
    // Under a stage the target stands where the stage put it, and the white cut-out of the old art is not drawn (the stage's figure is not an old canvas).
    const staged = !!this.s.stage;
    const { x, y, art } = staged ? { x: 0, y: 0, art: null } : this.s.enemyPos(u);
    const mid = staged ? this.s.pos(u.uid) : art ? { x: x + art.w / 2, y: y + art.h / 2 } : { x, y };
    const cx = mid.x * WORLD_SCALE + shx, cy = mid.y * WORLD_SCALE + shy;
    ctx.fillStyle = 'rgba(8,4,16,0.86)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.s.impactColor;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (this.s.impactT % 2) * 0.17;
      const r0 = 34 + (i % 3) * 10, r1 = IMPACT_LINE_REACH;
      for (let r = r0; r < r1; r += 3) ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.62), i % 2 ? 1 : 2, 1);
    }
    if (art) ctx.drawImage(silhouetteCache(art.canvas, '#ffffff'), x * WORLD_SCALE + shx, y * WORLD_SCALE + shy, art.w * WORLD_SCALE, art.h * WORLD_SCALE);
  }

  /** The frame the fight broke out of, shattering (built on the first intro frame). */
  private shatter: ShatterIntro | null = null;

  private drawEnemy(g: Ctx, e: Combatant, f: number): void {
    const dd = this.s.d(e.uid);
    const { x, y, art } = this.s.enemyPos(e);
    const dup = this.s.dupIndex(e);
    // Duplicates: a distinct individual where the sprite has one, else a palette and mirror.
    // Creatures get both: their own anatomy, and the tint, mirror and markings on top.
    const who = dup ? enemyArt(ENEMIES[e.key]!.sprite, dup) : art;
    const creature = e.family === 'beast' || e.family === 'machine' || e.family === 'spirit';
    // The strike frame through the lunge of an attack (from rearing back to the settle).
    const k = dd.poseT > 0 && dd.pose === 'attack' ? ENEMY_POSE_T - dd.poseT : -1;
    // And the flinch frame for most of a hit's knock-back (the last frames ease back to idle).
    const flinch = dd.poseT > 4 && dd.pose === 'hurt';
    const src = who.attack && k >= 6 && k < 18 ? who.attack : who.hurt && flinch ? who.hurt : who;
    // Humans with their own individual art still get the squad armband (marked()).
    const own = who.individual && !creature;
    const canvas = own ? marked(dup % 2 ? mirrored(src.canvas) : src.canvas, e.family ?? '', dup) : marked(variant(src.canvas, dup), e.family ?? '', dup);
    const glow = !src.glow ? undefined : own ? (dup % 2 ? mirrored(src.glow) : src.glow) : variant(src.glow, dup);
    // Every canvas below is at the art's resolution: placed at its world size (the 2x transform
    // on the enemy layer turns a creature's art pixels into screen pixels).
    const res = art.res;
    let ox = 0, oy = 0;
    switch (art.idle) {
      case 'hover': oy = Math.round(Math.sin(f * 0.08 + e.uid) * 2); break;
      case 'bob': oy = Math.round(Math.sin(f * 0.1 + e.uid) * 1); break;
      case 'sway': ox = Math.round(Math.sin(f * 0.05 + e.uid) * 2); oy = Math.round(Math.sin(f * 0.1) * 1); break;
      case 'breathe': oy = (Math.floor((f + e.uid * 13) / 30) % 2); break;
      case 'flicker': oy = Math.round(Math.sin(f * 0.06 + e.uid) * 2); break;
    }
    if (dd.shake > 0) ox += dd.shake % 4 < 2 ? 2 : -2;
    oy += Math.round(dd.lunge);
    // Body motion while acting or reeling (battle-world pixels; the party is below).
    let castGlow = 0;
    if (dd.poseT > 0) {
      const k = dd.pose === 'hurt' ? 16 - dd.poseT : ENEMY_POSE_T - dd.poseT;
      switch (dd.pose) {
        case 'attack': // rear back, lunge down at the crew, settle
          oy += k < 9 ? -Math.round(k / 3) : k < 15 ? Math.round((k - 9) * 1.6) - 3 : Math.max(0, 7 - (k - 15));
          break;
        case 'aim': // shoulder the kick
          oy += k >= 10 && k < 16 ? -2 : 0;
          ox += k >= 10 && k < 13 ? (e.uid % 2 ? 1 : -1) : 0;
          break;
        case 'cast': // lift and gather light
          oy -= Math.round(Math.min(3, k / 3) * (k < 24 ? 1 : Math.max(0, 1 - (k - 24) / 8)));
          castGlow = Math.sin(Math.min(1, k / 22) * Math.PI) * 0.45;
          break;
        case 'hurt': // knocked back, then recover
          oy -= k < 6 ? 2 : k < 12 ? 1 : 0;
          ox += k < 10 ? (e.uid % 2 ? 2 : -2) : 0;
          break;
      }
    }
    const dx = x + ox, dy = y + oy;
    // Shadow
    if (art.shadow) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      const cx = x + art.w / 2;
      const gy = y + art.h - 1;
      g.fillRect(Math.round(cx - art.shadow / 2), gy, art.shadow, 2);
      g.fillRect(Math.round(cx - art.shadow / 2 + 2), gy + 2, art.shadow - 4, 1);
    }
    let alpha = dd.alpha;
    if (art.idle === 'flicker') alpha *= 0.82 + 0.18 * Math.sin(f * 0.2 + e.uid);
    if (dd.dying > 0) {
      // Defeat: a brief white blink over the intact sprite, then it breaks up block by block
      // from the top, drifting up as it goes.
      const k = Math.min(1, dd.dying / 28);
      const lift = Math.round(k * 4);
      putArt(g, dissolved(canvas, Math.min(DISSOLVE_STEPS, Math.floor(k * (DISSOLVE_STEPS + 1)))), dx, dy - lift, res);
      if (dd.dying < 6) {
        g.globalAlpha = 0.5 * (1 - dd.dying / 6);
        putArt(g, silhouetteCache(canvas, '#ffffff'), dx, dy - lift, res);
      }
      g.globalAlpha = 1;
      return;
    }
    if (e.key === 'warden') this.drawConduits(g, dx, dy, art.w, art.size, f, !!e.memory.charging);
    // A heavy hit lands on the body: it squashes flat and wide from the feet, then snaps back.
    const hurtK = dd.poseT > 0 && dd.pose === 'hurt' ? 16 - dd.poseT : -1;
    const squash = hurtK >= 0 && hurtK < 8 ? (hurtK < 2 ? 1 : 1 - (hurtK - 2) / 6) : 0;
    if (squash > 0) {
      const fx = dx + art.w / 2, fy = dy + art.h;
      g.save();
      g.translate(fx, fy);
      g.scale(1 + 0.12 * squash, 1 - 0.1 * squash);
      g.translate(-fx, -fy);
    }
    // Rim light in a colour the backdrop doesn't use, so no enemy blends into the set.
    g.globalAlpha = alpha * 0.55;
    putArt(g, rimOf(canvas, this.s.rim), dx - 1 / res, dy - 1 / res, res);
    g.globalAlpha = alpha;
    putArt(g, canvas, dx, dy, res);
    if (this.s.bg.tintAmt > 0) {
      // Ambient tint: multiply-ish wash using the background light color.
      g.globalAlpha = alpha * this.s.bg.tintAmt;
      putArt(g, silhouetteCache(canvas, this.s.bg.tint), dx, dy, res);
      g.globalAlpha = alpha;
    }
    if (glow) putArt(g, glow, dx, dy, res);
    if (castGlow > 0) {
      g.globalAlpha = alpha * castGlow;
      putArt(g, silhouetteCache(canvas, '#e8d8ff'), dx, dy, res);
      g.globalAlpha = alpha;
    }
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      // A blink, not a blank: the sprite's detail stays visible under the white, so a still
      // caught on this frame reads as a hit rather than a white smear.
      g.globalAlpha = 0.55 * alpha;
      putArt(g, silhouetteCache(canvas, '#ffffff'), dx, dy, res);
    }
    g.globalAlpha = 1;
    if (squash > 0) g.restore();
  }

  /** The Warden is wired into the facility: sagging conduits run from its frame to the screen edges. */
  private drawConduits(g: Ctx, x: number, y: number, w: number, size: number, f: number, charging: boolean): void {
    const pulse = charging ? '#ff5a4a' : '#6ff3ff';
    const speed = charging ? 0.05 : 0.018;
    for (let i = 0; i < CONDUITS.length; i++) {
      const [from, fy, x1, ty, sag] = CONDUITS[i]!;
      // Anchor points were authored on the sprite at its first size: scale them with it.
      const x0 = from >= 0 ? x + from * size : x + w + from * size, y0 = y + fy * size, y1 = y + ty * size;
      const n = Math.ceil(Math.abs(x1 - x0));
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const px = Math.round(x0 + (x1 - x0) * t), py = Math.round(y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag);
        g.fillStyle = '#16121e';
        g.fillRect(px, py - 1, 1, 3);
        g.fillStyle = '#3a3448';
        g.fillRect(px, py - 1, 1, 1);
      }
      // Energy runs along each line into the machine.
      for (let k = 0; k < 2; k++) {
        const t = 1 - ((f * speed + i * 0.27 + k * 0.5) % 1);
        const px = Math.round(x0 + (x1 - x0) * t), py = Math.round(y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sag);
        g.fillStyle = pulse;
        g.fillRect(px - 1, py, 3, 1);
      }
    }
  }

  private drawPartyMember(g: Ctx, p: Combatant, f: number): void {
    const dd = this.s.d(p.uid);
    const art = this.s.partyArt.get(p.uid)!;
    const pos = this.s.partyPos(p);
    const active = (this.s.mode === 'command' || this.s.mode === 'list' || this.s.mode === 'target') && this.s.actor?.uid === p.uid;
    const down = dd.hp <= 0 && p.hp <= 0;
    // Melee moves play in beats: drawn in (the brace frame), the snap forward, the settle.
    const beat = dd.poseT > 0 && (dd.pose === 'attack' || dd.pose === 'thrust') ? swingBeat(PARTY_POSE_T - dd.poseT) : null;
    // The frame for each beat: gathered (brace), raised (the pose itself), then swept through
    // (strike) for the cut and the settle. Palm strikes (thrust) keep their own frame throughout.
    const through = beat && dd.pose === 'attack' && (beat.phase === 'cut' || beat.phase === 'settle');
    // Art with a wind-up of its own (Rook's raised sword) shows it for the gather's second half too:
    // the raise beat alone is two frames, too quick to read.
    const wound = art.windup && dd.pose === 'attack' && beat?.phase === 'gather' && PARTY_POSE_T - dd.poseT >= 3;
    const pose: Pose = dd.poseT > 0 ? (wound ? 'attack' : beat?.phase === 'gather' ? 'brace' : through ? 'strike' : dd.pose) : 'idle';
    const frame = art.frames[pose];
    // Drawn art (the art pass) can be finer than the battle world: `res` art pixels per world pixel.
    const res = art.res ?? 1;
    let ox = 0;
    if (dd.shake > 0) ox = dd.shake % 4 < 2 ? 2 : -2;
    if (pose === 'hurt') ox += 1;
    // Idle breathing: a 1px rise, staggered per member; faster and higher while choosing orders.
    const breathe = pose === 'idle' ? (Math.floor((f + p.uid * 23) / (active ? 16 : 34)) % 2) * (active ? 2 : 1) : 0;
    const x = Math.round(pos.x - frame.width / res / 2 + ox);
    const lift = beat ? beat.lift : dd.lunge;
    const y = Math.round(PARTY_BOTTOM - frame.height / res - dd.hop - lift - breathe + (pose === 'hurt' ? 2 : 0));
    if (down) {
      g.globalAlpha = 0.5;
      putArt(g, silhouetteCache(art.frames.hurt, '#3a3450'), x, y + 10, res);
      g.globalAlpha = 1;
      return;
    }
    if (dd.afterimage > 0) {
      // Speed ghosts trailing behind and to either side.
      for (const [gx, gy, a] of AFTERIMAGES) {
        g.globalAlpha = a * (dd.afterimage / 22);
        putArt(g, silhouetteCache(frame, MEMBERS[p.key as MemberId].color), x + gx, y + gy, res);
      }
      g.globalAlpha = 1;
    }
    if (beat && beat.smear > 0) {
      // The snap leaves a smear: tinted copies trailing back toward the line.
      const tint = MEMBERS[p.key as MemberId].color;
      for (let i = beat.smear; i >= 1; i--) {
        g.globalAlpha = 0.18 + 0.1 * (beat.smear - i);
        putArt(g, silhouetteCache(frame, tint), x, y + i * 4, res);
      }
      g.globalAlpha = 1;
    }
    putArt(g, frame, x, y, res);
    // The cut's lit trail shows only while the cut is happening, not through the settle.
    const glow = pose === 'strike' && beat?.phase === 'settle' ? undefined : art.glow[pose];
    if (glow) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.75 + 0.25 * Math.sin(f * 0.5);
      putArt(g, glow, x, y, res);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    if (active && this.s.mode !== 'target') this.drawArrow(g, p.uid, f, ACTIVE);
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      g.globalAlpha = 0.45;
      putArt(g, silhouetteCache(frame, '#ff5a5a'), x, y, res);
      g.globalAlpha = 1;
    }
  }

  /** A bouncing chevron over a combatant (world space: each pixel is two on screen). */
  private drawArrow(g: Ctx, uid: number, f: number, color: string): void {
    const u = this.s.battle.unit(uid);
    if (!u) return;
    let x: number, y: number;
    if (u.side === 'enemy') {
      const p = this.s.enemyPos(u);
      x = p.x + p.art.w / 2;
      y = p.y - 4;
    } else {
      const p = this.s.partyPos(u);
      x = p.x;
      y = PARTY_BOTTOM - this.s.partyArt.get(uid)!.headH - 3;
    }
    // Over an enemy it hangs above the head; over the crew it sits right on the hair, so it never
    // reaches up into the enemy row and reads as a target cursor (round 13).
    const b = Math.round(Math.sin(f * 0.25) * (u.side === 'enemy' ? 3 : 1.5));
    const top = u.side === 'enemy' ? y - 9 + b : y - 2 + b;
    // A chunky chevron (9 wide, 5 deep) with a dark outline all round, so it holds against any
    // backdrop, and a white glint across its top on the beat.
    g.fillStyle = '#0a0913';
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      for (let i = 0; i < 5; i++) g.fillRect(x - 4 + i + ox, top + i + oy, 9 - i * 2, 1);
    }
    g.fillStyle = color;
    for (let i = 0; i < 5; i++) g.fillRect(x - 4 + i, top + i, 9 - i * 2, 1);
    if (Math.sin(f * 0.25) > 0.3) {
      g.fillStyle = '#ffffff';
      g.fillRect(x - 3, top, 7, 1);
    }
  }
}
