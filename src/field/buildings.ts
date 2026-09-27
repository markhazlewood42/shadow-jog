/** Procedural 3/4-view buildings: roofs with clutter, facades with windows, doors, signage. */
import { disc, type Ctx } from '../engine/canvas';
import { mix, shade } from '../engine/color';
import { drawText, measure } from '../engine/font';
import { hash2, Rng } from '../engine/rng';
import type { BakeCtx } from './bake';
import { TS } from './tiles';
import type { BuildingDef, BuildingStyle, SignDef } from './types';

interface StyleColors {
  facade: string;
  roof: string;
  parapet: string;
  trim: string;
}

const STYLES: Record<BuildingStyle, StyleColors> = {
  brick: { facade: '#6b3b35', roof: '#352b34', parapet: '#4c3b42', trim: '#8a5a4a' },
  concrete: { facade: '#5a5f73', roof: '#30333f', parapet: '#464b5c', trim: '#747a90' },
  metal: { facade: '#4e5866', roof: '#343a44', parapet: '#4a525e', trim: '#6a7482' },
  tile: { facade: '#3e5566', roof: '#2c3440', parapet: '#3e4a58', trim: '#5a7488' },
  glass: { facade: '#1e2b3e', roof: '#2a3040', parapet: '#3a4256', trim: '#4a5a78' },
  shanty: { facade: '#5a4636', roof: '#4a3a2c', parapet: '#6a5440', trim: '#7a6448' },
  corp: { facade: '#c5ccd6', roof: '#3a3f4c', parapet: '#8a92a0', trim: '#e0e6ee' },
};

const WARM = '#ffd98a';
const COOL = '#8ad8ff';
const PINK = '#ff8ad0';
const VIOLET = '#b89aff';

// ------------------------------------------------------------------ facade materials
function paintFacade(c: Ctx, style: BuildingStyle, x: number, y: number, w: number, h: number, seed: number): void {
  const col = STYLES[style];
  c.fillStyle = col.facade;
  c.fillRect(x, y, w, h);
  switch (style) {
    case 'brick': {
      for (let by = 0; by < h; by += 4) {
        const off = (by / 4) % 2 === 0 ? 0 : 4;
        for (let bx = -off; bx < w; bx += 8) {
          const hh = hash2(x + bx, y + by, seed);
          c.fillStyle = hh < 0.2 ? shade(col.facade, -0.15) : hh > 0.85 ? shade(col.facade, 0.12) : col.facade;
          const sx = Math.max(0, bx);
          const ex = Math.min(w, bx + 7);
          if (ex > sx) c.fillRect(x + sx, y + by, ex - sx, Math.min(3, h - by));
        }
        c.fillStyle = shade(col.facade, -0.4);
        c.fillRect(x, y + by + 3, w, 1);
        for (let bx = -off + 7; bx < w; bx += 8) if (bx >= 0) c.fillRect(x + bx, y + by, 1, 3);
      }
      break;
    }
    case 'concrete':
    case 'corp': {
      c.fillStyle = shade(col.facade, -0.18);
      for (let px = 0; px < w; px += 16) c.fillRect(x + px, y, 1, h);
      for (let py = 12; py < h; py += 16) c.fillRect(x, y + py, w, 1);
      // Rain streaks and stains
      const r = new Rng(seed);
      for (let i = 0; i < w / 6; i++) {
        const sx = x + r.int(0, w - 1);
        const len = r.int(4, 14);
        c.fillStyle = shade(col.facade, -0.12);
        c.fillRect(sx, y + r.int(0, 4), 1, len);
      }
      break;
    }
    case 'metal': {
      for (let px = 0; px < w; px++) {
        const k = px % 4;
        c.fillStyle = k === 0 ? shade(col.facade, 0.2) : k === 3 ? shade(col.facade, -0.3) : col.facade;
        c.fillRect(x + px, y, 1, h);
      }
      c.fillStyle = shade(col.facade, -0.35);
      for (let py = 15; py < h; py += 16) c.fillRect(x, y + py, w, 1);
      // Rust patches
      const r = new Rng(seed);
      for (let i = 0; i < w / 10; i++) {
        c.fillStyle = r.chance(0.5) ? '#6a4a36' : '#5a3e30';
        c.fillRect(x + r.int(0, w - 4), y + r.int(0, h - 4), r.int(2, 4), r.int(2, 6));
      }
      break;
    }
    case 'tile': {
      c.fillStyle = shade(col.facade, -0.3);
      for (let px = 0; px < w; px += 4) c.fillRect(x + px, y, 1, h);
      for (let py = 0; py < h; py += 4) c.fillRect(x, y + py, w, 1);
      break;
    }
    case 'glass': {
      for (let px = 0; px < w; px += 16) {
        c.fillStyle = '#39445a';
        c.fillRect(x + px, y, 2, h);
      }
      c.fillStyle = '#2b3b55';
      for (let i = 0; i < w; i += 7) c.fillRect(x + i, y + 2, 1, h - 4);
      break;
    }
    case 'shanty': {
      const r = new Rng(seed);
      for (let px = 0; px < w; px += r.int(10, 18)) {
        const pw = r.int(10, 18);
        c.fillStyle = r.pick(['#5a4636', '#4a5a5a', '#6a5040', '#5a5a6a', '#6a4a3a']);
        c.fillRect(x + px, y, Math.min(pw, w - px), h);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(x + px, y, 1, h);
        c.fillStyle = 'rgba(255,255,255,0.08)';
        for (let py = 0; py < h; py += 3) c.fillRect(x + px + 1, y + py, Math.min(pw, w - px) - 1, 1);
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ roofs
function paintRoof(b: BakeCtx, def: BuildingDef, x: number, y: number, w: number, h: number, rng: Rng): void {
  const g = b.g;
  const col = STYLES[def.style];
  g.fillStyle = col.roof;
  g.fillRect(x, y, w, h);
  // Gravel / tar texture
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const hh = hash2(x + px, y + py, 991);
      if (hh < 0.06) {
        g.fillStyle = shade(col.roof, -0.25);
        g.fillRect(x + px, y + py, 1, 1);
      } else if (hh > 0.97) {
        g.fillStyle = shade(col.roof, 0.18);
        g.fillRect(x + px, y + py, 1, 1);
      }
    }
  }
  // Parapet
  g.fillStyle = col.parapet;
  g.fillRect(x, y, w, 3);
  g.fillRect(x, y, 3, h);
  g.fillRect(x + w - 3, y, 3, h);
  g.fillStyle = shade(col.parapet, 0.25);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = shade(col.roof, -0.35);
  g.fillRect(x + 3, y + 3, w - 6, 1);
  g.fillRect(x + 3, y + 3, 1, h - 3);
  // Front cornice (roof edge meeting the facade)
  g.fillStyle = col.trim;
  g.fillRect(x, y + h - 3, w, 2);
  g.fillStyle = shade(col.trim, 0.3);
  g.fillRect(x, y + h - 3, w, 1);
  g.fillStyle = '#0c0b14';
  g.fillRect(x, y + h - 1, w, 1);

  if (def.roof === 'garden') {
    for (let i = 0; i < w / 14; i++) {
      const px = x + 6 + rng.int(0, w - 18);
      const py = y + 6 + rng.int(0, Math.max(0, h - 16));
      g.fillStyle = '#3a2c24';
      g.fillRect(px, py, 10, 6);
      g.fillStyle = '#2f6a44';
      g.fillRect(px + 1, py - 2, 8, 5);
      g.fillStyle = '#62e06a';
      g.fillRect(px + 2, py - 2, 1, 1);
      g.fillRect(px + 6, py - 1, 1, 1);
    }
  }

  // Clutter
  const area = (w * h) / 256;
  const n = Math.max(1, Math.round(area * 0.7));
  const placed: [number, number, number, number][] = [];
  const free = (px: number, py: number, pw: number, ph: number) =>
    placed.every(([a, bb, c, d]) => px + pw + 2 < a || a + c + 2 < px || py + ph + 2 < bb || bb + d + 2 < py);
  for (let i = 0; i < n * 3 && placed.length < n; i++) {
    const kind = rng.pick(['ac', 'ac', 'vent', 'tank', 'hatch', 'solar', 'dish', 'pipes', 'skylight', 'antenna'] as const);
    const size: Record<string, [number, number]> = {
      ac: [11, 8], vent: [5, 5], tank: [13, 13], hatch: [14, 11], solar: [14, 9], dish: [9, 7], pipes: [20, 3], skylight: [12, 8], antenna: [3, 12],
    };
    const [pw, ph] = size[kind]!;
    if (w - 12 < pw || h - 14 < ph) continue;
    const px = x + 5 + rng.int(0, w - 10 - pw);
    const py = y + 5 + rng.int(0, h - 12 - ph);
    if (!free(px, py, pw, ph)) continue;
    placed.push([px, py, pw, ph]);
    roofItem(b, kind, px, py, rng);
  }

  if (def.roof === 'billboard' && def.billboard) billboard(b, x + 4, y + h - 30, w - 8, def.billboard.text, def.billboard.color);
}

function roofItem(b: BakeCtx, kind: string, x: number, y: number, rng: Rng): void {
  const g = b.g;
  const shadow = (w: number, h: number) => {
    g.fillStyle = 'rgba(5,4,10,0.45)';
    g.fillRect(x + 2, y + 2, w, h);
  };
  switch (kind) {
    case 'ac': {
      shadow(11, 8);
      g.fillStyle = '#6d7384'; g.fillRect(x, y, 11, 8);
      g.fillStyle = '#8b91a2'; g.fillRect(x, y, 11, 1);
      g.fillStyle = '#4a4f5e'; g.fillRect(x, y + 7, 11, 1);
      disc(g, x + 4, y + 4, 2.4, '#2f3340');
      g.fillStyle = '#6d7384'; g.fillRect(x + 4, y + 2, 1, 5); g.fillRect(x + 2, y + 4, 5, 1);
      g.fillStyle = '#4a4f5e'; g.fillRect(x + 8, y + 2, 2, 4);
      break;
    }
    case 'vent': {
      shadow(5, 5);
      g.fillStyle = '#5a5f6e'; g.fillRect(x, y, 5, 5);
      g.fillStyle = '#1f2230'; g.fillRect(x + 1, y + 1, 3, 3);
      g.fillStyle = '#7a8090'; g.fillRect(x, y, 5, 1);
      break;
    }
    case 'tank': {
      g.fillStyle = 'rgba(5,4,10,0.45)'; disc(g, x + 8, y + 8, 6, 'rgba(5,4,10,0.45)');
      disc(g, x + 6, y + 6, 6, '#5a4a3e');
      disc(g, x + 6, y + 6, 4, '#6e5a4a');
      g.fillStyle = '#7e6a58'; g.fillRect(x + 3, y + 3, 3, 1);
      g.fillStyle = '#3a2e26'; g.fillRect(x + 5, y + 5, 2, 2);
      break;
    }
    case 'hatch': {
      shadow(14, 11);
      g.fillStyle = '#4c5060'; g.fillRect(x, y, 14, 11);
      g.fillStyle = '#626779'; g.fillRect(x, y, 14, 2);
      g.fillStyle = '#2a2d3a'; g.fillRect(x + 4, y + 4, 6, 7);
      b.both((c) => { c.fillStyle = '#ffb45a'; c.fillRect(x + 6, y + 3, 2, 1); });
      b.lights.push({ x: x + 7, y: y + 6, r: 14, color: '#ffb45a', i: 0.5 });
      break;
    }
    case 'solar': {
      shadow(14, 9);
      g.fillStyle = '#1c2a4a'; g.fillRect(x, y, 14, 9);
      g.fillStyle = '#34507a';
      for (let i = 0; i < 14; i += 4) g.fillRect(x + i, y, 1, 9);
      g.fillRect(x, y + 4, 14, 1);
      g.fillStyle = '#5a7aaa'; g.fillRect(x + 1, y + 1, 2, 1);
      break;
    }
    case 'dish': {
      disc(g, x + 5, y + 4, 4, '#9aa0ae');
      disc(g, x + 5, y + 4, 2, '#7a8090');
      g.fillStyle = '#3a3d48'; g.fillRect(x + 5, y + 4, 1, 3);
      break;
    }
    case 'pipes': {
      g.fillStyle = '#5a5e6c'; g.fillRect(x, y, 20, 2);
      g.fillStyle = '#7a7e8c'; g.fillRect(x, y, 20, 1);
      g.fillStyle = '#3a3d48'; g.fillRect(x + 6, y - 1, 2, 4); g.fillRect(x + 14, y - 1, 2, 4);
      break;
    }
    case 'skylight': {
      shadow(12, 8);
      g.fillStyle = '#3a3e4c'; g.fillRect(x, y, 12, 8);
      const lit = rng.chance(0.6);
      const col = lit ? rng.pick([WARM, COOL, VIOLET]) : '#1a2230';
      b.both((c) => {
        c.fillStyle = col;
        c.fillRect(x + 1, y + 1, 10, 6);
        c.fillStyle = lit ? mix(col, '#ffffff', 0.4) : '#2a3448';
        c.fillRect(x + 1, y + 1, 4, 1);
      });
      g.fillStyle = '#3a3e4c'; g.fillRect(x + 6, y + 1, 1, 6);
      if (lit) b.lights.push({ x: x + 6, y: y + 4, r: 16, color: col, i: 0.45 });
      break;
    }
    case 'antenna': {
      g.fillStyle = '#6a6e7c'; g.fillRect(x + 1, y, 1, 12);
      g.fillRect(x, y + 3, 3, 1);
      g.fillStyle = '#2a2d38'; g.fillRect(x + 2, y + 11, 3, 1);
      const bx = x + 1, by = y;
      b.anims.push({
        x: bx - 2, y: by - 2, w: 5, h: 5,
        draw: (c, f, ox, oy) => {
          if ((f + bx * 7) % 90 < 45) {
            c.fillStyle = '#ff3a3a';
            c.fillRect(bx - ox, by - oy, 1, 1);
            c.globalAlpha = 0.35;
            c.fillRect(bx - ox - 1, by - oy, 3, 1);
            c.fillRect(bx - ox, by - oy - 1, 1, 3);
            c.globalAlpha = 1;
          }
        },
      });
      break;
    }
  }
}

function billboard(b: BakeCtx, x: number, y: number, w: number, text: string, color: string): void {
  const h = 22;
  b.g.fillStyle = '#1a1a24';
  b.g.fillRect(x + w / 2 - 6, y + h, 3, 8);
  b.g.fillRect(x + w / 2 + 4, y + h, 3, 8);
  b.both((c) => {
    c.fillStyle = '#0d0c18';
    c.fillRect(x, y, w, h);
    const grd = c.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, shade(color, -0.55));
    grd.addColorStop(1, shade(color, -0.85));
    c.fillStyle = grd;
    c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = color;
    c.fillRect(x + 1, y + 1, w - 2, 1);
    c.fillRect(x + 1, y + h - 2, w - 2, 1);
    drawText(c, text, x + w / 2, y + 7, { color: '#ffffff', shadow: shade(color, -0.3), align: 'center' });
  });
  b.lights.push({ x: x + w / 2, y: y + h / 2, r: Math.max(30, w * 0.7), color, i: 0.7 });
}

// ------------------------------------------------------------------ facade elements
function paintWindow(b: BakeCtx, x: number, y: number, rng: Rng, style: BuildingStyle): void {
  const g = b.g;
  const frame = style === 'corp' ? '#8a92a0' : '#1c1a26';
  g.fillStyle = frame;
  g.fillRect(x - 1, y - 1, 10, 10);
  const roll = rng.next();
  let col: string | null = null;
  if (roll < 0.36) col = WARM;
  else if (roll < 0.5) col = COOL;
  else if (roll < 0.58) col = rng.chance(0.5) ? PINK : VIOLET;
  if (col) {
    const c2 = col;
    b.both((c) => {
      c.fillStyle = c2;
      c.fillRect(x, y, 8, 8);
      c.fillStyle = mix(c2, '#ffffff', 0.35);
      c.fillRect(x, y, 8, 1);
      // Interior silhouette / blinds
      const kind = rng.int(0, 3);
      c.fillStyle = shade(c2, -0.55);
      if (kind === 0) for (let i = 2; i < 8; i += 2) c.fillRect(x, y + i, 8, 1);
      else if (kind === 1) { c.fillRect(x + 1, y + 3, 3, 5); c.fillRect(x + 2, y + 2, 1, 1); }
      else if (kind === 2) { c.fillRect(x, y + 5, 8, 3); c.fillStyle = '#3a8a4a'; c.fillRect(x + 5, y + 3, 2, 2); }
    });
    b.lights.push({ x: x + 4, y: y + 12, r: 13, color: c2, i: 0.32 });
  } else {
    g.fillStyle = '#161b28';
    g.fillRect(x, y, 8, 8);
    g.fillStyle = '#28324a';
    g.fillRect(x + 1, y + 1, 2, 1);
    g.fillRect(x + 1, y + 2, 1, 1);
  }
  // Sill
  g.fillStyle = shade(STYLES[style].trim, 0.1);
  g.fillRect(x - 1, y + 8, 10, 1);
  if (rng.chance(0.18)) {
    // Hanging AC unit
    g.fillStyle = '#6a7080';
    g.fillRect(x + 1, y + 9, 6, 4);
    g.fillStyle = '#4a4f5c';
    g.fillRect(x + 2, y + 10, 4, 1);
    g.fillRect(x + 1, y + 12, 6, 1);
  }
}

function paintDoor(b: BakeCtx, x: number, y: number, light: string, kind: 'glass' | 'metal' | 'shutter'): void {
  const g = b.g;
  g.fillStyle = '#0f0e17';
  g.fillRect(x, y, 12, 14);
  if (kind === 'shutter') {
    g.fillStyle = '#5a5e6c';
    g.fillRect(x + 1, y + 1, 10, 13);
    g.fillStyle = '#3e424e';
    for (let i = 2; i < 14; i += 2) g.fillRect(x + 1, y + i, 10, 1);
    g.fillStyle = '#b8a040';
    g.fillRect(x + 5, y + 12, 2, 1);
    return;
  }
  if (kind === 'metal') {
    g.fillStyle = '#3e4250';
    g.fillRect(x + 1, y + 1, 10, 13);
    g.fillStyle = '#4e5262';
    g.fillRect(x + 2, y + 2, 8, 5);
    g.fillRect(x + 2, y + 8, 8, 5);
    g.fillStyle = '#9aa0ae';
    g.fillRect(x + 9, y + 8, 1, 2);
  } else {
    b.both((c) => {
      const grd = c.createLinearGradient(0, y + 1, 0, y + 14);
      grd.addColorStop(0, shade(light, -0.25));
      grd.addColorStop(1, light);
      c.fillStyle = grd;
      c.fillRect(x + 1, y + 1, 10, 13);
      c.fillStyle = shade(light, -0.6);
      c.fillRect(x + 6, y + 1, 1, 13);
    });
    // Light spilling onto the pavement.
    b.lights.push({ x: x + 6, y: y + 18, r: 22, color: light, i: 0.6 });
  }
  // Lamp above
  b.both((c) => {
    c.fillStyle = '#ffe2a0';
    c.fillRect(x + 4, y - 3, 4, 1);
  });
  b.g.fillStyle = '#2a2830';
  b.g.fillRect(x + 3, y - 2, 6, 1);
  b.lights.push({ x: x + 6, y: y + 4, r: 26, color: '#ffc27a', i: 0.55 });
}

function paintShopfront(b: BakeCtx, x: number, y: number, w: number, glow: string, rng: Rng): void {
  const g = b.g;
  g.fillStyle = '#12111a';
  g.fillRect(x, y, w, 11);
  b.both((c) => {
    const grd = c.createLinearGradient(0, y, 0, y + 11);
    grd.addColorStop(0, shade(glow, -0.5));
    grd.addColorStop(1, shade(glow, -0.15));
    c.fillStyle = grd;
    c.fillRect(x + 1, y + 1, w - 2, 9);
    // Shelves / goods silhouettes
    c.fillStyle = shade(glow, -0.7);
    c.fillRect(x + 1, y + 4, w - 2, 1);
    c.fillRect(x + 1, y + 7, w - 2, 1);
    for (let i = x + 2; i < x + w - 2; i += 2) {
      if (rng.chance(0.6)) {
        c.fillStyle = rng.pick(['#ffe07a', '#7ad8ff', '#ff8ad0', '#9aff8a', '#ffffff']);
        c.globalAlpha = 0.7;
        c.fillRect(i, y + (rng.chance(0.5) ? 2 : 5), 1, 2);
        c.globalAlpha = 1;
      }
    }
    c.fillStyle = mix(glow, '#ffffff', 0.5);
    c.globalAlpha = 0.5;
    c.fillRect(x + 2, y + 1, 1, 9);
    c.fillRect(x + 4, y + 1, 1, 4);
    c.globalAlpha = 1;
  });
  g.fillStyle = '#12111a';
  for (let i = x + 15; i < x + w - 1; i += 16) g.fillRect(i, y, 1, 11);
  b.lights.push({ x: x + w / 2, y: y + 14, r: Math.max(18, w * 0.55), color: glow, i: 0.55 });
}

function paintAwning(b: BakeCtx, x: number, y: number, w: number, color: string): void {
  const g = b.g;
  const dark = shade(color, -0.35);
  for (let px = 0; px < w; px++) {
    const stripe = Math.floor(px / 4) % 2 === 0;
    g.fillStyle = stripe ? color : '#e8e4da';
    g.fillRect(x + px, y, 1, 4);
    g.fillStyle = stripe ? dark : '#b8b4aa';
    g.fillRect(x + px, y + 4, 1, 1);
    if (px % 4 === 1 || px % 4 === 2) {
      g.fillStyle = stripe ? dark : '#b8b4aa';
      g.fillRect(x + px, y + 5, 1, 1);
    }
  }
  g.fillStyle = 'rgba(8,6,14,0.5)';
  g.fillRect(x, y + 6, w, 2);
}

export function paintSign(b: BakeCtx, s: SignDef, bx: number, _by: number, bw: number, facadeTop: number): void {
  if (s.vertical) {
    const letters = s.text.split('');
    const h = letters.length * 9 + 6;
    const x = bx + (s.x !== undefined ? s.x * TS : 2);
    const y = facadeTop - 12;
    b.g.fillStyle = '#2a2830';
    b.g.fillRect(x + 4, y - 3, 3, 3);
    b.both((c) => {
      c.fillStyle = '#0d0b16';
      c.fillRect(x, y, 11, h);
      c.fillStyle = s.color;
      c.fillRect(x, y, 11, 1);
      c.fillRect(x, y + h - 1, 11, 1);
      c.fillRect(x, y, 1, h);
      c.fillRect(x + 10, y, 1, h);
      letters.forEach((ch, i) => drawText(c, ch, x + 6, y + 4 + i * 9, { color: mix(s.color, '#ffffff', 0.35), shadow: false, align: 'center' }));
    });
    b.lights.push({ x: x + 5, y: y + h / 2, r: Math.max(24, h * 0.7), color: s.color, i: 0.75, flicker: s.flicker });
    return;
  }
  const tw = measure(s.text);
  const w = tw + 10;
  const cx = s.x !== undefined ? bx + s.x * TS + 8 : bx + bw / 2;
  const x = Math.round(cx - w / 2);
  const y = facadeTop + 3;
  b.both((c) => {
    c.fillStyle = '#0d0b16';
    c.fillRect(x, y, w, 13);
    c.fillStyle = shade(s.color, -0.3);
    c.fillRect(x, y, w, 1);
    c.fillRect(x, y + 12, w, 1);
    c.fillRect(x, y, 1, 13);
    c.fillRect(x + w - 1, y, 1, 13);
    drawText(c, s.text, x + 5, y + 3, { color: mix(s.color, '#ffffff', 0.3), shadow: shade(s.color, -0.35) });
  });
  // Soft neon bloom baked into the emissive layer.
  const e = b.e;
  e.save();
  e.globalCompositeOperation = 'lighter';
  e.globalAlpha = 0.55;
  e.filter = 'blur(3px)';
  drawText(e, s.text, x + 5, y + 3, { color: s.color, shadow: false });
  e.restore();
  b.lights.push({ x: x + w / 2, y: y + 8, r: Math.max(34, w * 0.75), color: s.color, i: 0.85, flicker: s.flicker });
}

// ------------------------------------------------------------------ building
export function paintBuilding(b: BakeCtx, def: BuildingDef): void {
  const seed = def.seed ?? def.x * 131 + def.y * 17;
  const rng = new Rng(seed);
  const facadeRows = def.facade ?? 2;
  const X = def.x * TS, Y = def.y * TS, Wp = def.w * TS, Hp = def.h * TS;
  const roofH = (def.h - facadeRows) * TS;
  const facadeTop = Y + roofH;
  const facadeH = facadeRows * TS;

  for (let ty = def.y; ty < def.y + def.h; ty++) for (let tx = def.x; tx < def.x + def.w; tx++) b.block(tx, ty);

  paintRoof(b, def, X, Y, Wp, roofH, rng);
  if (facadeRows === 0) return;
  paintFacade(b.g, def.style, X, facadeTop, Wp, facadeH, seed);
  // Side edges (building corners)
  b.g.fillStyle = shade(STYLES[def.style].facade, -0.35);
  b.g.fillRect(X, facadeTop, 1, facadeH);
  b.g.fillRect(X + Wp - 1, facadeTop, 1, facadeH);
  // Floor band between upper floors and the street level
  const groundY = Y + Hp - TS;
  b.g.fillStyle = shade(STYLES[def.style].trim, -0.1);
  b.g.fillRect(X, groundY - 1, Wp, 1);

  // Upper-floor windows
  for (let row = 0; row < facadeRows - 1; row++) {
    const wy = facadeTop + row * TS + 3;
    for (let tx = 0; tx < def.w; tx++) {
      if (def.w > 2 && (tx === 0 || tx === def.w - 1) && rng.chance(0.5)) continue;
      paintWindow(b, X + tx * TS + 4, wy, rng, def.style);
    }
  }

  // Street level
  const doors = new Set(def.doors ?? []);
  const shutters = new Set(def.shutters ?? []);
  const glow = def.sign?.color ?? def.signs?.[0]?.color ?? WARM;
  if (def.shopfront) {
    // Glass runs between doors.
    let runStart = -1;
    for (let tx = 0; tx <= def.w; tx++) {
      const abs = def.x + tx;
      const isGap = tx === def.w || doors.has(abs) || shutters.has(abs) || tx === 0 || tx === def.w - 1;
      if (!isGap && runStart < 0) runStart = tx;
      if (isGap && runStart >= 0) {
        paintShopfront(b, X + runStart * TS + 1, groundY + 3, (tx - runStart) * TS - 2, glow, rng);
        runStart = -1;
      }
    }
  } else {
    for (let tx = 1; tx < def.w - 1; tx++) {
      const abs = def.x + tx;
      if (doors.has(abs) || shutters.has(abs) || doors.has(abs - 1) || doors.has(abs + 1)) continue;
      if (rng.chance(0.55)) paintWindow(b, X + tx * TS + 4, groundY + 3, rng, def.style);
      else if (rng.chance(0.35)) poster(b, X + tx * TS + 3, groundY + 3, rng);
    }
  }
  if (def.awning) paintAwning(b, X + 2, groundY - 3, Wp - 4, def.awning);
  for (const d of doors) {
    paintDoor(b, d * TS + 2, groundY + 2, def.shopfront ? mix(glow, WARM, 0.5) : WARM, 'glass');
    b.unblock(d, def.y + def.h - 1);
  }
  for (const s of shutters) paintDoor(b, s * TS + 2, groundY + 2, WARM, 'shutter');

  // Pipes / conduits on plain facades
  if (!def.shopfront && rng.chance(0.5)) {
    const px = X + (rng.chance(0.5) ? 2 : Wp - 4);
    b.g.fillStyle = '#4a4e5c';
    b.g.fillRect(px, facadeTop, 2, facadeH - 2);
    b.g.fillStyle = '#6a6e7c';
    b.g.fillRect(px, facadeTop, 1, facadeH - 2);
  }

  if (def.sign) paintSign(b, def.sign, X, Y, Wp, facadeTop);
  for (const s of def.signs ?? []) paintSign(b, s, X, Y, Wp, facadeTop);

  // Ground contact shadow / grime line
  b.g.fillStyle = 'rgba(6,5,12,0.55)';
  b.g.fillRect(X, Y + Hp, Wp, 2);
}

function poster(b: BakeCtx, x: number, y: number, rng: Rng): void {
  const col = rng.pick(['#ff4fb0', '#3fe0f0', '#ffcc3d', '#62e06a', '#e8452e']);
  b.g.fillStyle = '#d8d0c0';
  b.g.fillRect(x, y, 9, 11);
  b.g.fillStyle = col;
  b.g.fillRect(x + 1, y + 1, 7, 5);
  b.g.fillStyle = '#2a2830';
  b.g.fillRect(x + 1, y + 7, 7, 1);
  b.g.fillRect(x + 1, y + 9, 5, 1);
  // Torn corner
  b.g.fillStyle = 'rgba(0,0,0,0.3)';
  b.g.fillRect(x + 7, y + 9, 2, 2);
}
