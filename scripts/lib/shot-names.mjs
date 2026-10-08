/**
 * The one list of shot names the pivot tools (pixel-diff, check-shots, contact-sheet) all use, so
 * a change to what counts as a shot is made once.
 */
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Every PNG under `dir`, as names relative to it, with forward slashes and no extension. */
export function shotNames(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) out.push(relative(dir, p).split(sep).join('/').replace(/\.png$/i, ''));
    }
  };
  walk(dir);
  return out.sort();
}
