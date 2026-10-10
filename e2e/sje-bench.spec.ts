/// <reference types="node" />
/**
 * The M1 bench: the real game on the new engine, loaded with 1,000 objects (docs/engine/m1-brief.md task 15, pass line 10).
 *
 * LOCAL ONLY, like e2e/perf.spec.ts: run it with `npx playwright test e2e/sje-bench.spec.ts --project=chromium` on a machine with a real GPU.
 * CI does not run it: a software renderer says nothing about GPU timing (Mark, 2026-10-09). On software GL (SwiftShader) it still RUNS and proves
 * that the measuring works, but only the stuck-loop rule of the speed line applies, and the numbers it prints are labeled SOFTWARE. Those are not
 * GPU numbers. The GPU line of pass line 10 needs a run on Mark's machine.
 *
 * What it measures, in one page (`/?engine=sje`), with the game's own loop stopped and the test driving ticks and draws frame by frame:
 *   A  the title alone, effects off (`?fx=none`): one legacy canvas (`CanvasImage`, 921,600 bytes) uploaded each frame.
 *   B  two drawn legacy scenes (a transparent probe over the title): two canvases uploaded. A third is the line the design worries about.
 *   C  A plus 1,000 `ImageObject`s moved by the wrapper (x and y setters, with the pixel snap) every tick.
 *   D  A plus the same 1,000 sprites moved on the raw Pixi node (`position.set`): the wrapper's cost is C minus D.
 * For each: the frame interval p95 (requestAnimationFrame to requestAnimationFrame), the JavaScript work (tick + draw), the cost with the wait for
 * the GPU (a one-pixel read-back through GlHandoff, which cannot return before every earlier command ran), draw calls, framebuffer binds, canvas
 * uploads and their bytes per frame. The speed line is the one of e2e/sjelabkit.ts (`speedLineMisses`).
 *
 * Controls: the upload counter must see three canvases when there are three (so it can fail), the wrapper-cost reading must be above zero
 * only when objects move (a run with no objects reads about zero), and the speed line's rules have teeth (pure check).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installGlCounters, openGame, sj, waitTop } from './sjegamekit';
import { bareIntervals, isSoftwareName, percentile, SPEED_LINE, speedLineMisses } from './sjelabkit';

const OUT = 'test-results/m1-shell';
mkdirSync(OUT, { recursive: true });

const OBJECTS = 1000;
const FRAMES = 300;
const WARMUP = 90;

/**
 * The measuring loop, shared by the two tests. It runs INSIDE the page (its source text is sent over and evaluated there), so it uses nothing from this module.
 * `game` is the running game, `gl` the counters of `installGlCounters`.
 */
// biome-ignore lint/suspicious/noExplicitAny: it runs in the page, on the game's own objects, typed by the game and not by this spec.
function benchKit(game: any, gl: { draws: number; binds: number; uploads: number; uploadBytes: number }, frames: number, warmup: number) {
  const pct = (xs: number[], q: number): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  };
  const readBack = (): void => void game.renderer.handoff.readDefaultFramebuffer(0, 0, 1, 1);

  /** Drive `n` animation frames: `each(i)` runs inside the tick (the part a game's update would do), then tick + draw (+ GPU wait). */
  const drive = (n: number, each: (i: number) => void, sync: boolean) =>
    new Promise<{ intervals: number[]; work: number[]; cost: number[]; counts: typeof gl }>((resolve) => {
      const intervals: number[] = [];
      const work: number[] = [];
      const cost: number[] = [];
      let last = performance.now();
      let i = 0;
      gl.draws = gl.binds = gl.uploads = gl.uploadBytes = 0;
      const frame = (now: number): void => {
        intervals.push(now - last);
        last = now;
        const t0 = performance.now();
        each(i);
        game.advanceTick();
        game.draw(0);
        const t1 = performance.now();
        work.push(t1 - t0);
        if (sync) {
          readBack();
          cost.push(performance.now() - t0);
        }
        if (++i < n) requestAnimationFrame(frame);
        else resolve({ intervals, work, cost, counts: { ...gl } });
      };
      requestAnimationFrame(frame);
    });

  const measure = async (each: (i: number) => void) => {
    await drive(warmup, each, false);
    // Two passes, so the GPU wait does not disturb the interval: the interval and the counts from one, the cost from the other.
    const a = await drive(frames, each, false);
    const b = await drive(frames, each, true);
    return {
      frames,
      intervalP50: pct(a.intervals.slice(2), 0.5),
      intervalP95: pct(a.intervals.slice(2), 0.95),
      workP50: pct(a.work, 0.5),
      workP95: pct(a.work, 0.95),
      costP50: pct(b.cost, 0.5),
      costP95: pct(b.cost, 0.95),
      drawsPerFrame: a.counts.draws / frames,
      bindsPerFrame: a.counts.binds / frames,
      uploadsPerFrame: a.counts.uploads / frames,
      uploadBytesPerFrame: a.counts.uploadBytes / frames,
    };
  };
  return { pct, measure };
}

interface Scenario {
  frames: number;
  /** ms between animation frames */
  intervalP50: number;
  intervalP95: number;
  /** JavaScript ms of tick + draw (submit only) */
  workP50: number;
  workP95: number;
  /** ms of tick + draw + the wait for the GPU */
  costP50: number;
  costP95: number;
  drawsPerFrame: number;
  bindsPerFrame: number;
  uploadsPerFrame: number;
  uploadBytesPerFrame: number;
}

test.describe('M1 bench (local only, real GPU)', () => {
  test('the speed line has teeth: the rules fail when they should (pure check)', () => {
    const base = { bareP95: 17, sceneP95: 17, costP95: 3, software: false };
    expect(speedLineMisses(base)).toEqual([]);
    expect(speedLineMisses({ ...base, costP95: SPEED_LINE.costMs + 0.1 })).toHaveLength(1);
    expect(speedLineMisses({ ...base, sceneP95: 17 * SPEED_LINE.intervalRatio + 0.1 })).toHaveLength(1);
    expect(speedLineMisses({ ...base, software: true, sceneP95: SPEED_LINE.softwareStuckMs })).toHaveLength(1);
  });

  test(`the real game with ${OBJECTS} objects: wrapper cost, canvas uploads, draw calls, binds, the speed line`, async ({ browser }) => {
    test.setTimeout(240_000);
    const g = await openGame(browser, { engine: true, init: installGlCounters, query: '&fx=none' });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await page.waitForTimeout(800);
      const renderer = await sj<string>(page, 'sj.renderer.name');
      const software = isSoftwareName(renderer);
      // The M1 premise (one canvas per drawn legacy scene) holds only with the effects off: at `full` the title also uploads the UI canvas (and the glow canvas).
      expect(await sj<string>(page, 'sj.fxCounts().level'), 'these scenarios run with the effects off').toBe('none');
      // The game's own loop stops. The page then drives tick + draw one animation frame at a time, and keeps the numbers.
      await sj(page, '(sj.game.stop(), true)');

      const out = await page.evaluate(
        async ({ objects, frames, warmup, kitSrc }) => {
          // biome-ignore lint/suspicious/noExplicitAny: the page's own hook object, typed by the game, not by this spec.
          const sj = (window as unknown as { __SJ__: Record<string, any> }).__SJ__;
          const game = sj.game;
          const gl = (window as unknown as { __gl: { draws: number; binds: number; uploads: number; uploadBytes: number } }).__gl;
          // The dev server's own modules (the same instances the game runs). The names are variables so TypeScript does not look for the files.
          const imageObjectUrl = '/src/sje/display/imageobject.ts';
          const oldGameUrl = '/src/engine/game.ts';
          const { ImageObject } = await import(/* @vite-ignore */ imageObjectUrl);
          const { Scene } = await import(/* @vite-ignore */ oldGameUrl);
          // The shared measuring loop (see benchKit): evaluated here so it runs in the page.
          const { pct, measure } = new Function(`return (${kitSrc})`)()(game, gl, frames, warmup);
          const none = () => undefined;
          const result: Record<string, unknown> = {};

          // A: the title alone.
          result.A = await measure(none);

          // B: a transparent probe scene over the title: two legacy canvases are drawn. C3 (control): a third.
          class Probe extends Scene {
            constructor() {
              super();
              this.opaque = false;
            }
            update(): void {}
            render(ctx: CanvasRenderingContext2D): void {
              ctx.fillStyle = 'rgba(40, 90, 160, 0.4)';
              ctx.fillRect(8, 8, 60, 30);
            }
          }
          const probe1 = new Probe();
          void game.run(probe1);
          result.B = await measure(none);
          const probe2 = new Probe();
          void game.run(probe2);
          result.B3 = await measure(none);
          probe2.close(undefined);
          probe1.close(undefined);
          game.step(2);

          // C and D: 1,000 objects on the overlay root, moved every tick.
          const made = game.textures.createCanvas('bench-dot', 8, 8);
          made.ctx.fillStyle = '#ff2080';
          made.ctx.fillRect(0, 0, 8, 8);
          made.refresh();
          const objs = Array.from({ length: objects }, (_, i) => {
            const o = new ImageObject(game, (i * 7) % 600, (i * 11) % 340, 'bench-dot');
            o.setOrigin(0, 0);
            game.screen.overlayRoot.add(o);
            return o;
          });
          const wrapper = (i: number): void => {
            for (let n = 0; n < objs.length; n++) {
              const o = objs[n];
              o.x = ((n * 7 + i) % 600) + 0.3;
              o.y = ((n * 11 + i) % 340) + 0.3;
            }
          };
          const raw = (i: number): void => {
            for (let n = 0; n < objs.length; n++) {
              const o = objs[n]._pixi;
              o.position.set(Math.round(((n * 7 + i) % 600) + 0.3), Math.round(((n * 11 + i) % 340) + 0.3));
            }
          };
          // Control for the objects: they really draw (pink pixels of their color appear in the back buffer).
          const pink = (): number => {
            const px = sj.pixels();
            let n = 0;
            for (let i = 0; i < px.data.length; i += 4) if (px.data[i] === 255 && px.data[i + 1] === 32 && px.data[i + 2] === 128) n++;
            return n;
          };
          game.draw(0);
          result.pinkWith = pink();
          result.C = await measure(wrapper);
          result.D = await measure(raw);

          // The wrapper's own cost per frame (JavaScript only, the part of the tick that moves the objects). The browser's clock reads in steps of
          // 0.1 ms, which is coarse for one pass, so each sample times 20 passes and divides.
          const time = (fn: (i: number) => void): number[] => {
            const out: number[] = [];
            for (let i = 0; i < 300; i++) {
              const t = performance.now();
              for (let rep = 0; rep < 20; rep++) fn(i + rep);
              out.push((performance.now() - t) / 20);
            }
            return out;
          };
          time(wrapper);
          time(raw);
          const w = time(wrapper);
          const r = time(raw);
          const idle = time(none);
          result.move = { wrapperP50: pct(w, 0.5), wrapperP95: pct(w, 0.95), rawP50: pct(r, 0.5), rawP95: pct(r, 0.95), idleP50: pct(idle, 0.5) };
          result.textures = sj.glCounts().texture;
          for (const o of objs) o.destroy();
          game.draw(0);
          result.pinkWithout = pink();
          return result;
        },
        { objects: OBJECTS, frames: FRAMES, warmup: WARMUP, kitSrc: benchKit.toString() },
      );

      const s = out as unknown as { A: Scenario; B: Scenario; B3: Scenario; C: Scenario; D: Scenario; move: { wrapperP50: number; wrapperP95: number; rawP50: number; rawP95: number; idleP50: number }; textures: number; pinkWith: number; pinkWithout: number };
      const bare = await bareIntervals(browser, FRAMES);
      const bareP95 = percentile(bare, 0.95);
      const label = software ? `SOFTWARE GL (${renderer}): NOT GPU numbers` : `GPU (${renderer})`;
      const fmt = (x: Scenario) =>
        `interval p95 ${x.intervalP95.toFixed(2)} ms, work p50/p95 ${x.workP50.toFixed(2)}/${x.workP95.toFixed(2)} ms, cost p50/p95 ${x.costP50.toFixed(2)}/${x.costP95.toFixed(2)} ms, ` +
        `${x.drawsPerFrame.toFixed(1)} draws, ${x.bindsPerFrame.toFixed(1)} binds, ${x.uploadsPerFrame.toFixed(2)} uploads (${Math.round(x.uploadBytesPerFrame)} bytes) per frame`;
      const lines = [
        `SJE bench [${label}], bare rAF page p95 ${bareP95.toFixed(2)} ms`,
        `  A title alone (1 canvas): ${fmt(s.A)}`,
        `  B two legacy canvases:    ${fmt(s.B)}`,
        `  B3 three canvases (control): ${fmt(s.B3)}`,
        `  C ${OBJECTS} objects, wrapper: ${fmt(s.C)}`,
        `  D ${OBJECTS} objects, raw Pixi: ${fmt(s.D)}`,
        `  moving ${OBJECTS} objects, JS only: wrapper p50/p95 ${s.move.wrapperP50.toFixed(3)}/${s.move.wrapperP95.toFixed(3)} ms, raw p50/p95 ${s.move.rawP50.toFixed(3)}/${s.move.rawP95.toFixed(3)} ms, empty loop p50 ${s.move.idleP50.toFixed(4)} ms`,
        `  wrapper overhead p95 per frame: ${(s.move.wrapperP95 - s.move.rawP95).toFixed(3)} ms (line: under 1 ms); textures alive ${s.textures}`,
      ];
      console.log(lines.join('\n'));
      writeFileSync(`${OUT}/bench.json`, JSON.stringify({ label, renderer, software, bareP95, ...s }, null, 2));

      // The upload counter: one canvas per drawn legacy scene, exactly. The third canvas (control) is seen too.
      const canvasBytes = 640 * 360 * 4;
      expect(s.A.uploadsPerFrame).toBeCloseTo(1, 1);
      expect(s.B.uploadsPerFrame).toBeCloseTo(2, 1);
      expect(s.B.uploadBytesPerFrame).toBeCloseTo(2 * canvasBytes, -3);
      expect(s.B3.uploadsPerFrame, 'control: three drawn legacy scenes upload three canvases').toBeCloseTo(3, 1);
      // The objects really draw: their pink is in the picture while they live and (up to the title's own pink) gone after. Control for the whole bench.
      expect(s.pinkWith, 'the 1,000 objects are in the picture').toBeGreaterThan(s.pinkWithout + 500);
      // Control for the wrapper reading: an empty loop costs about nothing, so a reading above it means the objects moved.
      expect(s.move.wrapperP50).toBeGreaterThan(s.move.idleP50);
      // The wrapper's cost: a number to write down. The line is 1 ms per frame (p95 over the raw node).
      expect(s.move.wrapperP95 - s.move.rawP95).toBeLessThan(1);
      // Draw calls stay under the proposed budget with 1,000 objects (they batch).
      expect(s.C.drawsPerFrame).toBeLessThanOrEqual(60);
      expect(s.C.bindsPerFrame).toBeLessThanOrEqual(30);
      // The speed line of pass line 10 (on software only the stuck-loop rule applies; the GPU run is Mark's).
      const misses = speedLineMisses({ bareP95, sceneP95: s.C.intervalP95, costP95: s.C.costP95, software });
      expect(misses, `the speed line (${label})`).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });

  test('the title with the effects on (fx full): uploads are the scene canvas plus the UI canvas (plus glow when used), and the speed line', async ({ browser }) => {
    test.setTimeout(120_000);
    const g = await openGame(browser, { engine: true, init: installGlCounters, query: '&fx=full' });
    try {
      const { page } = g;
      expect(await waitTop(page, 'TitleScene')).toBe(true);
      await page.waitForTimeout(800);
      const renderer = await sj<string>(page, 'sj.renderer.name');
      const software = isSoftwareName(renderer);
      // On a software renderer `full` is still honored because ?fx= forces it (only `auto` falls back to `lite`).
      expect(await sj<string>(page, 'sj.fxCounts().level'), 'the effects run at full').toBe('full');
      await sj(page, '(sj.game.stop(), true)');
      const out = await page.evaluate(
        async ({ frames, warmup, kitSrc }) => {
          // biome-ignore lint/suspicious/noExplicitAny: the page's own hook object, typed by the game, not by this spec.
          const sj = (window as unknown as { __SJ__: Record<string, any> }).__SJ__;
          const game = sj.game;
          const gl = (window as unknown as { __gl: { draws: number; binds: number; uploads: number; uploadBytes: number } }).__gl;
          const { measure } = new Function(`return (${kitSrc})`)()(game, gl, frames, warmup);
          const title = await measure(() => undefined);
          // Which layers the title drew into on its last frame. The fx system clears these flags at the start of the next draw, so read them now.
          game.draw(0);
          return { title, glowUsed: Boolean(game.fx.glowUsed), uiUsed: Boolean(game.fx.uiTouched) };
        },
        { frames: FRAMES, warmup: WARMUP, kitSrc: benchKit.toString() },
      );
      const { title, glowUsed, uiUsed } = out as { title: Scenario; glowUsed: boolean; uiUsed: boolean };
      const bare = await bareIntervals(browser, FRAMES);
      const bareP95 = percentile(bare, 0.95);
      const label = software ? `SOFTWARE GL (${renderer}): NOT GPU numbers` : `GPU (${renderer})`;
      console.log(
        `SJE bench, title with fx full [${label}], bare rAF page p95 ${bareP95.toFixed(2)} ms
` +
          `  interval p95 ${title.intervalP95.toFixed(2)} ms, cost p50/p95 ${title.costP50.toFixed(2)}/${title.costP95.toFixed(2)} ms, ` +
          `${title.drawsPerFrame.toFixed(1)} draws, ${title.bindsPerFrame.toFixed(1)} binds, ${title.uploadsPerFrame.toFixed(2)} uploads (${Math.round(title.uploadBytesPerFrame)} bytes) per frame; ` +
          `glow used ${glowUsed}, UI canvas used ${uiUsed}`,
      );
      writeFileSync(`${OUT}/bench-fx-full.json`, JSON.stringify({ label, renderer, software, bareP95, title, glowUsed, uiUsed }, null, 2));
      // The scene canvas always uploads; the UI canvas when a scene drew into it; the glow canvas only when something glowed this frame.
      const expectedUploads = 1 + (uiUsed ? 1 : 0) + (glowUsed ? 1 : 0);
      expect(title.uploadsPerFrame, `uploads = scene canvas + UI canvas${glowUsed ? ' + glow canvas' : ''}`).toBeCloseTo(expectedUploads, 1);
      expect(title.uploadsPerFrame, 'the effects add canvas uploads over the fx none title (control: this can fail)').toBeGreaterThan(1.5);
      // The speed line (cost p95 at most 8 ms, interval p95 within 5% of a bare page) on a real GPU; on software only the stuck-loop rule.
      const misses = speedLineMisses({ bareP95, sceneP95: title.intervalP95, costP95: title.costP95, software });
      expect(misses, `the speed line (${label})`).toEqual([]);
      expect(g.problems).toEqual([]);
    } finally {
      await g.close();
    }
  });
});
