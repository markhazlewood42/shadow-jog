import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dropStrays } from '../src/art/rig2/sfpunch';
import movesJson from '../src/data/moves.json';
import { cutSheet, footAnchor } from '../src/stage/feet';
import type { MoveFile } from '../src/stage/moves';
import type { Raw } from '../src/stage/pixels';
import { buildKitSet, buildStrikeSet, type StrikeSet } from '../src/stage/strike';
import { readPng } from './png';

/**
 * The hit events of the shipped moves carry a `contact` point (where the weapon is, from the attacker's feet). Those numbers
 * were measured on Mark's drawings; this test measures them again, so that if he redraws a frame and the blade or the fist
 * moves, the data is told off instead of the spark quietly floating in the air. It reads his git-excluded PNGs and is skipped
 * where they are absent (CI); the stand-in art has its own, looser, check in the end-to-end spec.
 */
const DIR = 'spritefusion-tests';
const have = existsSync(`${DIR}/rook-battle-strike1.png`) && existsSync(`${DIR}/extracted/rook-battle-idle/spritesheet.png`) && existsSync(`${DIR}/kit-battle-punch2.png`) && existsSync(`${DIR}/extracted/kit-battle-idle/spritesheet.png`);
const file = movesJson as unknown as MoveFile;

function idleOf(id: string): Raw[] {
  const meta = JSON.parse(readFileSync(`${DIR}/extracted/${id}-battle-idle/metadata.json`, 'utf8')) as { frame_w: number; frame_count: number };
  return cutSheet(readPng(`${DIR}/extracted/${id}-battle-idle/spritesheet.png`), meta.frame_w, meta.frame_count);
}

/** The rightmost opaque column of a picture (the tip) as a distance from the axis, and the mean row of the pixels in that column as a height above the axis (negative = up). */
function tip(set: StrikeSet, key: string): { dx: number; dy: number } {
  const r = set.frames[key];
  if (!r) throw new Error(`no picture ${key}`);
  let maxX = -1;
  const rows: number[] = [];
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if ((r.px[(y * r.w + x) * 4 + 3] ?? 0) > 0) {
        if (x > maxX) {
          maxX = x;
          rows.length = 0;
        }
        if (x === maxX) rows.push(y);
      }
  return { dx: maxX + 1 - set.axisX, dy: rows.reduce((a, b) => a + b, 0) / rows.length - set.axisY };
}

describe.skipIf(!have)('the contact points in moves.json match the weapon tips on Mark’s drawings', () => {
  const rIdle = have ? idleOf('rook') : [];
  const kIdle = have ? idleOf('kit') : [];
  const rook = have
    ? buildStrikeSet(rIdle, footAnchor(rIdle), { s1: dropStrays(readPng(`${DIR}/rook-battle-strike1.png`)), s2: dropStrays(readPng(`${DIR}/rook-battle-strike2.png`)), crouch: dropStrays(readPng(`${DIR}/rook-battle-crouched.png`)) })
    : null;
  const kit = have
    ? buildKitSet(kIdle, footAnchor(kIdle), {
        run: dropStrays(readPng(`${DIR}/kit-battle-running.png`)),
        load: dropStrays(readPng(`${DIR}/kit-battle-punch1.png`)),
        jab: dropStrays(readPng(`${DIR}/kit-battle-punch2.png`)),
        cross: dropStrays(readPng(`${DIR}/kit-battle-punch3.png`)),
        kick: dropStrays(readPng(`${DIR}/kit-battle-kick.png`)),
        low: dropStrays(readPng(`${DIR}/kit-battle-crouched.png`)),
      })
    : null;

  for (const id of ['rook-strike', 'kit-punch', 'kit-punch-low']) {
    it(`${id}: every hit's contact is within a few pixels of a tip on its frame or the one held after it`, () => {
      const move = file.moves[id];
      if (!move || !rook || !kit) throw new Error('missing');
      move.frames.forEach((f, i) => {
        for (const e of f.events ?? []) {
          if (e.type !== 'hit' || !e.contact) continue;
          // The hit frame and the next two (the held pictures): the blow's tip is on one of them. A frame's own offset moves the picture.
          const candidates = move.frames.slice(i, i + 3).map((g) => {
            const def = file.stills[g.still];
            if (!def) throw new Error(`still ${g.still}`);
            const t = tip(def.art === 'sf-rook' ? rook : kit, def.key);
            const off = g.offset ?? [0, 0];
            return { dx: t.dx + off[0], dy: t.dy + off[1] };
          });
          const near = candidates.some((c) => Math.abs(c.dx - e.contact!.dx) <= 2.5 && Math.abs(c.dy - e.contact!.dy) <= 4.5);
          expect(near, `${id} frame ${i + 1}: contact ${JSON.stringify(e.contact)} vs tips ${JSON.stringify(candidates)}`).toBe(true);
        }
      });
    });
  }
});
