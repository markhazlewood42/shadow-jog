/**
 * Installs the field hooks: items, party changes, random encounters, battles (with retry),
 * shops, inn, clinic, save prompts, tutorials and the menu.
 */
import { notice, reportError } from '../engine/errors';
import { popMusic, pushMusic } from '../audio/music';
import { sfx } from '../audio/sfx';
import { ENCOUNTERS } from '../data/enemies';
import { ITEMS } from '../data/items';
import { MEMBERS } from '../data/party';
import { surface } from '../engine/canvas';
import { rng } from '../engine/rng';
import type { Game } from '../engine/game';
import { TS } from '../field/tiles';
import { BattleScene } from '../scenes/battle';
import { CardScene } from '../scenes/card';
import type { FieldScene } from '../scenes/field';
import { GameOverScene } from '../scenes/gameover';
import { MenuScene } from '../scenes/menu';
import { PanelScene } from '../scenes/panels';
import { EndingScene } from '../scenes/ending';
import { SaveScene } from '../scenes/saveload';
import { ShopScene } from '../scenes/shop';
import { fieldHooks } from './hooks';
import { addMember, fullRestore, innPrice, memberStats, partyMembers, rest, restoreUses } from './party';
import { applySave, latestSlot, loadSave, unsavedFrames, writeSave } from './save';
import type { BattleResult } from './script';
import { flags, setState, state, type GameState, type MemberId } from './state';

export interface SystemHandlers {
  toTitle: () => void;
  toField: (mapId: string, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') => void;
}

let handlers: SystemHandlers | null = null;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function snapshotScreen(game: Game): HTMLCanvasElement {
  const src = game.ctx.canvas;
  const s = surface(src.width, src.height);
  s.ctx.drawImage(src, 0, 0);
  return s.canvas;
}

export function installSystems(game: Game, h: SystemHandlers): void {
  handlers = h;

  fieldHooks.give = async (f, id, qty, quiet) => {
    const it = ITEMS[id];
    if (!it) return;
    state.inventory[id] = Math.min(99, (state.inventory[id] ?? 0) + qty);
    if (quiet) return;
    sfx(it.kind === 'key' ? 'keyitem' : 'item');
    const name = it.kind === 'key' ? `{y}${it.name}{/}` : `{c}${it.name}{/}`;
    await f.api.narrate(it.kind === 'key' ? `Obtained ${name}!` : `Got ${name}${qty > 1 ? ` ×${qty}` : ''}.`);
  };

  fieldHooks.take = (id, qty) => {
    const have = state.inventory[id] ?? 0;
    if (have < qty) return false;
    if (have === qty) delete state.inventory[id];
    else state.inventory[id] = have - qty;
    return true;
  };

  fieldHooks.join = async (f, id, quiet) => {
    const leadLevel = Math.max(...partyMembers().map((m) => m.level), 1);
    const m = addMember(id, Math.max(MEMBERS[id].startLevel, leadLevel - 1));
    fullRestore(m);
    f.refreshParty();
    if (!quiet) {
      sfx('levelup');
      await f.api.narrate(`{#${MEMBERS[id].color.slice(1)}}${MEMBERS[id].name}{/} joined the crew!`);
    }
  };

  fieldHooks.leave = (f, id) => {
    // The field and battle both assume a leader; a script can never empty the party.
    if (state.party.length <= 1 && state.party.includes(id)) {
      reportError(new Error(`Script tried to remove the last party member (${id})`));
      return;
    }
    state.party = state.party.filter((p) => p !== id);
    f.refreshParty();
  };

  fieldHooks.restoreParty = () => {
    for (const m of partyMembers()) fullRestore(m);
  };

  fieldHooks.refreshFocus = () => {
    for (const m of partyMembers()) {
      if (m.hp <= 0) continue;
      m.tp = memberStats(m).maxTp;
      restoreUses(m);
    }
  };

  // ---------------------------------------------------------------- encounters
  fieldHooks.onStep = (f) => {
    // Long stretches inside one map (a dungeon floor) still get saved every few minutes.
    if (unsavedFrames(game.playFrames) > AUTOSAVE_EVERY && game.top === f && f.busy === 0) autosave(game);
    const zones = f.def.encounters;
    if (!zones?.length || flags.has('noEncounters')) return false;
    const l = f.leader;
    const terrain = f.map.at(l.x, l.y);
    const zone = zones.find(
      (z) => (!z.terrain || z.terrain.includes(terrain)) && (!z.rect || (l.x >= z.rect[0] && l.y >= z.rect[1] && l.x < z.rect[0] + z.rect[2] && l.y < z.rect[1] + z.rect[3])),
    );
    if (!zone) return false;
    f.stepsSinceBattle++;
    const s = f.stepsSinceBattle;
    if (s < 6) return false;
    if (!rng.chance(1 / Math.max(2, zone.rate - 5))) return false;
    f.stepsSinceBattle = 0;
    void f.runScript(async () => {
      await runBattle(game, f, zone.table, { canRun: true, bg: zone.bg ?? f.def.battleBg ?? 'street' });
    });
    return true;
  };

  fieldHooks.battle = async (f, enc, opts) => runBattle(game, f, enc, { ...opts, bg: opts.bg ?? f.def.battleBg ?? 'street' });

  // ---------------------------------------------------------------- services
  fieldHooks.shop = async (_f, id) => {
    await game.run(new ShopScene(id));
  };

  fieldHooks.inn = async (f, price, name) => {
    const crew = partyMembers();
    const avg = crew.reduce((n, m) => n + m.level, 0) / Math.max(1, crew.length);
    const each = innPrice(price, avg);
    const cost = each * state.party.length;
    const downed = crew.filter((m) => m.hp <= 0 || m.ailments.length).length;
    const note = downed ? ' {d}(Sleep won’t help the downed or the sick: that’s Doc Yun.){/}' : '';
    const choice = await f.api.ask(null, `${name ?? 'A capsule for the night'}: {y}${each}¢{/} a head, {y}${cost}¢{/} for the crew. Rest?${note}`, ['Rest', 'Not now'], { cancel: 1 });
    if (choice !== 0) return;
    if (state.cred < cost) {
      sfx('buzz');
      await f.api.narrate('Not enough cred.');
      return;
    }
    state.cred -= cost;
    await game.fadeOut(40);
    sfx('save');
    for (const m of crew) rest(m);
    await game.wait(70);
    await game.fadeIn(40);
    await f.api.narrate(downed ? 'The crew wakes up rested. Whoever was on their feet is fully restored; the rest still need a doctor.' : 'The crew wakes up rested. HP, TP and skills are fully restored.');
    await fieldHooks.savePrompt!(f);
  };

  fieldHooks.clinic = async (f) => {
    for (;;) {
      const hurt = partyMembers().filter((m) => m.hp <= 0 || m.ailments.length);
      const c = await f.api.ask('yun', 'What’ll it be?', ['Treatment', 'Pharmacy', 'Leave'], { cancel: 2 });
      if (c === 2) return;
      if (c === 1) {
        await game.run(new ShopScene('clinic'));
        continue;
      }
      if (!hurt.length) {
        await f.api.say('yun', 'Everyone’s walking and breathing. My favorite kind of patient: the kind that leaves.');
        continue;
      }
      const opts = hurt.map((m) => `${MEMBERS[m.id].name} (${m.hp <= 0 ? 'revive' : 'cure'}) ${treatCost(m.id)}¢`);
      const pick = await f.api.ask('yun', 'Who needs patching?', [...opts, 'Never mind'], { cancel: opts.length });
      if (pick >= hurt.length) continue;
      const m = hurt[pick]!;
      const cost = treatCost(m.id);
      if (state.cred < cost) {
        sfx('buzz');
        await f.api.say('yun', 'I don’t do charity. Come back with cred.');
        continue;
      }
      state.cred -= cost;
      if (m.hp <= 0) m.hp = memberStats(m).maxHp;
      m.ailments = [];
      sfx('revive');
      await f.api.say('yun', m.hp > 0 ? `There. ${MEMBERS[m.id].name}'s good as new. Better, maybe.` : 'Done.');
    }
  };

  fieldHooks.savePrompt = async (f) => {
    const c = await f.api.ask(null, 'Save your progress?', ['Save', 'Not now'], { cancel: 1 });
    if (c !== 0) return;
    await game.run(new SaveScene('save'));
  };

  fieldHooks.tutorial = async (_f, title, body) => {
    await game.run(new CardScene(title, body));
  };

  fieldHooks.panels = async (_f, id) => {
    await game.fadeOut(20);
    const p = game.run(new PanelScene(id));
    await game.fadeIn(20);
    await p;
    await game.fadeOut(20);
  };

  fieldHooks.endChapter = async () => {
    flags.set('chapter_end');
    await game.run(new PanelScene('ending'));
    await game.fadeIn(20);
    await game.run(new EndingScene(game.playFrames));
    await game.fadeOut(40);
    handlers!.toTitle();
  };

  fieldHooks.openMenu = (f) => {
    void f.runScript(async () => {
      const r = await game.run(new MenuScene(true));
      if (r.kind === 'title') handlers!.toTitle();
      else if (r.kind === 'special') await useSpecial(game, f, r.item);
    });
  };

  // Autosave on every map transition into a town or dungeon.
  fieldHooks.onWarp = (f) => {
    if (f.def.kind === 'interior') return;
    autosave(game);
  };
}

/** Frames of play between timed autosaves (three minutes). */
const AUTOSAVE_EVERY = 3 * 60 * 60;

/** Autosave policy: a second tab on the same save file stops autosaving (see boot). */
export const autosavePolicy = { enabled: true, pausedNoticeShown: false };

export function autosave(game: Game): void {
  if (!autosavePolicy.enabled) {
    if (!autosavePolicy.pausedNoticeShown) {
      autosavePolicy.pausedNoticeShown = true;
      notice('Autosave is paused: Shadow Jog is open in another tab. Save from the menu here.', 'warn');
    }
    return;
  }
  if (writeSave('auto', game.playFrames)) notice('Autosaved', 'saved');
  else notice('Autosave failed: browser storage is unavailable. Save from the menu to keep progress.', 'warn');
}

function treatCost(id: MemberId): number {
  const m = state.members[id]!;
  return m.hp <= 0 ? 30 + m.level * 10 : 20;
}

async function useSpecial(game: Game, f: FieldScene, id: string): Promise<void> {
  const it = ITEMS[id]!;
  if (it.special === 'getaway') {
    if (f.def.kind !== 'dungeon' || !state.lastEntrance) {
      sfx('buzz');
      await f.api.narrate('You can only use that inside a dungeon.');
      return;
    }
    state.inventory[id]! -= 1;
    if (!state.inventory[id]) delete state.inventory[id];
    sfx('flee');
    const e = state.lastEntrance;
    await f.warp(e.map, e.x, e.y, 'down');
  } else if (it.special === 'cab') {
    if (f.def.kind === 'dungeon' || f.def.kind === 'interior') {
      sfx('buzz');
      await f.api.narrate('No autocab will come down here. Get back to the street first.');
      return;
    }
    state.inventory[id]! -= 1;
    if (!state.inventory[id]) delete state.inventory[id];
    await f.api.narrate('An autocab hisses to the curb. "DESTINATION CONFIRMED."');
    const t = state.lastTown;
    await f.warp(t.map, t.x, t.y, 'down');
  }
  void game;
}

export async function runBattle(
  game: Game,
  f: FieldScene,
  enc: string,
  opts: { canRun?: boolean; boss?: boolean; music?: string; bg: string; loseOk?: boolean },
): Promise<BattleResult> {
  if (!ENCOUNTERS[enc]) throw new Error(`Unknown encounter ${enc}`);
  const snapshot: GameState = clone(state);
  const rngBefore = rng.state;
  for (;;) {
    const intro = snapshotScreen(game);
    pushMusic(opts.music ?? (opts.boss ? 'boss' : 'battle'));
    game.flash('#ffffff', 8);
    await game.wait(10);
    const result = await game.run(new BattleScene({ encounter: enc, bg: opts.bg, canRun: opts.canRun, boss: opts.boss, music: opts.music, intro }));
    if (result !== 'lose') {
      popMusic();
      // Rustfang bounty tally (job board).
      const gangs = ['rustfang_punk', 'rustfang_slinger'].reduce((n, k) => n + (state.bestiary[k] ?? 0) - (snapshot.bestiary[k] ?? 0), 0);
      if (gangs > 0) flags.inc('rustfangs', gangs);
      return result;
    }
    if (opts.loseOk) {
      for (const m of partyMembers()) if (m.hp <= 0) m.hp = 1;
      popMusic();
      return 'lose';
    }
    const choice = await game.run(new GameOverScene(true));
    if (choice === 'retry') {
      // Rewind to the instant before the fight and try again.
      setState(clone(snapshot));
      rng.state = rngBefore + 1;
      popMusic();
      f.refreshParty();
      continue;
    }
    if (choice === 'load') {
      const newest = latestSlot();
      const slot = latestSlot(true);
      const s = slot ? loadSave(slot) : null;
      if (s) {
        loadIntoGame(game, s);
        if (slot !== newest) notice('Your newest save is damaged. Loaded the one before it.', 'warn');
        return 'lose';
      }
      notice(newest ? 'Your last save is damaged and could not be loaded. Returning to the title.' : 'There is no save to load. Returning to the title.', 'warn');
    }
    handlers!.toTitle();
    return 'lose';
  }
}

/** Apply a loaded save and drop the player into its field position (restores play time + RNG). */
export function loadIntoGame(game: Game, s: GameState): void {
  applySave(s);
  game.playFrames = s.playFrames;
  handlers!.toField(s.map, s.x, s.y, s.dir);
}

/** Tile-accurate helper for scripts that need pixel coords. */
export const tileCenter = (t: number) => t * TS + TS / 2;
