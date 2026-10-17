// Run the repo checkers on every frame the Blender script wrote, and print one table of numbers.
//   node scripts/art/rook3d/check.mjs <out dir> [--json <file>]
// 32x32 walk frames: checkHardLines (scripts/art/v2/grade/hardlines.mjs, which runs the pixlint lines) with the part labels of the
// render's own part-ID pass. Battle poses (79x68): lintFrame with the battle idle palette from target.json. Also prints a sha256 per
// PNG, for the determinism compare, and the katana side check.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkHardLines, loadSpec } from '../v2/grade/hardlines.mjs';
import { bboxOf } from '../v2/grade/image.mjs';
import { measureFrame, outlineRatio, orphans } from '../metrics.mjs';
import { readPng } from '../pixkit/png.mjs';
import { lintFrame } from '../pixlint.mjs';
import { readTarget } from '../pipeline/given.mjs';

const dir = process.argv[2];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (!dir) throw new Error('usage: check.mjs <out dir> [--json file]');
const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
const target = readTarget();
const spec = loadSpec();
const HILT = new Set(['guard', 'wrap']); // the sheath is often hidden behind the body; the hilt over the right shoulder shows in most facings

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const byName = (items, id, rx) => items.find((i) => i.id === id && (!rx || rx.test(i.name)));

const walkFrames = manifest.frames.filter((f) => f.kind === 'walk');
const imgs = Object.fromEntries(walkFrames.map((f) => [f.name, readPng(`${dir}/frames/${f.name}.png`)]));
const rows = [];
if (!manifest.frames.length) throw new Error('no frames');

for (const f of manifest.frames) {
  const path = `${dir}/frames/${f.name}.png`;
  const img = f.kind === 'walk' ? imgs[f.name] : readPng(path);
  const labGrid = JSON.parse(readFileSync(`${dir}/frames/${f.name}.labels.json`, 'utf8'));
  const labels = labGrid.flat();
  const row = { name: f.name, kind: f.kind, facing: f.facing, hash: sha(path) };
  if (f.kind === 'walk') {
    const set = walkFrames.filter((g) => g.index === f.index && g.facing !== f.facing).map((g) => ({ name: g.name, img: imgs[g.name] }));
    const res = checkHardLines(img, { facing: f.facing, labels, template: false, spec, name: f.name, set, sheathSide: f.facing === 'se' ? 'left' : undefined });
    const m = measureFrame(img);
    const b = bboxOf(img);
    const pal = res.items.find((i) => i.id === 'PA-01' && /only palette/.test(i.name));
    const alpha = res.items.find((i) => i.id === 'PA-02');
    const out = res.items.find((i) => i.id === 'PA-03' && /outline >=/.test(i.name));
    const gate = {
      palette: Number.parseInt(pal?.value, 10) === 0,
      alpha: Number.parseInt(alpha?.value, 10) === 0,
      outline: Number.parseFloat(out?.value) >= 93,
      height: Math.abs(b.h - 31) <= 1,
      bottom: b.y1 === 30,
      head: Number.parseInt(res.items.find((i) => i.id === 'HL-HEAD')?.value, 10) >= 13 && Number.parseInt(res.items.find((i) => i.id === 'HL-HEAD')?.value, 10) <= 15,
    };
    row.gate = gate;
    row.gatePass = Object.values(gate).every(Boolean);
    Object.assign(row, {
      colors: m.colors ?? null,
      offPalette: pal?.value,
      halfAlpha: alpha?.value,
      outline: out?.value,
      height: b.h,
      bottom: b.y1,
      head: res.items.find((i) => i.id === 'HL-HEAD')?.value,
      orphans: orphans(img).length,
      smallRegions: m.smallRegions,
      pass: res.pass,
      otherFailed: res.items.filter((i) => i.status === 'fail' && !/^(PA-01|PA-02|PA-03|HL-HEIGHT|HL-BOTTOM|HL-HEAD)$/.test(i.id)).map((i) => i.id),
      lines: res.items.map((i) => `${i.status === 'pass' ? '+' : i.status === 'fail' ? 'FAIL' : '.'} ${i.id} ${i.name}: ${i.value}`),
      failed: res.items.filter((i) => i.status === 'fail').map((i) => `${i.id} ${i.name}: ${i.value}`),
    });
    // katana side: the pixel centroid of the hilt against the 3D prediction (camera x of the hilt, px from the body axis)
    const ks = [];
    for (let i = 0; i < labels.length; i++) if (HILT.has(labels[i])) ks.push(i % 32);
    if (ks.length) {
      const cx = ks.reduce((a, v) => a + v, 0) / ks.length + 0.5 - 16;
      const pred = manifest.hilt_cam_x[f.facing];
      row.katana = { px: ks.length, centroidX: Number(cx.toFixed(2)), predictedX: pred, agree: Math.abs(pred) < 1 || Math.sign(pred) === Math.sign(cx) };
    } else row.katana = { px: 0, centroidX: null, predictedX: manifest.hilt_cam_x[f.facing], agree: null };
  } else {
    const lint = lintFrame(img, { palette: target.battleIdle.palette, ref: null, ranges: null, facing: false });
    const get = (id, rx) => lint.find((i) => i.id === id && rx.test(i.name));
    const b = bboxOf({ w: img.w, h: img.h, data: img.data });
    Object.assign(row, {
      offPalette: get('PA-01', /only palette/)?.value,
      halfAlpha: get('PA-02', /half/)?.value,
      outline: get('PA-03', /outline >=/)?.value,
      height: b ? b.h : 0,
      bottom: b ? b.y1 : -1,
      orphans: orphans(img).length,
      gatePass: ['PA-01', 'PA-02', 'PA-03'].every((id) => lint.filter((i) => i.id === id && i.status !== 'skipped' && i.status !== 'info').every((i) => i.status === 'pass')),
      failed: lint.filter((i) => i.status === 'fail').map((i) => `${i.id} ${i.name}: ${i.value}`),
    });
  }
  rows.push(row);
}

console.log('frame | off-palette | half-alpha | outline | height | bottom | head | orphans | gate (exit line 1) | all checker lines | hash');
for (const r of rows) console.log(`${r.name} | ${r.offPalette} | ${r.halfAlpha} | ${r.outline} | ${r.height} | ${r.bottom} | ${r.head ?? '-'} | ${r.orphans} | ${r.gatePass ? 'yes' : 'NO'} | ${r.pass === undefined ? '-' : r.pass ? 'yes' : 'NO'} | ${r.hash}`);
const gates = rows.filter((r) => r.kind === 'walk');
console.log(`\ngate (the 6 exit-criteria lines): ${rows.filter((r) => r.gatePass).length} of ${rows.length} frames; walk frames ${gates.filter((r) => r.gatePass).length} of ${gates.length}`);
console.log(`other checker lines (reported, not exit lines): walk frames with a failure ${gates.filter((r) => r.otherFailed.length).length} of ${gates.length}; failing ids ${[...new Set(gates.flatMap((r) => r.otherFailed))].join(' ')}`);
console.log('\nper facing (walk frames 0-3): height | bottom | head | outline min % | orphans max | gate frames');
const rng = (a) => (Math.min(...a) === Math.max(...a) ? `${Math.min(...a)}` : `${Math.min(...a)}-${Math.max(...a)}`);
for (const fc of [...new Set(gates.map((r) => r.facing))]) {
  const g = gates.filter((r) => r.facing === fc);
  console.log(`${fc} | ${rng(g.map((r) => r.height))} | ${rng(g.map((r) => r.bottom))} | ${rng(g.map((r) => Number.parseInt(r.head, 10)))} | ${Math.min(...g.map((r) => Number.parseFloat(r.outline))).toFixed(1)} | ${Math.max(...g.map((r) => r.orphans))} | ${g.filter((r) => r.gatePass).length}/4`);
}
console.log('\nfailed lines');
for (const r of rows) if (r.failed.length) console.log(`${r.name}: ${r.failed.join(' ; ')}`);
console.log('\nkatana side (hilt pixel centroid x from the body axis, predicted x from the 3D model)');
for (const r of rows) if (r.katana) console.log(`${r.name}: ${r.katana.px} px, centroid ${r.katana.centroidX}, predicted ${r.katana.predictedX}, agree ${r.katana.agree}`);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(rows, null, 1)}\n`);
