/**
 * The pure parts of the stage lab's parity harness (step B1 of the engine-platform spike, cleanup items C1 and C2). No Playwright and no
 * browser here, so a unit test (`tests/sjestage-parity.test.ts`) can prove the gates with made-up pictures, and the e2e kit and spec use the same code.
 *
 * Three things live here:
 *  1. `compareFrames`: the numbers of one comparison of two RGBA pictures (the largest difference, how many pixels differ, a picture of where).
 *  2. Two gates on those numbers. The LOOSE gate is exit criterion 7 of the spike (no pixel off by more than 2/255 in any channel and at
 *     most 3% of the pixels off at all). The STRICT gate (C1) is the regression gate: outside the few pixels whose colour depends on the
 *     renderer, the engine's frame must equal the reference EXACTLY. Measured parity is exactly 0, so the loose gate alone would let a
 *     shadow or a figure move by a pixel without a test failing.
 *  3. The PINS (C2): the SHA-256 of every input file of the slice, written in the manifest when the references are made and checked
 *     before any pixel is compared, so a design edit fails with a clear message and not with a pile of pixel numbers.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const W = 480;
export const H = 270;

// ------------------------------------------------------------------ comparing

export interface Parity {
  /** The largest difference in any one of R, G, B (0 to 255). */
  maxDiff: number;
  /** Pixels where any of R, G or B differs at all, and as a percentage of the picture. */
  differing: number;
  pct: number;
  /** Pixels that differ by more than 1, 2 and 3 in some channel. */
  over1: number;
  over2: number;
  over3: number;
  /** The share of the picture that differs by MORE than the allowed 2/255. */
  failing: number;
  /** Up to 8 worst pixels. */
  samples: Array<{ x: number; y: number; engine: number[]; ref: number[] }>;
  /** A picture of where they differ: the reference dimmed, every differing pixel hot pink (alpha 255). */
  diff: Buffer;
}

/** Compare two RGBA pictures of the same size (alpha is not compared: both are opaque). */
export function compareFrames(engine: Buffer, ref: Buffer): Parity {
  if (engine.length !== ref.length) throw new Error(`the pictures differ in size: ${engine.length} and ${ref.length} bytes`);
  const n = engine.length / 4;
  const diff = Buffer.alloc(engine.length);
  const out: Parity = { maxDiff: 0, differing: 0, pct: 0, over1: 0, over2: 0, over3: 0, failing: 0, samples: [], diff };
  const worst: Array<{ d: number; i: number }> = [];
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const d = Math.max(Math.abs((engine[i] ?? 0) - (ref[i] ?? 0)), Math.abs((engine[i + 1] ?? 0) - (ref[i + 1] ?? 0)), Math.abs((engine[i + 2] ?? 0) - (ref[i + 2] ?? 0)));
    if (d > 0) {
      diff.set([255, 0, 96, 255], i);
      out.differing++;
      out.maxDiff = Math.max(out.maxDiff, d);
      if (d > 1) out.over1++;
      if (d > 2) out.over2++;
      if (d > 3) out.over3++;
      if (worst.length < 8 || d > (worst[worst.length - 1]?.d ?? 0)) {
        worst.push({ d, i });
        worst.sort((a, b) => b.d - a.d);
        if (worst.length > 8) worst.pop();
      }
    } else diff.set([(ref[i] ?? 0) >> 2, (ref[i + 1] ?? 0) >> 2, (ref[i + 2] ?? 0) >> 2, 255], i);
  }
  out.pct = (out.differing / n) * 100;
  out.failing = (out.over2 / n) * 100;
  out.samples = worst.map(({ i }) => ({ x: (i / 4) % W, y: Math.floor(i / 4 / W), engine: [...engine.subarray(i, i + 4)], ref: [...ref.subarray(i, i + 4)] }));
  return out;
}

/** The pass line of exit criterion 7: no pixel differs by more than 2/255 in any channel, and at most 3% of the pixels differ at all. */
export const PARITY_MAX_CHANNEL = 2;
export const PARITY_MAX_PERCENT = 3;

/** A one-line report of one comparison (the numbers the spike doc records). */
export function describeParity(label: string, p: Parity): string {
  return `${label}: max channel diff ${p.maxDiff}/255, ${p.differing} px differ (${p.pct.toFixed(3)}%), over 1: ${p.over1}, over 2: ${p.over2}, over 3: ${p.over3}`;
}

// ------------------------------------------------------------------ the strict regression gate (C1)

/**
 * The pixels whose colour depends on the KIND of renderer: where a GPU browser's reference and a software browser's reference differ (item 35 of the
 * spike doc: the street's glow layer is painted by canvas 2D code that differs by 1/255 between the two). One byte per pixel, 1 = renderer dependent.
 * It is the union over every pair given, so one mask serves every tick and frame.
 */
export function rendererMask(pairs: Array<{ gpu: Buffer; soft: Buffer }>): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (const { gpu, soft } of pairs) {
    if (gpu.length !== soft.length) throw new Error('the two references differ in size');
    for (let p = 0; p < mask.length; p++) {
      const i = p * 4;
      if (gpu[i] !== soft[i] || gpu[i + 1] !== soft[i + 1] || gpu[i + 2] !== soft[i + 2]) mask[p] = 1;
    }
  }
  return mask;
}

export interface StrictResult {
  /** Pixels OUTSIDE the mask that differ at all. Must be 0. */
  outside: number;
  /** Pixels INSIDE the mask that differ by more than 1/255. Must be 0. */
  insideOver1: number;
  /** Pixels inside the mask that differ by exactly 1/255 (allowed: this is the renderer's own noise). */
  insideNoise: number;
  /** The first few offending pixels. */
  samples: Array<{ x: number; y: number; engine: number[]; ref: number[] }>;
  ok: boolean;
}

/**
 * The strict gate. Outside the renderer-dependent pixels the engine must equal the reference exactly (0/255 everywhere). Inside them a 1/255 step
 * is allowed, because the browser's canvas code, not the engine, makes it. Any other difference fails. A figure, a shadow or a ring that moves
 * by one pixel changes many pixels by far more than 1/255 and fails; so does a depth haze that rounds one step differently.
 */
export function strictCompare(engine: Buffer, ref: Buffer, mask: Uint8Array): StrictResult {
  if (engine.length !== ref.length) throw new Error(`the pictures differ in size: ${engine.length} and ${ref.length} bytes`);
  const out: StrictResult = { outside: 0, insideOver1: 0, insideNoise: 0, samples: [], ok: false };
  for (let p = 0; p < engine.length / 4; p++) {
    const i = p * 4;
    const d = Math.max(Math.abs((engine[i] ?? 0) - (ref[i] ?? 0)), Math.abs((engine[i + 1] ?? 0) - (ref[i + 1] ?? 0)), Math.abs((engine[i + 2] ?? 0) - (ref[i + 2] ?? 0)));
    if (d === 0) continue;
    let bad = false;
    if (!mask[p]) {
      out.outside++;
      bad = true;
    } else if (d > 1) {
      out.insideOver1++;
      bad = true;
    } else out.insideNoise++;
    if (bad && out.samples.length < 8) out.samples.push({ x: p % W, y: Math.floor(p / W), engine: [...engine.subarray(i, i + 4)], ref: [...ref.subarray(i, i + 4)] });
  }
  out.ok = out.outside === 0 && out.insideOver1 === 0;
  return out;
}

/** A one-line report of one strict comparison. */
export function describeStrict(label: string, r: StrictResult): string {
  return `${label}: ${r.ok ? 'EXACT' : 'FAILS'} outside the renderer mask: ${r.outside} px differ, inside it: ${r.insideOver1} px over 1/255 and ${r.insideNoise} px at 1/255`;
}

// ------------------------------------------------------------------ the pins (C2)

/** The command that makes the references again (run it once with and once without `--no-gpu`). */
export const REGENERATE_COMMAND = 'node scripts/sjestage-refs.mjs --out <folder> --fixtures   (then again with --no-gpu)';

/** The file's text as hashed: line ends are LF, so a Windows checkout with CRLF gives the same hash as a Linux one. */
export function pinnedText(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

/** The SHA-256 (hex) of a file of the repo, as pinned. */
export function pinHash(root: string, rel: string): string {
  return createHash('sha256').update(pinnedText(readFileSync(join(root, rel)))).digest('hex');
}

/** The SHA-256 of every input file (`files` are repo-relative paths). */
export function pinAll(root: string, files: readonly string[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f, pinHash(root, f)]));
}

/**
 * The input files that differ from what the manifest recorded, or are missing from it, as readable lines. Empty when every input is the one
 * the references were made with. `read` makes the hash of a path (default: from disk), so a test can change an input without touching a file.
 */
export function changedInputs(root: string, files: readonly string[], recorded: Record<string, string> | undefined, read: (rel: string) => string = (rel) => pinHash(root, rel)): string[] {
  const problems: string[] = [];
  for (const f of files) {
    const want = recorded?.[f];
    if (!want) problems.push(`${f}: the manifest has no hash for it`);
    else {
      const now = read(f);
      if (now !== want) problems.push(`${f}: changed (the references were made with sha256 ${want.slice(0, 12)}, the file is ${now.slice(0, 12)})`);
    }
  }
  return problems;
}

/** The one message a changed input gives. The spec throws it before it compares a single pixel. */
export function pinMessage(problems: readonly string[]): string {
  return `design data changed since the references were made: regenerate with ${REGENERATE_COMMAND}\n  ${problems.join('\n  ')}`;
}
