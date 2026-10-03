/**
 * The side-view battle HUD as Phaser objects (spike `spike/phaser-stage`). Each region of the design (the turn
 * timeline on top, the party table bottom-left, the command icons bottom-centre, the enemy box bottom-right, the
 * skill banner, the combo counter) is one Phaser **Container** placed at the box the stage config gives it; its
 * pieces are Images (window frames, text, face chips, icons, from `hudkit.ts`) and a Graphics for the bars.
 *
 * Layout inside a box is the design's, ported from the mockup script (`hud_*` in `render.py`); the positions of
 * the boxes, their opacity and when they show come from `stage.hud`, so moving a region in the config moves the
 * widget. The numbers come from a `HudView` (`demo.ts`), so a widget never knows where they came from.
 *
 * Also here, because they are text drawn over the stage from the same view: the **active tag** over the acting
 * hero's head, the **target label** over the aimed-at enemy (with its A/B letter), and the **damage number**.
 * They are positioned from the figures' current feet and edges (`FigureGeo`) the scene hands in.
 *
 * **HUD polish, round 1** (docs/spikes/phaser-stage.md): the three boxes along the bottom are framed as ONE band with dividers
 * (`bandPlans`), and the command strip keeps its slot during an action (a dimmed "standby" strip) so the band never has a hole;
 * panels are partly see-through; the acting hero's row is lit in the cyan of the ring on the stage; health bars go green, amber,
 * red and blink under a quarter; the party table shows statuses and a resource bar; the timeline has bigger chips, A/B tags, a
 * glowing "next" chip and a dim preview of the next round; the commands name every icon; the enemy box sizes itself to its
 * contents; damage numbers are tinted by the kind of hit and outlined two pixels thick.
 *
 * Hero colours: each hero has one colour (`MEMBERS[id].color`: Kit coral, Rook sand, Hex lilac, Sable cream), used the same way
 * everywhere: the name in the party table, the rim of the hero's chip on the timeline, the text of the name tab over the active
 * hero. Cyan is never a hero colour; it always means "the one acting now" (the ring, the table row, the tab's stripe).
 *
 * `render` rebuilds everything that is shown (cheap: it runs when the view changes, not every frame) and then
 * removes the text, window and face textures no longer in use.
 */
import type Phaser from 'phaser';
import type { HudRegion, StageConfig } from './config';
import { SCREEN_W } from './config';
import type { HudFoeView, HudMemberView, HudView } from './demo';
import { COMMAND_ICONS, COMMAND_INFO, iconRaw } from './icons';
import { type BandPlan, bandPlans, foeLayout, foeName, isShown, targetTab, type PlacedChip, type RegionName, timelineLayout } from './hudlayout';
import { CHIP_PAD, CHIP_PREFIX, chipTexture, HIT_COLOUR, hitKind, hpColor, iconTexture, NUMBER_LOOK, numberScale, statusIconTexture, TEXT_PREFIX, textAt, textTexture, type TextOptions, textWidth, UI, WINDOW_PREFIX, windowTexture } from './hudkit';
import { pickStatuses, STATUS_ICON_SIZE } from './hudstatus';
import { PREFIX, pruneTextures } from './textures';

/** Where a figure is on the screen right now, for the labels placed relative to it. */
export interface FigureGeo {
  /** Feet. */
  x: number;
  y: number;
  /** The drawn pixels' top edge, left edge and right edge on the screen. */
  top: number;
  left: number;
  right: number;
  boss: boolean;
}

export interface HudGeo {
  party: FigureGeo[];
  foes: FigureGeo[];
}

/** Face textures for the chips: the stage's sprites, cut to a size. */
export interface HudFaces {
  party(index: number, size: number): string;
  foe(index: number, size: number): string;
}

/** The depth the HUD draws at: above every fighter (their numbers stay below 300,000) and the stage's labels. */
export const HUD_DEPTH = 2_000_000;
/** The depth of the labels over the stage (active tag, target label, damage number). */
export const MARK_DEPTH = 1_000_000;

export class Hud {
  private readonly boxes = new Map<RegionName, Phaser.GameObjects.Container>();
  /** Containers that are not one of the six regions: the unified bottom band and the standby command strip. */
  private extras: Phaser.GameObjects.Container[] = [];
  private marks: Phaser.GameObjects.GameObject[] = [];
  private used = new Set<string>();
  /** The things that blink when someone is under a quarter health: `on` shows in one half of the blink, `off` (when there is one) in the other. */
  private blinkers: Array<{ on: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics; off: Phaser.GameObjects.Image | null }> = [];
  private clock = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly faces: HudFaces,
  ) {}

  /** Every game object the HUD currently has (for tests and tools). */
  get objects(): Phaser.GameObjects.GameObject[] {
    return [...this.boxes.values(), ...this.extras, ...this.marks];
  }

  /** The container of a region (absent when it is hidden). */
  box(name: RegionName): Phaser.GameObjects.Container | undefined {
    return this.boxes.get(name);
  }

  /** The frames that are not one of the six boxes: the unified bottom band and, during an action, the standby command strip (for tests). */
  get frames(): Phaser.GameObjects.Container[] {
    return this.extras;
  }

  /** How many low-health blinkers are on screen (for tests). */
  get blinking(): number {
    return this.blinkers.length;
  }

  /** Whether each blinker's "on" half is showing right now (for tests). */
  blinkerStates(): boolean[] {
    return this.blinkers.map((b) => b.on.visible);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.boxes.clear();
    this.extras = [];
    this.marks = [];
    this.blinkers = [];
  }

  /** One tick of the stage clock: the low-health blink follows it (every 16 ticks, about a quarter of a second). */
  tick(clock: number): void {
    this.clock = clock;
    const phase = Math.floor(clock / BLINK_TICKS) % 2 === 0;
    for (const b of this.blinkers) {
      b.on.setVisible(phase);
      b.off?.setVisible(!phase);
    }
  }

  /** Rebuild the HUD for this stage's layout and this view. */
  render(stage: StageConfig, view: HudView, geo: HudGeo): void {
    this.destroy();
    this.used = new Set();
    const h = stage.hud;
    const show = (name: RegionName, region: HudRegion): boolean => isShown(name, region.show, view.phase);

    // The bottom band first (it sits under the boxes): one frame behind the boxes that stand side by side.
    const plans = bandPlans(h);
    const framed = new Set<RegionName>(plans.flatMap((p) => p.members));
    for (const plan of plans) this.band(plan);

    if (show('turnOrder', h.turnOrder)) this.timeline(stage, view);
    if (show('partyStatus', h.partyStatus)) this.partyTable(stage, view, framed.has('partyStatus'));
    if (show('commands', h.commands)) this.commands(stage, view, framed.has('commands'), false);
    // The strip does not vanish during an action: its slot stays, dimmed, and says what is playing.
    else if (h.commands.show !== 'never' && framed.has('commands')) this.commands(stage, view, true, true);
    if (show('enemyInfo', h.enemyInfo)) this.enemyBox(stage, view, framed.has('enemyInfo'));
    if (show('banner', h.banner) && view.banner) this.banner(stage, view);
    if (show('combo', h.combo) && view.act) this.combo(stage, view);

    // While an action plays the banner already names the actor, and the tag would sit on the target's neighbourhood.
    if (h.activeTag?.show === 'always' && view.phase !== 'act') this.activeTag(stage, view, geo);
    if (view.phase === 'target' && view.target !== null && h.enemyInfo.names !== 'never') this.targetLabel(view, geo);
    this.lowHealthMarks(view, geo);
    if (view.phase === 'act' && view.act && !view.act.liveNumbers) this.damageNumber(view, geo);

    this.tick(this.clock);
    for (const prefix of [TEXT_PREFIX, WINDOW_PREFIX, CHIP_PREFIX, PREFIX.face]) pruneTextures(this.scene.textures, prefix, this.used);
  }

  // ---------------------------------------------------------------- building blocks

  private container(name: RegionName, r: HudRegion, x = r.x, y = r.y): Phaser.GameObjects.Container {
    // scrollFactor 0: a screen shake moves the stage, never the HUD.
    const c = this.scene.add.container(x, y).setDepth(HUD_DEPTH).setScrollFactor(0);
    this.boxes.set(name, c);
    return c;
  }

  /** A container that is not a region (the band, the standby strip). */
  private extra(x: number, y: number, depth = HUD_DEPTH): Phaser.GameObjects.Container {
    const c = this.scene.add.container(x, y).setDepth(depth).setScrollFactor(0);
    this.extras.push(c);
    return c;
  }

  private image(c: Phaser.GameObjects.Container | null, key: string, x: number, y: number, depth = HUD_DEPTH): Phaser.GameObjects.Image {
    this.used.add(key);
    const img = this.scene.add.image(x, y, key).setOrigin(0, 0);
    if (c) c.add(img);
    else img.setDepth(depth);
    return img;
  }

  private window(c: Phaser.GameObjects.Container, w: number, h: number, accent: string, region: { opacity?: number }, plain: boolean): void {
    this.image(c, windowTexture(this.scene.textures, w, h, accent, region.opacity ?? 1, plain), 0, 0);
  }

  /** A string at (x, y) in a box (x is the left, centre or right edge of the letters, y their top). */
  private text(c: Phaser.GameObjects.Container | null, str: string, x: number, y: number, opts: TextOptions & { align?: 'left' | 'center' | 'right'; depth?: number } = {}): Phaser.GameObjects.Image {
    const t = textTexture(this.scene.textures, str, opts);
    const at = textAt(t, str, x, y, opts.align ?? 'left', opts.scale ?? 1);
    return this.image(c, t.key, at.x, at.y, opts.depth);
  }

  /** The game's health bar: dark outline, back, fill, and a lit top line. */
  private bar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ratio: number, color: string): void {
    const r = Math.max(0, Math.min(1, ratio));
    g.fillStyle(hex(UI.outline), 1).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(hex(UI.barBack), 1).fillRect(x, y, w, h);
    const fw = Math.round(w * r);
    if (fw > 0) {
      g.fillStyle(hex(color), 1).fillRect(x, y, fw, h);
      g.fillStyle(0xffffff, 0.45).fillRect(x, y, fw, 1);
    }
  }

  /**
   * A health bar that also says how bad it is. Green above half, amber under half, red under a quarter (`hpColor`); under a
   * quarter the fill blinks to a light red, so a hero (or a foe) in trouble is the first thing the eye lands on.
   */
  private healthBar(c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, ratio: number): void {
    const low = ratio < LOW_HP;
    // Under a quarter the bar sits in a DARK red and blinks up to a bright one, so neither half of the blink can pass for a healthy bar.
    this.bar(g, x, y, w, h, ratio, low ? UI.redDark : hpColor(ratio));
    const fw = Math.round(w * Math.max(0, Math.min(1, ratio)));
    if (low && fw > 0) {
      const lit = this.scene.add.graphics();
      lit.fillStyle(hex(UI.red), 1).fillRect(x, y, fw, h);
      lit.fillStyle(0xffffff, 0.5).fillRect(x, y, fw, 1);
      c.add(lit);
      this.blinkers.push({ on: lit, off: null });
    }
  }

  private graphics(c: Phaser.GameObjects.Container): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    c.add(g);
    return g;
  }

  private fill(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    g.fillStyle(hex(color), alpha).fillRect(x, y, w, h);
  }

  /**
   * A chip on the timeline (or the NOW chip). A duplicate foe's A/B letter hangs on the chip's top-right corner as a badge
   * OUTSIDE the face (a dark-outlined letter), so the face stays whole.
   */
  private chip(c: Phaser.GameObjects.Container, x: number, y: number, o: { size: number; face: string; rim: string; bg: string; foe: boolean; dim?: number; glow?: string | null; tag?: string; alpha?: number }): void {
    this.used.add(o.face);
    const opts = { size: o.size, faceKey: o.face, rim: o.rim, bg: o.bg, foe: o.foe, dim: o.dim ?? 0, glow: o.glow ?? null };
    const img = this.image(c, chipTexture(this.scene.textures, opts), x - CHIP_PAD, y - CHIP_PAD);
    img.setAlpha(o.alpha ?? 1);
    if (o.tag) this.text(c, o.tag, x + o.size - 2, y - 3, { color: UI.text, shadow: false, outline: UI.outline, outlineW: 1 }).setAlpha(o.alpha ?? 1);
  }

  // ---------------------------------------------------------------- regions

  /** The one frame behind boxes that stand side by side along the bottom, with a divider in each gap. */
  private band(plan: BandPlan): void {
    const c = this.extra(plan.x, plan.y, HUD_DEPTH - 1);
    this.window(c, plan.w, plan.h, UI.cyan, { opacity: plan.opacity }, true);
    const g = this.graphics(c);
    for (const dx of plan.dividers) {
      const x = dx - plan.x;
      this.fill(g, x, 3, 1, plan.h - 6, UI.outline);
      this.fill(g, x + 1, 3, 1, plan.h - 6, UI.frame, 0.9);
      this.fill(g, x + 1, 3, 1, 1, UI.frameLit);
      this.fill(g, x + 1, plan.h - 4, 1, 1, UI.frameLit);
    }
  }

  /** The turn timeline: NOW chip at the left, the rest on a line (heroes above it, enemies below), real faces, then a dim preview of the next round. */
  private timeline(stage: StageConfig, view: HudView): void {
    const t = stage.hud.turnOrder;
    const c = this.container('turnOrder', t);
    this.window(c, t.w, t.h, UI.cyan, t, true);
    const g = this.graphics(c);
    const [now, ...rest] = view.turns;
    this.text(c, 'NOW', 5, Math.floor(t.h / 2) - 3, { color: UI.amber });
    if (!now) return;
    const place = timelineLayout(t, rest, now);
    const { line } = place;
    this.fill(g, line.x0, line.y, line.x1 - line.x0, 1, UI.frameLit);
    this.fill(g, line.x1 - 1, line.y - 2, 1, 5, UI.frameLit);
    this.fill(g, line.x1, line.y - 1, 1, 3, UI.frameLit);
    // The round divider: a dashed double line (a text cursor is solid), then the next round's order again.
    if (place.roundMark !== null) {
      const rm = place.roundMark;
      for (let dy = -7; dy <= 7; dy += 3) {
        this.fill(g, rm, line.y + dy, 1, 2, UI.frameLit);
        this.fill(g, rm + 2, line.y + dy, 1, 2, UI.frameLit);
      }
    }
    const s = t.chip;
    // A hero's chip is rimmed in the hero's own colour, a foe's in the enemy red; the foe's letter (A, B...) is the same one the lists and the target box use.
    const drawChip = (chip: PlacedChip, dim: number, glow: string | null, alpha = 1): void => {
      const foe = chip.side === 'enemy';
      const rim = foe ? UI.foe : (view.party[chip.index]?.color ?? UI.text);
      const face = foe ? this.faces.foe(chip.index, s - 4) : this.faces.party(chip.index, s - 2);
      this.chip(c, chip.x, chip.y, { size: s, face, rim, bg: foe ? UI.foeBg : UI.chipBg, foe, dim, glow, alpha, tag: foe ? (view.foes[chip.index]?.tag ?? '') : '' });
    };
    // The NOW chip: amber rim, bigger.
    const nowFoe = now.side === 'enemy';
    const nowFace = nowFoe ? this.faces.foe(now.index, place.now.size - 4) : this.faces.party(now.index, place.now.size - 2);
    this.chip(c, place.now.x, place.now.y, { size: place.now.size, face: nowFace, rim: UI.amber, bg: nowFoe ? UI.foeBg : UI.chipBg, foe: nowFoe, tag: nowFoe ? (view.foes[now.index]?.tag ?? '') : '' });
    place.chips.forEach((chip, i) => {
      // The one who acts next glows amber; the rest of this round are a touch dimmer.
      drawChip(chip, i === 0 ? 0 : 0.1, i === 0 ? UI.amber : null);
      if (i > 0) this.fill(g, chip.x + Math.floor(s / 2), line.y, 1, 1, UI.text);
    });
    // The next round is a GHOST: the same chips at about half strength, so "after the round turns" never reads as a live turn.
    for (const chip of place.later) {
      drawChip(chip, 0.2, null, 0.5);
      this.fill(g, chip.x + Math.floor(s / 2), line.y, 1, 1, UI.disabled);
    }
    // The next-to-act marker is drawn last, over the chips: a real diamond on the line with a dark outline, 7 px across.
    const first = place.chips[0];
    if (first) {
      const top = this.graphics(c);
      const mid = first.x + Math.floor(s / 2);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d <= 3) this.fill(top, mid + dx, line.y + dy, 1, 1, d <= 2 ? UI.amber : UI.outline);
      }
    }
  }

  /** The party table: one numeric row per hero (marker, face, name, statuses, health bar and numbers, resource bar and numbers). */
  private partyTable(stage: StageConfig, view: HudView, framed: boolean): void {
    const r = stage.hud.partyStatus;
    const c = this.container('partyStatus', r);
    if (!framed) this.window(c, r.w, r.h, UI.cyan, r, true);
    const g = this.graphics(c);
    view.party.forEach((m: HudMemberView, i) => {
      // Rows start 4 px down (one clear pixel under the frame's inner line) and end one clear pixel above the frame's bottom.
      const ry = ROW_TOP + i * r.rowH;
      const active = i === view.active;
      const down = m.hp <= 0;
      const ratio = m.maxHp > 0 ? m.hp / m.maxHp : 0;
      const low = !down && ratio < LOW_HP;
      // On the lit row every letter gets a one-pixel dark outline: the coloured names and the red low-health numbers sit on a teal ground and need it.
      const on = active ? { outline: UI.outline } : {};
      if (active) {
        // The acting hero's row is lit in the cyan of the ring under their feet: a ground (kept darker than before so the text holds), cyan lines above and below, a bar and an arrow.
        this.fill(g, 2, ry, r.w - 4, r.rowH - 1, UI.cyan, 0.3);
        this.fill(g, 2, ry, r.w - 4, 1, UI.cyan, 0.9);
        this.fill(g, 2, ry + r.rowH - 2, r.w - 4, 1, UI.cyan, 0.9);
        this.fill(g, 2, ry, 2, r.rowH - 1, UI.cyan);
        const mid = ry + Math.floor((r.rowH - 1) / 2);
        this.fill(g, 4, mid - 2, 1, 5, UI.cyan);
        this.fill(g, 5, mid - 1, 1, 3, UI.cyan);
        this.fill(g, 6, mid, 1, 1, UI.cyan);
      }
      this.image(c, this.faces.party(i, r.face), 8, ry + 1);
      this.text(c, m.name, 19, ry + 1, { color: down ? UI.disabled : m.color, shadow: false, ...on });
      // Statuses (or KO) between the name and the bar.
      if (down) this.text(c, 'KO', 47, ry + 1, { color: UI.red, shadow: false, ...on });
      else {
        const { shown } = pickStatuses(m.status);
        for (const [k, id] of shown.entries()) this.image(c, statusIconTexture(this.scene.textures, id), 47 + k * (STATUS_ICON_SIZE + 1), ry + Math.floor((r.rowH - STATUS_ICON_SIZE) / 2));
      }
      // Health bar, with the resource bar thin under it (one clear pixel between them).
      this.healthBar(c, g, 74, ry + 1, 30, 3, ratio);
      if (m.resMax > 0) {
        this.fill(g, 74, ry + 6, 30, 2, UI.barBack);
        this.fill(g, 74, ry + 6, Math.round((30 * Math.max(0, m.res)) / m.resMax), 2, UI.resource);
      }
      // Health numbers: white while healthy, amber under half, red under a quarter (and blinking).
      const hpText = `${m.hp}/${m.maxHp}`;
      const base = this.text(c, hpText, 146, ry + 1, { color: ratio > 0.5 ? UI.text : hpColor(ratio), shadow: false, align: 'right', ...on });
      if (low) {
        const bright = this.text(c, hpText, 146, ry + 1, { color: UI.redLit, shadow: false, align: 'right', ...on });
        this.blinkers.push({ on: bright, off: base });
      }
      if (m.resMax > 0) {
        // On the lit row the cyan and grey would sink into the cyan ground, so the resource reads white there.
        this.text(c, String(m.res), r.w - 5, ry + 1, { color: active ? '#ffffff' : UI.cyan, shadow: false, align: 'right', ...on });
        this.text(c, m.resLabel, r.w - 5 - textWidth(String(m.res)) - 3, ry + 1, { color: active ? '#e4f0ff' : UI.dim, shadow: false, align: 'right', ...on });
      } else this.text(c, '—', r.w - 5, ry + 1, { color: UI.disabled, shadow: false, align: 'right', ...on });
    });
  }

  /**
   * The command strip: a caption line over a row of icons, with the lit icon's name and its cost (or a one-line hint), and a
   * three-letter name printed under EVERY icon so none is a mystery. During an action (`standby`) the same strip stays in its
   * slot, DIMMED to about a third (icons, frames and codes), and the caption names who is acting.
   */
  private commands(stage: StageConfig, view: HudView, framed: boolean, standby: boolean): void {
    const r = stage.hud.commands;
    const c = standby ? this.extra(r.x, r.y) : this.container('commands', r);
    const hero = view.party[view.active];
    if (!framed) this.window(c, r.w, r.h, hero?.color ?? UI.cyan, r, false);
    const g = this.graphics(c);
    const selected = standby ? null : view.command.selected;
    const caption = standby ? `${hero?.name ?? ''} acting...` : view.command.label;
    const aside = standby ? '' : view.command.cost || (selected ? COMMAND_INFO[selected].hint : '');
    this.text(c, caption, 6, 4, { color: standby ? UI.soft : UI.text, shadow: false });
    if (aside && textWidth(caption) + textWidth(aside) + 10 <= r.w - 8) this.text(c, aside, r.w - 6, 4, { color: UI.dim, shadow: false, align: 'right' });
    const pitch = 21;
    const bx = Math.floor((r.w - (COMMAND_ICONS.length * pitch - 3)) / 2);
    const by = 13;
    COMMAND_ICONS.forEach((kind, i) => {
      const sel = kind === selected;
      const x = bx + i * pitch;
      this.fill(g, x, by, 18, 18, UI.outline);
      this.fill(g, x + 1, by + 1, 16, 16, sel ? UI.inner : '#14122a');
      const border = sel ? UI.cyan : '#3a3f6e';
      for (const [dx, dy, w, h] of [[0, 0, 18, 1], [0, 17, 18, 1], [0, 0, 1, 18], [17, 0, 1, 18]] as const) this.fill(g, x + dx, by + dy, w, h, border);
      this.image(c, iconTexture(this.scene.textures, kind, iconRaw(kind)), x + 1, by + 1);
      // Unfocused icons sit back a little; during an action the whole strip falls to about a third.
      if (standby) this.fill(g, x, by, 18, 18, '#070614', 0.66);
      else if (!sel) this.fill(g, x + 1, by + 1, 16, 16, '#070614', 0.3);
      this.text(c, COMMAND_INFO[kind].code, x + 9, by + 19, { color: sel ? UI.cyan : standby ? UI.soft : UI.dim, shadow: false, align: 'center' });
    });
  }

  /** The enemy box: sized to what is in it. A lone foe gets a full read-out, two to four a list that spreads over the box, five or six two columns; aiming or acting shows the target's details. */
  private enemyBox(stage: StageConfig, view: HudView, framed: boolean): void {
    const r = stage.hud.enemyInfo;
    const c = this.container('enemyInfo', r);
    if (!framed) this.window(c, r.w, r.h, UI.foe, r, true);
    const g = this.graphics(c);
    const aimed = view.target !== null ? view.foes[view.target] : undefined;
    if (aimed && view.target !== null) this.foeDetails(c, g, r, aimed, view.target);
    else if (view.foes.length === 1 && view.foes[0]) this.foeDetails(c, g, r, view.foes[0], 0);
    else this.foeList(c, g, r, view.foes);
  }

  /** Health numbers' colour: white while healthy, then the bar's own amber and red. */
  private hpTone(f: { hp: number; maxHp: number }): string {
    const ratio = f.maxHp > 0 ? f.hp / f.maxHp : 0;
    return ratio > 0.5 ? UI.text : hpColor(ratio);
  }

  /**
   * The foe list. Every row shares ONE bar column (the same left edge and length on every row, sized to the longest names
   * and numbers) and the numbers are right-aligned in their own column, so the rows line up whatever the numbers' widths; a
   * name that cannot fit is clipped, and a status icon or two fits in what room is left after the name.
   */
  private foeList(c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, r: HudRegion, foes: HudFoeView[]): void {
    const lay = foeLayout(foes.length, r.h);
    const colW = lay.mode === 'grid' ? Math.floor((r.w - 8) / 2) : r.w - 8;
    const top = 2 + Math.floor((r.h - 4 - lay.rows * lay.rowH) / 2);
    // The shared columns of a one-column list.
    const nameX = 17;
    const numsW = Math.max(0, ...foes.map((f) => textWidth(`${f.hp}/${f.maxHp}`)));
    const nameW = Math.max(0, ...foes.map((f) => textWidth(foeName(f.name))));
    const barW = Math.max(10, Math.min(28, r.w - 6 - numsW - 3 - 3 - nameX - nameW));
    const barX = r.w - 6 - numsW - 3 - barW;
    foes.forEach((f, i) => {
      const col = lay.mode === 'grid' ? Math.floor(i / lay.rows) : 0;
      const row = lay.mode === 'grid' ? i % lay.rows : i;
      const x0 = 4 + col * colW;
      const ry = top + row * lay.rowH;
      const ratio = f.maxHp > 0 ? f.hp / f.maxHp : 0;
      const name = foeName(f.name);
      this.image(c, this.faces.foe(i, 8), x0 + 2, ry + 1);
      if (lay.mode === 'grid') {
        this.text(c, clip(name, 30), x0 + 13, ry + 1, { color: '#ffd0d0', shadow: false });
        this.healthBar(c, g, x0 + colW - 30, ry + 3, 24, 3, ratio);
        return;
      }
      this.text(c, `${f.hp}/${f.maxHp}`, r.w - 6, ry + 1, { color: this.hpTone(f), shadow: false, align: 'right' });
      const shown = clip(name, barX - 3 - nameX);
      this.text(c, shown, nameX, ry + 1, { color: '#ffd0d0', shadow: false });
      this.healthBar(c, g, barX, ry + 3, barW, 3, ratio);
      // Statuses on the foe, as the same icons the party table uses, in whatever room the name leaves before the bar.
      let ix = nameX + textWidth(shown) + 3;
      for (const id of pickStatuses(f.status).shown) {
        if (ix + STATUS_ICON_SIZE > barX - 2) break;
        this.image(c, statusIconTexture(this.scene.textures, id), ix, ry);
        ix += STATUS_ICON_SIZE + 1;
      }
    });
  }

  /** One foe in full: chip, name, a long health bar with its numbers, and its states and weak spot as chips. */
  private foeDetails(c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, r: HudRegion, f: HudFoeView, index: number): void {
    this.chip(c, 6, 5, { size: 12, face: this.faces.foe(index, 8), rim: UI.foe, bg: UI.foeBg, foe: true, tag: f.tag });
    this.text(c, foeName(f.name), 22, 6, { shadow: false });
    this.text(c, `${f.hp}/${f.maxHp}`, r.w - 6, 6, { color: this.hpTone(f), shadow: false, align: 'right' });
    this.healthBar(c, g, 22, 17, r.w - 22 - 6, 3, f.maxHp > 0 ? f.hp / f.maxHp : 0);
    let x = 22;
    for (const tag of f.tags) {
      const color = tag.tone === 'cyan' ? UI.cyan : UI.amber;
      const w = textWidth(tag.text);
      if (x + w + 6 > r.w - 4) break;
      this.fill(g, x, 26, w + 6, 10, color, 0.2);
      this.fill(g, x, 26, w + 6, 1, color, 0.6);
      this.text(c, tag.text, x + 3, 27, { color, shadow: false });
      x += w + 10;
    }
  }

  /** The skill banner: a prompt (amber) while a target is picked, the skill's name (cyan) while it plays. */
  private banner(stage: StageConfig, view: HudView): void {
    const b = stage.hud.banner;
    const text = view.banner ?? '';
    const w = Math.min(b.w, textWidth(text) + 28);
    const c = this.container('banner', b, b.x + Math.floor((b.w - w) / 2), b.y);
    this.window(c, w, b.h, UI.amber, b, true);
    this.text(c, text, Math.floor(w / 2), 3, { color: view.phase === 'act' ? UI.cyan : UI.amber, shadow: false, align: 'center' });
  }

  /** The combo counter: hits so far, the word HIT, the total damage, and a bar for the combo window left. */
  private combo(stage: StageConfig, view: HudView): void {
    const r = stage.hud.combo;
    const act = view.act;
    if (!act) return;
    const c = this.container('combo', r);
    this.window(c, r.w, r.h, UI.pink, r, true);
    const g = this.graphics(c);
    this.text(c, String(act.hits), 6, 4, { color: UI.amber, shadow: false });
    this.text(c, 'HIT', 10 + textWidth(String(act.hits)), 4, { shadow: false });
    this.text(c, String(act.total), r.w - 6, 4, { color: UI.amber, shadow: false, align: 'right' });
    this.bar(g, 6, 17, r.w - 12, 2, act.windowLeft ?? COMBO_WINDOW_LEFT, UI.pink);
  }

  // ---------------------------------------------------------------- labels over the stage

  /** A name tab: a dark box with a coloured stripe at the left. Returns its width. */
  private tab(label: string, x: number, y: number, accent: string, textColor: string): number {
    const w = textWidth(label) + 8;
    const g = this.scene.add.graphics().setDepth(MARK_DEPTH);
    this.marks.push(g);
    g.fillStyle(hex(UI.outline), 1).fillRect(x - 1, y - 1, w + 2, 11);
    g.fillStyle(hex(UI.tabBg), 1).fillRect(x, y, w, 9);
    g.fillStyle(hex(accent), 1).fillRect(x, y, 2, 9);
    const t = textTexture(this.scene.textures, label, { color: textColor, shadow: false });
    const at = textAt(t, label, x + 5, y + 1, 'left');
    this.used.add(t.key);
    this.marks.push(this.scene.add.image(at.x, at.y, t.key).setOrigin(0, 0).setDepth(MARK_DEPTH));
    return w;
  }

  /** The acting hero's name tab above the head, with a small pointer down to it. */
  private activeTag(stage: StageConfig, view: HudView, geo: HudGeo): void {
    const hero = view.party[view.active];
    const f = geo.party[view.active];
    if (!hero || !f) return;
    const gap = stage.hud.activeTag?.gapAboveHead ?? 3;
    const label = hero.name.toUpperCase();
    const w = textWidth(label) + 8;
    const x = f.x - Math.floor(w / 2);
    const y = f.top - gap - 10;
    this.tab(label, x, y, UI.cyan, hero.color);
    const g = this.scene.add.graphics().setDepth(MARK_DEPTH);
    g.fillStyle(hex(UI.cyan), 1).fillRect(f.x - 1, y + 10, 3, 1).fillRect(f.x, y + 11, 1, 1);
    this.marks.push(g);
  }

  /**
   * The aimed-at enemy's name tab (with its A/B letter) and a pointer. It sits ABOVE the sprite's top edge when there is room
   * under the timeline and the banner; for a tall foe whose head is up there it goes BESIDE the sprite instead (right of its
   * widest edge, or left when the right has no room), never over the face. The name is also in the enemy box.
   */
  private targetLabel(view: HudView, geo: HudGeo): void {
    const foe = view.target === null ? undefined : view.foes[view.target];
    const f = view.target === null ? undefined : geo.foes[view.target];
    if (!foe || !f) return;
    const name = foeName(foe.name);
    const w = textWidth(name) + 8;
    const at = targetTab(f, w, SCREEN_W, HUD_TOP_CLEAR);
    this.tab(name, at.x, at.y, UI.amber, UI.text);
    // The pointer: down onto the head when the tab is above it, sideways towards the sprite when it is beside it.
    if (at.side === 'above') this.marks.push(this.text(null, '▼', f.x - 2, at.y + 10, { color: UI.amber, shadow: false, outline: UI.outline, depth: MARK_DEPTH }));
    else if (at.side === 'right') this.marks.push(this.text(null, '◀', at.x - 5, at.y + 1, { color: UI.amber, shadow: false, outline: UI.outline, depth: MARK_DEPTH }));
    else this.marks.push(this.text(null, '▶', at.x + w + 3, at.y + 1, { color: UI.amber, shadow: false, outline: UI.outline, depth: MARK_DEPTH }));
  }

  /**
   * A stage cue for low health: under a quarter, a small bar under the hero's feet blinks red (the same blink as the table's),
   * so a hero in trouble reads without looking down at the band.
   */
  private lowHealthMarks(view: HudView, geo: HudGeo): void {
    view.party.forEach((m, i) => {
      const f = geo.party[i];
      const ratio = m.maxHp > 0 ? m.hp / m.maxHp : 0;
      if (!f || m.hp <= 0 || ratio >= LOW_HP) return;
      const w = 20;
      const x = f.x - Math.floor(w / 2);
      const y = f.y + 5;
      const fw = Math.max(1, Math.round(w * ratio));
      const base = this.scene.add.graphics().setDepth(MARK_DEPTH);
      base.fillStyle(hex(UI.outline), 1).fillRect(x - 1, y - 1, w + 2, 5);
      base.fillStyle(hex(UI.barBack), 1).fillRect(x, y, w, 3);
      base.fillStyle(hex(UI.redDark), 1).fillRect(x, y, fw, 3);
      const lit = this.scene.add.graphics().setDepth(MARK_DEPTH);
      lit.fillStyle(hex(UI.red), 1).fillRect(x, y, fw, 3);
      lit.fillStyle(0xffffff, 0.5).fillRect(x, y, fw, 1);
      this.marks.push(base, lit);
      this.blinkers.push({ on: lit, off: null });
    });
  }

  /**
   * The number that pops from a hit (the lab's still version of the live floating number): tinted by the kind of hit (pale,
   * amber for a critical, cyan for a weak spot), 3x for an ordinary hit and 4x for a critical or weak one (the glyphs are 5 px
   * tall at 1x), a two-pixel dark outline and a drop shadow, CRIT or WEAK over it. It sits above the head, to the far side from
   * the attacker; for a tall target whose head is under the banner it goes on the shoulder line instead. Either way it is above
   * where a blow lands, so the cut and its sparks stay clear of it.
   */
  private damageNumber(view: HudView, geo: HudGeo): void {
    const act = view.act;
    const f = geo.foes[act?.target ?? -1];
    if (!act || !f) return;
    const kind = hitKind(act.crit, !!act.weak);
    const scale = numberScale(kind);
    const half = Math.ceil(textWidth(String(act.dmg), scale) / 2) + 3;
    let nx = f.x + 12;
    let ny = f.top - 8 - 7 * scale;
    // A tall target: its head is under the banner, so the number stands on the shoulder line instead.
    if (ny < NUMBER_TOP) ny = f.top + 10;
    // Keep the whole number on the screen.
    nx = Math.max(4 + half, Math.min(SCREEN_W - 4 - half, nx));
    const label = kind === 'crit' ? 'CRIT' : kind === 'weak' ? 'WEAK' : null;
    if (label) this.marks.push(this.text(null, label, nx, ny - 10, { color: HIT_COLOUR[kind], ...NUMBER_LOOK, outlineW: 1, align: 'center', depth: MARK_DEPTH }));
    this.marks.push(this.text(null, String(act.dmg), nx, ny, { color: HIT_COLOUR[kind], ...NUMBER_LOOK, align: 'center', scale, depth: MARK_DEPTH }));
  }
}

/** How much of the combo window is left, as a share: a placeholder (the real combo timer is a battle-test matter). */
export const COMBO_WINDOW_LEFT = 0.6;
/** Under this share of health a bar is red and blinks. */
export const LOW_HP = 0.25;
/** The low-health blink: ticks per half-blink. */
const BLINK_TICKS = 16;
/** The lowest a label over the stage may sit (just under the turn timeline and the skill banner). */
const HUD_TOP_CLEAR = 56;
/** The highest a damage number may sit before it moves to the target's upper body. */
const NUMBER_TOP = 60;
/** The party table's first row, in the box's own pixels: one clear pixel under the frame's inner line. */
const ROW_TOP = 4;

/** A string cut to fit `max` pixels, with a full stop where it was cut. */
function clip(text: string, max: number): string {
  if (textWidth(text) <= max) return text;
  // A duplicate's letter (" A", " B"...) is the point of the name, so it stays and the rest is cut.
  const m = / ([A-F])$/.exec(text);
  const tail = m ? ` ${m[1]}` : '';
  let t = m ? text.slice(0, -2) : text;
  while (t.length > 1 && textWidth(`${t}.${tail}`) > max) t = t.slice(0, -1);
  return `${t}.${tail}`;
}

const hex = (s: string): number => Number.parseInt(s.slice(1), 16);
