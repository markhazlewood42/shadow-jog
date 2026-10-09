// Rewrites src/sje/interfaces.check.ts from docs/engine/interfaces.md. See scripts/lib/interface-check.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCheckFile } from './lib/interface-check.mjs';

const md = readFileSync(new URL('../docs/engine/interfaces.md', import.meta.url), 'utf8');
writeFileSync(new URL('../src/sje/interfaces.check.ts', import.meta.url), buildCheckFile(md));
console.log('wrote src/sje/interfaces.check.ts');
