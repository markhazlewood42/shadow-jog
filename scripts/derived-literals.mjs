#!/usr/bin/env node
/**
 * The advisory scan of derived layout values for the 640x360 move (docs/PIVOT-640.md, PL1 scope
 * note and rubric R1). It never fails: it lists, per file, the numbers and expressions that the
 * inventory found to be tuned to the 480x270 screen without being the screen size itself:
 *
 *   464 (W-16), 472 (W-8), 262 (H-8), 228, 242, 214 (H-56), 196, 202, 204, 142, and the expressions
 *   W-16, W-8, H-20, H-56 written with W and H.
 *
 * A hit here is not a bug: `W - 16` is the right way to write a margin. The report is read at WP7,
 * where the reconciliation table maps each tuned-layout row of the inventory to a commit or a test
 * and says why each remaining derived value is right at 640x360.
 *
 *   node scripts/derived-literals.mjs [--tokens 464,472,...] [--json]
 *
 * The file set is the scan test's (scripts/lib/source-scan.mjs, `listScanFiles`). Comments and
 * strings are ignored, as in the test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTokens, listScanFiles } from './lib/source-scan.mjs';

const HELP = `derived-literals: list derived 480x270 layout values per file (advisory, never fails).

  node scripts/derived-literals.mjs [--tokens 464,472,...] [--json]`;

const DEFAULT_TOKENS = ['464', '472', '262', '228', '242', '214', '196', '202', '204', '142', 'W-16', 'W-8', 'H-20', 'H-56'];

const args = process.argv.slice(2);
let tokens = DEFAULT_TOKENS, json = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--tokens') tokens = args[++i].split(',').map((t) => t.trim()).filter(Boolean);
  else if (a === '--json') json = true;
  else if (a === '--help' || a === '-h') { console.log(HELP); process.exit(0); }
  else { console.log(HELP); process.exit(2); }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = [];
for (const file of listScanFiles(root)) {
  const hits = findTokens(readFileSync(join(root, file), 'utf8'), tokens);
  if (hits.length) report.push({ file, hits });
}

if (json) {
  console.log(JSON.stringify({ tokens, files: report }, null, 2));
} else {
  const total = report.reduce((n, f) => n + f.hits.length, 0);
  console.log(`derived-literals: ${total} hit(s) of [${tokens.join(', ')}] in ${report.length} file(s). Advisory only.\n`);
  for (const { file, hits } of report) {
    console.log(`${file} (${hits.length})`);
    for (const h of hits) console.log(`  ${String(h.line).padStart(5)}  ${h.token.padEnd(5)}  ${h.text.slice(0, 140)}`);
  }
}
process.exit(0);
