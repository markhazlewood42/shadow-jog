#!/usr/bin/env node
// Re-pin the input hashes of the stage parity references WITHOUT making new pictures (M3 task 8).
//
//   node scripts/sjestage-repin.mjs
//
// tests/fixtures/sjestage/manifest-<kind>.json records the SHA-256 of every data file the slice reads (the list is inputs.json). The parity spec fails FIRST when one changed.
// When a file changed in a way that cannot change a pixel (the enemy data moved from enemies.ts to JSON, a loader line changed), the pictures stay and only the pins move.
// That is a claim, and the parity run is its proof: run `npx playwright test e2e/sje-stage-parity.spec.ts` after this, and expect 0 differing pixels. When a design number
// changed (a position, a color), do NOT run this: make the references again with scripts/sjestage-refs.mjs, which needs the Phaser checkout.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests', 'fixtures', 'sjestage');
const files = JSON.parse(readFileSync(join(dir, 'inputs.json'), 'utf8')).files;
const hashText = (file) => createHash('sha256').update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), 'utf8').digest('hex');
const hashes = Object.fromEntries(files.map((f) => [f, hashText(join(root, f))]));
for (const kind of ['gpu', 'soft']) {
  const file = join(dir, `manifest-${kind}.json`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const changed = files.filter((f) => manifest.inputs[f] !== hashes[f]);
  manifest.inputs = hashes;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${kind}: ${changed.length ? `re-pinned ${changed.join(', ')}` : 'nothing changed'}`);
}
