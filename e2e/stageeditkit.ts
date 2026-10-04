/**
 * Shared by the Battle Stage Editor's specs (`e2e/stageedit*.spec.ts`): open the editor on a private scratch copy of
 * the stage files (`?scratch=<name>`, so no test ever touches `src/data/stages.json`), turn game pixels into screen
 * positions, and read the editor's state through its test hook.
 *
 * WHAT THE SCRATCH COPY HOLDS. Mark edits the real files (`src/data/*.json`) in the editor, so a test must not start from
 * them: a number he moved would break any test that expects the old one. `openEditor` therefore SEEDS the scratch copy from the
 * frozen fixture (`tests/fixtures/stagedata/`) before the page loads, and the page reads it back from there. A test that wants
 * Mark's current files (to check an invariant of his data, never a value) passes `{ data: 'current' }`: a scratch copy that was
 * never seeded or saved reads the real files. Rule: `docs/DEVELOPING.md`, "Tests vs design data".
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { HAVE_SPRITES, PRETEND_NO_SPRITES, hideSprites } from './stagelabkit';

/** A scratch name nobody else uses, so parallel or repeated runs never share a copy. */
export function scratchName(tag: string): string {
  return `e2e-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The folder the dev server keeps a scratch copy in (it must match `scratchDir` in `vite.config.ts`). */
const scratchFolder = (name: string): string => join(tmpdir(), 'shadowjog-stageedit', name);

/** Remove a scratch copy from the OS temp folder. */
export function dropScratch(name: string): void {
  rmSync(scratchFolder(name), { recursive: true, force: true });
}

/** The frozen copy of the five stage files that the editor specs start from. */
export const FIXTURE_FOLDER = join(process.cwd(), 'tests', 'fixtures', 'stagedata');
const FIXTURE_FILES = ['stages.json', 'axes.json', 'hud.json', 'enemyfacing.json', 'heroes.json'] as const;

/**
 * Put the fixture files in a scratch copy, unless it already holds files (a test that saves and reloads must find what it
 * saved). Every call after the first for one name does nothing.
 */
export function seedScratch(name: string): void {
  const dir = scratchFolder(name);
  if (existsSync(join(dir, 'stages.json'))) return;
  mkdirSync(dir, { recursive: true });
  for (const f of FIXTURE_FILES) copyFileSync(join(FIXTURE_FOLDER, f), join(dir, f));
}

export interface Opened {
  scratch: string;
  errors: string[];
}

/** The editor window size the specs use: the stage lands at exactly 2x (960x540) between the panels. */
export const EDITOR_VIEWPORT = { width: 1600, height: 900 };

/**
 * Open the editor on a scratch copy; resolves when the scene has drawn. Console and page errors are collected in `errors`.
 * The copy starts from the fixture (`data: 'fixture'`, the default) or from Mark's current files (`data: 'current'`, for invariant checks only).
 */
export async function openEditor(page: Page, scratch: string, query = '', opts: { data?: 'fixture' | 'current' } = {}): Promise<Opened> {
  if ((opts.data ?? 'fixture') === 'fixture') seedScratch(scratch);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (!HAVE_SPRITES && /404/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  if (PRETEND_NO_SPRITES) await hideSprites(page);
  await page.setViewportSize(EDITOR_VIEWPORT);
  await page.goto(`/stageedit.html?scratch=${scratch}${query}`);
  await waitReady(page);
  return { scratch, errors };
}

/** Wait for the editor to be ready (first frame drawn and the panels built), or to have failed. */
export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window.__stagelab?.ready === true && !!window.__stageedit) || !!window.__stagelab?.error, undefined, { timeout: 30_000 });
  const error = await page.evaluate(() => window.__stagelab?.error ?? null);
  if (error) throw new Error(`The editor failed to start: ${error}`);
  await flush(page);
}

/** Let the editor's batched scene update run (it applies changes once per animation frame). */
export async function flush(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** The stage canvas on the screen. */
export async function canvasRect(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate(() => {
    const r = (document.querySelector('#stage canvas') as HTMLCanvasElement).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

/** A point of the 480x270 game screen as a position in the browser window. */
export async function toScreen(page: Page, gx: number, gy: number): Promise<{ x: number; y: number }> {
  const r = await canvasRect(page);
  return { x: r.x + (gx / 480) * r.w, y: r.y + (gy / 270) * r.h };
}

/**
 * A point on a fighter's drawn body, in game pixels (a good place to press the mouse): the solid pixel nearest the
 * middle of its box, found with the scene's own picking, so a click there really picks this fighter.
 */
export async function bodyOf(page: Page, side: 'party' | 'enemy', index: number): Promise<{ x: number; y: number; feetX: number; feetY: number }> {
  return page.evaluate(
    ([s, i]) => {
      const scene = window.__stagelab?.scene();
      if (!scene) throw new Error('no scene');
      const f = scene.fighters.filter((x) => x.side === s)[i as number];
      if (!f) throw new Error(`no ${s} fighter ${i}`);
      const b = scene.boxOf(f);
      const mx = (b.left + b.right) / 2;
      const my = (b.top + f.y) / 2;
      let best: { x: number; y: number } | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (let y = Math.floor(b.top); y <= f.y; y++) {
        for (let x = Math.floor(b.left); x <= b.right; x++) {
          const d = (x - mx) ** 2 + (y - my) ** 2;
          if (d < bestD && scene.pick(x + 0.5, y + 0.5) === f) {
            best = { x: x + 0.5, y: y + 0.5 };
            bestD = d;
          }
        }
      }
      if (!best) throw new Error(`no solid pixel on ${s} fighter ${i}`);
      return { x: best.x, y: best.y, feetX: f.x, feetY: f.y };
    },
    [side, index] as const,
  );
}

/** Press the mouse at one game point and drag to another, in a few steps, then release. */
export async function dragGame(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8): Promise<void> {
  const a = await toScreen(page, from.x, from.y);
  const b = await toScreen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await flush(page);
}

/**
 * Every design-rule warning on every stage, worked out in the page straight from `src/stage/rules.ts` (the same inputs the editor
 * measures: the stages as the editor holds them, the previewed rosters, the scene's real sprite sizes), as the keys the Warnings
 * list uses, `"<stage>[ <enemy count>]: <sentence>"`, sorted. A test compares the editor's chip and list with this, so it never
 * needs a fixed list of expected warnings. A warning is advice: it is never a reason for a test to fail.
 */
export async function ruleKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    // (The addresses are variables so the type checker does not try to resolve them: the dev server serves them to the page.)
    const rulesUrl = '/src/stage/rules.ts';
    const configUrl = '/src/stage/config.ts';
    const { stageWarnings } = await import(/* @vite-ignore */ rulesUrl);
    const { SET_KEYS, resolveStage } = await import(/* @vite-ignore */ configUrl);
    const editor = window.__stageedit;
    const scene = window.__stagelab?.scene();
    if (!editor || !scene) throw new Error('no editor');
    const keys: string[] = [];
    for (const entry of Object.values(editor.session.data.stages)) {
      const cfg = resolveStage(entry, editor.session.data.hud);
      const boxes: Record<string, unknown> = {};
      for (const key of SET_KEYS as string[]) if (cfg.enemySets[key]) boxes[key] = scene.figureBoxesFor(cfg, key, editor.view.roster(cfg, key));
      for (const w of stageWarnings(cfg, boxes) as Array<{ stageId: string; setKey: string | null; text: string }>) keys.push(`${w.stageId}${w.setKey ? ` ${w.setKey}` : ''}: ${w.text}`);
    }
    return keys.sort();
  });
}
