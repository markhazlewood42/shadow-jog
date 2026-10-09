/**
 * The FX lab (dev only): `npm run dev`, then http://localhost:3007/?scene=fxlab.
 *
 * The game screen on the left shows a battle backdrop and an enemy to aim at, with the real GPU
 * effects; the panel on the right edits src/data/fx.json live: every particle preset (sliders for
 * each field, colours, shape, blend) and every moment (the layers that play on a game event: bursts,
 * shockwaves, colour split, bloom flare, each with a delay). Click the picture to fire the preset
 * or play the moment there; auto-repeat keeps firing while you drag. Save writes fx.json through
 * the dev server (vite.config.ts), and a running dev game takes the change at once; Revert reloads
 * it. Export and Import move one preset, one moment or the whole file as JSON. The Spells tab casts
 * a whole spell as the battle does: its shapes (code, src/battle/fx.ts) and its moments
 * (`cast.<id>` at the caster as they wind up, `spell.<id>` on each target as it lands).
 *
 * Nothing here ships: it's loaded by devroutes.ts, itself only imported in DEV builds.
 */
import { BG_IDS, battleBg, type BattleBg } from '../art/battlebg';
import { FxLayer, type Pt } from '../battle/fx';
import { gpuCast, gpuSpell } from '../scenes/battlekit/gpufx';
import { ENEMY_MID_AT, PARTY_BOTTOM, PARTY_MID, partyX, placeEnemies, WORLD_SCALE } from '../scenes/battlekit/geom';
import { artTop } from '../scenes/battlekit/sprites';
import { type EnemyArt, enemyArt } from '../art/enemies';
import { ENEMIES } from '../data/enemies';
import { FX, GAME_MOMENTS, replaceFx } from '../data/fx';
import { surface } from '../engine/canvas';
import type { Ctx } from '../engine/canvas';
import type { Display } from '../engine/display';
import { drawText } from '../engine/font';
import { checkFx, type FxData, type FxPreset, formatFx, type Moment, type MomentLayer } from '../engine/fxdata';
import { H, Scene, W } from '../engine/game';
import { playMoment } from '../engine/moments';
import type { ParticleShape } from '../engine/particles';
import { postfx } from '../engine/postfx';
import { BHT, BW, PANEL_Y } from '../scenes/battlekit/geom';

const PANEL_W = 400;

/** The spells the Spells tab casts: effect id, what uses it, and whether it hits every enemy. */
const SPELLS: readonly [string, string, boolean][] = [
  ['fire', 'Firebrand (Sable); Molotov, Wisp Flame', false],
  ['fire_all', 'Wildfire (Sable): every enemy', true],
  ['lightning', 'Overload (Hex): every enemy', true],
  ['zap', 'Taser, Coil Shock, Arc Welder (enemies)', false],
  ['code', 'Spike (Hex)', false],
  ['glitch', 'Scramble, Hijack (Hex)', false],
  ['palm', 'Iron Palm (Kit)', false],
  ['coil', 'Dragon Coil (Kit): every enemy', true],
  ['heal', 'Mend, Patch', false],
  ['heal_all', 'Mending Rain', true],
  ['revive', 'Rekindle', false],
  ['explosion', 'Pipe Bomb, Micro-Missile', false],
];
/** Where the caster stands: over the first party card, at the middle of the body (battle world px, the same spot the battle uses). */
const CASTER: Pt = { x: partyX(0, 4), y: PARTY_BOTTOM - PARTY_MID };
/** How far apart (screen px) the three dummies stand for a spell that hits every enemy; the effect's own spread is half of it in world px. */
const SPELL_SPREAD = 100;
/** Frames of windup before the effect plays (a party tech's, in battle). */
const WINDUP = 16;
const ID = /^[a-z][a-z0-9_.]*$/;

/** A fresh preset: a soft white-to-cyan puff, easy to see and to change. */
const NEW_PRESET: FxPreset = {
  note: '',
  shape: 'soft',
  count: [12, 18],
  life: [24, 44],
  speed: [0.6, 2.2],
  spread: 360,
  drag: 0.95,
  size: [5, 1],
  alpha: [1, 0],
  colors: ['#ffffff', '#3fe0f0'],
};

/** Preset fields as the panel shows them: [key, label, kind, min, max, step]. */
type NumKey = 'angle' | 'spread' | 'radius' | 'gravity' | 'drag' | 'stretch' | 'spin' | 'wobble';
type PairKey = 'count' | 'life' | 'speed' | 'size' | 'alpha';
const PAIRS: readonly [PairKey, string, [string, string], number, number, number][] = [
  ['count', 'Count', ['min', 'max'], 0, 200, 1],
  ['life', 'Life (frames)', ['min', 'max'], 1, 240, 1],
  ['speed', 'Speed (px/frame)', ['min', 'max'], 0, 12, 0.05],
  ['size', 'Size (px)', ['start', 'end'], 0, 120, 0.1],
  ['alpha', 'Opacity', ['start', 'end'], 0, 1, 0.01],
];
const NUMS: readonly [NumKey, string, number, number, number, number][] = [
  // key, label, min, max, step, default
  ['angle', 'Direction (°, 0 right, -90 up)', -180, 180, 1, 0],
  ['spread', 'Spread (°, 360 every way)', 0, 360, 1, 360],
  ['radius', 'Spawn radius (px)', 0, 80, 0.5, 0],
  ['gravity', 'Gravity (+ down, − rises)', -0.5, 0.5, 0.005, 0],
  ['drag', 'Speed kept per frame (1 = no drag)', 0.5, 1, 0.005, 1],
  ['stretch', 'Spark length (frames of travel)', 0, 10, 0.1, 3],
  ['spin', 'Spin (radians/frame)', 0, 0.5, 0.005, 0],
  ['wobble', 'Wobble (px)', 0, 10, 0.1, 0],
];
const SHAPES: readonly ParticleShape[] = ['soft', 'dot', 'spark', 'square', 'ring'];

const CSS = `
#fxlab { position: fixed; top: 0; right: 0; bottom: 0; width: ${PANEL_W}px; overflow-y: auto; box-sizing: border-box;
  background: #12111c; color: #d8d6ec; font: 12px/1.35 system-ui, sans-serif; border-left: 1px solid #2c2a40; padding: 10px 12px 40px; }
#fxlab h1 { font-size: 14px; margin: 0 0 6px; letter-spacing: 0.12em; color: #6ff3ff; }
#fxlab h2 { font-size: 12px; margin: 14px 0 6px; color: #ffe07a; text-transform: uppercase; letter-spacing: 0.08em; }
#fxlab button { background: #24223a; color: #e8e6ff; border: 1px solid #3c3a5a; border-radius: 3px; padding: 3px 8px; cursor: pointer; font: inherit; }
#fxlab button:hover { border-color: #6ff3ff; }
#fxlab button.primary { background: #1d4a52; border-color: #3fe0f0; }
#fxlab button:disabled { opacity: 0.4; cursor: default; }
#fxlab select, #fxlab input[type=text], #fxlab input[type=number], #fxlab textarea { background: #0b0a14; color: #e8e6ff; border: 1px solid #3c3a5a; border-radius: 3px; font: inherit; }
#fxlab input[type=number] { width: 64px; }
#fxlab input[type=range] { flex: 1; min-width: 60px; }
#fxlab .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
#fxlab .row > label { width: 150px; flex: none; color: #a8a6c8; }
#fxlab .sub { color: #7d7b98; width: 32px; flex: none; }
#fxlab .bar { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0; }
#fxlab .tabs button.on { background: #3a2a5a; border-color: #b07cff; }
#fxlab .status { min-height: 16px; margin: 4px 0; white-space: pre-wrap; }
#fxlab .ok { color: #86f08c; } #fxlab .err { color: #ff8a8a; } #fxlab .dim { color: #7d7b98; }
#fxlab .card { border: 1px solid #2c2a40; border-radius: 4px; padding: 6px; margin: 6px 0; background: #16152a; }
#fxlab .swatch { width: 34px; height: 20px; padding: 0; border: none; background: none; }
#fxlab textarea { width: 100%; height: 90px; box-sizing: border-box; }
`;

/** Build an element: tag, class, text, and attributes. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export class FxLabScene extends Scene<void> {
  private readonly display: Display;
  private panel: HTMLDivElement | null = null;
  private style: HTMLStyleElement | null = null;
  private body: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private tab: 'presets' | 'moments' | 'spells' = 'presets';
  private spellId = 'fire';
  /** The battle's own effect layer, for the Spells tab (battle-world coordinates). */
  private fxl = new FxLayer(BW, BHT);
  private fxWorld = surface(BW, BHT);
  private fxGlow = surface(BW, BHT);
  private pendingSpell: { at: number; id: string; targets: Pt[] } | null = null;
  private flashLeft = 0;
  private flashColor = '#ffffff';
  private presetId = Object.keys(FX.presets)[0] ?? '';
  private momentId = Object.keys(GAME_MOMENTS)[0] ?? '';
  private bgId = 'sewer';
  private bg: BattleBg = battleBg('sewer');
  private world = surface(BW, BHT);
  private enemyKey = 'sewer_ghoul';
  private art: EnemyArt | null = null;
  /** Where things fire: the enemy's middle to start with; a click moves it. */
  private target = { x: W / 2, y: 110 };
  private auto = true;
  private every = 45;
  private autoT = 0;
  private clip = true;
  private fireOnChange = true;
  private lastChangeFire = 0;
  private weight = 1.2;
  private aim = true;
  private aimAngle = 0;
  private frame = 0;
  /** The file as last loaded or saved (unsaved changes = anything that differs from it). */
  private saved = formatFx(FX);
  private onPointer = (e: PointerEvent) => {
    const p = this.display.toGame(e.clientX, e.clientY);
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return;
    this.target = { x: Math.round(p.x), y: Math.round(p.y) };
    this.fire();
  };
  private onUnload = (e: BeforeUnloadEvent) => {
    if (!this.dirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  constructor(display: Display) {
    super();
    this.display = display;
    this.setEnemy(this.enemyKey);
  }

  override enter(): void {
    postfx.clear();
    this.style = el('style', {}, CSS);
    document.head.appendChild(this.style);
    const panel = el('div', { id: 'fxlab' });
    // Typing in the panel is for the panel: the game's keyboard handler (on window) would
    // otherwise swallow z, x, arrows and Backspace.
    for (const t of ['keydown', 'keyup'] as const) panel.addEventListener(t, (e) => e.stopPropagation());
    document.body.appendChild(panel);
    this.panel = panel;
    const stage = document.getElementById('stage');
    if (stage) stage.style.right = `${PANEL_W}px`;
    this.display.resize();
    this.display.element.addEventListener('pointerdown', this.onPointer);
    window.addEventListener('beforeunload', this.onUnload);
    this.build();
  }

  override exit(): void {
    this.panel?.remove();
    this.style?.remove();
    const stage = document.getElementById('stage');
    if (stage) stage.style.right = '';
    this.display.resize();
    this.display.element.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('beforeunload', this.onUnload);
    postfx.clear();
  }

  // ------------------------------------------------------------------ the picture
  update(): void {
    this.frame++;
    postfx.rate = 1;
    postfx.clip = this.clip ? { x: 0, y: 0, w: W, h: PANEL_Y } : null;
    this.fxl.rate = 1;
    this.fxl.update();
    if (this.fxl.flash) {
      this.flashColor = this.fxl.flash.color;
      this.flashLeft = this.fxl.flash.frames;
      this.fxl.flash = null;
    }
    this.fxl.shake = 0;
    if (this.pendingSpell && this.frame >= this.pendingSpell.at) {
      const { id, targets } = this.pendingSpell;
      this.pendingSpell = null;
      const t = this.fxl.play(id, CASTER, targets, id === 'lightning' ? '#9ae8ff' : undefined);
      gpuSpell(id, targets, t.impact);
    }
    if (this.auto && ++this.autoT >= this.every) {
      this.autoT = 0;
      this.fire();
    }
  }

  render(ctx: Ctx): void {
    const g = this.world.ctx;
    g.drawImage(this.bg.canvas, 0, 0);
    if (this.bg.glow) g.drawImage(this.bg.glow, 0, 0);
    this.bg.anim?.(g, this.frame);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world.canvas, 0, 0, W, H);
    const art = this.art;
    if (art) {
      const spot = this.dummySpot(art);
      const x = Math.round(spot.x * WORLD_SCALE), y = Math.round(spot.y * WORLD_SCALE);
      // A spell on every enemy gets three of them to land on.
      const many = this.tab === 'spells' && SPELLS.find(([id]) => id === this.spellId)?.[2];
      for (const dx of many ? [-SPELL_SPREAD, 0, SPELL_SPREAD] : [0]) ctx.drawImage(art.canvas, x + dx, y, art.w * WORLD_SCALE, art.h * WORLD_SCALE);
    }
    // The battle's effect shapes, over the enemy, and into the bloom.
    const fg = this.fxWorld.ctx;
    fg.clearRect(0, 0, BW, BHT);
    this.fxl.render(fg, (c, ch, gx, gy, col) => drawText(c, ch, gx, gy, { color: col, shadow: false }));
    ctx.drawImage(this.fxWorld.canvas, 0, 0, W, H);
    if (this.flashLeft > 0) {
      ctx.globalAlpha = Math.min(0.5, this.flashLeft / 10);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      this.flashLeft--;
    }
    const glow = postfx.glowLayer();
    if (glow && this.bg.glow) {
      postfx.bloom = 0.7;
      glow.imageSmoothingEnabled = false;
      glow.drawImage(this.bg.glow, 0, 0, W, H);
    }
    if (glow && this.fxl.busy) {
      const gg = this.fxGlow.ctx;
      gg.clearRect(0, 0, BW, BHT);
      this.fxl.render(gg, () => undefined, true);
      glow.imageSmoothingEnabled = false;
      glow.drawImage(this.fxGlow.canvas, 0, 0, W, H);
    }
    // Where things fire, and the battlefield's edge (the status cards start there in battle).
    ctx.fillStyle = '#ffffff';
    const { x, y } = this.target;
    ctx.fillRect(x - 4, y, 3, 1);
    ctx.fillRect(x + 2, y, 3, 1);
    ctx.fillRect(x, y - 4, 1, 3);
    ctx.fillRect(x, y + 2, 1, 3);
    if (this.clip) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, PANEL_Y, W, 1);
    }
    const ui = postfx.ui ?? ctx;
    drawText(ui, postfx.active ? 'FX LAB · click to fire here' : '{r}GPU effects are off or unavailable (Options, or no WebGL 2){/}', 6, 4, { color: '#b8bcd0' });
  }

  private setEnemy(key: string): void {
    this.enemyKey = key;
    const d = ENEMIES[key];
    this.art = d ? enemyArt(d.sprite) : null;
    if (this.art) {
      const p = this.dummySpot(this.art);
      this.target = { x: Math.round((p.x + this.art.w / 2) * WORLD_SCALE), y: Math.round((p.y + this.art.h * ENEMY_MID_AT) * WORLD_SCALE) };
    }
  }

  /** Where the dummy stands (its top-left, in world px): the battle's own row rule for one regular enemy on this backdrop. */
  private dummySpot(art: EnemyArt): { x: number; y: number } {
    const spot = placeEnemies([{ w: art.w, h: art.h, top: artTop(art), boss: false, lurker: false }], this.bg.ground)[0];
    return spot ?? { x: 0, y: 0 };
  }

  /** Fire what's selected at the target: the preset, the moment, or the whole spell. */
  private fire(): void {
    const { x, y } = this.target;
    if (this.tab === 'spells') {
      this.castSpell();
      return;
    }
    if (this.tab === 'presets') {
      const p = FX.presets[this.presetId];
      if (p) postfx.emit(p, x, y, this.aim ? { angle: this.aimAngle } : {});
    } else playMoment(FX, this.momentId, x, y, { ...(this.aim ? { angle: this.aimAngle } : {}), weight: this.weight });
  }

  /**
   * Cast the selected spell as the battle does: it gathers at the caster through the windup, then
   * its shapes play and its moment lands on each target with the impact.
   */
  private castSpell(): void {
    if (this.pendingSpell || this.fxl.busy) return;
    const many = SPELLS.find(([id]) => id === this.spellId)?.[2];
    const t = { x: this.target.x / WORLD_SCALE, y: this.target.y / WORLD_SCALE };
    const spread = SPELL_SPREAD / WORLD_SCALE;
    const targets = many ? [{ x: t.x - spread, y: t.y }, t, { x: t.x + spread, y: t.y }] : [t];
    gpuCast(this.spellId, CASTER);
    this.pendingSpell = { at: this.frame + WINDUP, id: this.spellId, targets };
  }

  /** After an edit: mark unsaved, and show it (a burst on each change, at most every 0.15 s). */
  private changed(): void {
    this.status(this.dirty() ? 'Unsaved changes.' : '', 'dim');
    if (this.fireOnChange && performance.now() - this.lastChangeFire > 150) {
      this.lastChangeFire = performance.now();
      this.fire();
    }
  }

  private dirty(): boolean {
    return formatFx(FX) !== this.saved;
  }

  private status(text: string, kind: 'ok' | 'err' | 'dim' = 'dim'): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = `status ${kind}`;
  }

  // ------------------------------------------------------------------ the panel
  private build(): void {
    const p = this.panel;
    if (!p) return;
    p.replaceChildren();
    p.append(el('h1', {}, 'FX LAB'));
    const top = el('div', { class: 'bar' });
    const save = el('button', { class: 'primary', title: 'Write src/data/fx.json (the game uses it at once)' }, 'Save to game');
    save.onclick = () => void this.save();
    const revert = el('button', { title: 'Reload src/data/fx.json, dropping unsaved changes' }, 'Revert');
    revert.onclick = () => void this.revert();
    top.append(save, revert);
    p.append(top);
    this.statusEl = el('div', { class: 'status' });
    p.append(this.statusEl);
    this.stageControls(p);
    const tabs = el('div', { class: 'bar tabs' });
    for (const t of ['presets', 'moments', 'spells'] as const) {
      const b = el('button', t === this.tab ? { class: 'on' } : {}, t === 'presets' ? 'Particle presets' : t === 'moments' ? 'Moments' : 'Spells');
      b.onclick = () => {
        this.tab = t;
        this.build();
      };
      tabs.append(b);
    }
    p.append(tabs);
    this.body = el('div');
    p.append(this.body);
    if (this.tab === 'presets') this.presetEditor(this.body);
    else if (this.tab === 'moments') this.momentEditor(this.body);
    else this.spellPicker(this.body);
    this.exchange(p);
    this.status(this.dirty() ? 'Unsaved changes.' : 'Saved state (src/data/fx.json).', 'dim');
  }

  private stageControls(p: HTMLElement): void {
    p.append(el('h2', {}, 'Stage'));
    const bg = el('select');
    for (const id of BG_IDS) bg.append(el('option', id === this.bgId ? { value: id, selected: '' } : { value: id }, id));
    bg.onchange = () => {
      this.bgId = bg.value;
      this.bg = battleBg(bg.value);
      this.setEnemy(this.enemyKey);
    };
    p.append(this.labelled('Backdrop', bg));
    const en = el('select');
    en.append(el('option', { value: '' }, '(none)'));
    for (const [k, d] of Object.entries(ENEMIES)) en.append(el('option', k === this.enemyKey ? { value: k, selected: '' } : { value: k }, d.name));
    en.onchange = () => this.setEnemy(en.value);
    p.append(this.labelled('Target', en));
    p.append(this.check('Auto-repeat', () => this.auto, (v) => (this.auto = v)));
    p.append(this.number('Every (frames)', () => this.every, (v) => (this.every = Math.max(5, v)), 5, 240, 1, false));
    p.append(this.check('Fire on every change', () => this.fireOnChange, (v) => (this.fireOnChange = v)));
    p.append(this.check('Clip to battlefield (as in battle)', () => this.clip, (v) => (this.clip = v)));
    p.append(this.check('Aim (as a blow from the left)', () => this.aim, (v) => (this.aim = v)));
    p.append(this.number('Aim angle (°)', () => this.aimAngle, (v) => (this.aimAngle = v), -180, 180, 1, false));
    const fire = el('button', {}, 'Fire now');
    fire.onclick = () => this.fire();
    const row = el('div', { class: 'bar' });
    row.append(fire, el('span', { class: 'dim' }, 'or click the picture'));
    p.append(row);
  }

  // ---- spells
  private spellPicker(b: HTMLElement): void {
    b.append(el('p', { class: 'dim' }, 'Cast a whole spell as the battle does, from a caster at the lower left onto the target. The shapes are code (src/battle/fx.ts); what you tune here are its two moments: cast.<id> gathers at the caster during the windup, spell.<id> lands on each target.'));
    for (const [id, label] of SPELLS) {
      const row = el('div', { class: 'bar' });
      const cast = el('button', id === this.spellId ? { class: 'on' } : {}, label);
      cast.onclick = () => {
        this.spellId = id;
        this.build();
        this.castSpell();
      };
      row.append(cast);
      for (const part of ['cast', 'spell'] as const) {
        const name = `${part}.${id}`;
        if (!FX.moments[name]) continue;
        const edit = el('button', { title: `Edit the moment ${name}` }, part === 'cast' ? 'Cast ›' : 'Lands ›');
        edit.onclick = () => {
          this.tab = 'moments';
          this.momentId = name;
          this.build();
        };
        row.append(edit);
      }
      b.append(row);
    }
  }

  // ---- presets
  private presetEditor(b: HTMLElement): void {
    const ids = Object.keys(FX.presets);
    if (!ids.includes(this.presetId)) this.presetId = ids[0] ?? '';
    const list = el('select', { size: '8', style: 'width:100%' });
    for (const id of ids) list.append(el('option', id === this.presetId ? { value: id, selected: '' } : { value: id, title: FX.presets[id]?.note ?? '' }, id));
    list.onchange = () => {
      this.presetId = list.value;
      this.build();
    };
    b.append(list);
    const bar = el('div', { class: 'bar' });
    const add = el('button', {}, 'New');
    add.onclick = () => this.newPreset(false);
    const dup = el('button', {}, 'Duplicate');
    dup.onclick = () => this.newPreset(true);
    const ren = el('button', {}, 'Rename');
    ren.onclick = () => this.renamePreset();
    const del = el('button', {}, 'Delete');
    del.onclick = () => this.deletePreset();
    bar.append(add, dup, ren, del);
    b.append(bar);
    const p = FX.presets[this.presetId];
    if (!p) return;
    const users = Object.entries(FX.moments).filter(([, m]) => m.layers.some((l) => l.emit === this.presetId)).map(([id]) => id);
    b.append(el('div', { class: 'dim' }, users.length ? `Used by: ${users.join(', ')}` : 'Not used by any moment yet (add it to one on the Moments tab).'));
    const set = (patch: Partial<FxPreset>, drop?: keyof FxPreset) => {
      const cur = FX.presets[this.presetId];
      if (!cur) return;
      // A new object for every edit: particles already in flight keep the look they were born with.
      const next: FxPreset = { ...cur, ...patch };
      if (drop) delete next[drop];
      FX.presets[this.presetId] = next;
      this.changed();
    };
    const note = el('input', { type: 'text', value: p.note ?? '', style: 'flex:1' });
    note.oninput = () => set({ note: note.value });
    b.append(this.labelled('Note', note));
    const shape = el('select');
    for (const s of SHAPES) shape.append(el('option', s === p.shape ? { value: s, selected: '' } : { value: s }, s));
    shape.onchange = () => set({ shape: shape.value as ParticleShape });
    b.append(this.labelled('Shape', shape));
    const blend = el('select');
    for (const s of ['add', 'alpha']) blend.append(el('option', s === (p.blend ?? 'add') ? { value: s, selected: '' } : { value: s }, s === 'add' ? 'add (glows)' : 'alpha (covers)'));
    blend.onchange = () => set({ blend: blend.value as 'add' | 'alpha' });
    b.append(this.labelled('Blend', blend));
    for (const [k, label, subs, min, max, step] of PAIRS) {
      const pair = (): readonly [number, number] => (FX.presets[this.presetId]?.[k] ?? (k === 'alpha' ? [1, 0] : [0, 0])) as readonly [number, number];
      b.append(el('div', { class: 'dim', style: 'margin-top:6px' }, label));
      for (const i of [0, 1] as const) {
        b.append(this.number(subs[i], () => pair()[i], (v) => {
          const next: [number, number] = [pair()[0], pair()[1]];
          next[i] = v;
          set({ [k]: next } as Partial<FxPreset>);
        }, min, max, step, true));
      }
    }
    b.append(el('div', { style: 'height:6px' }));
    for (const [k, label, min, max, step, def] of NUMS) {
      b.append(this.number(label, () => FX.presets[this.presetId]?.[k] ?? def, (v) => set({ [k]: v } as Partial<FxPreset>), min, max, step, false));
    }
    b.append(this.check('Snap squares to whole pixels', () => !!FX.presets[this.presetId]?.snap, (v) => (v ? set({ snap: true }) : set({}, 'snap'))));
    b.append(this.check('Gather inward (start on the spawn radius, fly to the point)', () => !!FX.presets[this.presetId]?.inward, (v) => (v ? set({ inward: true }) : set({}, 'inward'))));
    // Colours over life.
    b.append(el('div', { class: 'dim', style: 'margin-top:6px' }, 'Colours over life (birth → death)'));
    const cols = el('div', { class: 'bar' });
    p.colors.forEach((c, i) => {
      const inp = el('input', { type: 'color', value: c, class: 'swatch', title: c });
      inp.oninput = () => {
        const next = [...(FX.presets[this.presetId]?.colors ?? [])];
        next[i] = inp.value;
        set({ colors: next });
      };
      const rm = el('button', { title: 'Remove this colour' }, '×');
      rm.disabled = p.colors.length <= 1;
      rm.onclick = () => {
        set({ colors: (FX.presets[this.presetId]?.colors ?? []).filter((_, j) => j !== i) });
        this.build();
      };
      const cell = el('span');
      cell.append(inp, rm);
      cols.append(cell);
    });
    const addC = el('button', {}, '+ colour');
    addC.onclick = () => {
      const cs = FX.presets[this.presetId]?.colors ?? [];
      set({ colors: [...cs, cs[cs.length - 1] ?? '#ffffff'] });
      this.build();
    };
    cols.append(addC);
    b.append(cols);
  }

  private askId(what: string, start: string): string | null {
    const id = window.prompt(`${what} id (lower case letters, digits, _ and .)`, start)?.trim();
    if (!id) return null;
    if (!ID.test(id)) {
      this.status(`"${id}" isn't a valid id.`, 'err');
      return null;
    }
    return id;
  }

  private newPreset(copy: boolean): void {
    const id = this.askId('New preset', copy ? `${this.presetId}_2` : 'my_effect');
    if (!id) return;
    if (FX.presets[id]) {
      this.status(`There's already a preset "${id}".`, 'err');
      return;
    }
    const src = copy ? FX.presets[this.presetId] : undefined;
    FX.presets[id] = src ? (JSON.parse(JSON.stringify(src)) as FxPreset) : { ...NEW_PRESET };
    this.presetId = id;
    this.build();
    this.changed();
  }

  private renamePreset(): void {
    const old = this.presetId;
    const p = FX.presets[old];
    if (!p) return;
    const id = this.askId('Rename preset', old);
    if (!id || id === old) return;
    if (FX.presets[id]) {
      this.status(`There's already a preset "${id}".`, 'err');
      return;
    }
    // Keep the order, and every moment that uses it follows the new name.
    const next: Record<string, FxPreset> = {};
    for (const [k, v] of Object.entries(FX.presets)) next[k === old ? id : k] = v;
    for (const k of Object.keys(FX.presets)) delete FX.presets[k];
    Object.assign(FX.presets, next);
    for (const m of Object.values(FX.moments)) for (const l of m.layers) if (l.emit === old) l.emit = id;
    this.presetId = id;
    this.build();
    this.changed();
  }

  private deletePreset(): void {
    const id = this.presetId;
    const users = Object.entries(FX.moments).filter(([, m]) => m.layers.some((l) => l.emit === id)).map(([k]) => k);
    if (users.length) {
      this.status(`"${id}" is used by ${users.join(', ')}: take it out of those moments first.`, 'err');
      return;
    }
    if (!window.confirm(`Delete the preset "${id}"?`)) return;
    delete FX.presets[id];
    this.presetId = Object.keys(FX.presets)[0] ?? '';
    this.build();
    this.changed();
  }

  // ---- moments
  private momentEditor(b: HTMLElement): void {
    const game = Object.keys(GAME_MOMENTS);
    const custom = Object.keys(FX.moments).filter((id) => !game.includes(id));
    if (!FX.moments[this.momentId]) this.momentId = game[0] ?? '';
    const list = el('select', { size: '8', style: 'width:100%' });
    for (const id of [...game, ...custom]) {
      const desc = (GAME_MOMENTS as Record<string, string>)[id];
      list.append(el('option', id === this.momentId ? { value: id, selected: '' } : { value: id }, desc ? `${id}: ${desc}` : `${id} (not played by the game yet)`));
    }
    list.onchange = () => {
      this.momentId = list.value;
      this.build();
    };
    b.append(list);
    const bar = el('div', { class: 'bar' });
    const add = el('button', {}, 'New');
    add.onclick = () => {
      const id = this.askId('New moment', 'my_moment');
      if (!id) return;
      if (FX.moments[id]) {
        this.status(`There's already a moment "${id}".`, 'err');
        return;
      }
      FX.moments[id] = { note: '', layers: [] };
      this.momentId = id;
      this.build();
      this.changed();
    };
    const del = el('button', {}, 'Delete');
    del.disabled = game.includes(this.momentId);
    del.title = del.disabled ? 'The game plays this one: it stays (empty it instead)' : 'Delete this moment';
    del.onclick = () => {
      if (!window.confirm(`Delete the moment "${this.momentId}"?`)) return;
      delete FX.moments[this.momentId];
      this.momentId = game[0] ?? '';
      this.build();
      this.changed();
    };
    bar.append(add, del);
    b.append(bar);
    const m = FX.moments[this.momentId];
    if (!m) {
      b.append(el('div', { class: 'err' }, `fx.json has no "${this.momentId}": add it with New.`));
      return;
    }
    const note = el('input', { type: 'text', value: m.note ?? '', style: 'flex:1' });
    note.oninput = () => {
      m.note = note.value;
      this.changed();
    };
    b.append(this.labelled('Note', note));
    b.append(this.number('Test weight (hits: 0.6 tap … 1.9 crushing)', () => this.weight, (v) => (this.weight = v), 0.2, 3, 0.05, false));
    m.layers.forEach((l, i) => {
      b.append(this.layerCard(m, l, i));
    });
    const addL = el('button', {}, '+ layer');
    addL.onclick = () => {
      m.layers.push({ emit: Object.keys(FX.presets)[0] ?? '' });
      this.build();
      this.changed();
    };
    b.append(addL);
  }

  private layerCard(m: Moment, l: MomentLayer, i: number): HTMLElement {
    const card = el('div', { class: 'card' });
    const kind = l.emit !== undefined ? 'emit' : l.shock ? 'shock' : l.aberrate !== undefined ? 'aberrate' : l.haze ? 'haze' : l.glitch ? 'glitch' : l.dim ? 'dim' : 'flare';
    const head = el('div', { class: 'bar' });
    const type = el('select');
    for (const [v, t] of [['emit', 'Particles'], ['shock', 'Shockwave'], ['aberrate', 'Colour split'], ['flare', 'Bloom flare'], ['haze', 'Heat haze'], ['glitch', 'Glitch'], ['dim', 'Dim the stage']] as const) {
      type.append(el('option', v === kind ? { value: v, selected: '' } : { value: v }, t));
    }
    type.onchange = () => {
      const keep: MomentLayer = {};
      if (l.delay !== undefined) keep.delay = l.delay;
      if (type.value === 'emit') keep.emit = Object.keys(FX.presets)[0] ?? '';
      else if (type.value === 'shock') keep.shock = { strength: 4, reach: 120, life: 26, width: 10 };
      else if (type.value === 'aberrate') keep.aberrate = 2.5;
      else if (type.value === 'haze') keep.haze = { radius: 40, strength: 1.5, life: 60 };
      else if (type.value === 'glitch') keep.glitch = { w: 90, h: 60, strength: 6, life: 24 };
      else if (type.value === 'dim') keep.dim = { amount: 0.5, life: 60 };
      else keep.flare = 0.5;
      m.layers[i] = keep;
      this.build();
      this.changed();
    };
    const move = (d: number) => {
      const j = i + d;
      if (j < 0 || j >= m.layers.length) return;
      const a = m.layers[i], bL = m.layers[j];
      if (!a || !bL) return;
      m.layers[i] = bL;
      m.layers[j] = a;
      this.build();
      this.changed();
    };
    const up = el('button', { title: 'Move up' }, '↑');
    up.onclick = () => move(-1);
    const down = el('button', { title: 'Move down' }, '↓');
    down.onclick = () => move(1);
    const rm = el('button', { title: 'Remove this layer' }, '×');
    rm.onclick = () => {
      m.layers.splice(i, 1);
      this.build();
      this.changed();
    };
    head.append(el('b', {}, `${i + 1}`), type, up, down, rm);
    card.append(head);
    const num = (label: string, get: () => number, put: (v: number) => void, min: number, max: number, step: number) =>
      card.append(this.number(label, get, (v) => {
        put(v);
        this.changed();
      }, min, max, step, false));
    if (kind === 'emit') {
      const pick = el('select');
      for (const id of Object.keys(FX.presets)) pick.append(el('option', id === l.emit ? { value: id, selected: '' } : { value: id }, id));
      pick.onchange = () => {
        l.emit = pick.value;
        this.changed();
      };
      card.append(this.labelled('Preset', pick));
      num('Count ×', () => l.scale ?? 1, (v) => (l.scale = v), 0, 6, 0.05);
      card.append(this.check('Weighted (heavier blow, bigger burst)', () => !!l.weighted, (v) => {
        if (v) l.weighted = true;
        else delete l.weighted;
        this.changed();
      }));
      card.append(this.check('Aimed (the way the blow travelled)', () => !!l.aim, (v) => {
        if (v) l.aim = true;
        else delete l.aim;
        this.changed();
      }));
    } else if (kind === 'shock') {
      l.shock ??= {};
      const s = l.shock;
      num('Push (px)', () => s.strength ?? 3, (v) => (s.strength = v), 0, 20, 0.1);
      num('Reach (px)', () => s.reach ?? 90, (v) => (s.reach = v), 0, W, 1);
      num('Life (frames)', () => s.life ?? 26, (v) => (s.life = v), 1, 120, 1);
      num('Ring width (px)', () => s.width ?? 10, (v) => (s.width = v), 1, 60, 0.5);
    } else if (kind === 'aberrate') {
      num('Split (px)', () => l.aberrate ?? 0, (v) => (l.aberrate = v), 0, 10, 0.1);
    } else if (kind === 'haze') {
      l.haze ??= {};
      const s = l.haze;
      num('Radius (px)', () => s.radius ?? 40, (v) => (s.radius = v), 4, W / 2, 1);
      num('Waver (px)', () => s.strength ?? 1.5, (v) => (s.strength = v), 0, 8, 0.1);
      num('Life (frames)', () => s.life ?? 60, (v) => (s.life = v), 1, 240, 1);
    } else if (kind === 'glitch') {
      l.glitch ??= {};
      const s = l.glitch;
      num('Width (px)', () => s.w ?? 90, (v) => (s.w = v), 4, W, 1);
      num('Height (px)', () => s.h ?? 60, (v) => (s.h = v), 4, H, 1);
      num('Slide (px)', () => s.strength ?? 6, (v) => (s.strength = v), 0, 30, 0.5);
      num('Life (frames)', () => s.life ?? 24, (v) => (s.life = v), 1, 120, 1);
    } else if (kind === 'dim') {
      l.dim ??= {};
      const s = l.dim;
      num('How dark (0-1)', () => s.amount ?? 0.5, (v) => (s.amount = v), 0, 1, 0.01);
      num('Life (frames)', () => s.life ?? 60, (v) => (s.life = v), 1, 240, 1);
    } else {
      num('Flare', () => l.flare ?? 0, (v) => (l.flare = v), 0, 3, 0.05);
    }
    num('Delay (frames)', () => l.delay ?? 0, (v) => {
      if (v > 0) l.delay = v;
      else delete l.delay;
    }, 0, 120, 1);
    num('Offset x (px)', () => l.dx ?? 0, (v) => {
      if (v) l.dx = v;
      else delete l.dx;
    }, -120, 120, 1);
    num('Offset y (px)', () => l.dy ?? 0, (v) => {
      if (v) l.dy = v;
      else delete l.dy;
    }, -120, 120, 1);
    return card;
  }

  // ---- save, revert, export, import
  private async save(): Promise<void> {
    const problems = checkFx(FX);
    if (problems.length) {
      this.status(`Can't save:\n${problems.join('\n')}`, 'err');
      return;
    }
    this.status('Saving…');
    try {
      const r = await fetch('/__fxlab/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(FX) });
      const j = (await r.json()) as { ok: boolean; text?: string; problems?: string[] };
      if (!j.ok || !j.text) throw new Error((j.problems ?? [`HTTP ${r.status}`]).join('\n'));
      this.saved = j.text;
      this.status('Saved to src/data/fx.json. A running dev game uses it now; commit it to ship it.', 'ok');
    } catch (e) {
      this.status(`Save failed (is this the dev server, npm run dev?):\n${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }

  private async revert(): Promise<void> {
    if (this.dirty() && !window.confirm('Drop your unsaved changes and reload fx.json?')) return;
    try {
      const r = await fetch('/__fxlab/fx');
      const j = (await r.json()) as { ok: boolean; text?: string };
      if (!j.ok || !j.text) throw new Error(`HTTP ${r.status}`);
      replaceFx(JSON.parse(j.text) as FxData);
      this.saved = j.text;
      this.build();
      this.status('Reloaded src/data/fx.json.', 'ok');
    } catch (e) {
      this.status(`Couldn't reload: ${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }

  private exchange(p: HTMLElement): void {
    p.append(el('h2', {}, 'Export / import'));
    const box = el('textarea', { spellcheck: 'false', placeholder: 'Exported JSON appears here. Paste JSON here to import it.' });
    const put = (text: string) => {
      box.value = text;
      void navigator.clipboard?.writeText(text).then(
        () => this.status('Copied to the clipboard (and shown below).', 'ok'),
        () => this.status('Shown below (the clipboard wasn’t available).', 'dim'),
      );
    };
    const bar = el('div', { class: 'bar' });
    const one = el('button', {}, this.tab === 'presets' ? 'Export preset' : 'Export moment');
    one.onclick = () => put(JSON.stringify(this.tab === 'presets' ? { [this.presetId]: FX.presets[this.presetId] } : { [this.momentId]: FX.moments[this.momentId] }, null, 2));
    const all = el('button', {}, 'Export all');
    all.onclick = () => put(formatFx(FX));
    const imp = el('button', {}, 'Import');
    imp.onclick = () => this.importText(box.value);
    bar.append(one, all, imp);
    p.append(bar, box);
  }

  /**
   * Take pasted JSON: a whole fx.json, or `{ "id": preset }` / `{ "id": moment }` entries (as
   * Export writes them), added or replacing by id. Checked before anything changes.
   */
  private importText(text: string): void {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      this.status('That isn’t valid JSON.', 'err');
      return;
    }
    const candidate = JSON.parse(JSON.stringify(FX)) as FxData;
    if (typeof data === 'object' && data !== null && 'presets' in data && 'moments' in data) Object.assign(candidate, data);
    else if (typeof data === 'object' && data !== null) {
      for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
        if (typeof v === 'object' && v !== null && 'layers' in v) candidate.moments[id] = v as Moment;
        else candidate.presets[id] = v as FxPreset;
      }
    }
    const problems = checkFx(candidate);
    if (problems.length) {
      this.status(`Not imported:\n${problems.join('\n')}`, 'err');
      return;
    }
    replaceFx(candidate);
    this.build();
    this.changed();
    this.status('Imported (not saved yet).', 'ok');
  }

  // ---- controls
  private labelled(label: string, control: HTMLElement): HTMLElement {
    const row = el('div', { class: 'row' });
    row.append(el('label', {}, label), control);
    return row;
  }

  private check(label: string, get: () => boolean, put: (v: boolean) => void): HTMLElement {
    const box = el('input', { type: 'checkbox' });
    box.checked = get();
    box.onchange = () => put(box.checked);
    const row = el('div', { class: 'row' });
    const lab = el('label', { style: 'width:auto' });
    lab.append(box, document.createTextNode(` ${label}`));
    row.append(lab);
    return row;
  }

  /** A slider and a number box that follow each other. `sub`: a short label on the same row. */
  private number(label: string, get: () => number, put: (v: number) => void, min: number, max: number, step: number, sub: boolean): HTMLElement {
    const row = el('div', { class: 'row' });
    row.append(el('label', sub ? { class: 'sub' } : {}, label));
    const range = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const box = el('input', { type: 'number', step: String(step) });
    const v0 = get();
    range.value = String(v0);
    box.value = String(v0);
    range.oninput = () => {
      box.value = range.value;
      put(Number(range.value));
    };
    box.onchange = () => {
      const v = Number(box.value);
      if (!Number.isFinite(v)) return;
      range.value = String(v);
      put(v);
    };
    row.append(range, box);
    return row;
  }
}
