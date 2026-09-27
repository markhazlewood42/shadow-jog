/** Color helpers. All colors are `#rrggbb` strings at the API boundary. */

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function rgb(hex: string): RGB {
  let c = cache.get(hex);
  if (c) return c;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0]! + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  cache.set(hex, c);
  return c;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export function hex(c: RGB): string {
  return '#' + ((1 << 24) | (clamp255(c[0]) << 16) | (clamp255(c[1]) << 8) | clamp255(c[2])).toString(16).slice(1);
}

export function rgba(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return hex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

export function toHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Rotate hue `h` toward `target` by up to `amt` degrees along the shortest arc. */
function hueToward(h: number, target: number, amt: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(Math.abs(d), amt);
}

/**
 * Pixel-art style shading. `amt` in [-1, 1]. Negative darkens and shifts hue toward cool violet;
 * positive lightens and shifts toward warm yellow. Mirrors how pixel artists hue-shift ramps.
 */
export function shade(color: string, amt: number): string {
  const [h, s, l] = toHsl(rgb(color));
  if (amt < 0) {
    const t = -amt;
    const nh = s < 0.05 ? 240 : hueToward(h, 250, 28 * t);
    const ns = s < 0.05 ? Math.min(0.22, 0.25 * t) : Math.min(1, s + 0.08 * t);
    return hex(fromHsl(nh, ns, l * (1 - 0.55 * t)));
  }
  const t = amt;
  const nh = s < 0.05 ? 50 : hueToward(h, 55, 22 * t);
  const ns = s < 0.05 ? Math.min(0.15, 0.2 * t) : Math.max(0, s - 0.05 * t);
  return hex(fromHsl(nh, ns, l + (1 - l) * 0.5 * t));
}

export function luminance(color: string): number {
  const [r, g, b] = rgb(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
