// Shoot the Shadow Jog trailer from the running dev server (npm run dev, port 3007):
//   node scripts/trailer.mjs            record it: media/shadow-jog-trailer-<date>.mp4
//   node scripts/trailer.mjs --preview  no recording: one still per shot, in media/trailer-preview/
//
// Real gameplay, directed: the script jumps to places and fights (the dev hooks in
// window.__SJ__, the same ones the screenshot suite uses), walks the crew with real key presses,
// stages each fight's orders so the good moves happen on camera, and holds one song per section.
// The browser records the game's own picture and sound (src/dev/trailer.ts) at 1920x1080, 60 fps.
// Re-run it after changing the art to get the same trailer with the new look.
import { mkdirSync, statSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PREVIEW = process.argv.includes('--preview');
const STAMP = new Date().toISOString().slice(0, 10);
const OUT = PREVIEW ? 'media/trailer-preview' : 'media';
const FILE = `shadow-jog-trailer-${STAMP}.mp4`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/** Run an expression in the page with `sj` (the game's dev hooks) and `t` (the trailer tools). */
const sj = (expr) => page.evaluate(`(async () => { const sj = window.__SJ__; const t = await sj.trailer(); return ${expr}; })()`);
const wait = (s) => page.waitForTimeout(s * 1000);
let shotNo = 0;
/** Preview: a still of this moment. Recording: nothing. */
const snap = async (name) => {
  shotNo++;
  if (PREVIEW) await page.screenshot({ path: `${OUT}/${String(shotNo).padStart(2, '0')}-${name}.png` });
};
const hold = (song) => sj(`t.hold(${JSON.stringify(song)})`);
const card = (lines, seconds) => sj(`t.card(${JSON.stringify(lines)}, ${seconds})`);
/** Jump to a stage preset (party, gear, flags), then tidy the screen for the camera. */
const stage = async (name) => {
  await sj(`sj.stage('${name}')`);
  await sj('t.quiet()');
};
const tp = (map, x, y, dir) => sj(`sj.tp('${map}', ${x}, ${y}, '${dir}')`);
const walk = async (key, seconds) => {
  await page.keyboard.down(key);
  await wait(seconds);
  await page.keyboard.up(key);
};
const top = () => sj('sj.top()');
const mode = () => sj("sj.game.top && sj.game.top.mode || ''");
/** Wait (up to `limit` seconds) until the battle is waiting for orders. */
const untilRound = async (limit = 20) => {
  for (let i = 0; i < limit * 10; i++) {
    if ((await mode()) === 'round') return true;
    await wait(0.1);
  }
  return false;
};
/** Wait until the battle wants orders (true) or has ended (false: its results are up, or it's gone). */
const untilRoundOrEnd = async (limit = 30) => {
  for (let i = 0; i < limit * 10; i++) {
    const m = await mode();
    if (m === 'round') return true;
    if (m === 'end' || (await top()) !== 'BattleScene') return false;
    await wait(0.1);
  }
  return false;
};
/** Give this round's orders ({ kit: ['tech', 'flash_step'], ... }; first living enemy as target) and play it. */
const orders = (o) =>
  sj(`(() => {
    const s = sj.game.top, p = s.battle.party, foes = s.battle.alive('enemy');
    const o = ${JSON.stringify(o)};
    s.cmds = p.filter((u) => u.hp > 0).map((u) => {
      const [type, id, foe] = o[u.key] ?? ['attack'];
      const target = type === 'guard' ? -1 : (foes[foe ?? 0] ?? foes[0]).uid;
      return { actor: u.uid, type, ...(id ? { id } : {}), target };
    });
    s.flow(s.executeRound());
    return true;
  })()`);

// ------------------------------------------------------------------ set up
await page.goto('http://localhost:3007/?debug');
await page.waitForFunction(() => window.__SJ__ && window.__SJ__.top() === 'TitleScene', null, { timeout: 30_000 });
// A key press starts the game's audio (browsers wait for one), and settles the title in.
await page.keyboard.press('Shift');
await sj('t.quiet()');
await hold('title');
await wait(1.5);
if (!PREVIEW) console.log('recording as', await sj('t.record.start()'));

// ------------------------------------------------------------------ cold open
await wait(4.5);
await snap('title');
await card([{ text: 'ONE EASY JOB.', scale: 5 }], 2.6);

// ------------------------------------------------------------------ Lantern Row
await hold('town');
await stage('start');
await tp('lantern_row', 12, 12, 'right');
await wait(0.4);
await walk('ArrowRight', 2.0);
await snap('street');
await walk('ArrowRight', 2.2);
await tp('lantern_row', 27, 20, 'down');
await walk('ArrowDown', 1.3);
await snap('plaza');
await walk('ArrowLeft', 1.6);
await tp('bar', 12, 9, 'up');
await wait(0.8);
await sj(`sj.say('dutch', 'There they are. My favorite disaster and his apprentice. Sit, sit. Mind the stain, it’s load-bearing.', 'happy')`);
await wait(2.6);
await snap('dutch');
await wait(0.9);
await page.keyboard.press('z');
await tp('world', 22, 22, 'right');
await wait(0.3);
await walk('ArrowRight', 2.6);
await snap('world');
await tp('rustyard', 15, 18, 'up');
await walk('ArrowUp', 2.2);
await snap('rustyard');
await card([{ text: 'WHAT COULD GO WRONG?', scale: 4 }], 2.6);

// ------------------------------------------------------------------ a fight
await hold('battle');
await stage('annex');
// Kit is one fight from a level, for the level-up at the end.
await sj(`(async () => { const { xpFor } = await import('/src/data/party.ts'); const k = sj.state.members.kit; k.xp = xpFor(k.level + 1) - 5; return true; })()`);
await sj("sj.defineEncounter('f_trailer', ['km_sentinel', 'hunter_drone', 'km_sentinel'])");
await sj('(sj.debug.playtest = true, true)'); // timed presses on the beat
await sj("sj.battle('f_trailer', 'lab')");
await wait(1.2);
await snap('transition');
await untilRound();
// Tough enough for the two staged rounds and a finish.
await sj('(t.toughen(2.6), true)');
await wait(0.6);
// Kit, Rook and Hex's Clean Job (a three-member combo), and Sable's fire.
await orders({ kit: ['tech', 'flash_step'], rook: ['skill', 'arc_cut'], hex: ['skill', 'analyze'], sable: ['tech', 'firebrand', 1] });
await wait(3.2);
await snap('combo');
if (await untilRoundOrEnd()) {
  await orders({ rook: ['skill', 'incendiary', 1], hex: ['tech', 'overload', 2], kit: ['tech', 'iron_palm', 0], sable: ['tech', 'mending_rain'] });
  await wait(3.5);
  await snap('elements');
}
if (await untilRoundOrEnd()) {
  // Finish it: every enemy one blow from down, and the crew attacks.
  await sj('(sj.game.top.battle.enemies.forEach((e) => { if (e.hp > 0) e.hp = 1; }), true)');
  await orders({});
  await untilRoundOrEnd();
}
// The results: victory, then Kit's level-up, each held for the camera.
await sj('(sj.debug.playtest = false, true)');
await wait(2.2);
await snap('victory');
await page.keyboard.press('z');
await wait(2.6);
await snap('level-up');
await page.keyboard.press('z');
await wait(0.6);

// ------------------------------------------------------------------ the Sinkline
await hold('dungeon');
await stage('sinkline');
await tp('sinkline_1', 8, 9, 'right');
await walk('ArrowRight', 2.6);
await snap('sinkline');
// The junction drained, and something glowing in the sump (the Lurker's lure, before its fight).
await sj("(Object.assign(sj.state.flags, { floodgate: true, lurker: false }), true)");
await tp('sinkline_1', 37, 10, 'down');
await wait(2.4);
await snap('lure');

// ------------------------------------------------------------------ bosses
await hold('boss');
await sj('(sj.debug.playtest = true, true)');
await sj("sj.battle('f_lurker', 'junction', true)");
await untilRound();
// Hurt enough to thrash: its tell comes up on its first move.
await sj('(sj.game.top.battle.enemies.forEach((e) => { e.hp = Math.round(e.base.maxHp * 0.49); }), true)');
await orders({ kit: ['tech', 'flash_step'], rook: ['skill', 'incendiary'], hex: ['tech', 'overload'], sable: ['tech', 'firebrand'] });
await wait(3.5);
await snap('lurker');
await wait(3.0);
await stage('finale');
await sj("sj.battle('f_warden', 'core', true)");
await untilRound();
// Tough enough to stay above 70% through the first round: below that it deploys drones
// instead of charging its cannon (the move with the tell).
await sj('(t.toughen(3), true)');
await orders({ kit: ['tech', 'flash_step'], rook: ['skill', 'arc_cut'], hex: ['skill', 'analyze'], sable: ['tech', 'firebrand'] });
// The Warden charges its cannon: the tell pins itself up top.
for (let i = 0; i < 120 && !(await sj('!!sj.game.top.tell')); i++) await wait(0.1);
await wait(1.6);
await snap('warden-tell');
await untilRound();
// Its shell one blow from breaking: the spirit tears free.
await sj("(sj.game.top.battle.enemies.forEach((e) => { if (e.key === 'warden') e.hp = 1; }), true)");
await orders({ kit: ['tech', 'flash_step'], rook: ['skill', 'arc_cut'], hex: ['skill', 'analyze'] });
await wait(4.2);
await snap('phase');
await wait(2.0);

// ------------------------------------------------------------------ end card
await sj('(t.fadeOut(90), true)');
await card([{ text: 'SHADOW JOG', scale: 7, color: '#ffffff', rule: '#ff4fb0' }, { text: 'CHAPTER 1: MILK RUN', scale: 2, color: '#6ff3ff' }], 5.5);
await wait(0.3);

if (!PREVIEW) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), sj(`t.record.stop('${FILE}')`)]);
  const path = `${OUT}/${FILE}`;
  await download.saveAs(path);
  console.log(`saved ${path} (${(statSync(path).size / 1e6).toFixed(1)} MB)`);
} else console.log(`preview stills in ${OUT}/`);
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].join('\n'));
await browser.close();
