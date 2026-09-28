/**
 * Chapter 1's critical path as a script of story beats, shared by the playthrough test
 * (instant dialogs/battles) and the playtest capture (real dialogs/battles, screenshots).
 */
import { expect, type Page } from '@playwright/test';

export type Dir = 'up' | 'down' | 'left' | 'right';

export async function sj<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

/** Poll timeout per beat; the playtest raises it because its dialogs and battles run at real speed. */
export const route = { timeout: 30_000 };

export async function waitFor(page: Page, expr: string, label: string, timeout = route.timeout): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await sj<boolean>(page, `!!(${expr})`)) return;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await page.waitForTimeout(100);
  }
}

const waitIdle = (page: Page) => waitFor(page, 'sj.idle()', 'field idle');
const waitFlag = (page: Page, f: string) => waitFor(page, `sj.state.flags['${f}']`, `flag ${f}`);

async function tp(page: Page, map: string, x: number, y: number, dir: Dir): Promise<void> {
  await waitIdle(page);
  await sj(page, `sj.tp('${map}', ${x}, ${y}, '${dir}')`);
  await waitIdle(page);
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}

/** From a fresh New Game to the chapter-end flag. */
export async function playChapter1(page: Page): Promise<void> {
  await waitFlag(page, 'intro');
  // First fight in the plaza
  await tp(page, 'lantern_row', 27, 15, 'down');
  await press(page, 'ArrowDown');
  await waitFlag(page, 'first_fight');
  // The job
  await tp(page, 'bar', 16, 5, 'up');
  await press(page, 'z');
  await waitFlag(page, 'met_dutch');
  // Hex
  await tp(page, 'hex_den', 6, 5, 'up');
  await press(page, 'z');
  await waitFlag(page, 'met_hex');
  // Rustyard
  await tp(page, 'rustyard', 15, 21, 'up');
  await press(page, 'ArrowUp');
  await waitFlag(page, 'rustyard_gate');
  await tp(page, 'rustyard', 11, 7, 'right');
  await press(page, 'ArrowRight');
  await waitFlag(page, 'knuckles');
  await tp(page, 'rustyard', 21, 7, 'up');
  await press(page, 'z');
  await waitFor(page, "sj.state.inventory['med_case']", 'med case');
  await tp(page, 'rustyard', 23, 17, 'up');
  await press(page, 'z');
  await waitFlag(page, 'coprocessor');
  // Hex joins
  await tp(page, 'hex_den', 6, 5, 'up');
  await press(page, 'z');
  await waitFlag(page, 'hex_joined');
  expect(await sj<string[]>(page, 'sj.state.party')).toEqual(['kit', 'rook', 'hex']);
  // Sinkline
  await tp(page, 'world', 26, 38, 'up');
  await press(page, 'ArrowUp');
  await waitFlag(page, 'sinkline_gate');
  await waitIdle(page);
  await press(page, 'ArrowUp');
  await waitFor(page, "sj.state.map === 'sinkline_1'", 'enter Sinkline');
  // Prime the pump intakes, lowest pressure first (30, 50, 70 psi), then run the pumps.
  for (const x of [11, 9, 13]) {
    await tp(page, 'sinkline_1', x, 27, 'up');
    await press(page, 'z');
  }
  await waitFor(page, "sj.state.flags.valves === 3", 'pumps primed');
  await tp(page, 'sinkline_1', 6, 27, 'up');
  await press(page, 'z');
  await waitFlag(page, 'floodgate');
  await tp(page, 'sinkline_1', 33, 16, 'right');
  await press(page, 'ArrowRight');
  await waitFlag(page, 'lurker');
  await tp(page, 'sinkline_1', 44, 29, 'down');
  await press(page, 'ArrowDown');
  await waitFor(page, "sj.state.map === 'annex'", 'enter Annex');
  // Annex 7
  await tp(page, 'annex', 8, 9, 'down');
  await press(page, 'ArrowDown');
  await waitFlag(page, 'annex_key');
  // The laser lattice: relay B alone drops all three emitters.
  await tp(page, 'annex', 16, 8, 'left');
  await press(page, 'z');
  await waitFlag(page, 'lattice_off');
  await tp(page, 'annex', 36, 7, 'up');
  await press(page, 'ArrowUp');
  await waitFlag(page, 'sable_joined');
  expect(await sj<string[]>(page, 'sj.state.party')).toContain('sable');
  await tp(page, 'annex', 27, 21, 'down');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await waitFlag(page, 'warden');
  // Lift to the dock: the betrayal and the ending.
  await tp(page, 'annex', 38, 31, 'down');
  await press(page, 'ArrowDown');
  await waitFlag(page, 'chapter_end');
}
