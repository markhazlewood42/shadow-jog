/**
 * M2 "Effects": the screen effects of the new engine, drawn and read back in a browser (docs/engine/m2-brief.md pass lines 3, 4, 5 and 16).
 * Runs in CI on the bundled Chromium with SwiftShader (software GL), with the level forced: `?fx=full`.
 *
 * The picture under test is a probe scene: a static, opaque, colorful checkerboard (so a push, a split or a dim shows), a white "glow" rectangle in the
 * glow layer and a green rectangle in the UI layer. The game loop is frozen (`game.speed = 0`), so a frame changes only when the test asks.
 *
 *  1. Per level (`full`, `lite`, `none`), for each effect: read a frame, turn the effect on through `postfx` (the old name, routed to `game.fx`), run a few
 *     ticks, read the frame again. The pixels inside the expected region change; the pixels in the region that must not move are identical.
 *     `full`: all nine. `lite`: the dim and the particles only (the rest spawn but are not drawn). `none`: nothing (control). A frame compared with
 *     itself changes nothing (control for the comparison).
 *  2. Determinism: two pages that play the same moments to the same tick give the same frame hash. Control: one more tick gives another.
 *  3. `restore(snapshot())` after more ticks gives the frame hash of the snapshot tick again. Control: without the restore the hash is another.
 *  4. No shader is compiled in the frames of a `playMoment`: the live program count after the warm-up equals the count after a run of hits. The first
 *     hit's frame time and the tenth's are recorded. Control: a program made on purpose shows in the count.
 *  5. No mixed block with every effect on, at device pixel ratio 1 and 1.5. Control: read at another ratio, blocks are uneven.
 *  6. 0 GL errors and 0 console warnings across every run above.
 */
import { expect, test } from '@playwright/test';
import { H, W } from '../src/sje/core/size';
import { glErrors, type Level, openProbe } from './sjefxkit';
import { sj } from './sjegamekit';

interface EffectCase {
  name: string;
  pre?: string;
  act: string;
  ticks: number;
  post?: string;
  /** Source of `(x, y) => 'in' | 'out' | undefined` (game pixels). */
  cls: string;
  /** The least pixels that must change inside the region. */
  min: number;
  /** Which levels draw it (the others must change nothing at all). `flash` is drawn at every level: the game's own wash when the composite is off. */
  levels: Level[];
}

const C = `Math.hypot(x - ${W / 2}, y - ${H / 2})`;
const EFFECTS: EffectCase[] = [
  {
    name: 'shockwave',
    act: `sj.postfx.shock(${W / 2}, ${H / 2}, { strength: 6, reach: 90, life: 26, width: 10 })`,
    ticks: 8,
    // At tick 8 the ring is about 47 px out and 9 wide: it moves the band around it, nothing near the center or beyond 105 px.
    cls: `(() => { const d = ${C}; return d > 25 && d < 70 ? 'in' : d > 105 || d < 8 ? 'out' : undefined; })()`,
    min: 300,
    levels: ['full'],
  },
  {
    name: 'color split',
    act: `sj.postfx.aberrate(4, ${W / 2}, ${H / 2})`,
    ticks: 1,
    // Red out, blue in, along the line from the impact: every picture edge moves, and the green channel does not (checked below).
    cls: `'in'`,
    min: 3000,
    levels: ['full'],
  },
  {
    name: 'haze',
    act: `sj.postfx.haze(${W / 2}, ${H / 2}, { radius: 40, strength: 3, life: 60 })`,
    ticks: 20,
    cls: `(() => { const d = ${C}; return d < 38 ? 'in' : d > 46 ? 'out' : undefined; })()`,
    min: 150,
    levels: ['full'],
  },
  {
    name: 'glitch',
    act: `sj.postfx.glitch(${W / 2}, ${H / 2}, { w: 100, h: 60, strength: 12, life: 24 })`,
    ticks: 3,
    cls: `(() => { const dx = Math.abs(x - ${W / 2}), dy = Math.abs(y - ${H / 2}); return dx < 48 && dy < 28 ? 'in' : dx > 52 || dy > 32 ? 'out' : undefined; })()`,
    min: 300,
    levels: ['full'],
  },
  {
    name: 'dim',
    pre: `window.__probe.glow = { x: 100, y: 100, w: 60, h: 60 }`,
    act: `sj.postfx.dim(0.6, 60)`,
    ticks: 15,
    post: `window.__probe.glow = null`,
    // Far from the glowing rectangle the picture darkens. Inside it (what glows) the dim spares it, in the composite.
    cls: `(() => { if (x >= 104 && x < 156 && y >= 104 && y < 156) return sj.game.fx.compositing ? 'out' : undefined; return Math.max(Math.abs(x - 130), Math.abs(y - 130)) > 70 ? 'in' : undefined; })()`,
    min: 100000,
    levels: ['full', 'lite'],
  },
  {
    name: 'flash',
    act: `sj.game.flash('#ff0000', 40)`,
    ticks: 6,
    // Let the wash run out, so it does not fade through the next effect's frames.
    post: `sj.step(45)`,
    // The wash covers the world. With the composite on, the UI layer (the green rectangle) stays as it was.
    cls: `x >= 12 && x < 38 && y >= 12 && y < 38 ? (sj.game.fx.compositing ? 'out' : undefined) : 'in'`,
    min: 100000,
    levels: ['full', 'lite', 'none'],
  },
  {
    name: 'vignette',
    pre: `sj.postfx.vignette = 0`,
    act: `sj.postfx.vignette = 0.6`,
    ticks: 0,
    post: `sj.postfx.vignette = 0.22`,
    cls: `(() => { const d = ${C}; return Math.abs(x - ${W / 2}) > 250 && Math.abs(y - ${H / 2}) > 130 ? 'in' : d < 12 ? 'out' : undefined; })()`,
    min: 1500,
    levels: ['full'],
  },
  {
    name: 'bloom',
    pre: `sj.postfx.bloom = 0; window.__probe.glow = { x: 300, y: 150, w: 40, h: 30 }`,
    act: `sj.postfx.bloom = 1`,
    ticks: 0,
    post: `sj.postfx.bloom = 1; window.__probe.glow = null`,
    // A halo round the lit rectangle; nothing 160 px away from it.
    cls: `(() => { const dx = Math.max(Math.abs(x - 320) - 20, 0), dy = Math.max(Math.abs(y - 165) - 15, 0); const r = Math.hypot(dx, dy); return r > 2 && r < 12 ? 'in' : r > 160 ? 'out' : undefined; })()`,
    min: 150,
    levels: ['full'],
  },
  {
    name: 'particles',
    act: `sj.postfx.emit(sj.fx.presets.crit_sparks, ${W / 2}, ${H / 2})`,
    ticks: 3,
    // Sparks of speed 3 to 6.6 px a tick: in three ticks they are within about 25 px. Their glow reaches further, so the far check starts at 200.
    cls: `(() => { const d = ${C}; return d < 30 ? 'in' : d > 200 ? 'out' : undefined; })()`,
    min: 20,
    levels: ['full', 'lite'],
  },
];

test.describe('the screen effects of the new engine, read from the canvas', () => {
  for (const level of ['full', 'lite', 'none'] as const) {
    test(`level ${level}: each effect changes the pixels it should and leaves the others alone${level === 'none' ? ' (the control: nothing is drawn)' : ''}`, async ({ browser }) => {
      const g = await openProbe(browser, level);
      try {
        const { page } = g;
        // The layers: `none` has no effects layers, no #fx overlay canvas exists on this path at any level.
        expect(await page.evaluate("document.getElementById('fx')")).toBeNull();
        const fxChildren = await sj<number>(page, 'sj.tree().children.find((c) => c.label === "fxRoot").children.length');
        if (level === 'none') expect(fxChildren, 'none: nothing in fxRoot').toBe(0);
        else expect(fxChildren, `${level}: the effects layers are in fxRoot`).toBeGreaterThan(0);
        expect(await sj<boolean>(page, 'sj.fxCounts().active')).toBe(level !== 'none');

        const report: string[] = [];
        for (const e of EFFECTS) {
          const r = await page.evaluate(
            ([pre, act, ticks, post, cls]) => (window as unknown as { __t: { run(...a: unknown[]): Record<string, number> } }).__t.run(pre, act, ticks, post, cls),
            [e.pre ?? '', e.act, e.ticks, e.post ?? '', e.cls] as const,
          );
          report.push(`${e.name}: in ${r.inChanged}/${r.inTotal}, out ${r.outChanged}/${r.outTotal}, green ${r.green}`);
          expect(r.selfAny, `${e.name}: a frame compared with itself changes nothing (control for the comparison)`).toBe(0);
          if (e.levels.includes(level)) {
            expect(r.inChanged, `${level} ${e.name}: pixels that change inside its region`).toBeGreaterThanOrEqual(e.min);
            expect(r.outChanged, `${level} ${e.name}: pixels that change where it must not`).toBe(0);
            if (e.name === 'color split') expect(r.green, 'the green channel does not move').toBe(0);
          } else {
            expect(r.any, `${level} ${e.name}: not drawn at this level, so the frame is the same`).toBe(0);
          }
        }
        console.log(`SJE fx, level ${level}: ${report.join(' | ')}`);
        expect(await glErrors(page), 'GL errors').toEqual([]);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }

  test('the same moments to the same tick give the same frame hash in two runs; one more tick gives another (control)', async ({ browser }) => {
    const play = async (extraTick: number): Promise<string> => {
      const g = await openProbe(browser, 'full');
      try {
        const { page } = g;
        const hash = await sj<string>(
          page,
          `(() => {
            const fx = sj.game.fx;
            fx.clear();
            fx.time = 0;
            window.__probe.glow = { x: 200, y: 120, w: 50, h: 40 };
            fx.playMoment('spell.fire', 200, 140);
            fx.playMoment('spell.code', 400, 200);
            sj.step(12 + ${extraTick});
            return sj.frameHash();
          })()`,
        );
        expect(await glErrors(page), 'GL errors').toEqual([]);
        expect(g.problems).toEqual([]);
        return hash;
      } finally {
        await g.close();
      }
    };
    const a = await play(0);
    const b = await play(0);
    expect(b, 'the same run twice').toBe(a);
    expect(await play(1), 'control: one more tick is another frame').not.toBe(a);
  });

  test('restore(snapshot()) after more ticks draws the frame of the snapshot tick again; without the restore it is another frame (control)', async ({ browser }) => {
    const g = await openProbe(browser, 'full');
    try {
      const { page } = g;
      const out = await sj<{ at4: string; at10: string; restored: string; json: boolean }>(
        page,
        `(() => {
          const fx = sj.game.fx;
          fx.clear();
          fx.playMoment('spell.fire', 200, 140);
          fx.playMoment('spell.code', 400, 200);
          fx.aberrate(3, 100, 100);
          sj.step(4);
          const at4 = sj.frameHash();
          const snap = fx.snapshot();
          const json = JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap);
          sj.step(6);
          const at10 = sj.frameHash();
          fx.restore(snap);
          sj.step(0);
          return { at4, at10, restored: sj.frameHash(), json };
        })()`,
      );
      expect(out.json, 'the snapshot is plain JSON').toBe(true);
      expect(out.at10, 'control: six more ticks is another frame').not.toBe(out.at4);
      expect(out.restored, 'restore gives the frame of the snapshot tick').toBe(out.at4);
      expect(await glErrors(page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('no shader compiles in the frames of a playMoment (the warm-up did it); the first hit and the tenth are timed; a program made on purpose is counted (control)', async ({ browser }) => {
    const g = await openProbe(browser, 'full');
    try {
      const { page } = g;
      const out = await sj<{ before: number; after: number; times: number[]; control: number }>(
        page,
        `(() => {
          const fx = sj.game.fx;
          sj.step(3);
          const before = sj.glCounts().program;
          const times = [];
          const names = sj.fxMoments();
          for (let i = 0; i < 10; i++) {
            fx.clear();
            fx.playMoment(names[(i * 7) % names.length], 320, 180);
            const t0 = performance.now();
            sj.step(1);
            times.push(performance.now() - t0);
            sj.step(5);
          }
          // Every moment of the file once more, so each kind of layer has drawn.
          for (const n of names) { fx.clear(); fx.playMoment(n, 320, 180); sj.step(2); }
          const after = sj.glCounts().program;
          const gl = sj.game.renderer.glc.gl;
          const prog = gl.createProgram();
          const control = sj.glCounts().program;
          gl.deleteProgram(prog);
          return { before, after, times, control };
        })()`,
      );
      console.log(`SJE fx warm-up: programs ${out.before} before the hits, ${out.after} after; frame ms of ten hits: ${out.times.map((t) => t.toFixed(1)).join(', ')} (first ${out.times[0]?.toFixed(1)}, tenth ${out.times[9]?.toFixed(1)})`);
      expect(out.after, 'no program was made in the frames of the hits').toBe(out.before);
      expect(out.control, 'control: a program made on purpose shows in the count').toBe(out.after + 1);
      expect(await glErrors(page)).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  for (const dpr of [1, 1.5]) {
    test(`device pixel ratio ${dpr}: with every effect on the canvas has no uneven block; read at another ratio it does (control)`, async ({ browser }) => {
      const g = await openProbe(browser, 'full', { dpr });
      try {
        const { page } = g;
        await sj(
          page,
          `(() => {
            const fx = sj.game.fx;
            fx.clear();
            window.__probe.glow = { x: 300, y: 150, w: 40, h: 30 };
            sj.postfx.shock(200, 120, { strength: 6, reach: 90, life: 60, width: 10 });
            sj.postfx.shock(420, 220, { strength: 6, reach: 90, life: 60, width: 10 });
            sj.postfx.aberrate(4, 320, 180);
            sj.postfx.haze(320, 180, { radius: 60, strength: 3, life: 80 });
            sj.postfx.glitch(120, 250, { w: 100, h: 60, strength: 12, life: 60 });
            sj.postfx.dim(0.4, 80);
            sj.game.flash('#ff8800', 80);
            sj.postfx.emit(sj.fx.presets.crit_sparks, 320, 180);
            sj.postfx.flare(0.5);
            sj.step(10);
            return fx.counts();
          })()`,
        );
        const counts = await sj<{ shocks: number; hazes: number; glitches: number; particles: number }>(page, 'sj.fxCounts()');
        expect(counts.shocks + counts.hazes + counts.glitches, 'the effects are alive').toBeGreaterThanOrEqual(4);
        expect(counts.particles).toBeGreaterThan(0);
        const r = await page.evaluate('window.__t.blocks(false)') as { bad: number; k: number; blocks: number };
        console.log(`SJE fx blocks, dpr ${dpr}: ${r.blocks} blocks of ${r.k}x${r.k}, uneven ${r.bad}`);
        expect(r.blocks).toBe(W * H);
        expect(r.bad, `dpr ${dpr}: uneven blocks`).toBe(0);
        const wrong = await page.evaluate('window.__t.blocks(true)') as { bad: number };
        expect(wrong.bad, 'control: a wrong ratio finds uneven blocks').toBeGreaterThan(0);
        expect(await glErrors(page)).toEqual([]);
        expect(g.problems).toEqual([]);
      } finally {
        await g.close();
      }
    });
  }
});
