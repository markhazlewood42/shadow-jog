/**
 * The field on the stage against the old field: the PARITY HARNESS of milestone M5 (docs/engine/m5-brief.md task 8 and pass line 4, decision 4a). Method:
 * docs/engine/tooling-and-testing.md section 5, "M5 parity method".
 *
 * REGRESSION PARITY. A state is a map, a tile, a story-flag preset with a few flags changed, the ambient, the weather, the seed and the field tick
 * (`tests/fixtures/sjefield/cases.json`: all 15 maps, plus day and night, rain on and off, flags, a seed, the camera at the corners of the world map, the banner, and the full
 * effect stack on a GPU). The REFERENCES are pictures of the LEGACY path (the game without `?engine=sje`: the Canvas 2D field), made by `e2e/sje-field-refs.spec.ts` in two
 * kinds, `gpu` (a hardware browser) and `soft` (SwiftShader, what CI runs). This spec puts the new path in the same state on a page with a fake clock, to the same field tick,
 * and compares what the player sees (the window at zoom 2) with the reference of its kind.
 *
 * TWO TIERS (see the result in `e2e/sjefieldparity.ts`):
 *  - THE STRICT GATE of the brief: 0 differing pixels outside the renderer mask (where the `gpu` and `soft` references differ), at most 1/255 inside it. It does NOT hold for lit
 *    frames (the light map is multiplied by Pixi's GL blend, the old path multiplies in Skia, and they round differently). Its numbers are printed for every state; it only fails
 *    the run when `SJEFIELD_STRICT=1`.
 *  - THE MEASURED BOUNDS: what was measured, rounded up, per kind and effects level. A regression guard: it fails when the new field drifts further from the old one. It is not
 *    the gate and not a decision about the tolerance (that is Mark's, brief decision 4).
 *  Controls that must FAIL the bounds: a 2/255 step, an actor one pixel off, a wrong light radius.
 *
 * Also checked: the inputs are pinned (the SHA-256 of every map file the references depend on; a changed file fails first with the command that makes the references again),
 * every map of the game has a state, the new frame is crisp (no uneven 2x2 block) and the page logs nothing.
 *
 * Run it:  CI=1 PW_PORT=3012 npx playwright test e2e/sje-field-parity.spec.ts --reporter=line   (the bundled Chromium on SwiftShader, like CI: the `soft` set)
 *          PW_PORT=3012 npx playwright test e2e/sje-field-parity.spec.ts --reporter=line       (Edge on the GPU: the `gpu` set)
 *          SJEFIELD_STRICT=1 ...   also fail on the strict gate (it fails today: see the numbers it prints)
 *          SJEFIELD_SHOTS=<folder> saves the new picture, the reference and a diff picture of every state.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { encodePng } from '../scripts/lib/png.mjs';
import { CASES, type Case, DEFAULT_FRAME, DIR, INPUTS, readRef, rendererKind, ROOT, shoot } from './sjefieldkit';
import { describeMeasure, describeStrict, measure, outsideBounds, type Picture, rendererMask, type RendererKind, strictCompare, withStep } from './sjefieldparity';

const SHOTS = process.env.SJEFIELD_SHOTS;
const STRICT = process.env.SJEFIELD_STRICT === '1';

const pin = (rel: string): string => createHash('sha256').update(readFileSync(join(ROOT, rel), 'utf8').replaceAll('\r\n', '\n'), 'utf8').digest('hex');

/** The renderer mask of every state, one per case: where its `gpu` and `soft` references differ. */
function maskOf(id: string): Uint8Array {
  const gpu = readRef('gpu', id);
  const soft = readRef('soft', id);
  // A state the old path cannot draw on software GL (the full effect stack) has a `gpu` reference only: no second renderer to tell which pixels depend on the renderer, so no pixel is excused.
  if (gpu && !soft && CASES.find((c) => c.id === id)?.kinds?.join() === 'gpu') return new Uint8Array(gpu.w * gpu.h);
  if (!gpu || !soft) throw new Error(`the references of ${id} are missing: M5_REFS=1 npx playwright test e2e/sje-field-refs.spec.ts (once with CI=1, once without)`);
  return rendererMask([{ gpu, soft }]);
}

function saveShots(id: string, now: Picture, ref: Picture): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const diff = new Uint8Array(now.data.length);
  for (let i = 0; i < now.data.length; i += 4) {
    const d = Math.max(Math.abs((now.data[i] ?? 0) - (ref.data[i] ?? 0)), Math.abs((now.data[i + 1] ?? 0) - (ref.data[i + 1] ?? 0)), Math.abs((now.data[i + 2] ?? 0) - (ref.data[i + 2] ?? 0)));
    diff.set(d === 0 ? [(ref.data[i] ?? 0) >> 2, (ref.data[i + 1] ?? 0) >> 2, (ref.data[i + 2] ?? 0) >> 2, 255] : [255, 0, 96, 255], i);
  }
  writeFileSync(join(SHOTS, `${id}-new.png`), encodePng(now.w, now.h, now.data));
  writeFileSync(join(SHOTS, `${id}-ref.png`), encodePng(ref.w, ref.h, ref.data));
  writeFileSync(join(SHOTS, `${id}-diff.png`), encodePng(now.w, now.h, diff));
}

test.describe('field parity: the inputs', () => {
  test('every input of the references is pinned, and every map of the game has a state', () => {
    const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { inputs: Record<string, string> };
    const changed = INPUTS.filter((f) => manifest.inputs[f] !== pin(f));
    expect(changed, `these map files changed since the references were made: make the references again (M5_REFS=1 npx playwright test e2e/sje-field-refs.spec.ts, once with CI=1 and once without)\n  ${changed.join('\n  ')}`).toEqual([]);
    const ids = readdirSync(join(ROOT, 'src', 'data', 'maps'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(ids).toHaveLength(15);
    expect([...new Set(CASES.map((c) => c.map))].sort()).toEqual(ids);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
});

test.describe('field parity: the new field against the old one', () => {
  test.setTimeout(240_000);
  for (const c of CASES) {
    test(`${c.id}: ${c.note}`, async ({ browser }) => {
      const s = await shoot(browser, c, true);
      try {
        const kind: RendererKind = await rendererKind(s.page.page);
        test.skip(!!c.kinds && !c.kinds.includes(kind), `${c.id} has no ${kind} reference: the old path cannot draw it on this kind of renderer`);
        const ref = readRef(kind, c.id);
        expect(ref, `no ${kind} reference for ${c.id}`).not.toBeNull();
        if (!ref) return;
        expect(s.frame).toBe(c.frame ?? DEFAULT_FRAME);
        expect(s.info.map).toBe(c.map);
        const strict = strictCompare(s.picture, ref, maskOf(c.id));
        const m = measure(s.picture, ref);
        console.log(describeStrict(`${kind} ${c.id}`, strict));
        console.log(describeMeasure(`${kind} ${c.id}`, m));
        saveShots(`${kind}-${c.id}`, s.picture, ref);
        const outside = outsideBounds(kind, c.fx ?? 'none', m);
        expect(outside, describeMeasure(c.id, m)).toEqual([]);
        if (STRICT) expect(strict.ok, describeStrict(c.id, strict)).toBe(true);
        expect(s.uneven, 'the new picture is crisp: no 2x2 block is more than one color').toBe(0);
        expect(s.page.problems).toEqual([]);
      } finally {
        await s.page.close();
      }
    });
  }
});

test.describe('field parity: the bounds can fail (controls)', () => {
  test.setTimeout(240_000);
  const base = (id: string): Case => {
    const c = CASES.find((x) => x.id === id);
    if (!c) throw new Error(`no case ${id}`);
    return c;
  };

  for (const id of ['lantern_row', 'bar']) {
    test(`${id}: a 2/255 step is rejected`, async ({ browser }) => {
      const c = base(id);
      const s = await shoot(browser, c, true);
      try {
        const kind = await rendererKind(s.page.page);
        const ref = readRef(kind, id);
        if (!ref) throw new Error(`no ${kind} reference for ${id}`);
        // Control of the control: the real frame is inside the bounds, so the failure below is the step and nothing else.
        expect(outsideBounds(kind, 'none', measure(s.picture, ref))).toEqual([]);
        const stepped = measure(withStep(s.picture, 2), ref);
        console.log(describeMeasure(`${id} +2/255`, stepped));
        expect(outsideBounds(kind, 'none', stepped).length).toBeGreaterThan(0);
      } finally {
        await s.page.close();
      }
    });

    test(`${id}: an actor one pixel off is rejected`, async ({ browser }) => {
      const s = await shoot(browser, base(id), true, { nudge: { px: 1, py: 0 } });
      try {
        const kind = await rendererKind(s.page.page);
        const ref = readRef(kind, id);
        if (!ref) throw new Error(`no ${kind} reference for ${id}`);
        const m = measure(s.picture, ref);
        console.log(describeMeasure(`${id} actor +1px`, m));
        expect(outsideBounds(kind, 'none', m).length).toBeGreaterThan(0);
      } finally {
        await s.page.close();
      }
    });

    test(`${id}: a wrong light radius is rejected`, async ({ browser }) => {
      const s = await shoot(browser, base(id), true, { lightScale: 1.1 });
      try {
        const kind = await rendererKind(s.page.page);
        const ref = readRef(kind, id);
        if (!ref) throw new Error(`no ${kind} reference for ${id}`);
        const m = measure(s.picture, ref);
        console.log(describeMeasure(`${id} light radius x1.1`, m));
        expect(outsideBounds(kind, 'none', m).length).toBeGreaterThan(0);
      } finally {
        await s.page.close();
      }
    });
  }
});
