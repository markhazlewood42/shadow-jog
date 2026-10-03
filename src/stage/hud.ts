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
 * `render` rebuilds everything that is shown (cheap: it runs when the view changes, not every frame) and then
 * removes the text, window and face textures no longer in use.
 */
import type Phaser from 'phaser';
import type { HudRegion, StageConfig } from './config';
import { SCREEN_W } from './config';
import type { HudFoeView, HudMemberView, HudView } from './demo';
import { COMMAND_ICONS, iconRaw } from './icons';
import { isShown, type RegionName, timelineLayout } from './hudlayout';
import { CHIP_PREFIX, chipTexture, hpColor, iconTexture, TEXT_PREFIX, textAt, textTexture, type TextOptions, textWidth, UI, WINDOW_PREFIX, windowTexture } from './hudkit';
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
  private marks: Phaser.GameObjects.GameObject[] = [];
  private used = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly faces: HudFaces,
  ) {}

  /** Every game object the HUD currently has (for tests and tools). */
  get objects(): Phaser.GameObjects.GameObject[] {
    return [...this.boxes.values(), ...this.marks];
  }

  /** The container of a region (absent when it is hidden). */
  box(name: RegionName): Phaser.GameObjects.Container | undefined {
    return this.boxes.get(name);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.boxes.clear();
    this.marks = [];
  }

  /** Rebuild the HUD for this stage's layout and this view. */
  render(stage: StageConfig, view: HudView, geo: HudGeo): void {
    this.destroy();
    this.used = new Set();
    const h = stage.hud;
    const show = (name: RegionName, region: HudRegion): boolean => isShown(name, region.show, view.phase);

    if (show('turnOrder', h.turnOrder)) this.timeline(stage, view);
    if (show('partyStatus', h.partyStatus)) this.partyTable(stage, view);
    if (show('commands', h.commands)) this.commands(stage, view);
    if (show('enemyInfo', h.enemyInfo)) this.enemyBox(stage, view);
    if (show('banner', h.banner) && view.banner) this.banner(stage, view);
    if (show('combo', h.combo) && view.act) this.combo(stage, view);

    // While an action plays the banner already names the actor, and the tag would sit on the target's neighbourhood.
    if (h.activeTag?.show === 'always' && view.phase !== 'act') this.activeTag(stage, view, geo);
    if (view.phase === 'target' && view.target !== null && h.enemyInfo.names !== 'never') this.targetLabel(view, geo);
    if (view.phase === 'act' && view.act && !view.act.liveNumbers) this.damageNumber(view, geo);

    for (const prefix of [TEXT_PREFIX, WINDOW_PREFIX, CHIP_PREFIX, PREFIX.face]) pruneTextures(this.scene.textures, prefix, this.used);
  }

  // ---------------------------------------------------------------- building blocks

  private container(name: RegionName, r: HudRegion, x = r.x, y = r.y): Phaser.GameObjects.Container {
    // scrollFactor 0: a screen shake moves the stage, never the HUD.
    const c = this.scene.add.container(x, y).setDepth(HUD_DEPTH).setScrollFactor(0);
    this.boxes.set(name, c);
    return c;
  }

  private image(c: Phaser.GameObjects.Container | null, key: string, x: number, y: number, depth = HUD_DEPTH): Phaser.GameObjects.Image {
    this.used.add(key);
    const img = this.scene.add.image(x, y, key).setOrigin(0, 0);
    if (c) c.add(img);
    else img.setDepth(depth);
    return img;
  }

  private window(c: Phaser.GameObjects.Container, w: number, h: number, accent: string, region: HudRegion, plain: boolean): void {
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

  private graphics(c: Phaser.GameObjects.Container): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    c.add(g);
    return g;
  }

  private fill(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    g.fillStyle(hex(color), alpha).fillRect(x, y, w, h);
  }

  private chip(c: Phaser.GameObjects.Container, x: number, y: number, size: number, face: string, border: string, bg: string, foe: boolean): void {
    this.used.add(face);
    this.image(c, chipTexture(this.scene.textures, size, face, border, bg, foe), x, y);
  }

  // ---------------------------------------------------------------- regions

  /** The turn timeline: NOW chip at the left, the rest on a line (heroes above it, enemies below), real faces. */
  private timeline(stage: StageConfig, view: HudView): void {
    const t = stage.hud.turnOrder;
    const c = this.container('turnOrder', t);
    this.window(c, t.w, t.h, UI.cyan, t, true);
    const g = this.graphics(c);
    this.text(c, 'NOW', 5, 9, { color: UI.amber });
    const [now, ...rest] = view.turns;
    if (!now) return;
    const place = timelineLayout(t, rest);
    const nowFoe = now.side === 'enemy';
    const nowFace = nowFoe ? this.faces.foe(now.index, place.now.size - 2) : this.faces.party(now.index, place.now.size - 2);
    this.chip(c, place.now.x, place.now.y, place.now.size, nowFace, UI.amber, nowFoe ? UI.foeBg : UI.chipBg, nowFoe);
    const { line } = place;
    this.fill(g, line.x0, line.y, line.x1 - line.x0, 1, UI.frameLit);
    this.fill(g, line.x1 - 1, line.y - 2, 1, 5, UI.frameLit);
    this.fill(g, line.x1, line.y - 1, 1, 3, UI.frameLit);
    const s = t.chip;
    for (const chip of place.chips) {
      const mid = chip.x + Math.floor(s / 2);
      if (chip.side === 'party') {
        const color = view.party[chip.index]?.color ?? UI.text;
        this.chip(c, chip.x, chip.y, s, this.faces.party(chip.index, s - 2), color, UI.chipBg, false);
        this.fill(g, mid, line.y - 1, 1, 1, color);
      } else {
        this.chip(c, chip.x, chip.y, s, this.faces.foe(chip.index, s - 2), UI.foe, UI.foeBg, true);
        this.fill(g, mid, line.y + 1, 1, 1, UI.foe);
      }
      this.fill(g, mid, line.y, 1, 1, UI.text);
    }
  }

  /** The party table: one compact numeric row per hero (face, name, health bar, HP now/max, resource label and value). */
  private partyTable(stage: StageConfig, view: HudView): void {
    const r = stage.hud.partyStatus;
    const c = this.container('partyStatus', r);
    this.window(c, r.w, r.h, UI.cyan, r, true);
    const g = this.graphics(c);
    view.party.forEach((m: HudMemberView, i) => {
      const ry = 2 + i * r.rowH;
      const active = i === view.active;
      if (active) {
        this.fill(g, 2, ry, r.w - 4, r.rowH, UI.inner, 0.95);
        this.fill(g, 2, ry, 2, r.rowH, UI.cyan);
      }
      this.image(c, this.faces.party(i, r.face), 6, ry + 1);
      this.text(c, m.name, 17, ry + 1, { color: active ? UI.text : m.color, shadow: false });
      this.bar(g, 50, ry + 3, 34, 3, m.hp / m.maxHp, hpColor(m.hp / m.maxHp));
      this.text(c, `${m.hp}/${m.maxHp}`, 130, ry + 1, { shadow: false, align: 'right' });
      if (m.resMax > 0) {
        this.text(c, m.resLabel, r.w - 19, ry + 1, { color: UI.dim, shadow: false, align: 'right' });
        this.text(c, String(m.res), r.w - 5, ry + 1, { color: UI.cyan, shadow: false, align: 'right' });
      } else this.text(c, '—', r.w - 5, ry + 1, { color: UI.disabled, shadow: false, align: 'right' });
    });
  }

  /** The command strip: a label line (the skill's name and cost) over a row of icons with the selected one lit. */
  private commands(stage: StageConfig, view: HudView): void {
    const r = stage.hud.commands;
    const c = this.container('commands', r);
    const hero = view.party[view.active];
    this.window(c, r.w, r.h, hero?.color ?? UI.cyan, r, false);
    const g = this.graphics(c);
    this.text(c, view.command.label, 6, 5, { shadow: false });
    if (view.command.cost) this.text(c, view.command.cost, r.w - 6, 5, { color: UI.dim, shadow: false, align: 'right' });
    const pitch = 21;
    const bx = Math.floor((r.w - (COMMAND_ICONS.length * pitch - 3)) / 2);
    const by = 16;
    COMMAND_ICONS.forEach((kind, i) => {
      const sel = kind === view.command.selected;
      const x = bx + i * pitch;
      this.fill(g, x, by, 18, 18, UI.outline);
      this.fill(g, x + 1, by + 1, 16, 16, sel ? UI.inner : '#14122a');
      const border = sel ? UI.cyan : '#3a3f6e';
      for (const [dx, dy, w, h] of [[0, 0, 18, 1], [0, 17, 18, 1], [0, 0, 1, 18], [17, 0, 1, 18]] as const) this.fill(g, x + dx, by + dy, w, h, border);
      this.image(c, iconTexture(this.scene.textures, kind, iconRaw(kind)), x + 1, by + 1);
      if (!sel) this.fill(g, x + 1, by + 1, 16, 16, '#070614', 0.3);
    });
    // The little pointer under the selected icon.
    const cx = bx + Math.max(0, COMMAND_ICONS.indexOf(view.command.selected)) * pitch + 9;
    this.fill(g, cx - 2, by + 19, 5, 1, UI.cyan);
    this.fill(g, cx - 1, by + 20, 3, 1, UI.cyan);
  }

  /** The enemy box: the foe list while choosing, the target's details while targeting or while an action plays. */
  private enemyBox(stage: StageConfig, view: HudView): void {
    const r = stage.hud.enemyInfo;
    const c = this.container('enemyInfo', r);
    this.window(c, r.w, r.h, UI.foe, r, true);
    const g = this.graphics(c);
    if (view.target !== null && view.foes[view.target]) this.targetDetails(c, g, r, view.foes[view.target] as HudFoeView, view.target);
    else this.foeList(c, g, r, view.foes);
  }

  private foeList(c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, r: HudRegion, foes: HudFoeView[]): void {
    const shown = foes.length <= 4 ? foes : foes.slice(0, 3);
    if (foes.length > 4) this.text(c, `+${foes.length - 3} more`, 17, 2 + 3 * 9 + 1, { color: UI.dim, shadow: false });
    shown.forEach((f, i) => {
      const ry = 2 + i * 9;
      this.image(c, this.faces.foe(i, 8), 6, ry + 1);
      this.text(c, f.name, 17, ry + 1, { color: '#ffd0d0', shadow: false });
      this.bar(g, r.w - 40, ry + 3, 34, 3, f.hp / f.maxHp, hpColor(f.hp / f.maxHp));
    });
  }

  private targetDetails(c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, r: HudRegion, f: HudFoeView, index: number): void {
    this.chip(c, 6, 5, 12, this.faces.foe(index, 10), UI.foe, UI.foeBg, true);
    this.text(c, f.name, 22, 6, { shadow: false });
    this.bar(g, 22, 17, 84, 3, f.hp / f.maxHp, hpColor(f.hp / f.maxHp));
    this.text(c, `${f.hp}/${f.maxHp}`, r.w - 6, 15, { shadow: false, align: 'right' });
    let x = 22;
    for (const tag of f.tags) {
      const color = tag.tone === 'cyan' ? UI.cyan : UI.amber;
      const w = textWidth(tag.text);
      this.fill(g, x, 26, w + 6, 10, color, 0.2);
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

  /** The aimed-at enemy's name tab (with its A/B letter) and a pointer, kept on the screen. */
  private targetLabel(view: HudView, geo: HudGeo): void {
    const foe = view.target === null ? undefined : view.foes[view.target];
    const f = view.target === null ? undefined : geo.foes[view.target];
    if (!foe || !f) return;
    const w = textWidth(foe.name) + 8;
    const x = Math.max(4, Math.min(SCREEN_W - 4 - w, f.x - Math.floor(w / 2)));
    const y = Math.max(30, f.top - 14);
    this.tab(foe.name, x, y, UI.amber, UI.text);
    this.marks.push(this.text(null, '▼', f.x - 2, y + 10, { color: UI.amber, shadow: false, outline: UI.outline, depth: MARK_DEPTH }));
  }

  /** The number that pops from a hit: CRIT over it when critical, drawn at 2x with an outline, above the head (or, for a tall target whose head is under the banner, beside its upper body). */
  private damageNumber(view: HudView, geo: HudGeo): void {
    const act = view.act;
    const f = geo.foes[act?.target ?? -1];
    if (!act || !f) return;
    const half = Math.ceil(textWidth(String(act.dmg), 2) / 2) + 2;
    let nx = f.x;
    let ny = f.top - 20;
    if (ny < 54) {
      // A tall target: its head is under the banner, and its body is white from the hit flash, so the number goes beside its upper body, on the side the attacker comes from.
      nx = f.left - half - 4;
      ny = f.top + 16;
    }
    // Keep the whole number on the screen.
    nx = Math.max(4 + half, Math.min(SCREEN_W - 4 - half, nx));
    if (act.crit) this.marks.push(this.text(null, 'CRIT', nx, ny - 9, { color: UI.amber, shadow: false, outline: UI.outline, align: 'center', depth: MARK_DEPTH }));
    this.marks.push(this.text(null, String(act.dmg), nx, ny, { color: '#ffffff', shadow: false, outline: UI.outline, align: 'center', scale: 2, depth: MARK_DEPTH }));
  }
}

/** How much of the combo window is left, as a share: a placeholder (the real combo timer is a battle-test matter). */
export const COMBO_WINDOW_LEFT = 0.6;

const hex = (s: string): number => Number.parseInt(s.slice(1), 16);
