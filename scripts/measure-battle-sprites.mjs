#!/usr/bin/env node
/**
 * Measure the real battle sprites and write tests/fixtures/battle-sprites.json: for each party
 * member the height of their frame and the first opaque row of their tallest idle silhouette, and
 * for each enemy its size and first opaque row, all in battle-world pixels.
 *
 *   npm run dev          (in another terminal)
 *   node scripts/measure-battle-sprites.mjs [baseURL] [outFile]
 *
 * Why it exists: the sprites are drawn in code and measured from pixels, so a unit test (which
 * has no canvas) cannot size them. tests/battle-geom.test.ts reads this file instead, to check
 * that the enemy row stays above the party's heads. Run it again when party or enemy art changes
 * size; the test also fails when an enemy has no entry here.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const baseURL = process.argv[2] ?? 'http://localhost:3007';
const outFile = process.argv[3] ?? 'tests/fixtures/battle-sprites.json';

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${baseURL}/?debug&scene=battle&party=kit,rook,hex,sable&enemies=rustfang_punk`);
await page.waitForFunction(() => window.__SJ__?.top?.() === 'BattleScene', null, { timeout: 30000 });
await page.waitForTimeout(1500);
const measured = await page.evaluate(`(async () => {
  const scene = window.__SJ__.game.top;
  const { opaqueTop, artTop } = await import('/src/scenes/battlekit/sprites.ts');
  const party = {};
  for (const u of scene.battle.party) {
    const b = scene.partyArt.get(u.uid);
    const res = b.res ?? 1;
    party[u.key] = { frameH: b.frames.idle.height / res, idleTop: opaqueTop(b.frames.idle) / res };
  }
  const { ENEMIES } = await import('/src/data/enemies.ts');
  const { enemyArt } = await import('/src/art/enemies.ts');
  const enemies = {};
  for (const [id, def] of Object.entries(ENEMIES)) {
    const a = enemyArt(def.sprite);
    enemies[id] = { w: a.w, h: a.h, top: artTop(a), boss: !!def.boss };
  }
  return { party, enemies };
})()`);
await browser.close();
const fixture = {
  _comment: 'Measured battle sprite sizes in battle-world pixels, written by scripts/measure-battle-sprites.mjs from the real art. tests/battle-geom.test.ts reads it.',
  ...measured,
};
writeFileSync(outFile, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`${outFile}: ${Object.keys(measured.party).length} party members, ${Object.keys(measured.enemies).length} enemies`);
