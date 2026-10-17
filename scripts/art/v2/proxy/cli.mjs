// One entry point for the proxy tools.   node scripts/art/v2/proxy/cli.mjs <command> [options]
//   fit        [--spec f] [--blank hairWing|coat|x0,y0,x1,y1] [--json]       fit report at the given facing; exit 1 when a pass line fails
//   light      [--spec f] [--blank ..]                                         best light vector and thresholds for the given's letters
//   optimize   [--spec f] [--out f] [--steps 1,0.5] [--random N] [--seed S] [--sigma X] [--freeze id,id] [--anchor f] [--guard s,n] [--blank ..]   numbers-only fit
//   templates  [--spec f] [--facings s,se,e,ne,n] [--out dir] [--k 32]        part map and light map previews, template.json and card.txt per facing
//   card       [--spec f] --facing s                                           print the structure card
//   classify   [--spec f] [--facings s,se,e,ne,n] [--blank ..] [--out dir]     S3 copy, transform, invent shares per facing
//   samples    [--spec f] --out dir [--blank ..]                               sample sheets cut from the given
//   kit        [--spec f] --facing s --out dir [--blank ..] [--neighbor se:grid.txt]   the writer kit
//   rebuild    [--spec f] --facing s --grid g.txt --out dir [--template t.json] [--blank ..] [--neighbor se:grid.txt]   facing from spec + template + grid
//   checks     [--spec f] [--facings s,n]                                      template checks (plan section 7)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPartMap } from '../../pipeline/decompose.mjs';
import { loadGiven } from '../../pipeline/given.mjs';
import { GridError, writePng } from '../../headtest/lib.mjs';
import { buildCard } from './card.mjs';
import { formatChecks, templateChecks } from './checks.mjs';
import { fitLight, fitReport, formatFitReport, optimizeSpec } from './fit.mjs';
import { flatCells, parseGrid32 } from './grid32.mjs';
import { buildKit } from './kit.mjs';
import { classImage, previewImage } from './preview.mjs';
import { rebuildFacing, TemplateMismatch, writeRebuild } from './rebuild.mjs';
import { approvedSource, classifyCells, formatShares, givenSource } from './reproject.mjs';
import { renderTemplate } from './render.mjs';
import { cutSamples, samplesText, writeSamples } from './samples.mjs';
import { loadSpec, stringifySpec, validateSpec } from './spec.mjs';
import { templateData } from './tdata.mjs';

export const DEFAULT_SPEC = fileURLToPath(new URL('./rook.character.json', import.meta.url));
/** The two boxes of the 6a held-out test (learnings.md): the hair wing and the coat. */
export const BLANK_BOXES = { hairWing: { x0: 11, y0: 0, x1: 17, y1: 10 }, coat: { x0: 13, y0: 11, x1: 17, y1: 25 } };

export function parseBlank(v) {
  if (!v) return null;
  if (BLANK_BOXES[v]) return BLANK_BOXES[v];
  const n = v.split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isInteger(x))) throw new Error(`--blank wants hairWing, coat or x0,y0,x1,y1; got ${v}`);
  return { x0: n[0], y0: n[1], x1: n[2], y1: n[3] };
}
function parseArgs(argv) {
  const out = { _: [], multi: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { (out.multi[key] ??= []).push(next); out[key] = next; i++; }
  }
  return out;
}
const must = (o, k) => { if (o[k] === undefined || o[k] === true) throw new Error(`missing --${k}`); return o[k]; };
const readGrid = (path) => flatCells(parseGrid32(readFileSync(path, 'utf8')));
const neighborsOf = (o) => (o.multi.neighbor ?? []).map((v) => { const i = v.indexOf(':'); return { facing: v.slice(0, i), flat: readGrid(v.slice(i + 1)) }; });

export function main(argv) {
  const [cmd, ...rest] = argv;
  const o = parseArgs(rest);
  const specPath = o.spec ?? DEFAULT_SPEC;
  const spec = loadSpec(specPath);
  const img = loadGiven();
  const pm = buildPartMap(img);
  const blank = parseBlank(o.blank);
  const facings = (o.facings ?? 's,se,e,ne,n').split(',');
  switch (cmd) {
    case 'fit': {
      const r = fitReport(spec, img, pm, { blank });
      console.log(o.json ? JSON.stringify(r, null, 2) : formatFitReport(r));
      return r.pass.mIoU && r.pass.landmarks ? 0 : 1;
    }
    case 'light': {
      console.log(JSON.stringify(fitLight(spec, img, pm, { blank }), null, 2));
      return 0;
    }
    case 'optimize': {
      const anchor = o.anchor ? loadSpec(o.anchor) : spec;
      const res = optimizeSpec(spec, pm, {
        blank, anchor, guard: o.guard ? String(o.guard).split(',') : null, steps: (o.steps ?? '1,0.5,0.25').split(',').map(Number), freeze: (o.freeze ?? '').split(',').filter(Boolean),
        random: o.random ? { iters: Number(o.random), seed: Number(o.seed ?? 1), sigma: Number(o.sigma ?? 0.4) } : null,
      });
      validateSpec(res.spec);
      writeFileSync(o.out ?? specPath, stringifySpec(res.spec));
      console.log(`objective ${res.before} -> ${res.after}`);
      console.log(formatFitReport(fitReport(res.spec, img, pm, { blank })));
      return 0;
    }
    case 'templates': {
      const out = o.out ?? 'rook-v2-templates';
      mkdirSync(out, { recursive: true });
      const k = Number(o.k ?? 32);
      for (const f of facings) {
        const t = renderTemplate(spec, { facing: f });
        writePng(previewImage(t, k), `${out}/${f}-template-32x.png`);
        writeFileSync(`${out}/${f}-card.txt`, buildCard(spec, t).text);
        writeFileSync(`${out}/${f}-template.json`, `${JSON.stringify(templateData(spec, t))}\n`);
        console.log(`wrote ${out}/${f}-template-32x.png, ${f}-card.txt, ${f}-template.json`);
      }
      return 0;
    }
    case 'card': {
      console.log(buildCard(spec, renderTemplate(spec, { facing: must(o, 'facing') })).text);
      return 0;
    }
    case 'classify': {
      const sources = [givenSource(spec, img, pm, { blank }), ...neighborsOf(o).map((n) => approvedSource(spec, n.facing, n.flat, `neighbor-${n.facing}`))];
      const rows = facings.map((f) => {
        const t = renderTemplate(spec, { facing: f });
        const cls = classifyCells(spec, t, sources, { blank });
        if (o.out) { mkdirSync(o.out, { recursive: true }); writePng(classImage(t, cls), `${o.out}/${f}-classes-32x.png`); }
        return { facing: f, ...cls };
      });
      console.log(formatShares(rows));
      return 0;
    }
    case 'samples': {
      const out = must(o, 'out');
      mkdirSync(out, { recursive: true });
      const cut = cutSamples(spec, img, pm, { blank });
      writeSamples(out, cut);
      writeFileSync(`${out}/samples.txt`, samplesText(cut));
      console.log(`wrote sample sheets and samples.txt to ${out}`);
      return 0;
    }
    case 'kit': {
      const out = must(o, 'out');
      const r = buildKit({ spec, facing: must(o, 'facing'), outDir: out, img, pm, blank, neighbors: neighborsOf(o) });
      console.log(`kit for ${o.facing}: ${r.files.length} files in ${out}; copy ${r.cls.counts.copy}, transform ${r.cls.counts.transform}, invent ${r.cls.counts.invent}`);
      return 0;
    }
    case 'rebuild': {
      const out = must(o, 'out');
      mkdirSync(out, { recursive: true });
      const facing = must(o, 'facing');
      try {
        const r = rebuildFacing({
          spec, facing, gridText: readFileSync(must(o, 'grid'), 'utf8'), img, pm, blank, neighbors: neighborsOf(o),
          templateJson: o.template ? JSON.parse(readFileSync(o.template, 'utf8')) : null,
        });
        writeRebuild(out, facing, r);
        console.log(`rebuilt ${facing} into ${out}: ${r.levelT.conflicts.length} conflicts, ${r.levelT.warnings.length} warnings, ${r.lockFixed} locked cells restored`);
        return r.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof TemplateMismatch) { console.error(e.message); return 3; }
        if (e instanceof GridError) { console.error(e.message); return 2; }
        throw e;
      }
    }
    case 'checks': {
      let bad = 0;
      for (const f of (o.facings ?? 's,n').split(',')) {
        const r = templateChecks(spec, pm, f);
        console.log(formatChecks(r));
        if (!r.ok) bad++;
      }
      return bad ? 1 : 0;
    }
    default:
      console.error('usage: cli.mjs fit | light | optimize | templates | card | classify | samples | kit | rebuild | checks   (see the header of this file)');
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
