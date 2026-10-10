// Checks that Mark's battle stage design data in this branch is byte for byte what the Phaser spike has (principle 8 of docs/engine/migration.md: the
// 480x270 stage JSONs never change by accident). It also lists the pure modules that came over from the spike and whether they are still the spike's bytes.
//   node scripts/stage-data-parity.mjs [--ref archive/phaser-stage-2026-10-09]
// For each of the five design files (src/data/stages.json, heroes.json, hud.json, enemyfacing.json, axes.json) it compares the git hash of the file here
// (`git hash-object`, the hash git would store for it) with the blob hash on the reference (`git rev-parse <ref>:<path>`), and the SHA-256 of the bytes
// on disk with the SHA-256 of the blob (`git show`). Both must match. Exit code 0 when all five match, 1 when one differs, 2 when the reference is not here.
//
// The pure modules are INFORMATION, not a gate. Since M3 they differ from the spike on purpose: `Raw` is the engine's { w, h, data } (was { w, h, px },
// decision 6 of docs/engine/m3-brief.md) in the modules that handle pixels, and `config.ts` takes `depthFor` and `PART` from the engine (task 3). A module that
// is listed as "same" has not been touched since the spike. It only reads.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const i = process.argv.indexOf('--ref');
const ref = i >= 0 ? (process.argv[i + 1] ?? '') : 'archive/phaser-stage-2026-10-09';
const FILES = ['stages', 'heroes', 'hud', 'enemyfacing', 'axes'].map((n) => `src/data/${n}.json`);
/** The modules that came from the spike: [path here, path on the reference]. */
const MODULES = ['config', 'hudpresets', 'feet', 'floor', 'shadow', 'rules', 'proportions', 'facing', 'crew', 'known', 'pixels', 'faces', 'sewerwall', 'idle'].map((n) => [`src/battlestage/${n}.ts`, `src/stage/${n}.ts`]);
MODULES.push(['src/battlestage/sfgeom.ts', 'src/art/rig2/sfgeom.ts']);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 26 });

try {
  git('rev-parse', '--verify', `${ref}^{commit}`);
} catch {
  console.error(`The reference ${ref} is not in this repository (fetch it, or pass --ref <tag or branch>).`);
  process.exit(2);
}
let bad = 0;
for (const file of FILES) {
  const here = readFileSync(join(root, file));
  const theirs = git('show', `${ref}:${file}`);
  const hereGit = git('hash-object', file).toString().trim();
  const theirsGit = git('rev-parse', `${ref}:${file}`).toString().trim();
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const same = hereGit === theirsGit && sha(here) === sha(theirs);
  if (!same) bad++;
  console.log(`${same ? 'same   ' : 'DIFFERS'} ${file}  git ${hereGit.slice(0, 10)} / ${theirsGit.slice(0, 10)}  sha256 ${sha(here).slice(0, 12)} / ${sha(theirs).slice(0, 12)}  (${here.length} bytes)`);
}
for (const [here, theirs] of MODULES) {
  let b;
  try {
    b = git('rev-parse', `${ref}:${theirs}`).toString().trim();
  } catch {
    console.log(`(info)  ${here}  (${theirs} is not on ${ref})`);
    continue;
  }
  const a = git('hash-object', here).toString().trim();
  console.log(`${a === b ? 'same   ' : 'changed'} ${here}  (${theirs} on ${ref}, information only)  git ${a.slice(0, 10)} / ${b.slice(0, 10)}`);
}
console.log(bad ? `${bad} design files differ from ${ref}.` : `All ${FILES.length} design files are byte for byte the ones on ${ref}.`);
process.exit(bad ? 1 : 0);
