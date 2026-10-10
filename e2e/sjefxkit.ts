/**
 * Shared helpers of the effects specs (e2e/sje-fx.spec.ts, e2e/sje-draws.spec.ts): the probe scene, a pixel comparison that
 * runs inside the page, and a page opener that forces the effects level. See e2e/sje-fx.spec.ts for what the probe is for.
 */
import { expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { H, W } from '../src/sje/core/size';
import { openGame, sj, waitTop } from './sjegamekit';

export type Level = 'full' | 'lite' | 'none';

/** Page-side helpers: the probe scene and the pixel comparison. Installed once per page. */
export const INSTALL = `(async () => {
  const sj = window.__SJ__;
  const { Scene } = await import('/src/engine/game.ts');
  const postfx = sj.postfx; // the routed singleton the game's own scenes use
  const probe = { glow: null, ui: { x: 10, y: 10, w: 30, h: 30 } };
  window.__probe = probe;
  class Probe extends Scene {
    update() {}
    render(ctx) {
      for (let cy = 0; cy < ${H} / 8; cy++) {
        for (let cx = 0; cx < ${W} / 8; cx++) {
          ctx.fillStyle = 'rgb(' + ((cx * 37 + cy * 91) % 150 + 80) + ',' + ((cx * 53 + cy * 17) % 150 + 80) + ',' + ((cx * 29 + cy * 61) % 150 + 80) + ')';
          ctx.fillRect(cx * 8, cy * 8, 8, 8);
        }
      }
      const g = probe.glow && postfx.glowLayer();
      if (g) { g.fillStyle = '#ffffff'; g.fillRect(probe.glow.x, probe.glow.y, probe.glow.w, probe.glow.h); }
      const ui = probe.ui && postfx.ui;
      if (ui) { ui.fillStyle = '#00ff00'; ui.fillRect(probe.ui.x, probe.ui.y, probe.ui.w, probe.ui.h); }
    }
  }
  window.__Probe = Probe;
  sj.game.speed = 0;
  const done = sj.game.run(new Probe());
  window.__probeDone = done;
  sj.step(2);
  const snap = () => sj.pixels().data.slice();
  const t = {
    snap,
    // Compare two frames. cls(x, y) says 'in' (expected to change), 'out' (must not change), or nothing (ignored).
    compare(a, b, clsSrc) {
      const cls = new Function('x', 'y', 'sj', 'return (' + clsSrc + ')');
      const r = { inChanged: 0, inTotal: 0, outChanged: 0, outTotal: 0, green: 0, any: 0 };
      for (let y = 0; y < ${H}; y++) {
        for (let x = 0; x < ${W}; x++) {
          const i = (y * ${W} + x) * 4;
          const rb = a[i] !== b[i] || a[i + 2] !== b[i + 2];
          const g = a[i + 1] !== b[i + 1];
          const ch = rb || g || a[i + 3] !== b[i + 3];
          if (g) r.green++;
          if (ch) r.any++;
          const c = cls(x, y, sj);
          if (c === 'in') { r.inTotal++; if (ch) r.inChanged++; }
          else if (c === 'out') { r.outTotal++; if (ch) r.outChanged++; }
        }
      }
      return r;
    },
    run(pre, act, ticks, post, clsSrc) {
      sj.game.fx.clear();
      new Function('sj', pre)(sj);
      sj.step(0);
      const a = snap();
      const self = t.compare(a, a, clsSrc);
      new Function('sj', act)(sj);
      sj.step(ticks);
      const b = snap();
      const res = t.compare(a, b, clsSrc);
      new Function('sj', post)(sj);
      sj.game.fx.clear();
      sj.step(0);
      return { ...res, selfAny: self.any };
    },
    glErrors() {
      const gl = sj.game.renderer.glc.gl;
      const out = [];
      for (let e = gl.getError(); e !== 0 && out.length < 16; e = gl.getError()) out.push(e);
      return out;
    },
    // The count of k-by-k blocks that are not one flat color in the canvas the player sees (cols x rows of them).
    blocks(wrongRatio) {
      const p = sj.canvasPixels();
      const bin = atob(p.base64);
      const d = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
      const k = wrongRatio ? p.k + 1 : p.k;
      const cols = wrongRatio ? Math.floor(${W} * p.k / k) - 1 : ${W};
      const rows = wrongRatio ? Math.floor(${H} * p.k / k) - 1 : ${H};
      let bad = 0;
      for (let by = 0; by < rows; by++) {
        for (let bx = 0; bx < cols; bx++) {
          const o = ((p.y + by * k) * p.w + (p.x + bx * k)) * 4;
          let flat = true;
          for (let dy = 0; dy < k && flat; dy++) {
            for (let dx = 0; dx < k; dx++) {
              const q = ((p.y + by * k + dy) * p.w + (p.x + bx * k + dx)) * 4;
              if (d[q] !== d[o] || d[q + 1] !== d[o + 1] || d[q + 2] !== d[o + 2]) { flat = false; break; }
            }
          }
          if (!flat) bad++;
        }
      }
      return { bad, k: p.k, blocks: cols * rows };
    },
    uiPixel() {
      const p = sj.pixels({ x: 20, y: 20, w: 1, h: 1 });
      return Array.from(p.data);
    },
  };
  window.__t = t;
  return true;
})()`;

/** Open the game at a forced level, run the probe scene on top of the title, and return the page. */
export async function openProbe(browser: Browser, level: Level, opts: { dpr?: number; init?: () => void } = {}) {
  const g = await openGame(browser, { query: `&fx=${level}`, ...(opts.dpr ? { dpr: opts.dpr } : {}), ...(opts.init ? { init: opts.init } : {}) });
  expect(await waitTop(g.page, 'TitleScene')).toBe(true);
  await g.page.waitForTimeout(400);
  await g.page.evaluate(INSTALL);
  expect(await sj<string>(g.page, 'sj.top()')).toBe('Probe');
  expect(await sj<string>(g.page, 'sj.fxCounts().level')).toBe(level === 'none' ? 'none' : level);
  return g;
}

export const glErrors = (page: Page) => page.evaluate('window.__t.glErrors()') as Promise<number[]>;
