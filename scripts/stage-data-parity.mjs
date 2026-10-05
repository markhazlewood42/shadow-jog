// Checks that Mark's battle stage design data in this branch is byte for byte what branch spike/phaser-stage has, and that the pure modules the slice brought
// over as they were (src/battlestage/*.ts, from src/stage/*.ts there) are unchanged too (step B1, pass line P4).
//   node scripts/stage-data-parity.mjs [--ref spike/phaser-stage]
// For each of the five design files (src/data/stages.json, heroes.json, hud.json, enemyfacing.json, axes.json) it compares the git hash of the file here
// (`git hash-object`, the hash git would store for it) with the blob hash on the reference branch (`git rev-parse <ref>:<path>`), and the SHA-256 of the
// bytes on disk with the SHA-256 of the blob (`git show`). Both must match. The pure modules are compared by git hash. Exit code 0 when all five match, 1 when one differs, 2 when the branch is not here.
// It only reads. The data is Mark's: this branch copies it and never changes it (the Battle Stage Editor owns it).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const i = process.argv.indexOf('--ref');
const ref = i >= 0 ? (process.argv[i + 1] ?? '') : 'spike/phaser-stage';
const FILES = ['stages', 'heroes', 'hud', 'enemyfacing', 'axes'].map((n) => `src/data/${n}.json`);
/** The modules copied as they were: [path here, path on the reference branch]. */
const MODULES = ['config', 'hudpresets', 'feet', 'floor', 'shadow', 'rules', 'proportions', 'facing', 'crew', 'known', 'pixels', 'faces', 'sewerwall', 'idle'].map((n) => [`src/battlestage/${n}.ts`, `src/stage/${n}.ts`]);
MODULES.push(['src/art/rig2/sfgeom.ts', 'src/art/rig2/sfgeom.ts']);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 1 << 26 });

try {
  git('rev-parse', '--verify', `${ref}^{commit}`);
} catch {
  console.error(`The branch ${ref} is not in this repository (fetch it, or pass --ref <branch>).`);
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
  const a = git('hash-object', here).toString().trim();
  const b = git('rev-parse', `${ref}:${theirs}`).toString().trim();
  if (a !== b) bad++;
  console.log(`${a === b ? 'same   ' : 'DIFFERS'} ${here}  (${theirs} on ${ref})  git ${a.slice(0, 10)} / ${b.slice(0, 10)}`);
}
console.log(bad ? `${bad} files differ from ${ref}.` : `All ${FILES.length} design files and ${MODULES.length} pure modules are byte for byte the ones on ${ref}.`);
process.exit(bad ? 1 : 0);
