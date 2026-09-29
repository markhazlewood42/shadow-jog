/**
 * Evidence capture for quality reviews: drives the game to fixed states and writes PNGs to
 * docs/screenshots/. Run with `npm run shots`.
 */
import { expect, test, type Page } from '@playwright/test';

const OUT = 'docs/screenshots';

async function sj<T = unknown>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const sj = window.__SJ__; return ${fn}; })()`) as Promise<T>;
}

async function open(page: Page, stage?: string): Promise<void> {
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  if (stage) {
    await sj(page, `sj.stage('${stage}')`);
    await page.waitForTimeout(900);
  }
}

async function key(page: Page, k: string, n = 1, gap = 180): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.down(k);
    await page.waitForTimeout(50);
    await page.keyboard.up(k);
    await page.waitForTimeout(gap);
  }
}

/**
 * Move a list's cursor to the entry with this label, by name rather than by a count of presses:
 * menu entries come and go with the story (the Deck page appears once the Stingray is in).
 * `list` is the path from the top scene to its ListMenu (the main menu is 'main').
 */
async function pick(page: Page, label: string, list = 'main'): Promise<void> {
  const i = await sj<number>(page, `sj.game.top.${list}.items.findIndex((it) => it.label === ${JSON.stringify(label)})`);
  expect(i, `no "${label}" in ${list}`).toBeGreaterThanOrEqual(0);
  const at = await sj<number>(page, `sj.game.top.${list}.index`);
  if (i > at) await key(page, 'ArrowDown', i - at);
  else if (i < at) await key(page, 'ArrowUp', at - i);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.locator('#screen').screenshot({ path: `${OUT}/${name}.png` });
}

test.describe.configure({ mode: 'serial' });

test('01 title', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1600);
  await key(page, 'Enter');
  await page.waitForTimeout(900);
  await shot(page, '01-title');
});

test('02 intro panels + first dialog', async ({ page }) => {
  await open(page);
  await sj(page, 'sj.newGame()');
  await page.waitForTimeout(1500);
  await key(page, 'z', 2, 500);
  await page.waitForTimeout(1200);
  await shot(page, '02-intro-panels');
  // Through the rest of the comic to the first spoken line in the field (not a half-drawn page).
  for (let i = 0; i < 24 && (await sj<string>(page, 'sj.top()')) !== 'DialogScene'; i++) {
    await key(page, 'z');
    await page.waitForTimeout(600);
  }
  expect(await sj<string>(page, 'sj.top()')).toBe('DialogScene');
  await page.waitForTimeout(1600);
  await shot(page, '03-dialog-portrait');
});

test('04 streets', async ({ page }) => {
  await open(page, 'start');
  await page.waitForTimeout(2500);
  await shot(page, '04-lantern-row-street');
  await open(page, 'town');
  await page.waitForTimeout(2500);
  await shot(page, '05-lantern-row-plaza');
});

test('06 bar dialog', async ({ page }) => {
  await open(page, 'start');
  await sj(page, "sj.tp('bar', 16, 6, 'up')");
  await page.waitForTimeout(800);
  await sj(page, "sj.say('dutch', 'There they are. My favorite disaster and his apprentice. Sit, sit. Mind the stain, it\\u2019s load-bearing.', 'happy')");
  await page.waitForTimeout(2600);
  await shot(page, '06-bar-dialog');
});

test('07 menus', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(700);
  await shot(page, '07-menu');
  await key(page, 'ArrowDown', 3);
  await key(page, 'Enter');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '08-menu-status');
  await key(page, 'x', 2);
  await key(page, 'ArrowUp');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '09-menu-equip');
});

test('10 shop', async ({ page }) => {
  await open(page, 'town');
  await sj(page, "sj.shop('lr_weapons')");
  await page.waitForTimeout(500);
  await key(page, 'Enter');
  await key(page, 'ArrowDown');
  await page.waitForTimeout(400);
  await shot(page, '10-shop');
  // The Sell tab, with something to sell.
  await sj(page, "(sj.state.inventory = { ...sj.state.inventory, gang_colors: 2 }, true)");
  await key(page, 'Escape');
  await page.waitForTimeout(300);
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '10b-shop-sell');
});

test('11 battle command + techs', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3200);
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '11-battle-command');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '12-battle-techs');
});

test('13 battle action', async ({ page }) => {
  await open(page, 'town');
  await sj(page, "sj.battle('street', 'street')");
  await page.waitForTimeout(3200);
  await key(page, 'ArrowDown', 2);
  await key(page, 'Enter');
  await page.waitForTimeout(700);
  await shot(page, '13-battle-action');
});

test('13b the swing, beat by beat', async ({ page }) => {
  await open(page, 'town');
  await sj(page, "sj.battle('street', 'street')");
  await page.waitForTimeout(3200);
  // Freeze the simulation (rendering carries on), then pose Rook on each beat of a swing.
  await sj(page, '(sj.__tick = sj.game.tick, sj.game.tick = () => undefined, true)');
  for (const [k, name] of [[3, 'gather'], [7, 'raise'], [9, 'cut'], [15, 'settle']] as const) {
    await sj(page, `(() => { const s = sj.game.top, r = s.battle.party.find((u) => u.key === 'rook'); const d = s.d(r.uid); d.pose = 'attack'; d.poseT = 34 - ${k}; return true; })()`);
    await page.waitForTimeout(120);
    await shot(page, `13b-swing-${name}`);
  }
  await sj(page, '(sj.game.tick = sj.__tick, true)');
});

test('14 combo hint', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.battle('f_annex_door', 'lab')");
  await page.waitForTimeout(3200);
  await key(page, 'Enter'); // Fight
  await key(page, 'ArrowDown');
  await key(page, 'Enter'); // Ki Arts
  await key(page, 'Enter'); // Flash Step
  await key(page, 'Enter'); // target
  await key(page, 'ArrowDown');
  await key(page, 'Enter'); // Rook: Skills
  await page.waitForTimeout(400);
  await shot(page, '14-battle-combo-hint');
  await key(page, 'Enter'); // Arc Cut
  await key(page, 'Enter'); // target
  await key(page, 'Enter'); // Hex attack
  await key(page, 'Enter');
  await key(page, 'Enter'); // Sable attack
  await key(page, 'Enter');
  await page.waitForTimeout(900);
  await shot(page, '15-battle-combo');
});

test('15b three-part combo, called', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.battle('f_annex_door', 'lab')");
  await page.waitForTimeout(3200);
  // Orders straight into the round: Kit's Flash Step, Rook's Arc Cut and Hex's Analyze fuse.
  await sj(page, `(() => {
    const s = sj.game.top, p = s.battle.party, e = s.battle.enemies[0].uid;
    const by = (k) => p.find((u) => u.key === k).uid;
    s.cmds = [
      { actor: by('kit'), type: 'tech', id: 'flash_step', target: e },
      { actor: by('rook'), type: 'skill', id: 'arc_cut', target: e },
      { actor: by('hex'), type: 'skill', id: 'analyze', target: e },
      { actor: by('sable'), type: 'attack', target: e },
    ];
    void s.executeRound();
    return true;
  })()`);
  await page.waitForTimeout(700);
  await shot(page, '15b-battle-triple-combo');
});

test('16b every recurring enemy: idle, strike, flinch', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  // A contact sheet straight from the art module: three frames per sprite, at battle scale.
  await page.evaluate(async () => {
    const url = '/src/art/enemies.ts';
    const { enemyArt } = (await import(/* @vite-ignore */ url)) as typeof import('../src/art/enemies');
    const keys = ['punk', 'medic', 'slinger', 'brute', 'ghoul', 'sentinel', 'arcanist', 'rat', 'hound', 'drone', 'wisp', 'crab', 'maint', 'shade', 'turret', 'hunter'];
    // Two sprites a row, three frames each, drawn at the battle's 2x.
    const cell = 124;
    const c = document.createElement('canvas');
    c.id = 'sheet';
    c.width = 6 * cell;
    c.height = Math.ceil(keys.length / 2) * cell;
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '99', background: '#12101c', imageRendering: 'pixelated' });
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#12101c';
    g.fillRect(0, 0, c.width, c.height);
    keys.forEach((k, i) => {
      const a = enemyArt(k);
      const frames = [a, a.attack ?? a, a.hurt ?? a];
      const col = i % 2, row = Math.floor(i / 2);
      frames.forEach((f, j) => {
        const x = (col * 3 + j) * cell + 4, y = row * cell + 4;
        const s = Math.min(2, (cell - 8) / Math.max(f.canvas.width, f.canvas.height));
        g.drawImage(f.canvas, x, y, f.canvas.width * s, f.canvas.height * s);
        if (f.glow) {
          g.globalCompositeOperation = 'lighter';
          g.drawImage(f.glow, x, y, f.canvas.width * s, f.canvas.height * s);
          g.globalCompositeOperation = 'source-over';
        }
      });
    });
    document.body.appendChild(c);
  });
  await page.locator('#sheet').screenshot({ path: `${OUT}/16b-enemy-poses.png` });
});

test('16c the bosses: idle, strike, flinch', async ({ page }) => {
  await page.goto('/?debug');
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const url = '/src/art/enemies.ts';
    const { enemyArt } = (await import(/* @vite-ignore */ url)) as typeof import('../src/art/enemies');
    const keys = ['lurker', 'warden', 'warden_spirit'];
    const cell = 200;
    const c = document.createElement('canvas');
    c.id = 'sheet';
    c.width = 3 * cell;
    c.height = keys.length * cell;
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '99', background: '#12101c' });
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#12101c';
    g.fillRect(0, 0, c.width, c.height);
    keys.forEach((k, row) => {
      const a = enemyArt(k);
      [a, a.attack ?? a, a.hurt ?? a].forEach((f, j) => {
        const s = Math.min(2, (cell - 8) / Math.max(f.canvas.width, f.canvas.height));
        const x = j * cell + 4, y = row * cell + 4;
        g.drawImage(f.canvas, x, y, f.canvas.width * s, f.canvas.height * s);
        if (f.glow) {
          g.globalCompositeOperation = 'lighter';
          g.drawImage(f.glow, x, y, f.canvas.width * s, f.canvas.height * s);
          g.globalCompositeOperation = 'source-over';
        }
      });
    });
    document.body.appendChild(c);
  });
  await page.locator('#sheet').screenshot({ path: `${OUT}/16c-boss-poses.png` });
});

test('16 bosses', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.battle('f_warden', 'core', true)");
  await page.waitForTimeout(3600);
  await shot(page, '16-battle-warden');
  await open(page, 'sinkline');
  await sj(page, "sj.battle('f_lurker', 'junction', true)");
  await page.waitForTimeout(3600);
  await shot(page, '17-battle-lurker');
});

test('18 world + dungeons', async ({ page }) => {
  await open(page, 'sinkline');
  await page.waitForTimeout(1500);
  await shot(page, '18-sinkline');
  await sj(page, "sj.tp('world', 22, 22, 'right')");
  await page.waitForTimeout(3500);
  await shot(page, '19-world');
  await sj(page, "sj.tp('rustyard', 15, 18, 'up')");
  await page.waitForTimeout(3500);
  await shot(page, '20-rustyard');
  await open(page, 'annex');
  await page.waitForTimeout(1500);
  await sj(page, "sj.tp('annex', 22, 20, 'down')");
  await page.waitForTimeout(2500);
  await shot(page, '21-annex');
});

test('18c the junction drained: something glowing in the sump', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "(Object.assign(sj.state.flags, { floodgate: true, lurker: false }), true)");
  await sj(page, "sj.tp('sinkline_1', 37, 10, 'down')");
  await page.waitForTimeout(2500);
  await shot(page, '18c-sinkline-lure');
});

test('18b intakes: one open, one shut', async ({ page }) => {
  await open(page, 'sinkline');
  // Intake 2 (the service bay) opened; intake 3 in the pump station beside it still shut.
  await sj(page, "(sj.state.flags.valve_v2 = true, sj.state.flags.valves = 1, true)");
  await sj(page, "sj.tp('sinkline_1', 16, 22, 'up')");
  await page.waitForTimeout(2500);
  await shot(page, '18b-sinkline-intakes');
});

test('22 victory', async ({ page }) => {
  await open(page, 'annex');
  // Hex a few XP short of a level, so the panel shows a bar rolling over.
  await page.evaluate(`(async () => { const { xpFor } = await import('/src/data/party.ts'); const m = window.__SJ__.state.members.hex; m.xp = xpFor(m.level + 1) - 4; })()`);
  await sj(page, "sj.battle('f_first_fight', 'street')");
  await page.waitForTimeout(3200);
  await key(page, 'ArrowDown', 2);
  await key(page, 'Enter');
  await page.waitForTimeout(9000);
  await shot(page, '22-battle-victory');
});

test('23 ending', async ({ page }) => {
  await open(page, 'annex');
  await sj(page, "sj.run((s) => s.panels('ending'))");
  await page.waitForTimeout(1500);
  await key(page, 'z', 2, 500);
  await page.waitForTimeout(1500);
  await shot(page, '23-ending-panels');
  // The last page: Pale's order, then the chapter's title card. Advance until the card is up.
  for (let i = 0; i < 40; i++) {
    const done = await sj<boolean>(page, "(() => { const t = sj.game.top; if (!t || t.constructor.name !== 'PanelScene') return true; const p = t.pages[t.page]; return t.page === t.pages.length - 1 && t.shown === p.length; })()");
    if (done) break;
    await key(page, 'z', 1, 350);
  }
  await page.waitForTimeout(2500);
  await shot(page, '23b-ending-finale');
});

test('24 ending results + 25 next chapter', async ({ page }) => {
  await open(page, 'finale'); // post-Warden: the chapter's real end state
  await sj(page, 'sj.ending()');
  await page.waitForTimeout(3400);
  await shot(page, '24-ending-results');
  await key(page, 'z', 1, 300);
  await page.waitForTimeout(3600);
  await shot(page, '25-ending-next');
});

test('26 menu bestiary', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "Object.assign(sj.state.bestiary, { rustfang_punk: 6, rustfang_medic: 2, glowrat: 9, scrap_hound: 4, smog_wisp: 2, knuckles: 1, drowned_shade: 3 })");
  await sj(page, "Object.assign(sj.state.weakSeen, { rustfang_punk: ['cyber'], smog_wisp: ['mana'], glowrat: ['fire'] })");
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(400);
  await pick(page, 'Bestiary');
  await key(page, 'Enter');
  await pick(page, 'Drowned Shade', 'beasts');
  await page.waitForTimeout(300);
  await shot(page, '26-menu-bestiary');
  // A boss's page: the portrait fits its box at any art resolution.
  await sj(page, '(sj.state.bestiary.lurker = 1, true)');
  await key(page, 'Escape');
  await key(page, 'Enter');
  await pick(page, 'The Lurker', 'beasts');
  await page.waitForTimeout(300);
  await shot(page, '26b-menu-bestiary-boss');
});

test('27 level features: lattice, secret panel, intake, radio lot', async ({ page }) => {
  await open(page, 'annex');
  // Mid-puzzle: relay A cycled, so emitters 1-2 are dark and 3 is live.
  await sj(page, '(Object.assign(sj.state.flags, { annex_key: true, relay_a: true, lattice_off: false, sable_joined: false }), true)');
  // Each secret framed on its own, after the area banner has gone.
  await page.waitForTimeout(3000);
  await sj(page, "sj.tp('annex', 28, 7, 'right')");
  await page.waitForTimeout(2500);
  await shot(page, '27-annex-lattice');
  await sj(page, "sj.tp('annex', 15, 22, 'left')");
  await page.waitForTimeout(2500);
  await shot(page, '28-annex-panel');
  await sj(page, '(sj.state.flags.annex_panel = true, true)');
  await sj(page, "sj.tp('annex', 12, 22, 'up')");
  await page.waitForTimeout(2500);
  await shot(page, '29-annex-crawlspace');
  await sj(page, "sj.tp('sinkline_1', 3, 11, 'up')");
  await page.waitForTimeout(1500);
  await shot(page, '30-sinkline-intake');
  await sj(page, "sj.tp('world', 6, 28, 'left')");
  await page.waitForTimeout(1500);
  await shot(page, '31-world-radio-lot');
});

test('37 cryopod before and after the rescue', async ({ page }) => {
  await open(page, 'annex');
  // Before: three of them, the pod lit cold and steady. After: Sable with them, the glass broken,
  // the breach alarm washing the wing red.
  await sj(page, "(delete sj.state.flags.sable_joined, sj.state.flags.lattice_off = true, sj.state.party = ['kit', 'rook', 'hex'], sj.tp('annex', 36, 8, 'up'))");
  await page.waitForTimeout(3200);
  await shot(page, '37-annex-cryopod');
  await sj(page, "(sj.state.flags.sable_joined = true, sj.state.party = ['kit', 'rook', 'hex', 'sable'], sj.tp('annex', 37, 7, 'left'))");
  await page.waitForTimeout(2500);
  await shot(page, '37b-annex-cryopod-empty');
});

test('38 packs: three rats, three hounds, each an individual', async ({ page }) => {
  for (const [name, who] of [['38-battle-rat-pack', 'glowrat'], ['38b-battle-hound-pack', 'scrap_hound']] as const) {
    await open(page, 'town');
    await sj(page, `sj.defineEncounter('f_shot_pack', ['${who}', '${who}', '${who}'])`);
    await sj(page, "sj.battle('f_shot_pack', 'street')");
    await page.waitForTimeout(3200);
    await shot(page, name);
  }
});

test('maps overview + cast', async ({ page }) => {
  for (const id of ['lantern_row', 'bar', 'world', 'rustyard', 'sinkline_1', 'annex', 'dock']) {
    await page.goto(`/?debug&scene=mapview&map=${id}`);
    await page.waitForTimeout(900);
    await shot(page, `maps/${id}`);
  }
  await page.goto('/?debug&scene=chars&zoom=4');
  await page.waitForTimeout(1200);
  await shot(page, 'progress-01-cast-sprites');
  await page.goto('/?debug&scene=chars&zoom=2&npcs');
  await page.waitForTimeout(1200);
  await shot(page, '32-crowd-sprites');
});

test('33 menu places', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(400);
  await pick(page, 'Places');
  await key(page, 'Enter');
  await page.waitForTimeout(300);
  await shot(page, '33-menu-places');
  // The current place's map.
  await key(page, 'Enter');
  await page.waitForTimeout(500);
  await shot(page, '33b-menu-place-map');
});

test('34 game over', async ({ page }) => {
  await open(page, 'town');
  await sj(page, 'Object.assign(sj.debug, { autoLose: true, autoBattle: false })');
  await sj(page, "sj.battle('street', 'street')");
  for (let i = 0; i < 60; i++) {
    if (await sj<boolean>(page, "sj.top() === 'GameOverScene'")) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2200);
  await shot(page, '34-game-over');
});

test('35 options + 36 controls', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1200);
  await key(page, 'Enter'); // press start
  await page.waitForTimeout(400);
  await key(page, 'ArrowDown', 3); // Options (no saves: New Game, Continue, Load, Options)
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '35-options');
  // Down to Controls by its label, not a row count (rows get added).
  for (let i = 0; i < 12 && (await sj<string>(page, "sj.game.top.rows[sj.game.top.idx].id")) !== 'controls'; i++) await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  expect(await sj<string>(page, 'sj.top()')).toBe('ControlsScene');
  await shot(page, '36-controls');
});

// ---- Mark's first playthrough (2026-09-29): the new pieces, for the reviewers.

test('39 hex deck: dead, seating the Stingray, booted', async ({ page }) => {
  await open(page, 'town');
  await sj(page, "(sj.run((s) => s.deck('dead')), true)");
  await page.waitForTimeout(900);
  await shot(page, '39-deck-dead');
  await key(page, 'Escape');
  await page.waitForTimeout(500);
  await sj(page, "(sj.run((s) => s.deck('seat')), true)");
  await page.waitForTimeout(1100);
  await shot(page, '40-deck-seat-align');
  // Seat it without the timed press (a script can't aim it reliably): drop, both clips, the boot.
  await sj(page, '(sj.game.stack.at(-1).go("drop"), true)');
  await page.waitForTimeout(700);
  await key(page, 'Enter', 2, 400);
  await page.waitForTimeout(3600);
  await shot(page, '41-deck-seat-booted');
});

test('42 the Deck page in the menu', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(500);
  await pick(page, 'Deck');
  await key(page, 'Enter');
  await page.waitForTimeout(800);
  await shot(page, '42-deck-menu');
});

test('43 shop: equip it now, and sell all loot', async ({ page }) => {
  await open(page, 'town');
  await sj(page, '(sj.state.cred = 5000, sj.state.inventory = { ...sj.state.inventory, gang_colors: 3, rat_tail: 4 }, true)');
  await sj(page, "sj.shop('lr_weapons')");
  await page.waitForTimeout(500);
  // Buy -> the Vibro-Katana (Rook's, and he isn't wearing one) -> quantity 1 -> the equip picker.
  await key(page, 'Enter');
  await key(page, 'ArrowDown', 2);
  await key(page, 'Enter', 2, 300);
  await page.waitForTimeout(400);
  await shot(page, '43-shop-equip-now');
  await key(page, 'Escape', 2, 300);
  // Sell -> the first row is "Sell all loot".
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(400);
  await shot(page, '44-shop-sell-all');
});

test('45 Rook, wounded, on his status page', async ({ page }) => {
  await open(page, 'town');
  await sj(page, 'sj.menu()');
  await page.waitForTimeout(500);
  await key(page, 'ArrowDown', 3);
  await key(page, 'Enter');
  await key(page, 'ArrowDown');
  await key(page, 'Enter');
  await page.waitForTimeout(500);
  await shot(page, '45-menu-status-rook-wounded');
});

test('46 a round in play: the turn strip and the acting arrow', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3200);
  // Auto: everyone attacks; catch the second action.
  await key(page, 'ArrowDown', 2);
  await key(page, 'Enter');
  await page.waitForTimeout(2600);
  await shot(page, '46-battle-round-in-play');
});

test('47 a chest, lit, with the interact marker', async ({ page }) => {
  await open(page, 'sinkline');
  // Beside the platform-end crate, facing it, once the map's name banner has gone.
  await sj(page, "sj.tp('sinkline_1', 26, 12, 'right')");
  await page.waitForTimeout(4200);
  await shot(page, '47-field-chest-and-marker');
});

test('48 the target box: weakness symbols, on the far side from the target', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "Object.assign(sj.state.weakSeen, { sewer_ghoul: ['fire'], rust_crab: ['mana'], glowrat: ['fire'] })");
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3200);
  // Fight -> Attack -> the target picker.
  await key(page, 'Enter', 2, 300);
  await page.waitForTimeout(400);
  await shot(page, '48-battle-target-box');
});

test('49 Hex’s deck over her card while a program runs', async ({ page }) => {
  await open(page, 'sinkline');
  await sj(page, "sj.battle('sinkline', 'sewer')");
  await page.waitForTimeout(3200);
  await sj(page, '(sj.game.top.deckT = 18, true)');
  await page.waitForTimeout(150);
  await shot(page, '49-battle-deck-cutin');
});
