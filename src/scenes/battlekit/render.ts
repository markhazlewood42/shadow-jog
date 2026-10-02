/**
 * Battle rendering: the backdrop, fighters, effects, floaters and every panel and menu, drawn
 * from the scene's state. The scene (scenes/battle.ts) owns state and flow (command entry, the
 * round, playback); this owns pixels. It reads the scene, and never changes game state.
 */
import type { Pose } from '../../art/battlers';
import { enemyArt } from '../../art/enemies';
import { getPortrait } from '../../art/portraits';
import type { Combatant, Command, Element } from '../../battle/types';
import { ABILITIES } from '../../data/abilities';
import { PARTY_POSE_T, swingBeat } from './motion';
import { type KataBeat, KATA_MEASURED, KATA_BODY_HALF, KATA_KNOCK, KATA_MEASURED_LOW, KATA_ROOM_GAP, KATA_ROOM_MAX, isContact, kataBeat } from '../../art/rig2/sidekata';
import { type SfBeat, SF_FADE, SF_MEASURED, SF_ROOM_MAX, SF_SWING, sfBeat } from '../../art/rig2/sfstrike';
import { ENEMIES, FAMILY_WEAK } from '../../data/enemies';
import { ITEMS } from '../../data/items';
import { MEMBERS } from '../../data/party';
import { surface, type Ctx, type Surface } from '../../engine/canvas';
import { postfx } from '../../engine/postfx';
import { drawParagraph, drawText, fitText, measure, wrap } from '../../engine/font';
import { H, W } from '../../engine/game';
import { state, type MemberId } from '../../game/state';
import { bandGradient, drawBar, drawWindow, hpColor, UI } from '../../ui/draw';
import { TARGET_INFO_W } from '../../ui/layout';
import type { BattleScene } from '../battle';
import { drawVictoryBanner } from './banner';
import { BHT, BW, CMD_W, DECK_CUT_LIFE, MENU_X, ORDER_BOTTOM, ORDER_FACE, ORDER_LEFT, ORDER_RIGHT, ORDER_TOP, PANEL_Y, orderStripLayout } from './geom';
import { INTRO_T, ShatterIntro } from './intro';
import { FACE, IDLE_FRAMES_PER_STEP, IDLE_FRAMES_PER_STEP_ACTIVE, SF, SF_BAR_RISE, SF_SETTLE_DIST, SIDE_PANEL_GAP, SIDE_VIEW, WALK_FRAMES_PER_STEP, sideBeat } from './sideview';
import { drawMiniDeck } from '../../art/deck';
import { DISSOLVE_STEPS, ENEMY_POSE_T, artTop, dissolved, drawBig, drawLag, enemyThumb, marked, mirrored, rimOf, silhouetteCache, variant } from './sprites';
import { AFTERIMAGES, ELEMENTS, ELEMENT_COLOR, ELEMENT_ICON, ELEMENT_TAG, STATUS_LABEL, elementMark, markElements, statusName } from './tables';

/**
 * Who is acting: one bright colour for the bouncing arrow, their status card and their turn-order
 * entry, so the three read as one signal (made louder after Mark's first playthrough, 2026-09-29).
 * Picking a target uses the menu cursor's cyan instead: acting and aiming never look alike.
 */
const ACTIVE = '#fff04a';
/** An enemy's tell: amber, the colour of a warning. */
const TELL_COLOR = '#ffb23a';
const AIMING = '#6ff3ff';
import { drawRing } from './timing';

let bigBandGrad: CanvasGradient | null = null;

/** Glyph effects (spell runes, numbers) don't glow: the glow pass skips them. */
const NO_GLYPH = (): void => undefined;

/**
 * The Warden's conduits, relative to its sprite: [from x (from the left edge if ≥ 0, else from the
 * right), from y, to x (screen-world), to y, sag]. A constant, so drawing them allocates nothing.
 */
const CONDUITS: readonly (readonly [number, number, number, number, number])[] = [
  [10, 24, -6, 4, 10],
  [-10, 24, BW + 6, 0, 12],
  [14, 44, -6, 58, 6],
  [-14, 44, BW + 6, 62, 6],
];

/** How the street names each kind of enemy (the target box's hint line). */
const FAMILY_NAME: Record<string, string> = { human: 'Chromed', machine: 'Machine', beast: 'Beast', spirit: 'Spirit', ghoul: 'Ghoul' };

/** Draw an enemy-art canvas at its battle-world size (its art may be finer than the world). */
function putArt(g: Ctx, c: HTMLCanvasElement, x: number, y: number, res: number): void {
  g.drawImage(c, x, y, c.width / res, c.height / res);
}

export class BattleRenderer {
  constructor(private readonly s: BattleScene) {}

  /** Wrapped top-line text, rebuilt only when the text changes. */
  private topKey = '';

  private topLines: { l: string; c: string }[] = [];

  private topW = 0;

  render(ctx: Ctx): void {
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
    el.setTransform(2, 0, 0, 2, 0, 0);
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
    // Side view: the crew are battle-scale art (one art pixel per screen pixel, like the enemies), so they go on this
    // screen-resolution layer, still at its 2x transform. On the world-resolution layer below (240x135) a 47 px sprite is
    // sampled 2:1 and loses three pixels in four, which is what made round 2's crew look noisy.
    // Whoever is mid-strike is drawn last, so a lunge passes in front of the line, not behind it.
    if (SIDE_VIEW) {
      const striking = (p: Combatant) => (this.s.d(p.uid).reachX ?? 0) !== 0 && this.s.d(p.uid).poseT > 0;
      for (const p of this.s.battle.party) if (!striking(p)) this.drawPartyMember(el, p, f);
      for (const p of this.s.battle.party) if (striking(p)) this.drawPartyMember(el, p, f);
    }
    el.setTransform(1, 0, 0, 1, 0, 0);
    // Party (back view)
    if (!SIDE_VIEW) for (const p of this.s.battle.party) this.drawPartyMember(g, p, f);
    // Foreground framing (rails, cables) over the fighters; FX and numbers stay on top of it.
    if (this.s.bg.fg) g.drawImage(this.s.bg.fg, 0, 0);
    this.s.fx.render(g, (c, ch, x, y, col) => drawText(c, ch, x, y, { color: col, shadow: false }));
    // A timed press: the ring closing on each target.
    const tp = this.s.timing.prompt;
    // Side view, Rook's kendo strike: the ring is gone from the first frame the blade is on the target, so nothing hides the blow.
    const bladeOn = SIDE_VIEW && this.s.battle.party.some((m) => this.strikeOf(m.uid)?.contact === true);
    if (tp && this.s.timing.isOpen && !bladeOn) {
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
      // its number the whole time); only the hit bounces. DoT ticks sink.
      const hit = fl.style === 'hit';
      const pop = 8 * (1 - (1 - Math.min(1, fl.t / 8)) ** 3);
      const rise = fl.style === 'tick' ? -Math.min(8, fl.t * 0.25) : pop + Math.max(0, fl.t - 24) * 0.15;
      const bounce = hit && fl.t >= 8 && fl.t < 20 ? Math.abs(Math.sin((fl.t - 8) * 0.52)) * 3 * (1 - (fl.t - 8) / 12) : 0;
      g.globalAlpha = fl.t > 38 ? Math.max(0, 1 - (fl.t - 38) / 12) : 1;
      drawText(g, fl.text, Math.round(fl.x), Math.round(fl.y - rise - bounce), { color: fl.color, align: 'center', shadow: '#0a0913' });
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
      ctx.drawImage(this.s.enemyLayer.canvas, sx * 2, sy * 2, sw * 2, sh * 2, shx, shy, W, H);
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
    const glow = dark ? null : postfx.glowLayer();
    if (glow) {
      postfx.bloom = 0.7 * (1 - Math.min(0.62, this.s.defeatT / 70));
      this.renderGlow(glow, shx, shy);
    }
    this.renderUi(postfx.active && postfx.ui ? postfx.ui : ctx);
  }

  /** The battle's light for the bloom: the backdrop's neon and every effect in flight. */
  private glowWorld: Surface | null = null;
  private renderGlow(glow: Ctx, shx: number, shy: number): void {
    this.glowWorld ??= surface(BW, BHT);
    const g = this.glowWorld.ctx;
    g.clearRect(0, 0, BW, BHT);
    if (this.s.bg.glow) g.drawImage(this.s.bg.glow, 0, 0);
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
    const { x, y, art } = this.s.enemyPos(u);
    const cx = (x + art.w / 2) * 2 + shx, cy = (y + art.h / 2) * 2 + shy;
    ctx.fillStyle = 'rgba(8,4,16,0.86)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.s.impactColor;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (this.s.impactT % 2) * 0.17;
      const r0 = 34 + (i % 3) * 10, r1 = 260;
      for (let r = r0; r < r1; r += 3) ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.62), i % 2 ? 1 : 2, 1);
    }
    ctx.drawImage(silhouetteCache(art.canvas, '#ffffff'), x * 2 + shx, y * 2 + shy, art.w * 2, art.h * 2);
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
        // Sprite Fusion side view: every copy faces the party (a mirrored second punk would turn its back), so no copy is mirrored; the armband tells them apart.
    const turn = dup % 2 === 1 && !SF;
    const canvas = own ? marked(turn ? mirrored(src.canvas) : src.canvas, e.family ?? '', dup) : marked(variant(src.canvas, dup), e.family ?? '', dup);
    const glow = !src.glow ? undefined : own ? (turn ? mirrored(src.glow) : src.glow) : variant(src.glow, dup);
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
    // Side view, Rook's cut: the body is pushed back 4 px from the blade (away from the crew: to the left for the code art, to the right for Sprite Fusion's) for two frames, then eases home.
    if (SIDE_VIEW && (dd.knock ?? 0) > 0) ox += FACE * (KATA_KNOCK[Math.min(KATA_KNOCK.length - 1, KATA_KNOCK.length - (dd.knock ?? 0))] ?? 0);
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
      g.fillStyle = SIDE_VIEW ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.35)';
      const cx = x + art.w / 2;
      const gy = y + art.h - 1;
      g.fillRect(Math.round(cx - art.shadow / 2), gy, art.shadow, 2);
      g.fillRect(Math.round(cx - art.shadow / 2 + 2), gy + 2, art.shadow - 4, 1);
      // Side view: a boss gets a wider, deeper contact patch, so it stands on the same ground as the crew instead of floating over a strip of it.
      if (SIDE_VIEW && e.boss) {
        g.fillRect(Math.round(cx - art.shadow / 2 - 4), gy - 1, art.shadow + 8, 1);
        g.fillRect(Math.round(cx - art.shadow / 2 + 4), gy + 3, art.shadow - 8, 1);
      }
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
    // (Sprite Fusion side view: the sprite carries its own dark outline instead, like the crew's.)
    if (!SF) {
      g.globalAlpha = alpha * 0.55;
      putArt(g, rimOf(canvas, this.s.rim), dx - 1 / res, dy - 1 / res, res);
    }
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

  /** Side view, Rook's kendo strike: where the pose is (null when he is not mid-strike). */
  private kataOf(uid: number): KataBeat | null {
    if (!SIDE_VIEW) return null;
    const dd = this.s.d(uid);
    if (!this.s.partyArt.get(uid)?.kata || dd.strikeAt === undefined || dd.poseT <= 0 || dd.poseT > (dd.poseLen ?? 0)) return null;
    return kataBeat((dd.poseLen ?? 0) - dd.poseT, dd.strikeAt, dd.strikeLow);
  }

  /** Sprite Fusion art, Rook's strike (rig2/sfstrike.ts): where the pose is (null when he is not mid-strike). */
  private sfOf(uid: number): SfBeat | null {
    if (!SIDE_VIEW) return null;
    const dd = this.s.d(uid);
    if (!this.s.partyArt.get(uid)?.sfStrike || dd.strikeAt === undefined || dd.poseT <= 0 || dd.poseT > (dd.poseLen ?? 0)) return null;
    return sfBeat((dd.poseLen ?? 0) - dd.poseT, dd.strikeAt);
  }

  /** Either strike (the code art's kendo cut or Sprite Fusion's frames): how far along its lunge the body is, and whether the blade is on the target. */
  private strikeOf(uid: number): { lunge: number; contact: boolean } | null {
    const kb = this.kataOf(uid);
    if (kb) return { lunge: kb.lunge, contact: isContact(kb.key) };
    const sk = this.sfOf(uid);
    return sk ? { lunge: sk.lunge, contact: sk.contact } : null;
  }

  /**
   * Side view, Rook's kendo strike: how far (world px, to the right) a crewmate steps aside to make room while he is on the target. His blade is
   * about 25 px long past his body, so against the nearest enemy he ends up standing where Kit does; she slides back toward his empty place
   * (up to 12 px) as he arrives, and returns as he goes home. Nobody is dimmed, and no crewmate is stood on.
   */
  private makeRoom(q: Combatant): number {
    if (!SIDE_VIEW) return 0;
    let room = 0;
    for (const p of this.s.battle.party) {
      if (p.uid === q.uid) continue;
      const kb = this.strikeOf(p.uid);
      if (!kb) continue;
      const dd = this.s.d(p.uid);
      const sx = this.s.partyPos(p).x;
      const rx = sx + (dd.reachX ?? 0);
      const qx = this.s.partyPos(q).x;
      const u = Math.max(0, Math.min(1, (kb.lunge - 0.5) / 0.45));
      if (SF) {
        // Sprite Fusion art: he runs right, so a crewmate between his place and where he ends steps back to the left, into the place he left (up to SF_ROOM_MAX world px): his body, coat and rear foot take about 30 world px.
        if (qx <= sx + 4 || qx > rx + 14) continue;
        const need = Math.max(0, Math.min(SF_ROOM_MAX, qx + 14 - (rx - 28)));
        room = Math.min(room, -need * u * u * (3 - 2 * u));
        continue;
      }
      if (qx < rx - 4) continue;
      const need = Math.max(0, Math.min(KATA_ROOM_MAX, rx + KATA_BODY_HALF + KATA_ROOM_GAP - (qx - 8)));
      room = Math.max(room, need * u * u * (3 - 2 * u));
    }
    return Math.round(room * 2) / 2;
  }

  /** Side view: the screen box (pixels) round a lunging Rook, or null; enemy health bars inside it fade so he does not run under one. */
  private lungeBox(): [number, number, number, number] | null {
    for (const p of this.s.battle.party) {
      const kb = this.strikeOf(p.uid);
      if (!kb || kb.lunge < 0.05) continue;
      const dd = this.s.d(p.uid);
      const cx = (this.s.partyPos(p).x + kb.lunge * (dd.reachX ?? 0)) * 2;
      const feet = (this.s.partyFeet(p) + kb.lunge * (dd.reachY ?? 0)) * 2;
      return SF ? [cx - 28, feet - 74, cx + 26, feet + 2] : [cx - 18, feet - 66, cx + 18, feet + 2];
    }
    return null;
  }

  /**
   * The strike's own effects. No ghosts and no dimming (round 3): the dash leaves a few speed lines behind the body, the blade flares as it
   * meets the target, and the front foot stamps a puff of dust. Everything is drawn on whole screen pixels (half a world pixel).
   */
  private drawKataFx(g: Ctx, p: Combatant, kb: KataBeat, frame: HTMLCanvasElement, x: number, y: number, res: number, walkLeft: number, lungeY: number, cx2: number): void {
    const dd = this.s.d(p.uid);
    const px = (v: number): number => Math.round(v * 2) / 2;
    // Speed lines on the cuts and the overshoot: thin pale streaks behind the body, level with the shoulders and the hips, longer the faster he is.
    if (kb.dash || kb.key === 'contact0' || kb.key === 'contact0Low') {
      const feet = this.s.partyFeet(p) + lungeY;
      const back = this.s.partyPos(p).x + walkLeft + kb.lunge * (dd.reachX ?? 0) + 7;
      const n = kb.key === 'swing0' ? 0 : kb.key === 'swing1' ? 1 : 2;
      const lines: [number, number][] = [[27, 14], [19, 22], [11, 12], [34, 9]];
      g.fillStyle = '#d8e6ff';
      g.globalAlpha = 0.6;
      for (const [up, len] of lines) g.fillRect(px(back + (n - 1) * 2), px(feet - up / 2), (len + n * 5) / 2, 0.5);
      g.globalAlpha = 1;
    }
    if (!isContact(kb.key)) return;
    const m = kb.key === 'contactLow' || kb.key === 'contact0Low' ? KATA_MEASURED_LOW : KATA_MEASURED;
    const gy2 = Math.round(this.s.partyFeet(p) - 1 + lungeY);
    const c = kb.key === 'contact0' || kb.key === 'contact0Low' ? 0 : kb.t + 1;
    // The blade's flare: bright streaks along it for the first frames of the blow, so the steel is seen before the flash.
    if (c < 4) {
      const tx = x + frame.width / res / 2 - m.tipReach / res;
      const ty = y + (frame.height - m.tipUp) / res;
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.95 - c * 0.22;
      for (const [dy, len] of [[-2.5, 12], [3.5, 9], [-4.5, 6]] as const) g.fillRect(px(tx + 1), px(ty + dy), len - c * 2, 0.5);
      g.globalAlpha = 1;
    }
    // The front foot stamps: a puff of street dust behind the heel in three stages of 2x2 clumps (one flat colour each, the street's own purples), spreading and rising, each 3 frames.
    if (c < 9) {
      const hx = Math.round(cx2 + KATA_MEASURED.footDx / res) + 4;
      const stage = Math.floor(c / 3);
      const puffs: [number, number][][] = [
        [[0, -1], [1, -1], [2, -2]],
        [[1, -2], [3, -2], [2, -4], [5, -1], [-1, -1]],
        [[3, -4], [6, -3], [2, -6], [7, -1]],
      ];
      g.globalAlpha = stage === 2 ? 0.65 : 1;
      (puffs[stage] ?? []).forEach(([dx, dy], i) => {
        g.fillStyle = i % 2 ? '#8c83ab' : '#b2a9cc';
        g.fillRect(hx + dx, gy2 + dy, 1, 1);
      });
      g.globalAlpha = 1;
    }
  }

  /**
   * Sprite Fusion's Rook strike: the stamping front foot kicks up a puff of street dust behind the heel as the blade lands (three stages of 2x2 clumps, nine frames from
   * the first swing frame B). Drawn in battle-world pixels on the enemy layer, like the code art's puff.
   */
  private drawSfDust(g: Ctx, p: Combatant, sk: SfBeat, lungeX: number, lungeY: number): void {
    const c = sk.key === 'swingB' ? sk.t : sk.key === 'followFade' ? SF_SWING + sk.t : sk.key === 'follow' ? SF_SWING + SF_FADE + sk.t : -1;
    if (c < 0 || c >= 9) return;
    const hx = Math.round(this.s.partyPos(p).x + lungeX + SF_MEASURED.footDx / 2) - 6;
    const gy = Math.round(this.s.partyFeet(p) - 1 + lungeY);
    const stage = Math.floor(c / 3);
    const puffs: [number, number][][] = [
      [[0, -1], [-1, -1], [-2, -2]],
      [[-1, -2], [-3, -2], [-2, -4], [-5, -1], [1, -1]],
      [[-3, -4], [-6, -3], [-2, -6], [-7, -1]],
    ];
    g.globalAlpha = stage === 2 ? 0.65 : 1;
    (puffs[stage] ?? []).forEach(([dx, dy], i) => {
      g.fillStyle = i % 2 ? '#8c83ab' : '#b2a9cc';
      g.fillRect(hx + (dx ?? 0), gy + (dy ?? 0), 1, 1);
    });
    g.globalAlpha = 1;
  }

  private drawPartyMember(g: Ctx, p: Combatant, f: number): void {
    const dd = this.s.d(p.uid);
    const art = this.s.partyArt.get(p.uid)!;
    const pos = this.s.partyPos(p);
    const active = (this.s.mode === 'command' || this.s.mode === 'list' || this.s.mode === 'target') && this.s.actor?.uid === p.uid;
    const down = dd.hp <= 0 && p.hp <= 0;
    // Melee moves play in beats: drawn in (the brace frame), the snap forward, the settle.
    const melee = dd.poseT > 0 && (dd.pose === 'attack' || dd.pose === 'thrust');
    // Side view: the strike plays on its own beats (sideBeat: crouch, wind-up, dash, blow, return); the back view's lift beats don't apply.
    const sk = SIDE_VIEW && melee ? this.sfOf(p.uid) : null;
    const sb = SIDE_VIEW && melee && !sk && dd.poseT <= PARTY_POSE_T ? sideBeat(PARTY_POSE_T - dd.poseT) : null;
    const beat = melee && !SIDE_VIEW ? swingBeat(PARTY_POSE_T - dd.poseT) : null;
    // Side view, Rook: the kendo strike plays on its own timeline (rig2/sidekata.ts), keyed to the frame the move's effect starts on.
    const kb = SIDE_VIEW && melee && art.kata && dd.strikeAt !== undefined && dd.poseT <= (dd.poseLen ?? 0) ? kataBeat((dd.poseLen ?? 0) - dd.poseT, dd.strikeAt, dd.strikeLow) : null;
    // The frame for each beat: gathered (brace), raised (the pose itself), then swept through
    // (strike) for the cut and the settle. Palm strikes (thrust) keep their own frame throughout.
    const through = beat && dd.pose === 'attack' && (beat.phase === 'cut' || beat.phase === 'settle');
    // Art with a wind-up of its own (Rook's raised sword) shows it for the gather's second half too:
    // the raise beat alone is two frames, too quick to read.
    const wound = art.windup && dd.pose === 'attack' && beat?.phase === 'gather' && PARTY_POSE_T - dd.poseT >= 3;
    const pose: Pose = sb ? sb.frame : dd.poseT > 0 ? (wound ? 'attack' : beat?.phase === 'gather' ? 'brace' : through ? 'strike' : dd.pose) : 'idle';
    // Side view: the wait loop plays in place of the rest frame, and the walk while stepping in.
    const walkLeft = this.s.sideWalk(p.order ?? 0);
    // Sprite Fusion art: a member who fades in over a short step (no run frame) is drawn at that opacity.
    const walkAlpha = SF ? this.s.sideWalkAlpha(p.order ?? 0) : 1;
    const cyc = art.cycle;
    const idleStep = cyc?.idleStep ?? (active ? IDLE_FRAMES_PER_STEP_ACTIVE : IDLE_FRAMES_PER_STEP);
    const walking = cyc !== undefined && pose === 'idle' && walkLeft !== 0;
    // Sprite Fusion art: over the last few pixels of the walk the run eases into the stance (a skid) where the member has a settle frame.
    const settle = walking && SF && cyc?.settle && Math.abs(walkLeft) < SF_SETTLE_DIST ? cyc.settle[Math.min(cyc.settle.length - 1, Math.floor((1 - Math.abs(walkLeft) / SF_SETTLE_DIST) * cyc.settle.length))] : undefined;
    const idleFrame = cyc ? cyc.idle[cyc.idleOrder[Math.floor((f + p.uid * 23) / idleStep) % cyc.idleOrder.length] ?? 0] : undefined;
    // A member with no walk frames of its own steps in on the idle loop, so the loop does not jump when it arrives.
    const frame = sk && art.sfStrike ? (sk.key === 'ready' && idleFrame ? idleFrame : art.sfStrike.frames[sk.key]) : kb && art.kata ? art.kata[kb.key] : cyc && pose === 'idle' ? (walking && cyc.walk.length > 0 ? (settle ?? cyc.walk[Math.floor((f - this.s.walkStart) / (cyc.walkStep ?? WALK_FRAMES_PER_STEP)) % cyc.walk.length]) : idleFrame) ?? art.frames[pose] : art.frames[pose];
    // Drawn art (the art pass) can be finer than the battle world: `res` art pixels per world pixel.
    const res = art.res ?? 1;
    let ox = 0;
    if (dd.shake > 0) ox = dd.shake % 4 < 2 ? 2 : -2;
    // Side view: a crewmate in the way of Rook's strike steps aside (see makeRoom).
    const room = this.makeRoom(p);
    ox += room;
    // Side view: a hit knocks the body back (away from the enemies: against the way the party faces) and it springs back over the pose.
    const hurtK = SIDE_VIEW && dd.poseT > 0 && dd.pose === 'hurt' ? 16 - dd.poseT : -1;
    if (hurtK >= 0) ox -= FACE * Math.max(0, 2.5 * (1 - hurtK / 10));
    else if (pose === 'hurt') ox -= FACE;
    // Idle breathing: a 1px rise, staggered per member; faster and higher while choosing orders.
    const breathe = pose === 'idle' && !cyc ? (Math.floor((f + p.uid * 23) / (active ? 16 : 34)) % 2) * (active ? 2 : 1) : 0;
    // Side view: positions land on a native pixel (half a world pixel); otherwise on a world pixel.
    const snap = SIDE_VIEW ? (v: number) => Math.round(v * 2) / 2 : Math.round;
    // Side view: how far along its lunge the body is, in world pixels.
    const lungeK = sk ? sk.lunge : kb ? kb.lunge : sb ? sb.lunge : 0;
    const lungeX = lungeK * (dd.reachX ?? 0);
    const lungeY = lungeK * (dd.reachY ?? 0);
    const x = snap(pos.x - frame.width / res / 2 + ox + walkLeft + lungeX);
    const lift = beat ? beat.lift : dd.lunge;
    const cx2 = Math.round(pos.x + walkLeft + lungeX);
    const y = snap(this.s.partyFeet(p) - frame.height / res - dd.hop - lift - breathe + lungeY + (pose === 'hurt' && !SIDE_VIEW ? 2 : 0));
    if (down) {
      g.globalAlpha = 0.5;
      putArt(g, silhouetteCache(art.frames.hurt, '#3a3450'), x, y + 10, res);
      g.globalAlpha = 1;
      return;
    }
    if (walkAlpha < 1) g.globalAlpha = walkAlpha;
    if (SIDE_VIEW) {
      // The crew plant on the street with a soft contact shadow, as the enemies do (it stays on the ground through a lunge or a hop).
      const cx = Math.round(pos.x + walkLeft + lungeX + (hurtK >= 0 ? ox : room));
      const gy = Math.round(this.s.partyFeet(p) - 1 + lungeY);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(cx - 9, gy, 18, 2);
      g.fillRect(cx - 7, gy + 2, 14, 1);
      g.fillRect(cx - 7, gy - 1, 14, 1);
    }
    // Sprite Fusion art: a dash (Kit's run, Rook's low lunge) leaves speed ghosts trailing behind it until the skid.
    if (SF && walking && cyc?.walkGhosts && Math.abs(walkLeft) > SF_SETTLE_DIST + 16) {
      const tint = MEMBERS[p.key as MemberId].color;
      for (let i = cyc.walkGhosts; i >= 1; i--) {
        g.globalAlpha = walkAlpha * (0.12 + 0.06 * (cyc.walkGhosts - i));
        putArt(g, silhouetteCache(frame, tint), x - FACE * i * 3, y, res);
      }
      g.globalAlpha = walkAlpha;
    }
    if (sk && art.sfStrike) this.drawSfDust(g, p, sk, lungeX, lungeY);
    if (kb && art.kata) this.drawKataFx(g, p, kb, frame, x, y, res, walkLeft, lungeY, cx2);
    if (!kb && dd.afterimage > 0) {
      // Speed ghosts trailing behind and to either side.
      for (const [gx, gy, a] of AFTERIMAGES) {
        g.globalAlpha = a * (dd.afterimage / 22);
        putArt(g, silhouetteCache(frame, MEMBERS[p.key as MemberId].color), x + gx, y + gy, res);
      }
      g.globalAlpha = 1;
    }
    if (sk?.dash) {
      // Sprite Fusion's Rook: the two swing frames leave speed ghosts trailing the body (his tint), the second more than the first.
      const tint = MEMBERS[p.key as MemberId].color;
      const n = sk.key === 'swingB' ? 3 : 2;
      for (let i = n; i >= 1; i--) {
        g.globalAlpha = 0.12 + 0.07 * (n - i);
        putArt(g, silhouetteCache(frame, tint), x - FACE * i * 3.5, y, res);
      }
      g.globalAlpha = 1;
    }
    if (!kb && sb && sb.smear > 0) {
      // Side view: the dash leaves speed ghosts trailing behind it, away from the target.
      const tint = MEMBERS[p.key as MemberId].color;
      const n = sb.smear;
      for (let i = n; i >= 1; i--) {
        g.globalAlpha = 0.14 + 0.07 * (n - i);
        putArt(g, silhouetteCache(frame, tint), x - FACE * i * 2.5, y, res);
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
    // Side view: whoever is giving orders gets a one-pixel outline in the active colour, beating on the half second, so the small
    // sprite reads as the actor without the arrow alone (round 3).
    if (SIDE_VIEW && active) {
      const sil = silhouetteCache(frame, ACTIVE);
      g.globalAlpha = 0.55 + 0.35 * Math.sin(f * 0.15);
      for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]] as const) putArt(g, sil, x + dx, y + dy, res);
      g.globalAlpha = 1;
    }
    putArt(g, frame, x, y, res);
    g.globalAlpha = 1;
    // Side view: the first frames of a hit show the body's own pixels in white, then a faint red tint (instead of a red wash over the whole sprite).
    if (SIDE_VIEW && dd.flash > 0 && !down) {
      if (dd.flash >= 6) {
        g.globalAlpha = 0.9;
        putArt(g, silhouetteCache(frame, '#ffffff'), x, y, res);
      } else if (dd.flash % 4 < 2) {
        g.globalAlpha = 0.28;
        putArt(g, silhouetteCache(frame, '#ff5a5a'), x, y, res);
      }
      g.globalAlpha = 1;
    }
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
    if (!SIDE_VIEW && dd.flash > 0 && dd.flash % 4 < 2) {
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
      // Side view: hang the chevron just over the health bar, wherever the prompt window has pushed it (the bar sits 6 screen pixels over the art, never above row 24).
      // Sprite Fusion art (round 4): the chevron rides 2 to 6 screen px over the bar's plate, and, for a front-row creature whose bar is under its feet, just over its head.
      if (SIDE_VIEW) y = Math.max(24, (p.y + artTop(p.art)) * 2 - (SF ? (p.front ? -1 : SF_BAR_RISE) : 3)) / 2;
    } else {
      const p = this.s.partyPos(u);
      x = p.x;
      y = this.s.partyFeet(u) - this.s.partyArt.get(uid)!.headH - 3;
      // Side view, Rook's kendo strike: the arrow rides the body through the lunge, and clears the raised blade (it would sit on it).
      const dd = this.s.d(uid);
      const sk = this.sfOf(uid);
      if (sk) {
        x += sk.lunge * (dd.reachX ?? 0);
        y += sk.lunge * (dd.reachY ?? 0);
        if (sk.key === 'windup' || sk.dash) y -= 13;
        if (sk.lunge > 0.12) return;
      } else if (SIDE_VIEW && this.s.partyArt.get(uid)?.kata && dd.strikeAt !== undefined && dd.poseT > 0 && dd.poseT <= (dd.poseLen ?? 0)) {
        const kb = kataBeat((dd.poseLen ?? 0) - dd.poseT, dd.strikeAt, dd.strikeLow);
        x += kb.lunge * (dd.reachX ?? 0);
        y += kb.lunge * (dd.reachY ?? 0);
        if (kb.key === 'lift' || kb.key === 'overhead' || kb.dash) y -= 13;
        // Over the enemy line it would sit on their health bars: the lunging body is its own marker.
        if (kb.lunge > 0.12) return;
      }
    }
    // Over an enemy it hangs above the head; over the crew it sits right on the hair, so it never
    // reaches up into the enemy row and reads as a target cursor (round 13).
    const b = Math.round(Math.sin(f * 0.25) * (u.side === 'enemy' ? (SIDE_VIEW ? 1 : 3) : 1.5));
    const top = u.side === 'enemy' ? Math.max(SIDE_VIEW ? 1 : -99, y - (SF ? 8 : 9) + b) : y - (SIDE_VIEW ? 5 : 2) + b;
    // Side view: the target cursor is white (the cyan one vanished against cyan neon signs), with its dark outline.
    const fill = SIDE_VIEW && color === AIMING ? '#ffffff' : color;
    // A chunky chevron (9 wide, 5 deep) with a dark outline all round, so it holds against any
    // backdrop, and a white glint across its top on the beat.
    // Sprite Fusion art (round 4): a dark plate behind the chevron, like the health bars', so a white chevron holds over a pale shop sign.
    if (SF && color === AIMING) {
      g.fillStyle = 'rgba(10,9,19,0.78)';
      g.fillRect(x - 6, top - 2, 13, 8);
    }
    g.fillStyle = '#0a0913';
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      for (let i = 0; i < 5; i++) g.fillRect(x - 4 + i + ox, top + i + oy, 9 - i * 2, 1);
    }
    g.fillStyle = fill;
    for (let i = 0; i < 5; i++) g.fillRect(x - 4 + i, top + i, 9 - i * 2, 1);
    if (Math.sin(f * 0.25) > 0.3) {
      g.fillStyle = fill === '#ffffff' ? '#ffd24a' : '#ffffff';
      g.fillRect(x - 3, top, 7, 1);
    }
  }

  /**
   * Over each enemy, stacked upward from the head: an HP bar (always shown), active status
   * chips, and any weaknesses the crew has found (by Analyze or by landing a weak hit).
   */
  private renderEnemyStatus(ctx: Ctx): void {
    for (const e of this.s.battle.enemies) {
      if (e.hp <= 0) continue;
      const dd = this.s.d(e.uid);
      if (dd.dying > 0 || dd.alpha < 0.5) continue;
      const { x, y, art, front } = this.s.enemyPos(e);
      const cx0 = Math.round((x + art.w / 2) * 2);
      // Sprite Fusion side view (round 4): the plate sits fully OVER the art (its bottom 3 screen px above the top of the head), not across the scanner or the mohawk.
      let row = Math.max(24, (y + artTop(art)) * 2 - (SF ? SF_BAR_RISE : SIDE_VIEW ? 3 : 6));
      // Sprite Fusion side view: a front-row creature stands over the legs of the row behind it, so its bar goes UNDER its feet (below the contact shadow) instead of across them; its chips and tags still stack over its head.
      const barRow = front && SF ? (y + art.h) * 2 + 5 : row;
      // HP bar (bosses get a wider one).
      const bw = e.boss ? 72 : 30;
      const ratio = Math.max(0, dd.shownHp / e.base.maxHp);
      // A solid dark plate and a 3px bar, so it holds up over bright signage. Side view: it fades while Rook's lunge runs through it.
      const lb = this.lungeBox();
      if (lb && cx0 + bw / 2 + 2 > lb[0] && cx0 - bw / 2 - 2 < lb[2] && barRow + 5 > lb[1] && barRow - 2 < lb[3]) ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(cx0 - bw / 2 - 2, barRow - 2, bw + 4, 7);
      ctx.fillStyle = '#2a2838';
      ctx.fillRect(cx0 - bw / 2, barRow, bw, 3);
      ctx.fillStyle = hpColor(ratio);
      ctx.fillRect(cx0 - bw / 2, barRow, Math.round(bw * ratio), 3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(cx0 - bw / 2, barRow, Math.round(bw * ratio), 1);
      drawLag(ctx, cx0 - bw / 2, barRow, bw, 3, ratio, dd.lagHp / e.base.maxHp);
      ctx.globalAlpha = 1;
      if (!(front && SF)) row -= 11;
      // While numbers are rising off this enemy, its chips and WEAK tag step aside (the HP bar
      // stays): the two text systems share the rows above its head.
      let floating = false;
      for (const f of this.s.floaters) if (f.uid === e.uid && f.t < 50) floating = true;
      if (floating) continue;
      // Status chips: measure, then draw (two passes, nothing allocated per frame).
      let count = 0, total = 0;
      for (const s of e.status) {
        const l = STATUS_LABEL[s.id];
        if (!l || s.id === 'guard') continue;
        if (count < 3) total += measure(l[0]) + 5;
        count++;
      }
      if (count) {
        const more = count - Math.min(count, 3);
        if (more) total += measure(`+${more}`) + 3;
        let cx = Math.round(cx0 - total / 2);
        let drawn = 0;
        for (const s of e.status) {
          const l = STATUS_LABEL[s.id];
          if (!l || s.id === 'guard' || drawn === 3) continue;
          const w = measure(l[0]) + 4;
          ctx.fillStyle = '#0a0913';
          ctx.fillRect(cx, row, w, 9);
          ctx.fillStyle = l[1];
          ctx.fillRect(cx, row + 8, w, 1);
          drawText(ctx, l[0], cx + 2, row + 1, { color: l[1], shadow: false });
          cx += w + 1;
          drawn++;
        }
        if (more) drawText(ctx, `+${more}`, cx + 1, row + 1, { color: UI.dim });
        row -= 11;
      }
      // Known weaknesses.
      const seen = state.weakSeen[e.key];
      let n = 0, width = measure('WEAK') + 2;
      for (const el of ELEMENTS) {
        if (e.analyzed ? (e.weak?.[el] ?? 1) > 1 : seen?.includes(el)) {
          width += measure(ELEMENT_ICON[el]) + 3;
          n++;
        }
      }
      if (!n) continue;
      let wx = Math.round(cx0 - width / 2);
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(wx - 2, row, width + 4, 9);
      drawText(ctx, 'WEAK', wx, row + 1, { color: UI.amber, shadow: false });
      wx += measure('WEAK') + 4;
      for (const el of ELEMENTS) {
        if (!(e.analyzed ? (e.weak?.[el] ?? 1) > 1 : seen?.includes(el))) continue;
        // The same symbols as the battle menus, so "weak to this" matches "this move is".
        drawText(ctx, ELEMENT_ICON[el], wx, row + 1, { color: ELEMENT_COLOR[el], shadow: false });
        wx += measure(ELEMENT_ICON[el]) + 3;
      }
    }
  }

  /** Top of the top-line strip: under a pinned tell when there is one. */
  private topY(): number {
    return this.s.tell ? 26 : 6;
  }

  /** A pinned enemy tell: an amber box across the top, with a warning mark, flashing as it arrives. */
  private renderTell(ctx: Ctx): void {
    const t = this.s.tell;
    if (!t) return;
    const text = fitText(t.text, W - 56);
    const tw = measure(text) + 34;
    const x = Math.round((W - tw) / 2);
    const flash = t.t < 24 && (t.t >> 2) % 2 === 0;
    drawWindow(ctx, x, 6, tw, 17, { plain: true, accent: flash ? '#ffffff' : TELL_COLOR });
    ctx.fillStyle = TELL_COLOR;
    ctx.fillRect(x + 8, 9, 9, 11);
    drawText(ctx, '!', x + 11, 10, { color: '#1a1020', shadow: false });
    drawText(ctx, text, x + 22, 10, { color: '#ffe2a8' });
  }

  private renderUi(ctx: Ctx): void {
    if (this.s.mode !== 'intro') this.renderEnemyStatus(ctx);
    this.renderPanel(ctx);
    this.renderTell(ctx);
    const top = this.topY();
    // Top line: action banner or message
    if (this.s.banner) {
      const b = this.s.banner;
      const a = b.t < 6 ? b.t / 6 : b.t > (b.big ? 60 : 50) ? Math.max(0, 1 - (b.t - (b.big ? 60 : 50)) / 10) : 1;
      ctx.globalAlpha = a;
      if (b.big) {
        const y = 92;
        bigBandGrad ??= bandGradient(ctx, 0, W, 0.15, 0.9);
        ctx.fillStyle = bigBandGrad;
        ctx.fillRect(0, y, W, 32);
        ctx.fillStyle = b.color;
        ctx.fillRect(40, y, W - 80, 1);
        ctx.fillRect(40, y + 31, W - 80, 1);
        drawBig(ctx, b.text, W / 2, y + 4, b.color);
        if (b.sub) drawText(ctx, b.sub, W / 2, y + 22, { align: 'center', color: '#ffffff' });
      } else {
        const tw = measure(b.text) + 24;
        drawWindow(ctx, (W - tw) / 2, top, tw, 17, { plain: true, accent: b.color });
        drawText(ctx, b.text, W / 2, top + 4, { align: 'center', color: b.color });
      }
      ctx.globalAlpha = 1;
    } else if (this.s.message) {
      const tw = Math.min(W - 20, measure(this.s.message.text) + 24);
      drawWindow(ctx, (W - tw) / 2, top, tw, 17, { plain: true });
      drawText(ctx, this.s.message.text, W / 2, top + 4, { align: 'center' });
    }
    if (this.s.message && this.s.banner && !this.s.banner.big) {
      const tw = Math.min(W - 20, measure(this.s.message.text) + 24);
      drawWindow(ctx, (W - tw) / 2, top + 20, tw, 17, { plain: true });
      drawText(ctx, this.s.message.text, W / 2, top + 24, { align: 'center' });
    }
    switch (this.s.mode) {
      case 'round':
        this.renderRoundMenu(ctx);
        break;
      case 'command':
        this.renderCmdMenu(ctx);
        break;
      case 'list':
        this.renderCmdMenu(ctx, false);
        this.renderList(ctx);
        break;
      case 'target':
        this.renderTargetInfo(ctx);
        break;
    }
    if (this.s.mode === 'round' || this.s.mode === 'command' || this.s.mode === 'list' || this.s.mode === 'target' || this.s.mode === 'play') this.renderOrder(ctx);
    this.renderCutins(ctx);
    if (this.s.bannerStart >= 0) drawVictoryBanner(ctx, this.s.frame - this.s.bannerStart);
    if (this.s.endPanel) this.s.endPanel(ctx);
  }

  /** The coming round's turn order, cached against the orders given so far. */
  private order: { key: number; list: number[][] } | null = null;

  /** Turn order as it stands: orders given so far, everyone else assumed to attack. */
  private turnOrder(): readonly number[][] {
    const key = this.s.battle.round * 100 + this.s.cmds.length;
    if (this.order?.key === key) return this.order.list;
    const given = new Set(this.s.cmds.map((c) => c.actor));
    const rest: Command[] = this.s.actors().filter((p) => !given.has(p.uid)).map((p) => ({ actor: p.uid, type: 'attack', target: -1 }));
    const list = this.s.battle.previewOrder([...this.s.cmds, ...rest]);
    this.order = { key, list };
    return list;
  }

  /**
   * The turn-order strip, down the right edge (the menus keep the left): who acts when this
   * round, as faces. While orders are given it updates as they go in (Guard goes first, items
   * early, a combo as one) and outlines the member giving orders and the enemy being aimed at.
   * While the round plays it is the real queue: the entry acting now stands out, the ones done
   * fade back.
   */
  private renderOrder(ctx: Ctx): void {
    const playing = this.s.mode === 'play';
    const list = playing ? this.s.battle.roundOrder : this.turnOrder();
    if (!list.length) return;
    const at = playing ? this.s.battle.roundAt : -1;
    const side = 'right';
    // Laid out once per change of order or side (orderStripLayout), like the list itself.
    if (this.orderRects.source !== list || this.orderRects.side !== side) {
      const faces: number[] = [];
      for (const acts of list) faces.push(acts.length);
      this.orderRects = { source: list, side, rects: orderStripLayout(faces, side) };
    }
    const rects = this.orderRects.rects;
    const edgeX = side === 'right' ? ORDER_RIGHT : ORDER_LEFT;
    drawText(ctx, 'TURN', edgeX, ORDER_TOP - 10, { color: UI.dim, align: side });
    const acting = this.s.mode === 'round' || playing ? undefined : this.s.actor?.uid;
    const aimed = this.s.mode === 'target' ? this.s.targetList[this.s.targetIdx] : undefined;
    const pulse = 0.6 + 0.4 * Math.sin(this.s.frame * 0.18);
    for (let k = 0; k < rects.length; k++) {
      const actors = list[k]!, rr = rects[k]!;
      const lead = this.s.battle.unit(actors[0]!);
      if (!lead) continue;
      const now = playing ? k === at : actors.includes(acting ?? -1);
      const hot = now || actors.includes(aimed ?? -1);
      const done = playing && k < at;
      // The entry acting now steps out toward the field, so the eye finds it without reading faces.
      const r = now ? { x: rr.x - 5, y: rr.y, w: rr.w, h: rr.h } : rr;
      if (done) ctx.globalAlpha = 0.35;
      const edge = actors.length > 1 ? '#ffe07a' : lead.side === 'party' ? MEMBERS[lead.key as MemberId].color : '#ff6a6a';
      if (now) {
        // A two-pixel frame in the acting colour, breathing.
        ctx.fillStyle = '#0a0913';
        ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = ACTIVE;
        ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = hot ? AIMING : edge;
        ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      }
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      for (let i = 0; i < actors.length; i++) {
        const u = this.s.battle.unit(actors[i]!);
        if (!u) continue;
        const eart = u.side === 'party' ? null : enemyArt(ENEMIES[u.key]!.sprite);
        const img = eart ? enemyThumb(eart.canvas, eart.res) : getPortrait(u.key, 'neutral');
        if (img) ctx.drawImage(img, r.x + 1 + i * ORDER_FACE, r.y + 1, 12, 12);
        // Two of a kind: which one, by the letter in its name (Glowrat A, Glowrat B).
        if (u.side === 'enemy' && this.s.twins(u)) {
          const lx = r.x + i * ORDER_FACE + 8, ly = r.y + 6;
          ctx.fillStyle = '#0a0913';
          ctx.fillRect(lx - 1, ly - 1, 7, 9);
          drawText(ctx, String.fromCharCode(65 + this.s.dupIndex(u)), lx, ly, { color: '#ffffff', shadow: false });
        }
      }
      if (hot) {
        // A pointer on the inside edge, toward the field.
        ctx.fillStyle = now ? ACTIVE : AIMING;
        const px = r.x - 6;
        ctx.fillRect(px, r.y + 4, 3, 7);
        ctx.fillRect(px - 1, r.y + 5, 1, 5);
        ctx.fillRect(px - 2, r.y + 6, 1, 3);
      }
      ctx.globalAlpha = 1;
    }
    if (rects.length < list.length) drawText(ctx, `+${list.length - rects.length}`, edgeX, ORDER_BOTTOM - 2, { color: UI.dim, align: side });
  }
  /** The strip's rects for the current order (recomputed only when the order changes). */
  private orderRects: { source: readonly number[][] | null; side: 'left' | 'right'; rects: { x: number; y: number; w: number; h: number }[] } = { source: null, side: 'right', rects: [] };


  /** Hex's deck, up over her card while a program runs: slides up, scrolls code, slides away. */
  private renderDeckCutin(ctx: Ctx): void {
    const t = this.s.deckT;
    const i = this.s.battle.party.findIndex((p) => p.key === 'hex');
    if (t < 0 || i < 0) return;
    const inK = Math.min(1, t / 8), outK = Math.max(0, (t - (DECK_CUT_LIFE - 8)) / 8);
    const k = (1 - (1 - inK) ** 3) * (1 - outK);
    const x = this.s.boxX(i) + 116 - 80, y = Math.round(PANEL_Y - 4 - k * 44);
    ctx.fillStyle = 'rgba(10,9,19,0.9)';
    ctx.fillRect(x - 4, y - 4, 80, 48);
    ctx.fillStyle = '#c3a0ff';
    ctx.fillRect(x - 4, y - 4, 80, 1);
    drawMiniDeck(ctx, x, y, t);
  }

  private renderCutins(ctx: Ctx): void {
    this.renderDeckCutin(ctx);
    for (const c of this.s.cutins) {
      if (c.t > c.life) continue;
      const m = MEMBERS[c.key as MemberId];
      const port = getPortrait(c.key, c.face);
      if (!m || !port) continue;
      // Slide in fast, hold, slide back out.
      const inK = Math.min(1, c.t / 8), outK = Math.max(0, (c.t - (c.life - 10)) / 10);
      const k = (1 - (1 - inK) ** 3) * (1 - outK);
      const w = c.line ? 184 : 132, h = 58, y = 132 - (c.row ?? 0) * 62;
      const x = c.fromLeft ? Math.round(-w + k * (w + 12)) : Math.round(W - k * (w + 12));
      ctx.fillStyle = 'rgba(10,9,19,0.92)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = m.color;
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(c.fromLeft ? x + w - 3 : x, y, 3, h);
      const px = c.fromLeft ? x + w - 58 : x + 8;
      ctx.fillStyle = UI.outline;
      ctx.fillRect(px - 1, y + 4, 50, 50);
      ctx.drawImage(port, px, y + 5, 48, 48);
      const tx = c.fromLeft ? x + 10 : x + 62;
      if (c.line) {
        drawText(ctx, m.name.toUpperCase(), tx, y + 10, { color: m.color });
        drawParagraph(ctx, `“${c.line}”`, tx, y + 23, w - 72, { color: UI.text, lineH: 11 });
      } else drawText(ctx, m.name.toUpperCase(), tx, y + 22, { color: m.color });
    }
  }

  private renderPanel(ctx: Ctx): void {
    const party = this.s.battle.party;
    party.forEach((p, i) => {
      const dd = this.s.d(p.uid);
      const m = MEMBERS[p.key as MemberId];
      const active = (this.s.mode === 'command' || this.s.mode === 'list' || this.s.mode === 'target') && this.s.actor?.uid === p.uid;
      const targeted = this.s.mode === 'target' && this.s.targetList[this.s.targetIdx] === p.uid;
      const x = this.s.boxX(i) + (dd.shake > 0 ? (dd.shake % 4 < 2 ? 1 : -1) : 0);
      const y = PANEL_Y - (active ? 5 : 0);
      drawWindow(ctx, x, y, 116, 52, { accent: active || targeted ? m.color : '#3a3f6e', plain: !(active || targeted), alpha: 0.94 });
      if (active || targeted) {
        // The card of whoever is giving orders (or being aimed at): a two-pixel frame outside the
        // window in the acting colour, breathing, so it reads from across the room.
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.s.frame * 0.18);
        ctx.fillStyle = targeted ? AIMING : ACTIVE;
        ctx.fillRect(x - 2, y - 2, 120, 2);
        ctx.fillRect(x - 2, y + 52, 120, 2);
        ctx.fillRect(x - 2, y, 2, 52);
        ctx.fillRect(x + 116, y, 2, 52);
        ctx.globalAlpha = 1;
      }
      const down = dd.hp <= 0;
      const ratio = dd.hp / p.base.maxHp;
      // Portrait: the member's face reacts to the fight.
      const face = down || (dd.poseT > 0 && dd.pose === 'hurt') || ratio < 0.3 ? 'hurt' : dd.poseT > 0 && dd.pose === 'victory' ? 'happy' : 'neutral';
      const port = getPortrait(p.key, face);
      ctx.fillStyle = UI.outline;
      ctx.fillRect(x + 4, y + 4, 26, 26);
      if (port) {
        if (down) ctx.globalAlpha = 0.35;
        ctx.drawImage(port, x + 5, y + 5, 24, 24);
        ctx.globalAlpha = 1;
      }
      drawText(ctx, m.name, x + 34, y + 5, { color: down ? UI.disabled : m.color });
      drawText(ctx, down ? 'DOWN' : `Lv${p.level}`, x + 110, y + 5, { color: down ? UI.red : UI.dim, align: 'right' });
      // Queued command mark on the portrait's corner.
      const queued = this.s.cmds.find((c) => c.actor === p.uid);
      if (queued && (this.s.mode === 'command' || this.s.mode === 'list' || this.s.mode === 'target')) {
        const inCombo = this.s.comboActors.has(p.uid);
        drawText(ctx, inCombo ? '★' : '•', x + 24, y + 3, { color: inCombo ? UI.amber : UI.green });
      }
      drawText(ctx, 'HP', x + 34, y + 17, { color: UI.dim });
      const shown = Math.max(0, dd.shownHp) / p.base.maxHp;
      drawText(ctx, `${Math.max(0, Math.round(dd.shownHp))}/${p.base.maxHp}`, x + 110, y + 17, { align: 'right', color: ratio < 0.25 && !down ? UI.red : UI.text });
      drawBar(ctx, x + 34, y + 28, 75, 2, shown, hpColor(shown));
      drawLag(ctx, x + 34, y + 28, 75, 2, shown, dd.lagHp / p.base.maxHp);
      if (p.base.maxTp > 0) {
        drawText(ctx, m.tpLabel, x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${Math.round(dd.shownTp)}/${p.base.maxTp}`, x + 110, y + 33, { align: 'right' });
        drawBar(ctx, x + 7, y + 44, 102, 2, dd.shownTp / p.base.maxTp, UI.cyan);
      } else {
        // Rook: skill charges instead of TP, with the same bar (charges left of the full set).
        let total = 0, full = 0;
        for (const id in p.maxUses) {
          total += p.uses[id] ?? 0;
          full += p.maxUses[id] ?? 0;
        }
        drawText(ctx, 'SKILL', x + 7, y + 33, { color: UI.dim });
        drawText(ctx, `${total}/${full} uses`, x + 110, y + 33, { align: 'right' });
        drawBar(ctx, x + 7, y + 44, 102, 2, full ? total / full : 0, UI.amber);
      }
      // Status: the first ailment tagged on the portrait's lower edge, plus a count.
      let tags = 0;
      for (const st of p.status) {
        const lab = STATUS_LABEL[st.id];
        if (!lab || st.id === 'guard' || st.id === 'cover') continue;
        if (tags++ === 0) {
          ctx.fillStyle = 'rgba(10,9,19,0.85)';
          ctx.fillRect(x + 5, y + 21, measure(lab[0]) + 3, 8);
          drawText(ctx, lab[0], x + 6, y + 21, { color: lab[1], shadow: false });
        }
      }
      if (tags > 1) drawText(ctx, `+${tags - 1}`, x + 8 + measure('WWW'), y + 21, { color: UI.dim, shadow: false });
    });
  }

  /** One or two centred lines in the top slot, where action banners play during a round. */
  private topLine(ctx: Ctx, text: string, color: string = UI.dim, second?: { text: string; color: string }): void {
    // Text wider than the screen wraps onto a second line instead of running off the window.
    const key = `${text}|${second?.text ?? ''}|${color}`;
    if (key !== this.topKey) {
      const maxW = W - 44;
      const lines = wrap(text, maxW).map((l) => ({ l, c: color }));
      const extra = second ? wrap(second.text, maxW).map((l) => ({ l, c: second.color })) : [];
      this.topKey = key;
      this.topLines = [...lines, ...extra];
      this.topW = Math.min(W - 20, Math.max(...this.topLines.map((a) => measure(a.l))) + 24);
    }
    const all = this.topLines, tw = this.topW, y = this.topY();
    drawWindow(ctx, (W - tw) / 2, y, tw, 6 + all.length * 11, { plain: true, accent: second ? second.color : UI.cyan });
    all.forEach((a, i) => {
      drawText(ctx, a.l, W / 2, y + 4 + i * 11, { align: 'center', color: a.c });
    });
  }

  private renderRoundMenu(ctx: Ctx): void {
    const x = MENU_X, y = PANEL_Y - 60 - (SIDE_VIEW ? SIDE_PANEL_GAP : 0);
    drawWindow(ctx, x, y, 84, 54, { title: `ROUND ${this.s.battle.round + 1}` });
    this.s.roundMenu.render(ctx, x + 8, y + 8, 72);
    const help: Record<string, string> = {
      fight: 'Give each crew member orders.',
      repeat: this.s.telegraphed()
        ? 'Something big is coming. Give fresh orders.'
        : this.s.roundMenu.items[1]?.enabled === false ? 'No orders to repeat yet.' : 'Repeat last round’s orders.',
      auto: this.s.setup.boss ? 'Not against a boss. Give orders.' : 'Everyone attacks.',
      run: this.s.battle.canRun && !this.s.setup.boss ? 'Try to escape.' : 'You can’t run from this fight.',
    };
    const h = help[this.s.roundMenu.current?.value ?? ''];
    if (h && !this.s.banner && !this.s.message) this.topLine(ctx, h);
  }

  private renderCmdMenu(ctx: Ctx, active = true): void {
    const a = this.s.actor;
    if (!a) return;
    const h = this.s.cmdMenu.items.length * 11 + 12;
    const x = this.s.menuX(a, CMD_W), y = PANEL_Y - h - 6 - (SIDE_VIEW ? SIDE_PANEL_GAP : 0);
    drawWindow(ctx, x, y, CMD_W, h, { accent: MEMBERS[a.key as MemberId].color, title: a.name.toUpperCase(), alpha: active ? 1 : 0.85 });
    this.s.cmdMenu.render(ctx, x + 7, y + 7, CMD_W - 8, active);
  }

  private renderList(ctx: Ctx): void {
    const a = this.s.actor;
    if (!a) return;
    // Stacked above the command window, and above the party's heads, so the field stays readable.
    const items = this.s.listMenu.items;
    let widest = measure('Nothing to use.');
    for (const it of items) widest = Math.max(widest, measure(it.label) + (it.icon ? measure(it.icon) + 3 : 0) + (it.right ? measure(it.right) + 12 : 0));
    // Cursor and margins (the list draws labels 9px in, and the window has 8px either side).
    const w = Math.min(210, Math.max(120, widest + 32));
    const h = Math.min(this.s.listMenu.rows, Math.max(1, items.length)) * 11 + 14;
    const cmdTop = PANEL_Y - (this.s.cmdMenu.items.length * 11 + 12) - 6;
    // Side view: the enemies are left of the party, so a window stacked above the command menu would cover
    // them. It sits beside the command menu instead, on the open ground under the enemies.
    const x = SIDE_VIEW ? MENU_X + CMD_W + 4 : this.s.menuX(a, w), y = SIDE_VIEW ? PANEL_Y - h - 6 - SIDE_PANEL_GAP : cmdTop - h - 4;
    const kind = this.s.listKind === 'item' ? 'Items' : this.s.listKind === 'skill' ? 'Skills' : this.s.cmdMenu.items.find((i) => i.value === 'tech')?.label ?? 'Techs';
    drawWindow(ctx, x, y, w, h, { title: `${a.name} · ${kind}`.toUpperCase(), accent: MEMBERS[a.key as MemberId].color });
    this.s.listMenu.render(ctx, x + 8, y + 8, w - 14, true, 'Nothing to use.');
    const cur = this.s.listMenu.current;
    if (!cur) return;
    const desc = this.s.listKind === 'item' ? ITEMS[cur.value]!.desc : ABILITIES[cur.value]!.desc;
    // Combo hint: would this choice pair with an order already given?
    const hint = this.s.listKind === 'item' ? '' : this.s.comboHint(cur.value);
    this.topLine(ctx, markElements(desc), '#d8d6ec', hint ? { text: hint, color: UI.amber } : undefined);
  }

  /**
   * What the target box says about an enemy, worked out when the target or the crew's notes change
   * (not every frame): its weaknesses as far as they're known, its resistances and immunities, and
   * before anything is known, the street wisdom about its kind ("likely weak", with a question mark).
   */
  private targetNotes(u: Combatant): { weak: string; guess: string; notes: [string, string][] } {
    const seenW = state.weakSeen[u.key]?.length ?? 0, seenR = state.resistSeen[u.key]?.length ?? 0, seenI = state.immuneSeen[u.key]?.length ?? 0;
    const key = u.uid * 10000 + (u.analyzed ? 5000 : 0) + seenW * 100 + seenR * 10 + seenI;
    if (this.targetCache?.key === key) return this.targetCache.value;
    // Analyzed: the whole chart. Otherwise what the crew has learned the hard way.
    const weak = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => k) : (state.weakSeen[u.key] ?? []);
    const res = u.analyzed ? Object.entries(u.weak ?? {}).filter(([, v]) => (v ?? 1) < 1).map(([k]) => k) : (state.resistSeen[u.key] ?? []);
    const imm = u.analyzed ? (u.immune ?? []) : (state.immuneSeen[u.key] ?? []);
    const notes: [string, string][] = [];
    // Element names as the chips over the enemies write them (ELEMENT_TAG), everywhere.
    if (res.length) notes.push([`RESISTS ${res.map((el) => `${elementMark(el as Element)}${ELEMENT_TAG[el as Element]}`).join(' ')}`, '#b8bcd0']);
    if (imm.length) notes.push([`IMMUNE ${imm.map(statusName).join(' ')}`, '#c9b8ff']);
    // Nothing learned yet: what everyone on the street knows about its kind.
    let guess = '';
    if (!weak.length && u.family) {
      const own = ENEMIES[u.key]?.weak;
      const fam = Object.entries(FAMILY_WEAK[u.family] ?? {}).filter(([k, v]) => (v ?? 1) > 1 && (own?.[k as Element] ?? 2) > 1).map(([k]) => `${elementMark(k as Element)}${ELEMENT_TAG[k as Element]}`);
      if (fam.length) guess = `${FAMILY_NAME[u.family]}: likely weak to ${fam.join(' ')}?`;
    }
    const value = { weak: weak.length ? `WEAK ${weak.map((el) => `${elementMark(el as Element)}${ELEMENT_TAG[el as Element]}`).join(' ')}` : '', guess, notes };
    if (guess) value.notes.unshift([guess, '#b89a66']);
    this.targetCache = { key, value };
    return value;
  }
  private targetCache: { key: number; value: { weak: string; guess: string; notes: [string, string][] } } | null = null;

  private renderTargetInfo(ctx: Ctx): void {
    const uid = this.s.targetList[this.s.targetIdx];
    const u = uid !== undefined ? this.s.battle.unit(uid) : undefined;
    if (!u) return;
    // The box sits on the far side of the screen from its target (clear of the turn-order strip
    // on the right), so it never covers the target or the arrow over it.
    const w = TARGET_INFO_W;
    const tx = this.s.pos(u.uid).x * 2;
    const name = this.s.label(u);
    const info = u.side === 'enemy' ? this.targetNotes(u) : null;
    const boxH = info ? 19 + (u.analyzed ? 11 : 0) + info.notes.length * 10 : 19;
    // Side view: the enemies fill the top and middle of the screen, so the box takes the open ground
    // under them (the command windows' place, which are hidden while aiming), whoever is aimed at.
    const x = SIDE_VIEW ? MENU_X + 4 : tx < W / 2 ? W - 44 - w : 8;
    const y = SIDE_VIEW ? PANEL_Y - 6 - SIDE_PANEL_GAP - boxH : 44;
    if (info) {
      const { weak, notes } = info;
      drawWindow(ctx, x, y, w, boxH, { plain: true, accent: UI.amber });
      drawText(ctx, name, x + 8, y + 5, { color: '#ffd0d0' });
      const bestiary = state.bestiary[u.key] ?? 0;
      if (weak) drawText(ctx, fitText(weak, w - 24 - measure(name)), x + w - 8, y + 5, { align: 'right', color: UI.amber });
      else if (!u.analyzed) drawText(ctx, bestiary ? `Defeated ×${bestiary}` : 'Unknown', x + w - 8, y + 5, { align: 'right', color: UI.dim });
      let ny = y + 15;
      if (u.analyzed) {
        drawBar(ctx, x + 8, y + 19, w - 70, 3, u.hp / u.base.maxHp, hpColor(u.hp / u.base.maxHp));
        drawText(ctx, `${u.hp}/${u.base.maxHp}`, x + w - 8, y + 15, { align: 'right', color: UI.dim });
        ny += 11;
      }
      for (const [text, color] of notes) {
        drawText(ctx, fitText(text, w - 16), x + 8, ny, { color });
        ny += 10;
      }
    } else {
      drawWindow(ctx, x, y, w, 19, { plain: true, accent: UI.amber });
      drawText(ctx, name, x + 8, y + 5, { color: MEMBERS[u.key as MemberId]?.color ?? UI.text });
      drawText(ctx, `${u.hp}/${u.base.maxHp}`, x + w - 8, y + 5, { align: 'right', color: UI.dim });
    }
  }

}
