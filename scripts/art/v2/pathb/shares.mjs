// S3 by part box (path B): each connected piece of a part in a facing looks for the same part in a source picture under one shift or one mirror.
// Cells that land on that part are copy (no shift) or transform (shift or mirror). Everything else is invent. No reprojection: the box is the unit.
import { components } from './card.mjs';
import { SIZE, cellOf } from './sheet.mjs';

/** Candidate moves for one piece, identity first. dest (x, y) reads source (x - dx, y - dy), or (A - x, y - dy) when mirrored. */
function moves(reach, mirrorAxes) {
  const out = [{ kind: 'identity', dx: 0, dy: 0 }];
  for (let dy = -reach.dy; dy <= reach.dy; dy++)
    for (let dx = -reach.dx; dx <= reach.dx; dx++) if (dx || dy) out.push({ kind: 'shift', dx, dy });
  for (const A of mirrorAxes) for (let dy = -reach.dy; dy <= reach.dy; dy++) out.push({ kind: 'mirror', A, dy });
  return out;
}
const srcOf = (m, x, y) => (m.kind === 'mirror' ? [m.A - x, y - m.dy] : [x - m.dx, y - m.dy]);
const cost = (m) => (m.kind === 'identity' ? 0 : m.kind === 'shift' ? 1 + Math.abs(m.dx) + Math.abs(m.dy) : 100 + Math.abs(m.dy));

/**
 * Shares of one facing against source part maps (labels arrays, the given first). sources = [{ name, labels }].
 * Returns { total, copy, transform, invent, share: { copy, transform, invent } (0..1), perPart, pieces }.
 */
export function sharesByBox(data, sheet, sources) {
  const { dx, dy } = data.checks.copyShift;
  const axes = [];
  for (let A = 28; A <= 42; A++) axes.push(A);
  const cand = moves({ dx, dy }, axes);
  const count = { copy: 0, transform: 0, invent: 0 };
  const perPart = {};
  const pieces = [];
  const cells = Array(SIZE * SIZE).fill(null);
  for (const part of Object.keys(sheet.parts)) {
    perPart[part] = { copy: 0, transform: 0, invent: 0 };
    for (const comp of components(sheet, part)) {
      let best = null;
      for (const src of sources)
        for (const m of cand) {
          let n = 0;
          for (const i of comp) {
            const [x, y] = cellOf(i);
            const [sx, sy] = srcOf(m, x, y);
            if (sx >= 0 && sy >= 0 && sx < SIZE && sy < SIZE && src.labels[sy * SIZE + sx] === part) n++;
          }
          if (!best || n > best.n || (n === best.n && cost(m) < cost(best.m))) best = { n, m, src: src.name };
        }
      const same = best?.m.kind === 'identity';
      for (const i of comp) {
        const [x, y] = cellOf(i);
        const [sx, sy] = best ? srcOf(best.m, x, y) : [-1, -1];
        const hit = best && sx >= 0 && sy >= 0 && sx < SIZE && sy < SIZE && sources.find((s) => s.name === best.src)?.labels[sy * SIZE + sx] === part;
        const cls = hit ? (same ? 'copy' : 'transform') : 'invent';
        cells[i] = cls;
        count[cls]++;
        perPart[part][cls]++;
      }
      pieces.push({ part, size: comp.length, move: best?.m ?? null, from: best?.src ?? null, matched: best?.n ?? 0 });
    }
  }
  const total = count.copy + count.transform + count.invent;
  const share = Object.fromEntries(Object.entries(count).map(([k, v]) => [k, total ? v / total : 0]));
  return { total, ...count, share, perPart, pieces, cells };
}
