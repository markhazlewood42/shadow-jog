/**
 * Dialogue portraits by rig v2: each speaker's picked portrait and the expressions the art pass
 * redrew for it, traced to one palette (`public/art/rig/portraits.json`), and the rest in code: the
 * expressions it didn't make (eyes and mouth redrawn on the neutral face, a pixel or two at a time),
 * a blink, and the mouth working while a line types (`getPortrait(key, face, 'blink' | 'talk')`).
 */
import { FACES, replacePortrait } from '../portraits';
import { PORTRAIT_TRACED } from './data';
import { decode } from './rig';

/** x0, y0, x1, y1 (inclusive) on the 48x48 portrait. */
export type Box = [number, number, number, number];
export interface TracedPortrait {
  w: number;
  h: number;
  pal: string[];
  /** Pixel rows per expression the art pass made (always `neutral`). */
  faces: Record<string, string[]>;
  /** The eyes, left then right as we look at them (none behind shades or a visor), and the mouth. */
  eyes: Box[];
  mouth: Box;
}

/** How code draws each expression: what the eyes do, and the mouth. */
const RECIPE: Record<string, [string, string]> = {
  happy: ['arc', 'smile'],
  sad: ['up', 'frown'],
  angry: ['down', 'grit'],
  surprised: ['wide', 'o'],
  smirk: ['lid', 'smirk'],
  hurt: ['squeeze', 'grit'],
};

const lum = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
};

/** One face being drawn on: palette indexes, -1 empty. */
class Face {
  constructor(
    readonly px: Int16Array,
    readonly w: number,
    readonly pal: string[],
  ) {}
  get = (x: number, y: number) => this.px[y * this.w + x] ?? -1;
  set = (x: number, y: number, c: number) => {
    if (c >= 0 && x >= 0 && y >= 0 && x < this.w) this.px[y * this.w + x] = c;
  };
  row = (y: number, x0: number, x1: number, c: number) => {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  };
  /** The commonest light colour on a row (skin, usually), or -1. */
  common(y: number, x0: number, x1: number): number {
    const n = new Map<number, number>();
    for (let x = x0; x <= x1; x++) {
      const c = this.get(x, y);
      if (c >= 0 && lum(this.pal[c] ?? '#000') > 90) n.set(c, (n.get(c) ?? 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  }
  /** The skin under a feature: the first row below it that has some. */
  skin(b: Box): number {
    for (let y = b[3] + 1; y < b[3] + 4; y++) {
      const c = this.common(y, b[0], b[2]);
      if (c >= 0) return c;
    }
    return this.pal.length >> 1;
  }
  /** The darkest colour on a row, within a feature's width. */
  darkest(y: number, x0: number, x1: number): number {
    let best = -1;
    for (let x = x0; x <= x1; x++) {
      const c = this.get(x, y);
      if (c >= 0 && (best < 0 || lum(this.pal[c] ?? '#fff') < lum(this.pal[best] ?? '#fff'))) best = c;
    }
    return best;
  }
  /** The palette colour nearest a darker shade of one (for a mouth line in skin's own hue). */
  shade(c: number, k: number): number {
    const n = Number.parseInt((this.pal[c] ?? '#808080').slice(1), 16);
    const t = [(n >> 16) * k, ((n >> 8) & 255) * k, (n & 255) * k];
    let best = 0, bd = Infinity;
    this.pal.forEach((p, i) => {
      const m = Number.parseInt(p.slice(1), 16);
      const d = ((m >> 16) - (t[0] ?? 0)) ** 2 + (((m >> 8) & 255) - (t[1] ?? 0)) ** 2 + ((m & 255) - (t[2] ?? 0)) ** 2;
      if (d < bd) [bd, best] = [d, i];
    });
    return best;
  }

  /** An eye, `inner` being its corner nearer the nose. */
  eye(b: Box, inner: number, how: string): void {
    const [x0, y0, x1, y1] = b;
    const skin = this.skin(b);
    const lash = Math.max(0, this.darkest(y0 - 1, x0, x1));
    const clear = (from: number, to: number) => {
      for (let y = from; y <= to; y++) this.row(y, x0, x1, skin);
    };
    const step = inner === x1 ? -1 : 1;
    switch (how) {
      case 'shut': // a blink: the lid down to the bottom of the eye
        clear(y0 - 1, y1);
        this.row(y1, x0, x1, lash);
        break;
      case 'arc': // happy: shut and curved up
        clear(y0 - 1, y1);
        this.row(y0, x0 + 1, x1 - 1, lash);
        this.set(x0, y0 + 1, lash);
        this.set(x1, y0 + 1, lash);
        break;
      case 'squeeze': {
        // hurt: screwed shut, creased at the inner corner
        clear(y0 - 1, y1);
        const m = Math.round((y0 + y1) / 2);
        this.row(m, x0, x1, lash);
        this.set(inner, m - 1, lash);
        this.set(inner + step, m - 1, lash);
        break;
      }
      case 'lid': // smirk: the lid half down
        this.row(y0 - 1, x0, x1, skin);
        this.row(y0, x0, x1, lash);
        break;
      case 'wide': // surprised: the lid up a pixel, white under it
        for (let x = x0; x <= x1; x++) this.set(x, y0 - 2, this.get(x, y0 - 1));
        this.row(y0 - 1, x0 + 1, x1 - 1, this.pal.length - 1);
        break;
      case 'down': // angry: the lid drawn down at the inner corner
        this.set(inner, y0, lash);
        this.set(inner + step, y0, lash);
        this.set(inner - step, y0 - 2, lash);
        break;
      case 'up': // sad: the inner corner lifted
        this.set(inner, y0 - 1, skin);
        this.set(inner, y0 - 2, lash);
        this.set(inner + step, y0 - 2, lash);
        break;
    }
  }

  mouth(b: Box, how: string): void {
    const [x0, y0, x1, y1] = b;
    const skin = this.skin(b);
    const line = this.shade(skin, 0.45);
    const cy = Math.round((y0 + y1) / 2), mx = (x0 + x1) >> 1;
    for (let y = y0; y <= y1; y++) this.row(y, x0, x1, skin);
    switch (how) {
      case 'smile':
      case 'frown':
      case 'smirk':
        this.row(cy, x0 + 1, x1 - 1, line);
        if (how !== 'smirk') this.set(x0, how === 'smile' ? cy - 1 : cy + 1, line);
        this.set(x1, how === 'frown' ? cy + 1 : cy - 1, line);
        break;
      case 'o': // a small open mouth: lip over a dark 2x2
        this.row(cy - 1, mx, mx + 1, line);
        this.row(cy, mx, mx + 1, 0);
        this.row(cy + 1, mx, mx + 1, 0);
        break;
      case 'grit':
        this.row(cy - 1, x0 + 1, x1 - 1, line);
        this.row(cy, x0, x1, line);
        this.row(cy, x0 + 1, x1 - 1, this.pal.length - 1);
        this.row(cy + 1, x0 + 1, x1 - 1, line);
        break;
    }
  }

  /** The mouth open a little (talking): a dark row under its line, the lower lip a pixel down. */
  talk(b: Box): void {
    const [x0, y0, x1, y1] = b;
    const skinLum = lum(this.pal[this.skin(b)] ?? '#fff');
    // The lip line: the row with the most dark pixels (else the middle row).
    let lip = Math.round((y0 + y1) / 2), most = 0;
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      let n = 0;
      for (let x = x0; x <= x1; x++) if (lum(this.pal[this.get(x, y)] ?? '#fff') < skinLum * 0.75) n++;
      if (n > most) [most, lip] = [n, y];
    }
    const open = most ? lip + 1 : lip;
    for (let x = x0 + 1; x < x1; x++) {
      this.set(x, open + 1, this.get(x, open));
      this.set(x, open, 0);
    }
  }

  canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.px.length / this.w;
    const g = c.getContext('2d');
    if (!g) return c;
    const img = g.createImageData(c.width, c.height);
    this.px.forEach((i, k) => {
      if (i < 0) return;
      const n = Number.parseInt((this.pal[i] ?? '#000').slice(1), 16);
      img.data.set([n >> 16, (n >> 8) & 255, n & 255, 255], k * 4);
    });
    g.putImageData(img, 0, 0);
    return c;
  }
}

/** Every expression of one portrait, with its blink and talk frames. */
export function rigPortrait(p: TracedPortrait): Record<string, { face: HTMLCanvasElement; blink?: HTMLCanvasElement | undefined; talk: HTMLCanvasElement }> {
  const px = (rows: string[]) => decode({ w: p.w, h: p.h, feet: 0, hip: 0, pal: p.pal, rows }).px;
  const neutral = px(p.faces.neutral ?? []);
  const out: ReturnType<typeof rigPortrait> = {};
  // The eyes as drawn on the neutral face (with the lash row and a row above it).
  const eyesOf = (a: Int16Array) => p.eyes.map(([x0, y0, x1, y1]) => Array.from({ length: (y1 - y0 + 3) * (x1 - x0 + 1) }, (_, i) => a[(y0 - 2 + Math.floor(i / (x1 - x0 + 1))) * p.w + x0 + (i % (x1 - x0 + 1))]).join()).join('|');
  for (const name of FACES) {
    const rows = p.faces[name];
    const f = new Face(rows ? px(rows) : neutral.slice(), p.w, p.pal);
    const recipe = RECIPE[name];
    if (!rows && recipe) {
      p.eyes.forEach((b, i) => {
        f.eye(b, i ? b[0] : b[2], recipe[0]);
      });
      f.mouth(p.mouth, recipe[1]);
    }
    const t = new Face(f.px.slice(), p.w, p.pal);
    t.talk(p.mouth);
    // A blink only where the eyes are the neutral face's (a redrawn or reshaped eye would show
    // around the closed lid).
    let blink: HTMLCanvasElement | undefined;
    if (p.eyes.length && eyesOf(f.px) === eyesOf(neutral)) {
      const b = new Face(f.px.slice(), p.w, p.pal);
      p.eyes.forEach((e, i) => {
        b.eye(e, i ? e[0] : e[2], 'shut');
      });
      blink = b.canvas();
    }
    out[name] = { face: f.canvas(), blink, talk: t.canvas() };
  }
  return out;
}

/** Swap the traced portraits in, every expression with its blink and talk. Returns how many. */
export function applyRigPortraits(): number {
  const all = Object.entries(PORTRAIT_TRACED);
  for (const [key, p] of all)
    for (const [face, v] of Object.entries(rigPortrait(p))) {
      replacePortrait(key, v.face, [face]);
      replacePortrait(key, v.talk, [face], 'talk');
      if (v.blink) replacePortrait(key, v.blink, [face], 'blink');
    }
  return all.length;
}
