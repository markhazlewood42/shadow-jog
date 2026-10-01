/**
 * NPCs on rig v2. Named looks carry `rig` in src/data/looks.ts; this does the rest once the traced
 * frames have loaded: one-off NPCs (whose looks are written inline on their maps, traced as
 * "map:<map>.<id>") and the passers-by, whose random looks take the traced townsfolk ("pool:<n>")
 * in turn.
 */
import { type CharSprite, replaceCharSprite } from '../chars';
import { townsfolkLooks } from '../drawn';
import { getMap } from '../../data/maps';
import { TRACED } from './data';
import { rigSprite } from './rig';

/** Swap the loaded NPCs in. Returns how many were. */
export function applyRigNpcs(): number {
  let n = 0;
  const oneOffs = new Set<string>();
  const pool: CharSprite[] = [];
  for (const [key, traced] of Object.entries(TRACED)) {
    if (key.startsWith('map:')) {
      const id = key.slice(4);
      oneOffs.add(id);
      const [mid = '', nid] = id.split('.');
      const npc = getMap(mid).npcs?.find((x) => x.id === nid);
      if (!npc) continue;
      replaceCharSprite(npc.look, rigSprite(traced));
      n++;
    } else if (key.startsWith('pool:')) pool.push(rigSprite(traced));
  }
  // Passers-by take the townsfolk looks in turn, map by map, so a street shows as many different
  // people as there are looks before any repeats (a hash of each look clumped them).
  if (pool.length)
    townsfolkLooks(oneOffs).forEach((look, i) => {
      const sprite = pool[i % pool.length];
      if (!sprite) return;
      replaceCharSprite(look, sprite);
      n++;
    });
  return n;
}
