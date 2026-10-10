/**
 * The pure parts of the field parity harness (M5 task 8, docs/engine/m5-brief.md pass line 4). No Playwright and no browser here, so a unit test
 * (`tests/sjefield-parity.test.ts`) proves the gate with made-up pictures, and the e2e spec and the references spec use the same code.
 *
 * The method is the one of M3's battle stage (`e2e/sjestageparity.ts`, tooling-and-testing.md section 5), at 640x360 and with the OLD FIELD as the reference:
 *  - a picture is the screenshot of the game canvas at 1280x720 (zoom 2), not the 640x360 back buffer: the old path's GL presenter (glow, haze) works at the screen's resolution
 *    on a hardware GPU, so only the whole picture is a fair thing to compare;
 *  - the references are pictures of the legacy path (no `?engine=sje`: the Canvas 2D field), one per state of `tests/fixtures/sjefield/cases.json`;
 *  - the new path (the field on the stage) must equal them: 0 differing pixels OUTSIDE the renderer mask, at most 1/255 INSIDE it;
 *  - the renderer mask is where the legacy `gpu` reference and the legacy `soft` reference differ (the browser's own canvas and GL code, not the engine). One mask for all
 *    states: the union;
 *  - the gate must be able to fail: controls (a 2/255 step, a one-pixel actor move, a wrong light radius) must be rejected.
 *
 * RESULT (2026-10-10, recorded in m5-brief.md section 9): the strict gate does NOT hold for lit frames. The light map is multiplied over the world by Pixi's GL blend; the old
 * path multiplies in Canvas 2D (Skia), and the two round differently. On SwiftShader the new frame is 1/255 lower than the old one in 25 to 90% of the pixels (Skia's software
 * blend rounds up); on a GPU about 1 to 25% of the pixels are 1/255 apart, and a few hundred to 30,000 of them lie outside the renderer mask. Brief decision 4 lets lighting out
 * of the numeric gate when this happens, if Mark sees the diff. So the spec has two tiers: the STRICT gate (opt in with `SJEFIELD_STRICT=1`: it reports the numbers and fails)
 * and the MEASURED BOUNDS below, a regression guard that holds today and fails when the new field drifts further from the old one (with the same three controls). The bounds are
 * not the gate and they are not a decision: they are what was measured, rounded up.
 */
/** The game's size in game pixels. The pictures of the harness are what the player sees: the game at a whole zoom (2x in a 1280x720 window), so 1280x720. */
export const W = 640;
export const H = 360;

/** Which kind of renderer drew a picture: a hardware browser (`gpu`) or software GL and software canvas (`soft`, what CI runs). */
export type RendererKind = 'gpu' | 'soft';

export interface Picture {
  w: number;
  h: number;
  /** RGBA bytes, top row first. */
  data: Uint8Array;
}

const maxChannel = (a: Uint8Array, b: Uint8Array, i: number): number => Math.max(Math.abs((a[i] ?? 0) - (b[i] ?? 0)), Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)), Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)));

/**
 * The pixels whose color depends on the KIND of renderer: where the `gpu` reference and the `soft` reference of the same state differ, over every state given.
 * One byte per pixel, 1 = renderer dependent.
 */
export function rendererMask(pairs: ReadonlyArray<{ gpu: Picture; soft: Picture }>): Uint8Array {
  const first = pairs[0];
  if (!first) throw new Error('no reference pairs');
  const mask = new Uint8Array(first.gpu.w * first.gpu.h);
  for (const { gpu, soft } of pairs) {
    if (gpu.data.length !== soft.data.length || gpu.data.length !== mask.length * 4) throw new Error('the two references differ in size');
    for (let p = 0; p < mask.length; p++) if (maxChannel(gpu.data, soft.data, p * 4) > 0) mask[p] = 1;
  }
  return mask;
}

export interface Strict {
  /** Pixels OUTSIDE the mask that differ at all. Must be 0. */
  outside: number;
  /** Pixels INSIDE the mask that differ by more than 1/255. Must be 0. */
  insideOver1: number;
  /** Pixels inside the mask that differ by exactly 1/255 (allowed: the renderer's own noise). */
  insideNoise: number;
  /** The largest difference in any channel. */
  max: number;
  /** The first few offending pixels. */
  samples: Array<{ x: number; y: number; now: number[]; ref: number[] }>;
  ok: boolean;
}

/** The strict gate. */
export function strictCompare(now: Picture, ref: Picture, mask: Uint8Array): Strict {
  if (now.data.length !== ref.data.length || now.w !== ref.w || now.h !== ref.h) throw new Error(`the pictures differ in size: ${now.w}x${now.h} and ${ref.w}x${ref.h}`);
  const out: Strict = { outside: 0, insideOver1: 0, insideNoise: 0, max: 0, samples: [], ok: false };
  for (let p = 0; p < now.w * now.h; p++) {
    const i = p * 4;
    const d = maxChannel(now.data, ref.data, i);
    if (d === 0) continue;
    if (d > out.max) out.max = d;
    let bad = false;
    if (!mask[p]) {
      out.outside++;
      bad = true;
    } else if (d > 1) {
      out.insideOver1++;
      bad = true;
    } else out.insideNoise++;
    if (bad && out.samples.length < 8) out.samples.push({ x: p % now.w, y: Math.floor(p / now.w), now: [...now.data.subarray(i, i + 4)], ref: [...ref.data.subarray(i, i + 4)] });
  }
  out.ok = out.outside === 0 && out.insideOver1 === 0;
  return out;
}

/** A one-line report of one strict comparison. */
export function describeStrict(label: string, r: Strict): string {
  return `${label}: ${r.ok ? 'EXACT' : 'FAILS'} outside the mask ${r.outside} px, inside it ${r.insideOver1} px over 1/255 and ${r.insideNoise} px at 1/255 (largest step ${r.max}/255)`;
}

/** A copy of a picture with every red channel above `from` raised by `step` (clamped): the 2/255 control. Pixels at 255 cannot rise, so the step is taken from the other side there. */
export function withStep(p: Picture, step: number, region?: { x: number; y: number; w: number; h: number }): Picture {
  const data = new Uint8Array(p.data);
  const r = region ?? { x: 0, y: 0, w: p.w, h: p.h };
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * p.w + x) * 4;
      const v = data[i] ?? 0;
      data[i] = v + step <= 255 ? v + step : v - step;
    }
  }
  return { w: p.w, h: p.h, data };
}

/** How many k-by-k blocks of a picture are not one flat color (a crisp integer zoom has none). */
export function unevenBlocks(p: Picture, k: number): number {
  let uneven = 0;
  for (let y = 0; y + k <= p.h; y += k) {
    for (let x = 0; x + k <= p.w; x += k) {
      const o = (y * p.w + x) * 4;
      let flat = true;
      for (let dy = 0; dy < k && flat; dy++)
        for (let dx = 0; dx < k; dx++) {
          const q = ((y + dy) * p.w + x + dx) * 4;
          if (p.data[q] !== p.data[o] || p.data[q + 1] !== p.data[o + 1] || p.data[q + 2] !== p.data[o + 2]) {
            flat = false;
            break;
          }
        }
      if (!flat) uneven++;
    }
  }
  return uneven;
}

// ------------------------------------------------------------------ the measured bounds (a regression guard, not the gate)

export interface Measure {
  pixels: number;
  /** Pixels that differ at all, by at least 2, and by at least 4 in some channel. */
  any: number;
  ge2: number;
  ge4: number;
  /** The largest step in any channel. */
  max: number;
}

export function measure(now: Picture, ref: Picture): Measure {
  if (now.data.length !== ref.data.length) throw new Error('the pictures differ in size');
  const m: Measure = { pixels: now.w * now.h, any: 0, ge2: 0, ge4: 0, max: 0 };
  for (let p = 0; p < m.pixels; p++) {
    const d = maxChannel(now.data, ref.data, p * 4);
    if (d === 0) continue;
    m.any++;
    if (d >= 2) m.ge2++;
    if (d >= 4) m.ge4++;
    if (d > m.max) m.max = d;
  }
  return m;
}

export type FxLevel = 'none' | 'full';

/** What was measured on 2026-10-10 (31 states), rounded up. A fraction of the pixels, except `max` (a channel step). */
export const BOUNDS: Record<RendererKind, Partial<Record<FxLevel, { max: number; ge2: number; ge4: number }>>> = {
  // SwiftShader, effects off: 1/255 almost everywhere, 2/255 at most, 2/255 in at most 0.7% of the pixels (the Annex).
  soft: { none: { max: 2, ge2: 0.01, ge4: 0 } },
  // A GPU, effects off: 1/255 almost everywhere, 2/255 in at most 20 pixels. With the whole effect stack: at most 15/255, 4/255 or more in at most 2% of the pixels.
  gpu: { none: { max: 2, ge2: 0.0001, ge4: 0 }, full: { max: 16, ge2: 0.08, ge4: 0.03 } },
};

/** The ways a measurement is outside the bounds of its kind and level (empty: inside). */
export function outsideBounds(kind: RendererKind, fx: FxLevel, m: Measure): string[] {
  const b = BOUNDS[kind][fx];
  if (!b) return [`no bounds for ${kind} at fx ${fx}`];
  const out: string[] = [];
  if (m.max > b.max) out.push(`the largest step is ${m.max}/255, the bound is ${b.max}`);
  if (m.ge2 > b.ge2 * m.pixels) out.push(`${m.ge2} px differ by 2/255 or more, the bound is ${Math.floor(b.ge2 * m.pixels)}`);
  if (m.ge4 > b.ge4 * m.pixels) out.push(`${m.ge4} px differ by 4/255 or more, the bound is ${Math.floor(b.ge4 * m.pixels)}`);
  return out;
}

export function describeMeasure(label: string, m: Measure): string {
  return `${label}: ${((m.any / m.pixels) * 100).toFixed(2)}% of pixels differ, >=2: ${m.ge2}, >=4: ${m.ge4}, largest step ${m.max}/255`;
}
