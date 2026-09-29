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
import { ENEMIES, FAMILY_WEAK } from '../../data/enemies';
import { ITEMS } from '../../data/items';
import { MEMBERS } from '../../data/party';
import type { Ctx } from '../../engine/canvas';
import { drawParagraph, drawText, fitText, measure, wrap } from '../../engine/font';
import { H, W } from '../../engine/game';
import { knownAbilities, maxUses } from '../../game/party';
import { state, type MemberId } from '../../game/state';
import { bandGradient, drawBar, drawWindow, hpColor, UI } from '../../ui/draw';
import { TARGET_INFO_W } from '../../ui/layout';
import type { BattleScene } from '../battle';
import { drawVictoryBanner } from './banner';
import { BHT, BW, CMD_W, DECK_CUT_LIFE, MENU_X, ORDER_BOTTOM, ORDER_FACE, ORDER_LEFT, ORDER_RIGHT, ORDER_TOP, PANEL_Y, PARTY_BOTTOM, orderStripLayout } from './geom';
import { INTRO_T, ShatterIntro } from './intro';
import { drawMiniDeck } from '../../art/deck';
import { DISSOLVE_STEPS, ENEMY_POSE_T, dissolved, drawBig, drawLag, enemyThumb, marked, mirrored, opaqueTop, rimOf, silhouetteCache, variant } from './sprites';
import { AFTERIMAGES, ELEMENTS, ELEMENT_COLOR, ELEMENT_ICON, ELEMENT_TAG, STATUS_LABEL, elementMark, statusName } from './tables';

/**
 * Who is acting: one bright colour for the bouncing arrow, their status card and their turn-order
 * entry, so the three read as one signal (made louder after Mark's first playthrough, 2026-09-29).
 * Picking a target uses the menu cursor's cyan instead: acting and aiming never look alike.
 */
const ACTIVE = '#fff04a';
const AIMING = '#6ff3ff';
import { drawRing } from './timing';

let bigBandGrad: CanvasGradient | null = null;

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

export class BattleRenderer {
  constructor(private readonly s: BattleScene) {}

  /** Wrapped top-line text, rebuilt only when the text changes. */
  private topKey = '';

  private topLines: { l: string; c: string }[] = [];

  private topW = 0;

  render(ctx: Ctx): void {
    const g = this.s.world.ctx;
    const f = this.s.frame;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.s.bg.canvas, 0, 0);
    if (this.s.bg.glow) g.drawImage(this.s.bg.glow, 0, 0);
    this.s.bg.anim?.(g, f);
    // Enemies, back to front
    // Back to front, into a reused buffer.
    const order = this.s.drawOrder;
    order.length = 0;
    for (const e of this.s.battle.enemies) if (this.s.d(e.uid).alpha > 0.01) order.push(e);
    order.sort(this.s.byFeet);
    for (const e of order) this.drawEnemy(g, e, f);
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
    } else ctx.drawImage(this.s.world.canvas, shx, shy, W, H);
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
    this.renderUi(ctx);
  }

  /**
   * An impact frame, for the hits that end things (a critical, a combo landing): two frames where
   * the world drops to near-black, the target is a white cut-out and speed lines burst from it.
   * A different kind of event from a normal hit, not just more sparks.
   */
  private renderImpact(ctx: Ctx, shx: number, shy: number): void {
    const u = this.s.impactOn!;
    const { x, y, art } = this.s.enemyPos(u);
    const cx = (x + art.canvas.width / 2) * 2 + shx, cy = (y + art.canvas.height / 2) * 2 + shy;
    ctx.fillStyle = 'rgba(8,4,16,0.86)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = this.s.impactColor;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (this.s.impactT % 2) * 0.17;
      const r0 = 34 + (i % 3) * 10, r1 = 260;
      for (let r = r0; r < r1; r += 3) ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.62), i % 2 ? 1 : 2, 1);
    }
    ctx.drawImage(silhouetteCache(art.canvas, '#ffffff'), x * 2 + shx, y * 2 + shy, art.canvas.width * 2, art.canvas.height * 2);
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
      const cx = x + art.canvas.width / 2;
      const gy = y + art.canvas.height - 1;
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
      g.drawImage(dissolved(canvas, Math.min(DISSOLVE_STEPS, Math.floor(k * (DISSOLVE_STEPS + 1)))), dx, dy - lift);
      if (dd.dying < 6) {
        g.globalAlpha = 0.5 * (1 - dd.dying / 6);
        g.drawImage(silhouetteCache(canvas, '#ffffff'), dx, dy - lift);
      }
      g.globalAlpha = 1;
      return;
    }
    if (e.key === 'warden') this.drawConduits(g, dx, dy, art.canvas.width, f, !!e.memory.charging);
    // A heavy hit lands on the body: it squashes flat and wide from the feet, then snaps back.
    const hurtK = dd.poseT > 0 && dd.pose === 'hurt' ? 16 - dd.poseT : -1;
    const squash = hurtK >= 0 && hurtK < 8 ? (hurtK < 2 ? 1 : 1 - (hurtK - 2) / 6) : 0;
    if (squash > 0) {
      const fx = dx + art.canvas.width / 2, fy = dy + art.canvas.height;
      g.save();
      g.translate(fx, fy);
      g.scale(1 + 0.12 * squash, 1 - 0.1 * squash);
      g.translate(-fx, -fy);
    }
    // Rim light in a colour the backdrop doesn't use, so no enemy blends into the set.
    g.globalAlpha = alpha * 0.55;
    g.drawImage(rimOf(canvas, this.s.rim), dx - 1, dy - 1);
    g.globalAlpha = alpha;
    g.drawImage(canvas, dx, dy);
    if (this.s.bg.tintAmt > 0) {
      // Ambient tint: multiply-ish wash using the background light color.
      g.globalAlpha = alpha * this.s.bg.tintAmt;
      g.drawImage(silhouetteCache(canvas, this.s.bg.tint), dx, dy);
      g.globalAlpha = alpha;
    }
    if (glow) g.drawImage(glow, dx, dy);
    if (castGlow > 0) {
      g.globalAlpha = alpha * castGlow;
      g.drawImage(silhouetteCache(canvas, '#e8d8ff'), dx, dy);
      g.globalAlpha = alpha;
    }
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      // A blink, not a blank: the sprite's detail stays visible under the white, so a still
      // caught on this frame reads as a hit rather than a white smear.
      g.globalAlpha = 0.55 * alpha;
      g.drawImage(silhouetteCache(canvas, '#ffffff'), dx, dy);
    }
    g.globalAlpha = 1;
    if (squash > 0) g.restore();
  }

  /** The Warden is wired into the facility: sagging conduits run from its frame to the screen edges. */
  private drawConduits(g: Ctx, x: number, y: number, w: number, f: number, charging: boolean): void {
    const pulse = charging ? '#ff5a4a' : '#6ff3ff';
    const speed = charging ? 0.05 : 0.018;
    for (let i = 0; i < CONDUITS.length; i++) {
      const [from, fy, x1, ty, sag] = CONDUITS[i]!;
      const x0 = from >= 0 ? x + from : x + w + from, y0 = y + fy, y1 = y + ty;
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
    const pose: Pose = dd.poseT > 0 ? (beat?.phase === 'gather' ? 'brace' : through ? 'strike' : dd.pose) : 'idle';
    const frame = art.frames[pose];
    let ox = 0;
    if (dd.shake > 0) ox = dd.shake % 4 < 2 ? 2 : -2;
    if (pose === 'hurt') ox += 1;
    // Idle breathing: a 1px rise, staggered per member; faster and higher while choosing orders.
    const breathe = pose === 'idle' ? (Math.floor((f + p.uid * 23) / (active ? 16 : 34)) % 2) * (active ? 2 : 1) : 0;
    const x = Math.round(pos.x - frame.width / 2 + ox);
    const lift = beat ? beat.lift : dd.lunge;
    const y = Math.round(PARTY_BOTTOM - frame.height - dd.hop - lift - breathe + (pose === 'hurt' ? 2 : 0));
    if (down) {
      g.globalAlpha = 0.5;
      g.drawImage(silhouetteCache(art.frames.hurt, '#3a3450'), x, y + 10);
      g.globalAlpha = 1;
      return;
    }
    if (dd.afterimage > 0) {
      // Speed ghosts trailing behind and to either side.
      for (const [gx, gy, a] of AFTERIMAGES) {
        g.globalAlpha = a * (dd.afterimage / 22);
        g.drawImage(silhouetteCache(frame, MEMBERS[p.key as MemberId].color), x + gx, y + gy);
      }
      g.globalAlpha = 1;
    }
    if (beat && beat.smear > 0) {
      // The snap leaves a smear: tinted copies trailing back toward the line.
      const tint = MEMBERS[p.key as MemberId].color;
      for (let i = beat.smear; i >= 1; i--) {
        g.globalAlpha = 0.18 + 0.1 * (beat.smear - i);
        g.drawImage(silhouetteCache(frame, tint), x, y + i * 4);
      }
      g.globalAlpha = 1;
    }
    g.drawImage(frame, x, y);
    // The cut's lit trail shows only while the cut is happening, not through the settle.
    const glow = pose === 'strike' && beat?.phase === 'settle' ? undefined : art.glow[pose];
    if (glow) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.75 + 0.25 * Math.sin(f * 0.5);
      g.drawImage(glow, x, y);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    if (active && this.s.mode !== 'target') this.drawArrow(g, p.uid, f, ACTIVE);
    if (dd.flash > 0 && dd.flash % 4 < 2) {
      g.globalAlpha = 0.45;
      g.drawImage(silhouetteCache(frame, '#ff5a5a'), x, y);
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
      x = p.x + p.art.canvas.width / 2;
      y = p.y - 4;
    } else {
      const p = this.s.partyPos(u);
      x = p.x;
      y = PARTY_BOTTOM - this.s.partyArt.get(uid)!.headH - 3;
    }
    const b = Math.round(Math.sin(f * 0.25) * 3);
    const top = y - 9 + b;
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

  /**
   * Over each enemy, stacked upward from the head: an HP bar (always shown), active status
   * chips, and any weaknesses the crew has found (by Analyze or by landing a weak hit).
   */
  private renderEnemyStatus(ctx: Ctx): void {
    for (const e of this.s.battle.enemies) {
      if (e.hp <= 0) continue;
      const dd = this.s.d(e.uid);
      if (dd.dying > 0 || dd.alpha < 0.5) continue;
      const { x, y, art } = this.s.enemyPos(e);
      const cx0 = Math.round((x + art.canvas.width / 2) * 2);
      let row = Math.max(24, (y + opaqueTop(art.canvas)) * 2 - 6);
      // HP bar (bosses get a wider one).
      const bw = e.boss ? 72 : 30;
      const ratio = Math.max(0, dd.shownHp / e.base.maxHp);
      // A solid dark plate and a 3px bar, so it holds up over bright signage.
      ctx.fillStyle = '#0a0913';
      ctx.fillRect(cx0 - bw / 2 - 2, row - 2, bw + 4, 7);
      ctx.fillStyle = '#2a2838';
      ctx.fillRect(cx0 - bw / 2, row, bw, 3);
      ctx.fillStyle = hpColor(ratio);
      ctx.fillRect(cx0 - bw / 2, row, Math.round(bw * ratio), 3);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(cx0 - bw / 2, row, Math.round(bw * ratio), 1);
      drawLag(ctx, cx0 - bw / 2, row, bw, 3, ratio, dd.lagHp / e.base.maxHp);
      row -= 11;
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

  private renderUi(ctx: Ctx): void {
    if (this.s.mode !== 'intro') this.renderEnemyStatus(ctx);
    this.renderPanel(ctx);
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
        drawWindow(ctx, (W - tw) / 2, 6, tw, 17, { plain: true, accent: b.color });
        drawText(ctx, b.text, W / 2, 10, { align: 'center', color: b.color });
      }
      ctx.globalAlpha = 1;
    } else if (this.s.message) {
      const tw = Math.min(W - 20, measure(this.s.message.text) + 24);
      drawWindow(ctx, (W - tw) / 2, 6, tw, 17, { plain: true });
      drawText(ctx, this.s.message.text, W / 2, 10, { align: 'center' });
    }
    if (this.s.message && this.s.banner && !this.s.banner.big) {
      const tw = Math.min(W - 20, measure(this.s.message.text) + 24);
      drawWindow(ctx, (W - tw) / 2, 26, tw, 17, { plain: true });
      drawText(ctx, this.s.message.text, W / 2, 30, { align: 'center' });
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
        const img = u.side === 'party' ? getPortrait(u.key, 'neutral') : enemyThumb(enemyArt(ENEMIES[u.key]!.sprite).canvas);
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
        const known = knownAbilities(state.members[p.key as MemberId]!, 'skill');
        const total = known.reduce((n, id) => n + (p.uses[id] ?? 0), 0);
        const full = known.reduce((n, id) => n + maxUses(p.key as MemberId, id), 0);
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
    const all = this.topLines, tw = this.topW;
    drawWindow(ctx, (W - tw) / 2, 6, tw, 6 + all.length * 11, { plain: true, accent: second ? second.color : UI.cyan });
    all.forEach((a, i) => {
      drawText(ctx, a.l, W / 2, 10 + i * 11, { align: 'center', color: a.c });
    });
  }

  private renderRoundMenu(ctx: Ctx): void {
    const x = MENU_X, y = PANEL_Y - 60;
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
    const x = this.s.menuX(a, CMD_W), y = PANEL_Y - h - 6;
    drawWindow(ctx, x, y, CMD_W, h, { accent: MEMBERS[a.key as MemberId].color, title: a.name.toUpperCase(), alpha: active ? 1 : 0.85 });
    this.s.cmdMenu.render(ctx, x + 7, y + 7, CMD_W - 8, active);
  }

  private renderList(ctx: Ctx): void {
    const a = this.s.actor;
    if (!a) return;
    // Stacked above the command window, and above the party's heads, so the field stays readable.
    const items = this.s.listMenu.items;
    const widest = items.reduce((m, it) => Math.max(m, measure(it.label) + (it.right ? measure(it.right) + 12 : 0)), measure('Nothing to use.'));
    const w = Math.min(190, Math.max(120, widest + 30));
    const h = Math.min(this.s.listMenu.rows, Math.max(1, items.length)) * 11 + 14;
    const cmdTop = PANEL_Y - (this.s.cmdMenu.items.length * 11 + 12) - 6;
    const x = this.s.menuX(a, w), y = cmdTop - h - 4;
    const kind = this.s.listKind === 'item' ? 'Items' : this.s.listKind === 'skill' ? 'Skills' : this.s.cmdMenu.items.find((i) => i.value === 'tech')?.label ?? 'Techs';
    drawWindow(ctx, x, y, w, h, { title: `${a.name} · ${kind}`.toUpperCase(), accent: MEMBERS[a.key as MemberId].color });
    this.s.listMenu.render(ctx, x + 8, y + 8, w - 14, true, 'Nothing to use.');
    const cur = this.s.listMenu.current;
    if (!cur) return;
    const desc = this.s.listKind === 'item' ? ITEMS[cur.value]!.desc : ABILITIES[cur.value]!.desc;
    // Combo hint: would this choice pair with an order already given?
    const hint = this.s.listKind === 'item' ? '' : this.s.comboHint(cur.value);
    this.topLine(ctx, desc, '#d8d6ec', hint ? { text: hint, color: UI.amber } : undefined);
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
      const fam = Object.entries(FAMILY_WEAK[u.family] ?? {}).filter(([, v]) => (v ?? 1) > 1).map(([k]) => `${elementMark(k as Element)}${ELEMENT_TAG[k as Element]}`);
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
    const w = TARGET_INFO_W, y = 44;
    const tx = this.s.pos(u.uid).x * 2;
    const x = tx < W / 2 ? W - 44 - w : 8;
    const name = this.s.label(u);
    if (u.side === 'enemy') {
      const { weak, notes } = this.targetNotes(u);
      drawWindow(ctx, x, y, w, 19 + (u.analyzed ? 11 : 0) + notes.length * 10, { plain: true, accent: UI.amber });
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
