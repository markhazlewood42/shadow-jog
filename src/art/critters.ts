/** Small animal field sprites (4 directions × 3 frames), same contract as character sprites. */
import type { CharSprite, Dir } from './chars';
import { Pix } from './pix';

export type Critter = 'cat' | 'crow';

function catFrame(dir: Dir, f: number): HTMLCanvasElement {
  const p = new Pix(16, 14);
  const fur = '#e8903a', furD = '#b8621e', furL = '#ffc27a';
  const step = f === 0 ? 0 : f === 1 ? 1 : -1;
  if (dir === 'left' || dir === 'right') {
    // Side view facing left; mirrored later for right.
    p.limb([[12, 8], [14, 5], [15, 3]], 1, 0.8, furD);
    p.ball(9, 9, 5, 3, fur);
    p.ball(4, 6, 3.2, 3, fur);
    p.set(2, 3, furD); // one ear (the other lost to a fight)
    p.set(3, 3, fur);
    p.set(3, 6, '#1a1020');
    p.set(1, 7, '#d88a9a');
    for (const [x, o] of [[6, step], [8, -step], [11, step], [13, -step]] as const) p.rect(x, 11 + (o > 0 ? -1 : 0), 1, 2 + (o < 0 ? 0 : 0), furD);
    p.set(7, 8, furL);
  } else {
    const back = dir === 'up';
    p.ball(8, 9, 5, 4, fur);
    p.ball(8, 5, 4, 3.5, fur);
    p.set(5, 2, furD);
    p.set(5, 3, fur);
    if (!back) {
      p.set(6, 5, '#1a1020');
      p.set(10, 5, '#1a1020');
      p.set(8, 7, '#d88a9a');
    } else p.limb([[8, 12], [11, 11], [13, 8]], 1, 0.8, furD);
    p.rect(5 + (step > 0 ? 0 : 0), 12, 1, 2 - (step > 0 ? 1 : 0), furD);
    p.rect(10, 12, 1, 2 - (step < 0 ? 1 : 0), furD);
  }
  p.outline();
  const c = p.toCanvas();
  if (dir === 'right') {
    const m = document.createElement('canvas');
    m.width = c.width;
    m.height = c.height;
    const g = m.getContext('2d')!;
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(c, 0, 0);
    return m;
  }
  return c;
}

const cache = new Map<Critter, CharSprite>();

export function critterSprite(kind: Critter): CharSprite {
  let s = cache.get(kind);
  if (s) return s;
  const frames: Record<Dir, HTMLCanvasElement[]> = { down: [], up: [], left: [], right: [] };
  for (const d of ['down', 'up', 'left', 'right'] as Dir[]) for (let f = 0; f < 3; f++) frames[d].push(catFrame(d, f));
  const w = frames.down[0]!.width, h = frames.down[0]!.height;
  s = { frames, w, h, ax: Math.floor(w / 2), ay: h - 2 };
  cache.set(kind, s);
  return s;
}
