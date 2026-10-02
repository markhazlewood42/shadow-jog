/**
 * The side-view arm lab (dev only; spike `spike/side-battle`): `?scene=sidelab&scale=field|battle`.
 *
 * Shows Rook seen from the side, enlarged with nearest-neighbour scaling, to answer one question:
 * can the near arm be posed without a pixel repaint loop? A sheet per scale:
 *   - the base, then the arm cut out and the torso filled in behind it;
 *   - the arm turned about the shoulder into three poses (raised overhead, forward, low
 *     follow-through), with and without the katana held in two hands;
 *   - the same three poses with a code-drawn limb instead.
 * `scale=battle` also lays out the ways of shrinking his traced 8-direction view to ~46 px.
 *
 * The sheet is a DOM canvas laid over the page (the game's own canvas is only 480x270), so it can be
 * screenshotted big: `node scripts/shot.mjs` takes the game canvas, so use the page screenshot.
 */
import { renderLayers, type Layer, decode, type Traced } from '../art/rig2/rig';
import { TRACED, VIEWS_TRACED, loadViews } from '../art/rig2/data';
import { buildSideCrew } from '../art/rig2/sidecrew';
import { buildChar } from '../art/chars';
import { LOOKS } from '../data/looks';
import {
  type Dims,
  POSES,
  type Pt,
  type SideArm,
  type ShrinkMode,
  drawnArm,
  heldKatana,
  rotatedArm,
  scaleArm,
  separateArm,
  shrink,
  stripOutline,
} from '../art/rig2/side';
import type { Ctx } from '../engine/canvas';
import { Scene } from '../engine/game';

/** Rook's near arm on his traced FIELD `left` frame (17x30). */
const FIELD_ARM: SideArm = { shoulder: [8.5, 13], hand: [7.6, 21.6], r: 2.6, sleeve: [8, 16], skin: [7, 21] };
/** The same on his traced `west` view (47x99), in that frame's pixels. */
const VIEW_ARM: SideArm = { shoulder: [20.5, 38], hand: [17.5, 61.5], r: 6.8, sleeve: [19, 53], skin: [17, 61] };

/** How big the lab's frames are: the cell holds the raised arm and the blade. */
interface Scale {
  cell: [number, number];
  /** Where the frame's (0, 0) goes in the cell. */
  at: Pt;
  zoom: number;
  katana: Dims;
  grip: number;
  fist: number;
  width: number;
  /** How much of a pose's arm extension this size takes (the battle size's arm is already long). */
  reach: number;
}

const FIELD: Scale = { cell: [56, 48], at: [24, 16], zoom: 5, katana: { pommel: -5, guard: 2, tip: 17, thin: true }, grip: 2.6, fist: 1.2, width: 3, reach: 1 };
const BATTLE: Scale = { cell: [88, 76], at: [40, 26], zoom: 3, katana: { pommel: -8, guard: 3, tip: 25 }, grip: 4, fist: 2.3, width: 4.6, reach: 0.85 };

/** Which shrink the battle sheet uses for its poses (set after comparing them on the sheet). */
const BATTLE_MODE: ShrinkMode = 'nearest';

const BG = '#3a3f5c';

function mount(): HTMLCanvasElement {
  document.querySelector('#sidelab')?.remove();
  const c = document.createElement('canvas');
  c.id = 'sidelab';
  c.style.cssText = `position:fixed;left:0;top:0;z-index:999;image-rendering:pixelated;background:${BG}`;
  document.body.appendChild(c);
  return c;
}

/** One lab cell: layers drawn in order, outlined, on a neutral ground. */
function cell(layers: Layer[], pal: string[], s: Scale): HTMLCanvasElement {
  return renderLayers(layers, pal, s.cell[0], s.cell[1], s.at[0], s.at[1]);
}

interface Sheet {
  g: CanvasRenderingContext2D;
  zoom: number;
  cw: number;
  ch: number;
  x: number;
  y: number;
  col: number;
}

function put(sh: Sheet, c: HTMLCanvasElement, label: string): void {
  const x = sh.x + sh.col * (sh.cw * sh.zoom + 8);
  sh.g.imageSmoothingEnabled = false;
  sh.g.fillStyle = '#2e3250';
  sh.g.fillRect(x, sh.y, sh.cw * sh.zoom, sh.ch * sh.zoom);
  sh.g.drawImage(c, x, sh.y, sh.cw * sh.zoom, sh.ch * sh.zoom);
  sh.g.fillStyle = '#fff';
  sh.g.font = '13px sans-serif';
  sh.g.fillText(label, x + 4, sh.y + sh.ch * sh.zoom - 6);
  sh.col++;
}

function row(sh: Sheet, title: string): void {
  sh.y += sh.col ? sh.ch * sh.zoom + 8 : 0;
  sh.col = 0;
  sh.g.fillStyle = '#9fd';
  sh.g.font = 'bold 14px sans-serif';
  sh.g.fillText(title, sh.x, sh.y + 12);
  sh.y += 18;
}

/** Build one scale's sheet: the arm test on `base` (a decoded frame with its palette). */
function arm(sh: Sheet, base: Layer, pal: string[], a: SideArm, s: Scale): void {
  const sep = separateArm(base, a, pal);
  const farShoulder: Pt = [a.shoulder[0] + 1, a.shoulder[1] - 0.5];
  row(sh, 'The cut: base | body with torso filled | arm alone | gap fill | put back together');
  put(sh, cell([base], pal, s), 'base (as traced)');
  put(sh, cell([sep.body], pal, s), 'body, arm gone');
  put(sh, cell([sep.arm], pal, s), 'arm alone');
  put(sh, cell([sep.gap], pal, s), 'torso fill only');
  put(sh, cell([sep.body, sep.arm], pal, s), 'put back (rest)');

  const katanaFor = (hand: Pt, blade: number) => heldKatana(hand, blade, pal, s.katana, s.grip, sep.skinCol, farShoulder, sep.sleeveCol, s.fist);
  for (const mode of ['rot', 'code'] as const) {
    for (const withKatana of [false, true]) {
      row(sh, `${mode === 'rot' ? '(i) the arm turned (RotSprite)' : '(ii) a code-drawn limb'}${withKatana ? ', katana in both hands' : ''}`);
      for (const p of POSES) {
        const posed = mode === 'rot' ? rotatedArm(sep, a, p.deg, p.reach * s.reach) : drawnArm(sep, a, pal, p.deg, s.width, s.fist, p.reach * s.reach);
        const layers: Layer[] = [];
        if (withKatana) {
          const k = katanaFor(posed.hand, p.blade);
          layers.push(...k.behind, sep.body, k.blade, k.farHand, ...posed.layers);
        } else layers.push(sep.body, ...posed.layers);
        put(sh, cell(layers, pal, s), p.name);
      }
    }
  }
}

/**
 * The crew sheet (`?scene=sidelab&scale=crew`): each member's field `left` frame for identity, the battle-scale
 * wait loop (3 frames) and walk (4 frames), then the action poses (brace, wind-up, strike, cast, hurt, victory),
 * two rows a member, all at one zoom (default 4).
 */
async function crewSheet(zoom: number): Promise<HTMLCanvasElement> {
  const canvas = mount();
  if (!Object.keys(VIEWS_TRACED).length) await loadViews();
  const keys = ['kit', 'rook', 'hex', 'sable'];
  const crews = keys.map((k) => buildSideCrew(k));
  // Each member's cells are cropped to the box that holds all of their frames (the frames carry room for a katana and a lunge).
  const boxes = crews.map((c) => {
    const frames = c ? [...c.idle, ...c.walk, ...Object.values(c.poses)] : [];
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const f of frames) {
      const d = f.getContext('2d')?.getImageData(0, 0, f.width, f.height).data;
      if (!d) continue;
      for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) if ((d[(y * f.width + x) * 4 + 3] ?? 0) > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    return { x0: x0 - 1, y0: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 };
  });
  const cw = Math.max(...boxes.map((b) => b.w), 34);
  const cols = 8;
  const heights = boxes.map((b) => b.h * zoom + 22);
  canvas.width = 8 + cols * (cw * zoom + 8);
  canvas.height = 36 + heights.reduce((a, h) => a + 2 * h, 0);
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  g.imageSmoothingEnabled = false;
  g.fillStyle = BG;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#fff';
  g.font = 'bold 16px sans-serif';
  g.fillText(`The crew at BATTLE scale, round 4: the traced south-west view collapsed to its native resolution (one art pixel per screen pixel), graded, outlined, x${zoom}. Row 1: field frame | wait 1 2 3 (played 1-2-3-2) | walk 1 2 3 4. Row 2: brace | wind-up | strike | cast | hurt | victory`, 8, 22);
  const heads1 = ['field frame', 'wait 1', 'wait 2', 'wait 3', 'walk 1', 'walk 2', 'walk 3', 'walk 4'];
  const heads2 = ['', 'brace', 'wind-up (attack)', 'strike', 'cast', 'hurt', 'victory', ''];
  const put = (c: HTMLCanvasElement | undefined, label: string, i: number, y: number, box: { x0: number; y0: number; w: number; h: number }, field: boolean): void => {
    const x = 8 + i * (cw * zoom + 8);
    g.fillStyle = '#2e3250';
    g.fillRect(x, y, cw * zoom, box.h * zoom);
    if (c && field) g.drawImage(c, x + Math.floor((cw * zoom - c.width * zoom) / 2), y + box.h * zoom - c.height * zoom, c.width * zoom, c.height * zoom);
    else if (c) g.drawImage(c, box.x0, box.y0, box.w, box.h, x + Math.floor((cw - box.w) / 2) * zoom, y, box.w * zoom, box.h * zoom);
    g.fillStyle = '#fff';
    g.font = '12px sans-serif';
    g.fillText(label, x + 4, y + box.h * zoom + 14);
  };
  let y = 36;
  keys.forEach((k, r) => {
    const crew = crews[r];
    const box = boxes[r];
    if (!box) return;
    const field = buildChar(LOOKS[k as keyof typeof LOOKS]).frames.left[0];
    const row1: (HTMLCanvasElement | undefined)[] = [field, ...(crew?.idle ?? []), ...(crew?.walk ?? [])];
    const row2: (HTMLCanvasElement | undefined)[] = [undefined, crew?.poses.brace, crew?.poses.attack, crew?.poses.strike, crew?.poses.cast, crew?.poses.hurt, crew?.poses.victory, undefined];
    row1.forEach((c, i) => {
      put(c, `${k} ${heads1[i]}`, i, y, box, i === 0);
    });
    y += box.h * zoom + 22;
    row2.forEach((c, i) => {
      if (c) put(c, `${k} ${heads2[i]}`, i, y, box, false);
    });
    y += box.h * zoom + 22;
  });
  return canvas;
}

async function build(which: string, zoom?: number): Promise<HTMLCanvasElement> {
  if (which === 'crew') return crewSheet(zoom || 4);
  const canvas = mount();
  const field = which !== 'battle';
  const s = { ...(field ? FIELD : BATTLE), ...(zoom ? { zoom } : {}) };
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const cw = s.cell[0];
  const ch = s.cell[1];
  const cols = 5;
  canvas.width = 16 + cols * (cw * s.zoom + 8);
  canvas.height = 3000;
  g.fillStyle = BG;
  g.fillRect(0, 0, canvas.width, canvas.height);
  const sh: Sheet = { g, zoom: s.zoom, cw, ch, x: 8, y: 8, col: 0 };
  g.fillStyle = '#fff';
  g.font = 'bold 16px sans-serif';
  g.fillText(field ? `Rook, FIELD scale (traced left frame, 30 px tall), x${s.zoom}` : `Rook, BATTLE scale (traced west view shrunk to ~46 px), x${s.zoom}`, 8, 20);
  sh.y = 30;
  if (field) {
    const t = TRACED.rook?.left;
    if (!t) throw new Error('Rook has no traced left frame');
    arm(sh, decode(t), t.pal, FIELD_ARM, s);
  } else {
    const res = await fetch('art/rig/views.json');
    const views = (await res.json()) as Record<string, Record<string, Traced>>;
    const west = views.rook?.west;
    if (!west) throw new Error('Rook has no traced west view');
    const k = 46 / (west.feet - 0);
    // Ways of shrinking the traced view to ~46 px, each with its own outline put back.
    row(sh, `Shrinking the 99 px west view to ${Math.round(west.h * k)} px (x${k.toFixed(3)}): source | average+snap | nearest | commonest colour (all outlined again)`);
    put(sh, renderLayers([decode(west)], west.pal, 60, 110, 6, 6), 'source 47x99');
    for (const mode of ['area', 'nearest', 'mode'] as ShrinkMode[]) {
      const sm = shrink(west, k, mode);
      put(sh, cell([stripOutline(decode(sm), sm.pal)], sm.pal, s), mode);
    }
    // The shrunk-and-snapped frame the poses use.
    const sm = shrink(west, k, BATTLE_MODE);
    const base = stripOutline(decode(sm), sm.pal);
    arm(sh, base, sm.pal, scaleArm(VIEW_ARM, k), s);
  }
  // Trim the canvas to what was drawn.
  const used = Math.ceil(sh.y + ch * s.zoom + 12);
  const trimmed = g.getImageData(0, 0, canvas.width, used);
  canvas.height = used;
  g.putImageData(trimmed, 0, 0);
  return canvas;
}

export class SideLabScene extends Scene {
  private status = 'building the lab sheet...';
  constructor(private which: string, private zoom = 0) {
    super();
  }
  override enter(): void {
    void build(this.which, this.zoom).then(
      () => {
        this.status = 'sidelab ready';
        (window as unknown as { __sidelab?: string }).__sidelab = 'ready';
      },
      (e: unknown) => {
        this.status = `sidelab failed: ${e instanceof Error ? e.message : String(e)}`;
        (window as unknown as { __sidelab?: string }).__sidelab = this.status;
      },
    );
  }
  override update(): void {}
  override render(ctx: Ctx): void {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, 480, 270);
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.fillText(this.status, 8, 16);
  }
}
