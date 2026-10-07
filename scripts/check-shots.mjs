#!/usr/bin/env node
/**
 * The smoke check of the 640x360 move (PL3 of docs/PIVOT-640.md): in every full-screen shot that is
 * not on the void-allowed list, the L-shaped area outside the old 480x270 frame (x at or beyond 480,
 * or y at or beyond 270, in game pixels) must hold at least 5% pixels that are not the clear color.
 * An empty void there means a scene still draws only the old frame. The check does not see a
 * stretched layer, clipped text or a misregistered layer: PL4 and the expectation list carry those.
 *
 *   node scripts/check-shots.mjs <dir> [--config scripts/pivot-640.json] [--size 640x360] [--old 480x270]
 *
 * <dir> holds the regenerated shots (PNG, any integer zoom of the new frame: a 1280x720 shot is
 * 2x). The void-allowed list, the clear colors and the 5% line come from the config file, which
 * mirrors docs/PIVOT-640.md. --size and --old override the frames in the config.
 *
 * Exit code 1 when a checked shot fails or has an unexpected size, else 0.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { decodePng } from './lib/png.mjs';

const HELP = `check-shots: the PL3 smoke check of docs/PIVOT-640.md.

  node scripts/check-shots.mjs <dir> [--config scripts/pivot-640.json] [--size 640x360] [--old 480x270]

For each PNG under <dir> that is not on the void-allowed list: the area outside the old frame must
hold at least minFillPercent pixels that are not a clear color. Exit code 1 on any failure.`;

const args = process.argv.slice(2);
const positional = [];
let configFile = 'scripts/pivot-640.json', sizeArg = null, oldArg = null, help = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--config') configFile = args[++i];
  else if (a === '--size') sizeArg = args[++i];
  else if (a === '--old') oldArg = args[++i];
  else if (a === '--help' || a === '-h') help = true;
  else positional.push(a);
}
if (help || positional.length !== 1) {
  console.log(HELP);
  process.exit(help ? 0 : 2);
}
const [dir] = positional;
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`not a directory: ${dir}`);
  process.exit(2);
}

/** "640x360" to { w, h }. */
function parseSize(s, what) {
  const m = /^(\d+)x(\d+)$/.exec(s ?? '');
  if (!m) throw new Error(`${what}: expected WxH, got "${s}"`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

const config = JSON.parse(readFileSync(configFile, 'utf8'));
const size = sizeArg ? parseSize(sizeArg, '--size') : config.newFrame;
const old = oldArg ? parseSize(oldArg, '--old') : config.oldFrame;
const minFill = Number(config.minFillPercent);
const tolerance = Number(config.clearTolerance ?? 0);
const voidAllowed = new Set(config.voidAllowed ?? []);
const clearColors = (config.clearColors ?? []).map((hex) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`clearColors: expected #rrggbb, got "${hex}"`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
});

/** Is this pixel within the tolerance of one of the clear colors? */
function isClear(r, g, b) {
  for (const [cr, cg, cb] of clearColors) {
    if (Math.abs(r - cr) <= tolerance && Math.abs(g - cg) <= tolerance && Math.abs(b - cb) <= tolerance) return true;
  }
  return false;
}

/** Every PNG under `dir`, as names relative to it, with forward slashes and no extension. */
function shotNames(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) out.push(relative(root, p).split(sep).join('/').replace(/\.png$/i, ''));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Check one shot. Returns `{ ok, text }`: `ok` is true for a pass and for a skipped shot.
 */
function check(file) {
  const img = decodePng(readFileSync(file));
  const k = img.width / size.w;
  if (!Number.isInteger(k) || k < 1 || img.height !== size.h * k) {
    return { ok: false, text: `unexpected size ${img.width}x${img.height} (not a whole multiple of ${size.w}x${size.h})` };
  }
  const oldW = old.w * k, oldH = old.h * k;
  let outer = 0, filled = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x < oldW && y < oldH) continue; // inside the old frame
      outer++;
      const o = (y * img.width + x) * 4;
      if (!isClear(img.data[o], img.data[o + 1], img.data[o + 2])) filled++;
    }
  }
  if (outer === 0) return { ok: false, text: 'no outer area (the shot is the old frame)' };
  const pct = (filled / outer) * 100;
  const ok = pct >= minFill;
  return { ok, text: `${ok ? 'ok  ' : 'FAIL'}  ${pct.toFixed(1)}% of the outer area is drawn (${filled} of ${outer} px at ${k}x)` };
}

const names = shotNames(dir);
const width = Math.max(...names.map((n) => n.length), 4);
let failed = 0, checked = 0, skipped = 0;
console.log(`check-shots: ${dir}  (frame ${size.w}x${size.h}, old frame ${old.w}x${old.h}, at least ${minFill}% drawn outside it)`);
for (const name of names) {
  if (voidAllowed.has(name)) {
    skipped++;
    console.log(`${name.padEnd(width)}  skip  (void allowed)`);
    continue;
  }
  checked++;
  const r = check(join(dir, `${name}.png`));
  if (!r.ok) failed++;
  console.log(`${name.padEnd(width)}  ${r.text}`);
}
console.log('');
console.log(`${checked} shots checked, ${failed} failed, ${skipped} skipped (void allowed).`);
process.exit(failed ? 1 : 0);
