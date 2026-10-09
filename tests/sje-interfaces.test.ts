/**
 * The design sketches of docs/engine/interfaces.md are compiled (M0): `src/sje/interfaces.check.ts` is built from the doc's
 * code blocks by scripts/sync-interface-check.mjs, and `npm run typecheck` compiles it under the strict settings. This test is the
 * other half: the file on disk must be exactly what the script builds from the doc today, so a doc edit that nobody synced fails here
 * (run `node scripts/sync-interface-check.mjs`), and a sketch that does not compile fails `tsc`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ambient, blocksOf, buildCheckFile } from '../scripts/lib/interface-check.mjs';

const ROOT = join(import.meta.dirname, '..');
const md = readFileSync(join(ROOT, 'docs/engine/interfaces.md'), 'utf8');

describe('interfaces.md is compiled', () => {
  it('src/sje/interfaces.check.ts is what the doc builds today (run `node scripts/sync-interface-check.mjs` after editing the doc)', () => {
    const onDisk = readFileSync(join(ROOT, 'src/sje/interfaces.check.ts'), 'utf8');
    expect(onDisk === buildCheckFile(md)).toBe(true);
  });

  it('every code block of the doc is in the file (the scan is alive)', () => {
    const blocks = blocksOf(md);
    expect(blocks.length).toBeGreaterThanOrEqual(14);
    const onDisk = readFileSync(join(ROOT, 'src/sje/interfaces.check.ts'), 'utf8');
    for (const [i, b] of blocks.entries()) expect(onDisk, `block ${i + 1}`).toContain(ambient(b, i));
  });

  it('a value line with an initializer that the script does not know is refused (a doc change cannot slip past as runtime code)', () => {
    expect(() => ambient('export const NEW_THING = 5;', 0)).toThrow(/does not know/);
    expect(ambient('export class A { m(): void; }', 0)).toContain('export declare class A');
  });

  it('the generated file holds no runtime code: no initializer, no function body', () => {
    const onDisk = readFileSync(join(ROOT, 'src/sje/interfaces.check.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(onDisk).not.toMatch(/^export const /m);
    expect(onDisk).not.toMatch(/\bfunction\s+\w+\s*\([^)]*\)\s*(:[^{;]+)?\{/);
  });
});
