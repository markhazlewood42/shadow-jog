/**
 * Contact shadows and rings as pixel pictures (Phaser spike `spike/phaser-stage`), ported from the design's mockup
 * script (`draw_shadow`, `draw_ring`). Pure: each function returns a small picture (`Raw`, with a transparent
 * background) that the texture code hands to Phaser. No Phaser, no browser.
 *
 * A **contact shadow** is the dark oval under a fighter's feet. It does more than decorate: it is what tells
 * the eye "this figure stands ON the floor, at this depth". It is drawn as flat ellipse with three steps of
 * strength toward the rim plus a stippled (every-other-pixel) outer edge, which reads as soft without any
 * blur. The oval is `aspect` times wider than tall (4:1 here), the squashed circle you get when a round
 * patch of floor is seen from above at a shallow angle.
 *
 * A **ring** is a thin ellipse outline around the shadow: cyan under the acting hero, amber under the target,
 * and a dotted copy marks the spot an attacker started from while it lunges.
 */
import type { ShadowStyle } from './config';
import { hexRgb, newRaw, type Raw, type RGB } from './pixels';

/** The shadow picture's size for an oval `w` wide: padded so the stippled rim fits, and even in both directions so the oval's middle is a pixel EDGE (the picture is centred on its feet position exactly). */
export function shadowSize(w: number, aspect: number): { w: number; h: number; ovalH: number } {
  const ovalH = Math.max(4, Math.round(w / aspect));
  return { w: w + 8 + (w % 2), h: ovalH + 6 + (ovalH % 2), ovalH };
}

/** The shadow oval, `w` wide. Its centre is the middle of the picture. */
export function shadowRaw(w: number, style: ShadowStyle): Raw {
  const size = shadowSize(w, style.aspect);
  const out = newRaw(size.w, size.h);
  const col = hexRgb(style.color);
  const a = w / 2;
  const b = size.ovalH / 2;
  const cx = size.w / 2;
  const cy = size.h / 2;
  for (let y = 0; y < size.h; y++)
    for (let x = 0; x < size.w; x++) {
      const d = ((x + 0.5 - cx) / a) ** 2 + ((y + 0.5 - cy) / b) ** 2;
      let al: number;
      if (d <= 0.45) al = style.alpha;
      else if (d <= 0.8) al = style.alpha * 0.82;
      else if (d <= 1) al = style.alpha * 0.62;
      else if (d <= 1.35 && (x + y) % 2 === 0) al = style.edgeAlpha;
      else continue;
      out.data.set([col[0], col[1], col[2], Math.round(al * 255)], (y * size.w + x) * 4);
    }
  return out;
}

/** A ring picture's size for a ring `w` wide. */
export function ringSize(w: number): { w: number; h: number; ringH: number } {
  const ringH = Math.max(4, Math.round(w / 4)) + 1;
  return { w: w + 5 + ((w + 5) % 2), h: ringH + 5 + ((ringH + 5) % 2), ringH };
}

/**
 * A one-pixel ellipse outline `w` wide (or, when `dotted`, a ring of separate dots at 70% strength), centred
 * in the picture. Whole pixels only: a pixel is on the outline when it is inside the ellipse but not inside
 * the same ellipse made one pixel smaller.
 */
export function ringRaw(w: number, color: string, dotted: boolean): Raw {
  const size = ringSize(w);
  const out = newRaw(size.w, size.h);
  const c: RGB = hexRgb(color);
  const cx = size.w / 2;
  const cy = size.h / 2;
  const rx = w / 2;
  const ry = size.ringH / 2;
  if (dotted) {
    for (let k = 0; k < 360; k += 12) {
      const x = Math.floor(cx + Math.round(Math.cos((k * Math.PI) / 180) * rx));
      const y = Math.floor(cy + Math.round(Math.sin((k * Math.PI) / 180) * ry));
      if (x >= 0 && y >= 0 && x < size.w && y < size.h) out.data.set([c[0], c[1], c[2], Math.round(0.7 * 255)], (y * size.w + x) * 4);
    }
    return out;
  }
  for (let y = 0; y < size.h; y++)
    for (let x = 0; x < size.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const outer = (dx / (rx + 0.5)) ** 2 + (dy / (ry + 0.5)) ** 2;
      const inner = (dx / (rx - 0.5)) ** 2 + (dy / (ry - 0.5)) ** 2;
      if (outer <= 1 && inner > 1) out.data.set([c[0], c[1], c[2], 255], (y * size.w + x) * 4);
    }
  return out;
}
