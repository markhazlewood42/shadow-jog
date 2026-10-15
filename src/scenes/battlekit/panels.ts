/**
 * The battle's two result panels as kit parts (M8c group G): the VICTORY tally and the LEVEL UP panel. Until now each was a `draw(ctx)` closure that painted
 * canvas calls every frame. Each is now a small set of retained display objects: a `NineSlice` window, `TextObject` texts and kit `Bar`s, made once when the
 * panel opens. `update()` runs once per sync and sets what the clock says; a text ignores a string it already shows and a bar ignores a ratio it already has, so
 * a tick where nothing changed repaints nothing.
 *
 * Canvas pictures, because they are ART: the level-up panel's wheel of light and portrait (it turns every tick), the big level number (2x letters), the amber
 * "NEW SKILL" chip and the glint that runs across a new name.
 *
 * The scene owns the clock (`t`: ticks since the panel opened; a press while it counts up sets it to the end) and holds the panel until confirm
 * (`BattleScene.panel`). The panel only reads it.
 */
import { getPortrait } from '../../art/portraits';
import { ABILITIES } from '../../data/abilities';
import { MEMBERS } from '../../data/party';
import { shade } from '../../engine/color';
import type { GrowthStat, LevelUp } from '../../game/party';
import type { MemberId } from '../../game/state';
import { Bar, CanvasImage, Container, type DisplayHost, fitText, measure, NineSlice, TextObject, UI } from '../../sje';
import { H, W } from '../../sje/core/size';
import { LEVELUP_TEXT_W } from '../../ui/layout';
import { drawBig } from './sprites';
import { abilityLabel } from './tables';

/** What the scene holds while a panel is open. */
export interface BattlePanel {
  /** Set the objects to the panel's clock. Safe to call twice in a tick. */
  update(): void;
  /** Take the panel off the screen. */
  destroy(): void;
}

/** What a panel needs of the scene that shows it. */
export interface PanelHost extends DisplayHost {
  /** The scene's own tick count (the blink of a mark runs on it). */
  readonly frame: number;
  readonly sys: { readonly ui: Container };
}

/** The level-up panel's stats, in the order they count up, and the frames between them. */
export const LEVEL_STATS: readonly (readonly [GrowthStat, string])[] = [['hp', 'HP'], ['tp', 'TP'], ['atk', 'ATK'], ['def', 'DEF'], ['mnd', 'MND'], ['agi', 'AGI']];
export const LEVEL_ROW_T = 9;

/** The beats of a level-up panel, in ticks from its start: when each stat row begins to count, when the restore line shows, when each new skill shows, and the end. */
export function levelUpBeats(u: LevelUp): { stats: (readonly [GrowthStat, string])[]; rowAt: (i: number) => number; restoredAt: number; learnAt: (j: number) => number; end: number } {
  const stats = LEVEL_STATS.filter(([k]) => u.to[k] > 0);
  const rowAt = (i: number): number => 18 + i * LEVEL_ROW_T;
  const restoredAt = rowAt(stats.length) + 10;
  const learnAt = (j: number): number => restoredAt + 22 + j * 18;
  return { stats, rowAt, restoredAt, learnAt, end: learnAt(u.learned.length) + 4 };
}

function add<T extends Container['list'][number]>(box: Container, o: T): T {
  box.add(o);
  return o;
}

// ---------------------------------------------------------------------------------------------------- victory

export interface VictoryData {
  xp: number;
  cred: number;
  walletBefore: number;
  bars: { id: MemberId; lv0: number; r0: number; lv1: number; r1: number }[];
  dropNames: string[];
  /** The window's top. Under a stage it starts below the stage HUD's top boxes. */
  y: number;
}

export class VictoryPanel implements BattlePanel {
  private readonly box: Container;
  private readonly xpText: TextObject;
  private readonly credText: TextObject;
  private readonly wallet: TextObject;
  private readonly rows: { lv: TextObject; bar: Bar; up: TextObject }[] = [];
  private readonly arrow: TextObject;

  constructor(private readonly host: PanelHost, private readonly d: VictoryData, private readonly t: () => number) {
    const box = new Container(host, 0, 0, 'battle-victory');
    this.box = box;
    host.sys.ui.add(box);
    const w = 272, h = 58 + d.dropNames.length * 11 + d.bars.length * 13;
    const x = (W - w) / 2, y = d.y;
    add(box, new NineSlice(host, Math.round(x), y, w, h, { title: 'VICTORY', accent: UI.amber }));
    this.xpText = add(box, new TextObject(host, Math.round(x + 14), y + 14, ''));
    this.credText = add(box, new TextObject(host, Math.round(x + 14), y + 26, ''));
    this.wallet = add(box, new TextObject(host, Math.round(x + w - 14), y + 26, '', { color: UI.dim, align: 'right' }));
    d.bars.forEach((b, i) => {
      const by = y + 42 + i * 13;
      add(box, new TextObject(host, Math.round(x + 14), by, MEMBERS[b.id].name, { color: MEMBERS[b.id].color }));
      const lv = add(box, new TextObject(host, Math.round(x + 70), by, '', { color: UI.dim }));
      const bar = add(box, new Bar(host, Math.round(x + 104), by + 3, 110, 4, UI.cyan, 0));
      const up = add(box, new TextObject(host, Math.round(x + w - 14), by, 'LV UP!', { color: UI.amber, align: 'right' }));
      up.setVisible(false);
      this.rows.push({ lv, bar, up });
    });
    const dy = y + 46 + d.bars.length * 13;
    if (d.dropNames.length) {
      add(box, new TextObject(host, Math.round(x + 14), dy, 'Found:', { color: UI.dim }));
      d.dropNames.forEach((n, i) => {
        add(box, new TextObject(host, Math.round(x + 54), dy + i * 11, n, { color: UI.cyan }));
      });
    }
    this.arrow = add(box, new TextObject(host, Math.round(x + w - 16), y + h - 13, '▼', { color: UI.cyan }));
    this.update();
  }

  update(): void {
    const { d } = this;
    const t = this.t();
    const tally = Math.min(1, t / 28), fill = Math.min(1, Math.max(0, (t - 10) / 44));
    this.xpText.setText(`{y}${Math.round(d.xp * tally)}{/} XP each`);
    this.credText.setText(`{y}${Math.round(d.cred * tally).toLocaleString('en-US')}¢{/} cred`);
    this.wallet.setText(`Wallet: ${Math.round(d.walletBefore + d.cred * tally).toLocaleString('en-US')}¢`);
    // Each survivor's progress to the next level fills; a level-up fills, flips and rolls over.
    d.bars.forEach((b, i) => {
      const row = this.rows[i];
      if (!row) return;
      const up = b.lv1 > b.lv0, flipped = up && fill >= 0.6;
      const ratio = !up ? b.r0 + (b.r1 - b.r0) * fill : !flipped ? b.r0 + (1 - b.r0) * (fill / 0.6) : b.r1 * ((fill - 0.6) / 0.4);
      row.lv.setText(`Lv ${flipped ? b.lv1 : b.lv0}`);
      row.lv.setStyle({ color: flipped ? UI.amber : UI.dim });
      row.bar.setColor(flipped ? UI.amber : UI.cyan);
      // The bar is 110 px: a ratio that does not move a pixel is not a change.
      row.bar.setRatio(Math.round(110 * Math.max(0, Math.min(1, ratio))) / 110);
      row.up.setVisible(flipped && this.host.frame % 24 < 16);
    });
    this.arrow.setVisible(this.host.frame % 40 < 28);
  }

  destroy(): void {
    this.box.destroy();
  }
}

// ---------------------------------------------------------------------------------------------------- level up

export class LevelUpPanel implements BattlePanel {
  private readonly box: Container;
  private readonly beats: ReturnType<typeof levelUpBeats>;
  private readonly x: number;
  private readonly y: number;
  private readonly wheel: CanvasImage;
  private wheelFrame = -1;
  private readonly level: CanvasImage;
  private levelColor = '';
  private readonly rows: { cur: TextObject; gain: TextObject; bar: Bar }[] = [];
  private readonly restored: TextObject;
  private readonly learned: { tag: CanvasImage; tagText: TextObject; name: TextObject; glint: CanvasImage }[] = [];
  private readonly arrow: TextObject;

  constructor(private readonly host: PanelHost, private readonly u: LevelUp, private readonly t: () => number) {
    const mem = MEMBERS[u.id];
    const beats = levelUpBeats(u);
    this.beats = beats;
    const { stats } = beats;
    const box = new Container(host, 0, 0, 'battle-levelup');
    this.box = box;
    host.sys.ui.add(box);
    const w = 300, h = 76 + stats.length * 12 + 16 + u.learned.length * 18 + 8;
    const x = (W - w) / 2, y = Math.max(8, Math.round((H - h) / 2) - 20);
    this.x = x;
    this.y = y;
    add(box, new NineSlice(host, Math.round(x), y, w, h, { title: 'LEVEL UP', accent: mem.color }));
    // The member, lit: a slow wheel of light behind the portrait. Art, painted again each tick (it turns).
    this.wheel = add(box, new CanvasImage(host, Math.round(x + 38) - 36, y + 2, 72, 60));
    this.wheel.ctx.imageSmoothingEnabled = false;
    add(box, new TextObject(host, Math.round(x + 76), y + 14, mem.name, { color: mem.color }));
    // The new level stamps in: white as it lands, then amber.
    add(box, new TextObject(host, Math.round(x + 76), y + 32, `Lv ${u.level - 1}  →`, { color: UI.dim }));
    const lv = String(u.level);
    this.level = add(box, new CanvasImage(host, Math.round(x + 118), y + 28, 2 * (measure(lv) + 3), 24));
    this.level.ctx.imageSmoothingEnabled = false;
    // Each stat counts up in turn, its bar filling from the old value to the new.
    const top = y + 64;
    stats.forEach(([k, label], i) => {
      const ry = top + i * 12;
      const from = u.from[k], to = u.to[k];
      add(box, new TextObject(host, Math.round(x + 14), ry, label, { color: UI.dim }));
      add(box, new TextObject(host, Math.round(x + 70), ry, String(from), { align: 'right', color: UI.dim }));
      const bar = add(box, new Bar(host, Math.round(x + 78), ry + 2, 124, 4, shade(mem.color, -0.3), from / to));
      const cur = add(box, new TextObject(host, Math.round(x + 238), ry, String(from), { align: 'right', color: UI.disabled }));
      const gain = add(box, new TextObject(host, Math.round(x + 246), ry, `+${to - from}`, { color: UI.green }));
      gain.setVisible(false);
      this.rows.push({ cur, gain, bar });
    });
    const ry = top + stats.length * 12 + 4;
    const restores = `{g}Fully restored:{/} HP and ${u.id === 'rook' ? 'skill uses' : mem.tpLabel}, ailments cleared`;
    this.restored = add(box, new TextObject(host, Math.round(x + 14), ry, fitText(restores, w - 28)));
    this.restored.setVisible(false);
    u.learned.forEach((id, j) => {
      const ab = ABILITIES[id];
      // An id with no entry gets no row (as the old code did), not a chip with a blank name.
      if (!ab) return;
      const ly = ry + 16 + j * 18;
      const tag = ab?.kind === 'skill' ? 'NEW SKILL' : 'NEW TECH';
      const tw = measure(tag) + 8;
      const chip = add(box, new CanvasImage(host, Math.round(x + 14), ly - 2, tw, 11));
      chip.ctx.fillStyle = UI.amber;
      chip.ctx.fillRect(0, 0, tw, 11);
      chip.refresh();
      const tagText = add(box, new TextObject(host, Math.round(x + 18), ly, tag, { color: '#1a1020', shadow: false }));
      const nx = x + 22 + tw;
      const name = add(box, new TextObject(host, Math.round(nx), ly, fitText(abilityLabel(ab), LEVELUP_TEXT_W), { color: UI.cyan }));
      // A glint runs across the new name as it arrives.
      const glint = add(box, new CanvasImage(host, Math.round(nx), ly - 1, 3, 9));
      glint.ctx.fillStyle = '#ffffff';
      glint.ctx.fillRect(0, 0, 3, 9);
      glint.refresh();
      glint.setAlpha(0.7);
      for (const o of [chip, tagText, name, glint]) o.setVisible(false);
      this.learned.push({ tag: chip, tagText, name, glint });
    });
    this.arrow = add(box, new TextObject(host, Math.round(x + w - 16), y + h - 13, '▼', { color: UI.cyan }));
    this.arrow.setVisible(false);
    this.update();
  }

  update(): void {
    const { u, beats } = this;
    const t = this.t();
    const frame = this.host.frame;
    const mem = MEMBERS[u.id];
    if (frame !== this.wheelFrame) {
      this.wheelFrame = frame;
      this.paintWheel(frame, mem.color, u.id);
    }
    const levelColor = t < 10 ? '#ffffff' : UI.amber;
    if (levelColor !== this.levelColor) {
      this.levelColor = levelColor;
      const c = this.level.ctx;
      const lv = String(u.level);
      c.clearRect(0, 0, this.level.width, this.level.height);
      drawBig(c, lv, measure(lv), 0, levelColor);
      this.level.refresh();
    }
    beats.stats.forEach(([k], i) => {
      const row = this.rows[i];
      if (!row) return;
      const p = Math.max(0, Math.min(1, (t - beats.rowAt(i)) / 12));
      const from = u.from[k], to = u.to[k], gain = to - from;
      const cur = Math.round(from + gain * p);
      row.cur.setText(String(cur));
      row.cur.setStyle({ color: p <= 0 ? UI.disabled : p < 1 ? UI.amber : UI.text });
      // The gained stretch: white while it fills, then amber.
      row.bar.setGhost({ ratio: cur / to, color: p < 1 ? '#ffffff' : UI.amber });
      row.gain.setVisible(p > 0 && gain > 0);
    });
    this.restored.setVisible(t >= beats.restoredAt);
    u.learned.forEach((_, j) => {
      const l = this.learned[j];
      if (!l) return;
      const on = t >= beats.learnAt(j);
      l.tag.setVisible(on);
      l.tagText.setVisible(on);
      l.name.setVisible(on);
      const gt = t - beats.learnAt(j);
      l.glint.setVisible(on && gt < 16);
      if (on && gt < 16) l.glint.x = l.name.x + gt * 8;
    });
    this.arrow.setVisible(t >= beats.end && frame % 40 < 28);
  }

  /** The wheel of light and the portrait: the old code's calls, with the origin moved to this picture's corner. */
  private paintWheel(frame: number, color: string, who: MemberId): void {
    const c = this.wheel.ctx;
    const ox = Math.round(this.x + 38) - 36, oy = this.y + 2;
    c.clearRect(0, 0, 72, 60);
    c.save();
    c.translate(-ox, -oy);
    const pcx = this.x + 38, pcy = this.y + 38;
    c.fillStyle = color;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6 + frame * 0.015;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let r = 22 + (((frame >> 3) + k) % 4); r < 36; r += 4) {
        const py = Math.round(pcy + sa * r);
        // Kept above the stat rows.
        if (py < this.y + 60) c.fillRect(Math.round(pcx + ca * r), py, 1, 1);
      }
    }
    const port = getPortrait(who, 'happy');
    if (port) c.drawImage(port, pcx - 24, pcy - 24);
    c.restore();
    this.wheel.refresh();
  }

  destroy(): void {
    this.box.destroy();
  }
}
