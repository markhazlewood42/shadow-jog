/**
 * The tests of the field parity harness (M5), written as functions (the bodies of the tests) so that four spec files can share them: `e2e/sje-field-parity-a.spec.ts`
 * to `-d.spec.ts` (CI runs them in different shards, because the whole set took about 10 minutes alone). The `test(...)` calls stay in the spec
 * files, because Playwright names a test by the file that calls `test()`. Together the four files hold exactly the tests of the old single file `sje-field-parity.spec.ts`:
 * the inputs check, one test for each of the 31 states, and the 6 controls. Method and tiers: see the header of the spec files and `docs/engine/m5-brief.md`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, expect, test } from '@playwright/test';
import { encodePng } from '../scripts/lib/png.mjs';
import { CASES, type Case, DEFAULT_FRAME, DIR, INPUTS, pinOf, readRef, rendererKind, ROOT, shoot } from './sjefieldkit';
import { describeMeasure, describeStrict, measure, outsideBounds, type Picture, rendererMask, type RendererKind, strictCompare, withStep } from './sjefieldparity';

const SHOTS = process.env.SJEFIELD_SHOTS;
const STRICT = process.env.SJEFIELD_STRICT === '1';

/** The renderer mask of every state, one per case: where its `gpu` and `soft` references differ. */
function maskOf(id: string): Uint8Array {
  const gpu = readRef('gpu', id);
  const soft = readRef('soft', id);
  // A state the old path cannot draw on software GL (the full effect stack) has a `gpu` reference only: no second renderer to tell which pixels depend on the renderer, so no pixel is excused.
  if (gpu && !soft && CASES.find((c) => c.id === id)?.kinds?.join() === 'gpu') return new Uint8Array(gpu.w * gpu.h);
  if (!gpu || !soft) throw new Error(`the references of ${id} are missing (the old field is gone: check out the commit before M6 and run M5_REFS=1 npx playwright test e2e/sje-field-refs.spec.ts, once with CI=1, once without)`);
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

/** The slices of CASES that parts A, B and C run (part D runs the controls). Each spec file takes `CASES.slice(...PART_SLICES[n])`; `inputsBody` checks that they are contiguous and the last is open-ended, so no state is dropped or run twice. */
export const PART_SLICES: ReadonlyArray<readonly [number, number?]> = [[0, 8], [8, 15], [15]];

/** The inputs check: every pinned input, and every map of the game has a state (always over ALL the cases, not a part). */
export function inputsBody(): void {
  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { inputs: Record<string, string> };
  const changed = INPUTS.filter((f) => manifest.inputs[f] !== pinOf(f));
  expect(changed, `these map files changed since the references were made: make the references again (the old field is gone: check out the commit before M6 and run M5_REFS=1 npx playwright test e2e/sje-field-refs.spec.ts, once with CI=1 and once without)\n  ${changed.join('\n  ')}`).toEqual([]);
  const ids = readdirSync(join(ROOT, 'src', 'data', 'maps'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
  expect(ids).toHaveLength(15);
  expect([...new Set(CASES.map((c) => c.map))].sort()).toEqual(ids);
  expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  // The slices of the part files: start at 0, each starts where the one before ends, the last has no end.
  const edges = PART_SLICES.map(([start, end], i) => `${i}:${start}-${end ?? 'end'}`);
  expect(PART_SLICES[0]?.[0], `the first slice starts at 0 (${edges.join(' ')})`).toBe(0);
  PART_SLICES.forEach(([, end], i) => {
    const next = PART_SLICES[i + 1];
    if (next) expect(end, `slice ${i} ends where slice ${i + 1} starts (${edges.join(' ')})`).toBe(next[0]);
    else expect(end, 'the last slice is open-ended').toBeUndefined();
  });
  expect(PART_SLICES[PART_SLICES.length - 1]?.[0] ?? Infinity, 'the last slice starts inside CASES').toBeLessThan(CASES.length);
}

let kindOfBrowser: Promise<RendererKind> | undefined;
/** The renderer kind of this worker's browser, probed once. */
function browserKind(browser: Browser): Promise<RendererKind> {
  if (!kindOfBrowser) {
    const probing = (async () => {
      const probe = await browser.newPage();
      try {
        return await rendererKind(probe);
      } finally {
        await probe.close();
      }
    })();
    kindOfBrowser = probing;
    // A failed probe must not stay cached for ever: clear it so the next call probes again. The current call still rethrows (it awaits the same promise).
    probing.catch(() => {
      if (kindOfBrowser === probing) kindOfBrowser = undefined;
    });
  }
  return kindOfBrowser;
}

/** One state: the new field against the reference of its kind. */
export async function stateBody(browser: Browser, c: Case): Promise<void> {
  // A state with a `kinds` list is skipped BEFORE the render when this renderer is not on the list. Rendering first cost about 60 s for each skipped GPU-only state on CI
  // (the full effect stack on SwiftShader), so six skips took 6 minutes of the shard for no check. The kind comes from the browser (the GL backend is a launch setting, the same
  // for every page and context of it, so a bare page tells the same kind as the page `shoot()` makes), and it is probed once for each worker.
  if (c.kinds) {
    const probed = await browserKind(browser);
    test.skip(!c.kinds.includes(probed), `${c.id} has no ${probed} reference: the old path cannot draw it on this kind of renderer`);
  }
  const s = await shoot(browser, c);
  try {
    const kind: RendererKind = await rendererKind(s.page.page);
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
}

/** The control cases: each one must FAIL the measured bounds. */
export const CONTROL_IDS = ['lantern_row', 'bar'];

function base(id: string): Case {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
}

export async function stepControl(browser: Browser, id: string): Promise<void> {
  const s = await shoot(browser, base(id));
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
}

export async function nudgeControl(browser: Browser, id: string): Promise<void> {
  const s = await shoot(browser, base(id), { nudge: { px: 1, py: 0 } });
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
}

export async function lightControl(browser: Browser, id: string): Promise<void> {
  const s = await shoot(browser, base(id), { lightScale: 1.1 });
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
}
