/// <reference types="node" />
/**
 * The M2 side-by-side: the old GL presenter against the new `FxSystem`, one moment at a time (docs/engine/m2-brief.md pass line 6).
 *
 * LOCAL ONLY, like e2e/sje-bench.spec.ts and e2e/perf.spec.ts: CI does not run it. Run it with
 * `npx playwright test e2e/sje-fx-compare.spec.ts --project=chromium`. On a real GPU it needs no trick. On software GL (SwiftShader) the old
 * presenter refuses the context by its name, so the OLD page gets an init script that makes `UNMASKED_RENDERER_WEBGL` look like a GPU
 * (docs/engine/m2-survey.md section 3). The new page needs none: `?fx=full` forces the level.
 *
 * For every moment in src/data/fx.json: both pages show the same static probe scene (the one of e2e/sjefxkit.ts), the effects clock is reset, the
 * moment is fired at the screen center, and a screenshot is taken at two fixed ticks (5 and 14 after the hit; 14 shows a delayed layer). Each page
 * also takes a baseline shot at those ticks with no moment. Pictures: media/m2-fx/<moment>.t<tick>.{old,new}.png (git-ignored). The table
 * (media/m2-fx/table.md) lists, per moment and tick: the pixels the moment changed on each path (against that path's baseline), the pixels that
 * differ between the two paths and the largest channel difference, and the distance between the centers of the two changed areas. `old vs new px`
 * also counts the probe's own differences (the old path draws the scaled picture with a smoothing filter), so it never reads 0.
 *
 * A pixel difference is EVIDENCE, not a gate (the look is Mark's decision, E8). The test fails only for a missing effect (the old path changed the
 * picture and the new one did not), an effect in the wrong place (the changed areas are centered more than 120 px apart), or a crash.
 * Control: the same check on a deliberately empty "new" frame (the baseline) must report a missing effect for a moment that the old path shows.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { H, W } from '../src/sje/core/size';
import { type Img, decode, openGame, sj, waitTop } from './sjegamekit';

const OUT = 'media/m2-fx';
const TICKS = [5, 14];
/** A moment that must show on the old path (an explosion of embers): the control uses it. */
const CONTROL_MOMENT = 'spell.fire';
const MAX_CENTER_GAP = 120;
/**
 * Below this many changed screenshot pixels (0.2% of the picture) the old path shows only a faint tail: the last frames of a push or a color split that is
 * under half a pixel. The old shader samples the scene with a linear filter and shows it as a soft fringe; the new composite samples with the nearest filter
 * (the picture stays crisp), so it shows nothing. That is a look difference to show Mark, listed as `faint (old only)`, not a missing effect.
 */
const FAINT = 2000;

const MOMENTS = Object.keys((JSON.parse(readFileSync('src/data/fx.json', 'utf8')) as { moments: Record<string, unknown> }).moments);

/** The probe scene: the one of e2e/sjefxkit.ts, with no helper functions (this spec only needs the picture). */
const PROBE = `(async () => {
  const sj = window.__SJ__;
  const { Scene } = await import('/src/engine/game.ts');
  class Probe extends Scene {
    update() {}
    render(ctx) {
      for (let cy = 0; cy < ${H} / 8; cy++) {
        for (let cx = 0; cx < ${W} / 8; cx++) {
          ctx.fillStyle = 'rgb(' + ((cx * 37 + cy * 91) % 150 + 80) + ',' + ((cx * 53 + cy * 17) % 150 + 80) + ',' + ((cx * 29 + cy * 61) % 150 + 80) + ')';
          ctx.fillRect(cx * 8, cy * 8, 8, 8);
        }
      }
      const ui = sj.postfx.ui;
      if (ui) { ui.fillStyle = '#00ff00'; ui.fillRect(10, 10, 30, 30); }
    }
  }
  sj.game.speed = 0;
  sj.game.run(new Probe());
  return true;
})()`;

type Shot = { name: string; tick: number; png: Buffer };

/** Fire one moment in the page and take the shots. `old` drives the old path (game.tick, the old playMoment); otherwise the new (step, FxSystem.playMoment). */
async function shoot(page: import('@playwright/test').Page, old: boolean, moment: string | null): Promise<Shot[]> {
  const shots: Shot[] = [];
  const reset = `(async () => {
    sj.postfx.clear();
    sj.postfx.time = 0;
    ${moment === null ? '' : old ? `const m = await import('/src/engine/moments.ts'); m.playMoment(sj.fx, ${JSON.stringify(moment)}, ${W / 2}, ${H / 2});` : `sj.game.fx.playMoment(${JSON.stringify(moment)}, ${W / 2}, ${H / 2});`}
    return true;
  })()`;
  await sj(page, reset);
  let at = 0;
  for (const tick of TICKS) {
    const n = tick - at;
    at = tick;
    await sj(
      page,
      old
        ? `(async () => { for (let i = 0; i < ${n}; i++) sj.game.tick(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()`
        : `(sj.step(${n}), true)`,
    );
    shots.push({ name: moment ?? 'baseline', tick, png: await page.screenshot() });
  }
  await sj(page, 'sj.postfx.clear()');
  return shots;
}

interface Change {
  /** Pixels that differ between the two pictures. */
  count: number;
  maxDiff: number;
  /** Center of the changed area, in picture pixels; null when nothing changed. */
  center: { x: number; y: number } | null;
}

function change(a: Img, b: Img): Change {
  let count = 0;
  let maxDiff = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)), Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)), Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)));
    if (d > 0) {
      count++;
      if (d > maxDiff) maxDiff = d;
      const p = i / 4;
      sx += p % a.w;
      sy += Math.floor(p / a.w);
    }
  }
  return { count, maxDiff, center: count ? { x: sx / count, y: sy / count } : null };
}

/** Is this moment missing on the new path, or in the wrong place? The old path's change against its baseline is the reference. */
function verdict(oldChange: Change, newChange: Change): 'ok' | 'missing' | 'wrong place' | 'faint (old only)' {
  if (oldChange.count === 0) return 'ok'; // the old path shows nothing at this tick: nothing to compare
  if (newChange.count === 0) return oldChange.count < FAINT ? 'faint (old only)' : 'missing';
  if (oldChange.center && newChange.center) {
    const gap = Math.hypot(oldChange.center.x - newChange.center.x, oldChange.center.y - newChange.center.y);
    if (gap > MAX_CENTER_GAP) return 'wrong place';
  }
  return 'ok';
}

test.describe('M2 side by side (local, GPU)', () => {
  test('every moment in fx.json: a picture pair per tick, and a table of changed pixels', async ({ browser }) => {
    test.setTimeout(1_800_000);
    mkdirSync(OUT, { recursive: true });

    // The new path.
    const neu = await openGame(browser, { engine: true, query: '&fx=full' });
    const neuShots = new Map<string, Shot[]>();
    try {
      expect(await waitTop(neu.page, 'TitleScene')).toBe(true);
      await neu.page.waitForTimeout(400);
      await sj(neu.page, PROBE);
      expect(await sj<boolean>(neu.page, 'sj.fxCounts().active')).toBe(true);
      neuShots.set('baseline', await shoot(neu.page, false, null));
      for (const m of MOMENTS) neuShots.set(m, await shoot(neu.page, false, m));
      expect(neu.problems).toEqual([]);
    } finally {
      await neu.close();
    }

    // The old path, with the renderer name spoofed so the presenter accepts software GL (the survey, section 3).
    const old = await openGame(browser, {
      engine: false,
      init: () => {
        const orig = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (this: WebGL2RenderingContext, p: number) {
          return p === 0x9246 ? 'ANGLE (NVIDIA, Fake GPU)' : orig.call(this, p);
        } as typeof orig;
      },
    });
    const oldShots = new Map<string, Shot[]>();
    try {
      expect(await waitTop(old.page, 'TitleScene')).toBe(true);
      await old.page.waitForTimeout(700);
      expect(await sj<boolean>(old.page, 'sj.postfx.active'), 'the old presenter is live').toBe(true);
      await sj(old.page, PROBE);
      oldShots.set('baseline', await shoot(old.page, true, null));
      for (const m of MOMENTS) oldShots.set(m, await shoot(old.page, true, m));
      expect(old.problems).toEqual([]);
    } finally {
      await old.close();
    }

    // The pictures and the table.
    const rows: string[] = ['| moment | tick | old changed | new changed | old vs new px | max channel diff | center gap px | verdict |', '|---|---|---|---|---|---|---|---|'];
    const failures: string[] = [];
    const baseOld = oldShots.get('baseline') ?? [];
    const baseNew = neuShots.get('baseline') ?? [];
    let controlSeen = false;
    for (const m of MOMENTS) {
      for (let k = 0; k < TICKS.length; k++) {
        const tick = TICKS[k] as number;
        const o = oldShots.get(m)?.[k];
        const n = neuShots.get(m)?.[k];
        const bo = baseOld[k];
        const bn = baseNew[k];
        if (!o || !n || !bo || !bn) throw new Error(`missing shot for ${m} at ${tick}`);
        writeFileSync(`${OUT}/${m}.t${tick}.old.png`, o.png);
        writeFileSync(`${OUT}/${m}.t${tick}.new.png`, n.png);
        const [io, inew, ibo, ibn] = [decode(o.png), decode(n.png), decode(bo.png), decode(bn.png)];
        const oldChange = change(ibo, io);
        const newChange = change(ibn, inew);
        const between = change(io, inew);
        const v = verdict(oldChange, newChange);
        if (v === 'missing' || v === 'wrong place') failures.push(`${m} at tick ${tick}: ${v}`);
        // Control: the new frame replaced by its own baseline is a missing effect for a moment that the old path shows.
        if (m === CONTROL_MOMENT && oldChange.count > 0) {
          controlSeen = true;
          expect(verdict(oldChange, change(ibn, ibn)), 'control: an empty new frame is a missing effect').toBe('missing');
        }
        const gap = oldChange.center && newChange.center ? Math.hypot(oldChange.center.x - newChange.center.x, oldChange.center.y - newChange.center.y).toFixed(0) : '-';
        rows.push(`| ${m} | ${tick} | ${oldChange.count} | ${newChange.count} | ${between.count} | ${between.maxDiff} | ${gap} | ${v} |`);
      }
    }
    writeFileSync(`${OUT}/table.md`, `# M2 side by side\n\nOld presenter against FxSystem, ${W}x${H} probe scene at 1280x720. A pixel difference is evidence, not a gate.\n\n${rows.join('\n')}\n`);
    console.log(`SJE fx compare: ${MOMENTS.length} moments, ${MOMENTS.length * TICKS.length} picture pairs and the table in ${OUT}/`);
    expect(controlSeen, `the control moment ${CONTROL_MOMENT} shows on the old path`).toBe(true);
    expect(failures, 'moments missing or in the wrong place on the new path').toEqual([]);
  });
});
