/**
 * The handles drawn over the stage in the Battle Stage Editor (Phaser spike `spike/phaser-stage`).
 *
 * The stage underneath is the real Phaser scene, the very one a battle draws. The handles are NOT part of it: they
 * are an SVG laid exactly over the canvas, scaled so that one unit of the SVG is one game pixel. That keeps the
 * stage untouched (nothing the editor draws can leak into a battle) and lets the handles' text be sharp at any
 * zoom instead of being blown up pixel art. Lines are drawn one screen pixel thin whatever the zoom
 * (`vector-effect: non-scaling-stroke`); text sizes are worked out in game units from the current zoom.
 *
 * What is drawn (`docs/TOOLING-UI.md` 3.4): the horizon (cyan dashes), the floor bottom (green, with a grip), the
 * depth rows (thin white, numbered, with a swatch of their haze), a badge at every fighter's feet (orange P1 to P4
 * for the party, pink E1.. for enemies, with +1 / -1 where the draw order is overridden), the selection outline,
 * the HUD boxes (yellow, with corner grips on the selected one), and the optional guides, safe zones, camera
 * outline and foot-anchor crosshairs.
 *
 * This file only DRAWS from the state it is given; the pointer logic that picks and moves things is in
 * `interact.ts`, and the geometry it uses is in `hit.ts`.
 */
import { SCREEN_H, SCREEN_W, type StageConfig } from '../config';
import type { Phase } from '../demo';
import { HUD_REGION_NAMES, HUD_REGIONS, hudOverrides } from '../hudpresets';
import { isShown } from '../hudlayout';
import type { Layer } from './hit';
import type { Item } from './session';

/** What the overlay needs to know about one figure standing on the stage. */
export interface OverlayFigure {
  side: 'party' | 'enemy';
  index: number;
  /** Feet position and the edges of the drawn pixels, in game pixels. */
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  /** The slot's draw-order override. */
  order: -1 | 0 | 1;
  /** True when this sprite's foot anchor has been corrected (drawn white; a measured one is grey). */
  shifted: boolean;
}

export interface OverlayShow {
  hud: boolean;
  guides: boolean;
  safe: boolean;
  camera: boolean;
  anchors: boolean;
}

export interface OverlayInput {
  stage: StageConfig;
  figures: OverlayFigure[];
  selection: Item[];
  hover: Item | null;
  show: OverlayShow;
  phase: Phase;
  locked: ReadonlySet<Layer>;
}

const C = {
  horizon: '#5ae8ff',
  floor: '#62e06a',
  row: '#ffffff',
  party: '#ffa24a',
  enemy: '#ff6ad5',
  hud: '#ffd35a',
  select: '#ffe07a',
  hover: '#ffffff',
  safe: '#ff5a5a',
  guide: '#8a86a0',
  camera: '#ff9a3c',
  ink: '#07060d',
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const same = (a: Item | null, b: Item): boolean => !!a && a.kind === b.kind && JSON.stringify(a) === JSON.stringify(b);

/** The SVG markup for the handles. `scale` is screen pixels per game pixel (so text can be a fixed readable size). */
export function overlayMarkup(input: OverlayInput, scale: number): string {
  const { stage, figures, selection, hover, show, phase, locked } = input;
  const u = 1 / scale;
  const fs = 10.5 * u;
  const out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, opts: { w?: number; dash?: string | undefined; alpha?: number } = {}): void => {
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${opts.w ?? 1}" ${opts.dash ? `stroke-dasharray="${opts.dash}"` : ''} ${opts.alpha !== undefined ? `stroke-opacity="${opts.alpha}"` : ''} vector-effect="non-scaling-stroke"/>`);
  };
  const rect = (x: number, y: number, w: number, h: number, o: { stroke?: string; fill?: string; sw?: number; dash?: string | undefined; alpha?: number; fillAlpha?: number } = {}): void => {
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill ?? 'none'}" ${o.fillAlpha !== undefined ? `fill-opacity="${o.fillAlpha}"` : ''} stroke="${o.stroke ?? 'none'}" stroke-width="${o.sw ?? 1}" ${o.dash ? `stroke-dasharray="${o.dash}"` : ''} ${o.alpha !== undefined ? `stroke-opacity="${o.alpha}"` : ''} vector-effect="non-scaling-stroke"/>`);
  };
  // Text over the stage gets a dark outline so it reads on any picture; text on a solid badge does not (`outline` false).
  const text = (t: string, x: number, y: number, color: string, anchor: 'start' | 'middle' | 'end' = 'start', size = fs, weight = 600, outline = true): void => {
    const edge = outline ? `stroke="${C.ink}" stroke-width="${2.4 * u}" stroke-linejoin="round" paint-order="stroke"` : '';
    out.push(`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${edge}>${esc(t)}</text>`);
  };
  const isSel = (it: Item): boolean => selection.some((s) => same(s, it));

  // --- optional guides: the frame, the centre line and the line where the two sides meet
  if (show.guides) {
    rect(0.5, 0.5, SCREEN_W - 1, SCREEN_H - 1, { stroke: C.guide, alpha: 0.7 });
    line(SCREEN_W / 2, 0, SCREEN_W / 2, SCREEN_H, C.guide, { dash: '4 4', alpha: 0.6 });
    const heroes = figures.filter((f) => f.side === 'party');
    const foes = figures.filter((f) => f.side === 'enemy');
    if (heroes.length && foes.length) {
      const meet = (Math.max(...heroes.map((f) => f.right)) + Math.min(...foes.map((f) => f.left))) / 2;
      line(meet, stage.backdrop.horizonY, meet, stage.floor.y1, C.guide, { dash: '2 3', alpha: 0.8 });
      text('meet', meet, stage.backdrop.horizonY + 9 * u * 1.1, C.guide, 'middle', 9 * u);
    }
  }
  if (show.camera) {
    rect(1.5, 1.5, SCREEN_W - 3, SCREEN_H - 3, { stroke: C.camera, dash: '6 3', alpha: 0.85 });
    text('Camera 480×270', SCREEN_W - 4, SCREEN_H - 4 - 40, C.camera, 'end', 9 * u);
  }

  // --- HUD boxes
  if (show.hud) {
    const overridden = new Set(hudOverrides(stage.hud).map((o) => o.region));
    for (const name of HUD_REGIONS) {
      const r = stage.hud[name];
      const shown = isShown(name, r.show, phase);
      const it: Item = { kind: 'hud', region: name };
      const sel = isSel(it);
      const hov = same(hover, it);
      rect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, { stroke: C.hud, sw: sel ? 2 : 1, dash: shown ? undefined : '3 2', alpha: sel ? 1 : hov ? 0.95 : 0.7, fill: C.hud, fillAlpha: sel ? 0.1 : 0.03 });
      const label = `${HUD_REGION_NAMES[name]}${overridden.has(name) ? ' •' : ''}${shown ? '' : ' (not in this moment)'}`;
      // The name sits just above the box when there is room, else inside its top-left corner.
      text(label, r.x + 2, r.y >= 12 ? r.y - 2 : r.y + 9 * u * 1.2, C.hud, 'start', 9 * u, 600);
      if (sel) {
        const g = 4 * u;
        for (const [cx, cy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as const) rect(cx - g, cy - g, 2 * g, 2 * g, { fill: C.hud, stroke: C.ink, sw: 1 });
      }
    }
  }

  // --- safe zones: a HUD box that is up while a fighter stands behind it
  if (show.safe) {
    for (const name of HUD_REGIONS) {
      const r = stage.hud[name];
      if (r.show === 'never') continue;
      const hit = figures.some((f) => f.right > r.x && f.left < r.x + r.w && f.y + 2 > r.y && f.top < r.y + r.h);
      if (hit) rect(r.x, r.y, r.w, r.h, { fill: C.safe, fillAlpha: 0.38, stroke: C.safe, alpha: 0.9 });
    }
  }

  // --- ground: horizon, floor bottom, depth rows
  const hz = stage.backdrop.horizonY;
  const groundLocked = locked.has('ground');
  const lineStyle = (it: Item): { w: number; alpha: number } => ({ w: isSel(it) ? 2 : same(hover, it) ? 1.6 : 1, alpha: groundLocked ? 0.35 : 1 });
  {
    const it: Item = { kind: 'horizon' };
    const st = lineStyle(it);
    line(0, hz + 0.5, SCREEN_W, hz + 0.5, C.horizon, { dash: '5 3', ...st });
    text(`Horizon ${hz}`, SCREEN_W - 4, hz - 3 * u * 1.4, C.horizon, 'end');
  }
  stage.rows.forEach((row, i) => {
    const it: Item = { kind: 'row', index: i };
    const st = lineStyle(it);
    line(0, row.y + 0.5, SCREEN_W, row.y + 0.5, C.row, { w: st.w, alpha: (isSel(it) ? 0.95 : same(hover, it) ? 0.75 : 0.4) * (groundLocked ? 0.5 : 1) });
    const amount = stage.depthTint?.amounts[i] ?? 0;
    // The row's number with a swatch of its haze (the fog colour at that row's strength, scaled up so a 6% haze is visible).
    const sw = 7 * u;
    rect(3, row.y - sw / 2 - 0.5, sw, sw, { fill: stage.depthTint?.fog ?? '#000000', fillAlpha: Math.min(1, amount * 6 + 0.05), stroke: C.row, alpha: 0.6 });
    text(String(i + 1), 3 + sw + 3 * u, row.y + 3.4 * u, isSel(it) ? C.select : C.row, 'start', 9.5 * u);
  });
  {
    const it: Item = { kind: 'floor' };
    const st = lineStyle(it);
    const y = stage.floor.y1 - 0.5;
    line(0, y, SCREEN_W, y, C.floor, st);
    const g = 5 * u;
    rect(SCREEN_W - 40 * u * 1.2 - 2, y - g * 1.4, 40 * u * 1.2, g * 2.8, { fill: C.floor, fillAlpha: 0.9, stroke: C.ink, sw: 1 });
    text(`Floor ${stage.floor.y1}`, SCREEN_W - 40 * u * 0.6 - 2, y + 3.4 * u, C.ink, 'middle', 9.5 * u, 700, false);
  }

  // --- fighters: badges, outlines, foot anchors
  for (const f of figures) {
    const it: Item = { kind: 'fighter', side: f.side, index: f.index };
    const sel = isSel(it);
    const hov = same(hover, it);
    const color = f.side === 'party' ? C.party : C.enemy;
    if (sel || hov) {
      rect(f.left - 0.5, f.top - 0.5, f.right - f.left + 1, f.y - f.top + 3, { stroke: sel ? C.select : C.hover, sw: sel ? 2 : 1, alpha: sel ? 1 : 0.6, dash: sel ? undefined : '3 2' });
    }
    const label = `${f.side === 'party' ? 'P' : 'E'}${f.index + 1}`;
    const bw = (label.length * 6 + 6) * u;
    const bh = 10 * u;
    const bx = f.x - bw / 2;
    const by = f.y + 5;
    rect(bx, by, bw, bh, { fill: color, fillAlpha: sel ? 1 : 0.85, stroke: sel ? C.select : C.ink, sw: sel ? 2 : 1 });
    text(label, f.x, by + bh - 2.6 * u, C.ink, 'middle', 9 * u, 800, false);
    if (f.order !== 0) text(f.order > 0 ? '+1' : '-1', bx + bw + 2 * u, by + bh - 2.4 * u, color, 'start', 9 * u, 800);
    if (show.anchors) {
      const a = isSel({ kind: 'anchor', side: f.side, index: f.index });
      const col = a ? C.party : f.shifted ? '#ffffff' : C.guide;
      line(f.x - 5, f.y + 0.5, f.x + 6, f.y + 0.5, col, { w: a ? 2 : 1.3 });
      line(f.x + 0.5, f.y - 5, f.x + 0.5, f.y + 6, col, { w: a ? 2 : 1.3 });
    }
  }
  return out.join('\n');
}
