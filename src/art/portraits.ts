/**
 * Dialogue portraits (48×48). A parametric bust painter: background, torso, neck, head,
 * layered hair, expressive eyes/brows/mouth, and character accessories.
 */
import { surface } from '../engine/canvas';
import { mix, shade } from '../engine/color';
import { Pix } from './pix';

export type Face = 'neutral' | 'happy' | 'angry' | 'sad' | 'surprised' | 'smirk' | 'hurt';

interface Spec {
  skin: string;
  hair: string;
  eyes: string;
  top: string;
  inner?: string;
  accent: string;
  bg: string;
  hairStyle: 'ponytail' | 'short' | 'bun' | 'long' | 'bald' | 'slick' | 'bob';
  face?: 'round' | 'square' | 'oval' | 'broad';
  extras?: ('shades' | 'goggles' | 'visor' | 'tusks' | 'beard' | 'stubble' | 'freckles' | 'paint' | 'glasses' | 'earrings' | 'scar' | 'chain' | 'cyber' | 'tie' | 'wrinkles' | 'braids' | 'hood' | 'cross')[];
  /** Eyes set lower/wider for younger or dwarf faces. */
  eyeY?: number;
  brow?: string;
}

const SPECS: Record<string, Spec> = {
  kit: {
    skin: '#b97a52', hair: '#2e1d33', eyes: '#e8a040', top: '#d8452e', inner: '#1d1b2a', accent: '#ff8a6a', bg: '#3a1420',
    hairStyle: 'ponytail', face: 'oval', extras: ['earrings', 'scar'],
  },
  rook: {
    skin: '#d8a882', hair: '#8d8f99', eyes: '#6a7a8a', top: '#4d5238', inner: '#23232e', accent: '#d8c08a', bg: '#2a2618',
    hairStyle: 'short', face: 'square', extras: ['shades', 'stubble', 'cyber'], brow: '#6d6f79',
  },
  hex: {
    skin: '#f0c7a4', hair: '#2fbfb0', eyes: '#9a6ad8', top: '#6a3fa0', inner: '#2a2438', accent: '#c3a0ff', bg: '#1e1438',
    hairStyle: 'bun', face: 'round', extras: ['goggles', 'freckles', 'hood'], eyeY: 1,
  },
  sable: {
    skin: '#8a9a6a', hair: '#e8e4da', eyes: '#e8d890', top: '#8c2f39', inner: '#3a2a24', accent: '#efe6cf', bg: '#1a2418',
    hairStyle: 'long', face: 'broad', extras: ['tusks', 'paint', 'braids'],
  },
  dutch: {
    skin: '#6e4430', hair: '#1a1418', eyes: '#5a3a2a', top: '#6a2a58', inner: '#e8c85a', accent: '#e8c85a', bg: '#2a1424',
    hairStyle: 'bald', face: 'square', extras: ['beard', 'chain'],
  },
  pale: {
    skin: '#eadbd0', hair: '#dcd8cf', eyes: '#9aa8b8', top: '#e4e4ea', inner: '#16161e', accent: '#ff6a7a', bg: '#1a1a24',
    hairStyle: 'slick', face: 'oval', extras: ['visor', 'tie'],
  },
  mags: {
    skin: '#d9a47e', hair: '#c9c4bb', eyes: '#5a8a5a', top: '#8a5a2e', inner: '#3a3a3a', accent: '#86f08c', bg: '#20241a',
    hairStyle: 'bob', face: 'round', extras: ['goggles', 'wrinkles'], eyeY: 1,
  },
  yun: {
    skin: '#e8c8a0', hair: '#1a1418', eyes: '#3a2a20', top: '#e8ecf0', inner: '#6ab0a8', accent: '#6ff3ff', bg: '#12242a',
    hairStyle: 'bob', face: 'oval', extras: ['glasses', 'cross'],
  },
};

const S = 48;
const OUT = '#0e0b16';

function paint(spec: Spec, face: Face): HTMLCanvasElement {
  const p = new Pix(S, S);
  const ex = new Set(spec.extras ?? []);
  const cx = 24;
  const shape = spec.face ?? 'oval';
  const rx = shape === 'broad' ? 14 : shape === 'round' ? 13.5 : shape === 'square' ? 13 : 12.5;
  const ry = shape === 'round' ? 13.5 : 15;
  const hy = 22;
  const top = hy - ry;
  const hairD = shade(spec.hair, -0.4);
  const hairL = shade(spec.hair, 0.35);
  const skinD = shade(spec.skin, -0.22);
  const skinDD = shade(spec.skin, -0.42);

  // ---------------------------------------------------------------- back hair
  if (spec.hairStyle === 'long') p.poly([[cx - rx - 3, top + 6], [cx + rx + 3, top + 6], [cx + rx + 6, S], [cx - rx - 6, S]], hairD);
  if (spec.hairStyle === 'bob') p.poly([[cx - rx - 2, top + 6], [cx + rx + 2, top + 6], [cx + rx + 2, hy + 12], [cx - rx - 2, hy + 12]], hairD);
  if (spec.hairStyle === 'ponytail') p.limb([[cx + 10, top + 4], [cx + 18, top + 8], [cx + 21, hy + 4], [cx + 19, hy + 16]], 4, 2, hairD);

  // ---------------------------------------------------------------- torso
  const sh = 41;
  p.poly([[0, S], [2, sh + 2], [cx - 9, sh - 3], [cx + 9, sh - 3], [S - 2, sh + 2], [S, S]], spec.top);
  p.poly([[S, S], [S - 2, sh + 2], [cx + 9, sh - 3], [cx + 6, S]], shade(spec.top, -0.25));
  if (spec.inner) p.poly([[cx - 6, sh - 2], [cx + 6, sh - 2], [cx + 4, S], [cx - 4, S]], spec.inner);
  p.poly([[cx - 10, sh - 3], [cx - 4, sh - 2], [cx - 7, sh + 5]], shade(spec.top, 0.22));
  p.poly([[cx + 10, sh - 3], [cx + 4, sh - 2], [cx + 7, sh + 5]], shade(spec.top, 0.1));
  if (ex.has('tie')) p.poly([[cx - 1, sh - 1], [cx + 1, sh - 1], [cx + 2, S], [cx - 2, S]], spec.accent);
  if (ex.has('chain')) for (let x = cx - 6; x <= cx + 6; x++) p.set(x, sh + 5 - Math.round(Math.abs(x - cx) * 0.35), x % 2 ? '#e8c85a' : '#b89a3a');
  if (ex.has('cyber')) {
    p.ball(S - 7, sh + 4, 7, 4.5, '#9aa3b8');
    p.rect(S - 12, sh + 3, 9, 1, '#5d6680');
    p.rect(S - 12, sh + 6, 9, 1, '#5d6680');
    p.set(S - 6, sh + 1, '#ffb13d');
  }
  if (ex.has('hood')) {
    p.limb([[3, S], [6, sh], [cx - 12, sh - 5]], 3.5, 2.5, shade(spec.top, 0.12));
    p.limb([[S - 3, S], [S - 6, sh], [cx + 12, sh - 5]], 3.5, 2.5, shade(spec.top, 0.02));
  }
  if (ex.has('cross')) {
    p.rect(cx - 15, sh + 4, 3, 1, '#62e06a');
    p.rect(cx - 14, sh + 3, 1, 3, '#62e06a');
  }

  // ---------------------------------------------------------------- neck & head
  p.rect(cx - 5, hy + 8, 10, 12, skinD);
  p.rect(cx - 5, hy + 8, 3, 12, skinDD);
  p.ball(cx, hy, rx, ry, spec.skin, { light: 0.62 });
  if (shape === 'square' || shape === 'broad') {
    p.poly([[cx - rx + 1, hy + 2], [cx + rx - 1, hy + 2], [cx + rx - 3, hy + 13], [cx - rx + 3, hy + 13]], spec.skin);
    p.poly([[cx + 4, hy + 4], [cx + rx - 1, hy + 2], [cx + rx - 3, hy + 13], [cx + 3, hy + 13]], shade(spec.skin, -0.1));
  } else {
    p.poly([[cx - rx + 2, hy + 4], [cx + rx - 2, hy + 4], [cx + 4, hy + ry - 0.5], [cx - 4, hy + ry - 0.5]], spec.skin);
    p.poly([[cx + 3, hy + 6], [cx + rx - 2, hy + 4], [cx + 4, hy + ry - 0.5]], shade(spec.skin, -0.08));
  }
  p.ball(cx - rx + 0.5, hy + 2, 2.5, 3.5, skinD);
  p.ball(cx + rx - 0.5, hy + 2, 2.5, 3.5, skinDD);
  if (ex.has('earrings')) {
    p.set(cx - rx, hy + 6, '#3fe0f0');
    p.set(cx + rx, hy + 6, '#3fe0f0');
  }

  // ---------------------------------------------------------------- eyes, brows, nose, mouth
  const ey = hy + 1 + (spec.eyeY ?? 0);
  const eL = cx - 9, eR = cx + 3;
  const dark = '#140c1c';
  const white = '#f6f0ea';
  const eye = (x: number, left: boolean) => {
    const inner = left ? x + 5 : x;
    const outer = left ? x : x + 5;
    if (face === 'happy') {
      p.rect(x + 1, ey, 4, 1, dark);
      p.set(x, ey + 1, dark);
      p.set(x + 5, ey + 1, dark);
      return;
    }
    if (face === 'hurt') {
      p.line(x, ey, x + 5, ey + 1, dark);
      return;
    }
    const tall = face === 'surprised' ? 4 : 3;
    p.rect(x, ey, 6, tall, white);
    const ix = left ? x + 2 : x + 1;
    p.rect(ix, ey, 3, tall, spec.eyes);
    p.rect(ix, ey + tall - 1, 3, 1, shade(spec.eyes, -0.3));
    p.rect(ix + 1, ey + 1, 1, tall - 1, dark);
    p.set(ix, ey, '#ffffff');
    p.rect(x, ey - 1, 6, 1, dark);
    p.set(outer, ey, dark);
    if (face === 'angry') {
      p.set(inner, ey, dark);
      p.set(left ? inner - 1 : inner + 1, ey, dark);
    }
    if (face === 'sad') p.set(outer, ey + 1, dark);
    if (face === 'smirk' && !left) p.rect(x, ey, 6, 1, dark);
    p.set(outer, ey + tall - 1, shade(spec.skin, -0.35));
  };
  eye(eL, true);
  eye(eR, false);
  const brow = spec.brow ?? shade(spec.hair, -0.35);
  const browY = ey - 4 - (face === 'surprised' ? 1 : 0);
  const drawBrow = (x: number, left: boolean) => {
    let tilt = 0;
    if (face === 'angry') tilt = 2;
    else if (face === 'sad' || face === 'hurt') tilt = -2;
    else if (face === 'smirk') tilt = left ? 0 : -1;
    for (let i = 0; i < 6; i++) {
      const t = left ? i / 5 : (5 - i) / 5;
      const y = browY + Math.round(t * tilt);
      p.set(x + i, y, brow);
      if (i > 0 && i < 5) p.set(x + i, y - 1, brow);
    }
  };
  drawBrow(eL, true);
  drawBrow(eR, false);
  p.set(cx + 1, ey + 3, skinD);
  p.set(cx + 1, ey + 4, skinD);
  p.rect(cx - 1, ey + 6, 3, 1, skinDD);
  const my = ey + 10;
  const lip = shade(spec.skin, -0.52);
  switch (face) {
    case 'happy':
      p.rect(cx - 4, my, 8, 1, lip);
      p.set(cx - 5, my - 1, lip);
      p.set(cx + 4, my - 1, lip);
      p.rect(cx - 3, my + 1, 6, 1, '#f4e8e8');
      p.rect(cx - 2, my + 2, 4, 1, lip);
      break;
    case 'smirk':
      p.rect(cx - 2, my, 5, 1, lip);
      p.set(cx + 3, my - 1, lip);
      break;
    case 'angry':
      p.rect(cx - 4, my - 1, 8, 3, '#3a1018');
      p.rect(cx - 3, my - 1, 6, 1, '#f0e8e0');
      break;
    case 'sad':
    case 'hurt':
      p.rect(cx - 3, my, 6, 1, lip);
      p.set(cx - 4, my + 1, lip);
      p.set(cx + 3, my + 1, lip);
      break;
    case 'surprised':
      p.ball(cx, my, 2, 2.5, '#3a1018');
      break;
    default:
      p.rect(cx - 3, my, 6, 1, lip);
      p.set(cx + 3, my - 1, shade(spec.skin, -0.3));
  }
  if (face === 'happy') {
    p.rect(eL, ey + 4, 3, 1, mix(spec.skin, '#ff6a7a', 0.35));
    p.rect(eR + 3, ey + 4, 3, 1, mix(spec.skin, '#ff6a7a', 0.35));
  }
  if (ex.has('freckles')) for (const [x, y] of [[eL + 1, ey + 5], [eL + 3, ey + 6], [eR + 2, ey + 5], [eR + 4, ey + 6], [eL + 4, ey + 5]] as const) p.set(x, y, shade(spec.skin, -0.28));
  if (ex.has('wrinkles')) {
    p.set(eL - 1, ey + 2, skinDD);
    p.set(eR + 6, ey + 2, skinDD);
    p.rect(cx - 6, my - 3, 1, 3, skinD);
    p.rect(cx + 5, my - 3, 1, 3, skinD);
  }
  if (ex.has('scar')) p.line(eR + 6, ey + 4, eR + 8, ey + 7, shade(spec.skin, 0.35));
  if (ex.has('paint')) for (const x of [eL + 1, eL + 4, eR + 1, eR + 4]) p.line(x, ey + 4, x - 1, ey + 7, '#efe6cf');
  if (ex.has('stubble')) {
    for (let x = cx - rx + 3; x <= cx + rx - 3; x++)
      for (let y = my - 3; y <= hy + 14; y++) if ((x * 3 + y) % 4 === 0 && p.get(x, y) && !(Math.abs(x - cx) < 5 && Math.abs(y - my) < 2)) p.set(x, y, mix(spec.skin, spec.hair, 0.5));
  }
  if (ex.has('beard')) {
    p.poly([[cx - rx + 1, ey + 5], [cx + rx - 1, ey + 5], [cx + rx - 3, hy + 15], [cx, hy + 18], [cx - rx + 3, hy + 15]], spec.hair);
    p.rect(cx - 4, my - 2, 8, 4, skinDD);
    p.rect(cx - 3, my - 1, 6, 1, face === 'happy' ? '#e8c85a' : '#f0e0e0');
    p.rect(cx - 5, my - 3, 10, 1, spec.hair);
  }
  if (ex.has('tusks')) {
    for (const tx of [cx - 5, cx + 4]) {
      p.rect(tx, my - 3, 2, 3, '#efe6cf');
      p.set(tx + (tx < cx ? 0 : 1), my - 4, '#ffffff');
    }
  }

  // ---------------------------------------------------------------- front hair
  switch (spec.hairStyle) {
    case 'ponytail':
      p.ball(cx, top + 6, rx + 1.5, 7.5, spec.hair);
      p.poly([[cx - rx - 2, top + 6], [cx - 1, top + 5], [cx - 5, top + 13], [cx - rx + 1, top + 17], [cx - rx - 1, hy + 4]], spec.hair);
      p.poly([[cx + rx + 2, top + 6], [cx + 2, top + 5], [cx + 7, top + 12], [cx + rx, top + 16], [cx + rx + 1, hy + 2]], spec.hair);
      p.limb([[cx - 2, top + 4], [cx - 4, top + 11], [cx - 3, top + 15]], 1.8, 1, spec.hair);
      p.rect(cx - 7, top + 2, 8, 1, hairL);
      p.rect(cx - 8, top + 3, 3, 1, hairL);
      p.line(cx + 5, top + 3, cx + 9, top + 8, '#ff4fb0');
      break;
    case 'short':
      p.ball(cx, top + 5, rx + 1, 7, spec.hair);
      p.poly([[cx - rx - 1, top + 5], [cx + rx + 1, top + 5], [cx + rx, top + 10], [cx - rx, top + 10]], spec.hair);
      for (let x = cx - rx + 1; x < cx + rx; x += 3) p.poly([[x, top + 9], [x + 3, top + 9], [x + 1, top + 11]], spec.hair);
      p.rect(cx - rx - 1, top + 9, 2, 6, spec.hair);
      p.rect(cx + rx - 1, top + 9, 2, 6, hairD);
      p.rect(cx - 6, top + 1, 7, 1, hairL);
      break;
    case 'bun':
      p.ball(cx + 1, top - 1, 6, 5, spec.hair);
      p.set(cx - 1, top - 4, hairL);
      p.ball(cx, top + 6, rx + 2, 7.5, spec.hair);
      p.poly([[cx - rx - 2, top + 6], [cx - 2, top + 7], [cx - 8, top + 13], [cx - rx - 1, hy + 6]], spec.hair);
      p.poly([[cx + rx + 2, top + 6], [cx + 2, top + 7], [cx + 8, top + 12], [cx + rx + 1, hy + 5]], spec.hair);
      p.rect(cx - 6, top + 2, 6, 1, hairL);
      break;
    case 'long':
      p.ball(cx, top + 6, rx + 2, 7.5, spec.hair);
      p.poly([[cx - rx - 3, top + 6], [cx - 2, top + 6], [cx - rx + 1, top + 14], [cx - rx - 1, S], [cx - rx - 4, S]], spec.hair);
      p.poly([[cx + rx + 3, top + 6], [cx + 2, top + 6], [cx + rx - 1, top + 14], [cx + rx + 1, S], [cx + rx + 4, S]], spec.hair);
      p.rect(cx - 7, top + 2, 9, 1, hairL);
      for (let y = top + 16; y < S; y += 4) {
        p.set(cx - rx - 2, y, hairD);
        p.set(cx + rx + 2, y + 2, hairD);
      }
      break;
    case 'bob':
      p.ball(cx, top + 6, rx + 2, 7.5, spec.hair);
      p.poly([[cx - rx - 3, top + 7], [cx + rx + 3, top + 7], [cx + rx + 3, top + 11], [cx - rx - 3, top + 11]], spec.hair);
      p.poly([[cx - rx - 3, top + 10], [cx - rx + 2, top + 10], [cx - rx + 2, hy + 11], [cx - rx - 3, hy + 11]], spec.hair);
      p.poly([[cx + rx + 3, top + 10], [cx + rx - 2, top + 10], [cx + rx - 2, hy + 11], [cx + rx + 3, hy + 11]], spec.hair);
      for (let x = cx - rx; x < cx + rx; x += 4) p.set(x, top + 11, hairD);
      p.rect(cx - 6, top + 2, 7, 1, hairL);
      break;
    case 'slick':
      p.ball(cx + 1, top + 4, rx + 0.5, 6, spec.hair);
      p.poly([[cx - rx, top + 5], [cx + rx, top + 5], [cx + rx, top + 8], [cx - rx, top + 8]], spec.hair);
      for (let x = cx - 8; x < cx + 10; x += 3) p.line(x, top + 1, x + 4, top + 7, hairL);
      break;
    case 'bald':
      p.rect(cx - 6, top + 3, 4, 1, shade(spec.skin, 0.4));
      p.set(cx - 7, top + 4, shade(spec.skin, 0.3));
      break;
  }
  if (ex.has('braids')) {
    for (const bx of [cx - rx - 1, cx + rx + 1]) {
      p.limb([[bx, hy + 2], [bx + (bx < cx ? -1 : 1), hy + 12], [bx, S]], 2, 1.5, shade(spec.hair, -0.1));
      p.rect(bx - 1, hy + 14, 3, 2, '#d9b36c');
      p.rect(bx - 1, hy + 20, 3, 1, '#8c2f39');
    }
  }

  // ---------------------------------------------------------------- eyewear
  if (ex.has('shades')) {
    for (const x of [eL, eR]) {
      p.rect(x - 1, ey - 1, 8, 4, '#15131c');
      p.rect(x, ey - 1, 3, 1, '#ffb13d');
      p.set(x + 4, ey + 1, '#6a4a1a');
    }
    p.rect(eL + 7, ey, eR - eL - 8, 1, '#15131c');
    p.line(eL - 1, ey, cx - rx + 1, ey - 1, '#15131c');
    p.line(eR + 6, ey, cx + rx - 1, ey - 1, '#15131c');
  }
  if (ex.has('visor')) {
    p.rect(cx - rx + 1, ey - 1, rx * 2 - 2, 3, spec.accent);
    p.rect(cx - rx + 1, ey - 1, rx * 2 - 2, 1, mix(spec.accent, '#ffffff', 0.55));
    p.rect(cx - rx + 1, ey + 1, rx * 2 - 2, 1, shade(spec.accent, -0.3));
  }
  if (ex.has('glasses')) {
    for (const x of [eL - 1, eR - 1]) {
      p.rect(x, ey - 2, 8, 1, '#2a2a34');
      p.rect(x, ey + 3, 8, 1, '#2a2a34');
      p.rect(x, ey - 2, 1, 6, '#2a2a34');
      p.rect(x + 7, ey - 2, 1, 6, '#2a2a34');
      p.set(x + 2, ey - 1, '#ffffff');
    }
    p.rect(eL + 7, ey - 1, eR - eL - 8, 1, '#2a2a34');
  }
  if (ex.has('goggles')) {
    const gy = top + 8;
    p.rect(cx - rx - 2, gy, rx * 2 + 4, 2, '#3b3448');
    for (const gx of [cx - 6, cx + 6]) {
      p.ball(gx, gy + 1, 4.5, 3.5, '#3b3448');
      p.ball(gx, gy + 1, 3, 2.3, spec.accent);
      p.set(gx - 1, gy, '#ffffff');
    }
  }

  p.outline(OUT);
  const s = surface(S, S);
  const g = s.ctx;
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(0, shade(spec.bg, 0.2));
  grd.addColorStop(1, shade(spec.bg, -0.45));
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.16;
  g.fillStyle = spec.accent;
  for (let y = 1; y < S; y += 3) g.fillRect(0, y, S, 1);
  g.globalAlpha = 1;
  g.drawImage(p.toCanvas(), 0, 0);
  return s.canvas;
}

const cache = new Map<string, HTMLCanvasElement>();

export function getPortrait(key: string, face: string): HTMLCanvasElement | null {
  const spec = SPECS[key];
  if (!spec) return null;
  const k = `${key}:${face}`;
  let c = cache.get(k);
  if (!c) {
    c = paint(spec, (['neutral', 'happy', 'angry', 'sad', 'surprised', 'smirk', 'hurt'].includes(face) ? face : 'neutral') as Face);
    cache.set(k, c);
  }
  return c;
}

export const PORTRAIT_KEYS = Object.keys(SPECS);
