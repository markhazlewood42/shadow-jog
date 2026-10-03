/**
 * The Battle Test dialog (Phaser spike `spike/phaser-stage`), laid out like RPG Maker's: one tab per party slot ([1] to
 * [4]) for who stands there and their level, a Status readout of what that comes to (worked out by the game's own stat
 * code), the troop (for now: the enemies on the stage), a few options, and Start / Cancel.
 *
 * Choices are remembered in this browser (`localStorage`: a convenience, never game data), so the second test is Enter.
 * The dialog only asks; `battletest.ts` runs the fight.
 */
import { ENEMIES } from '../../data/enemies';
import { MAX_LEVEL, MEMBERS } from '../../data/party';
import type { MemberId } from '../../game/state';
import type { BattleTestOptions } from '../battleflow';
import { loadoutStats } from '../battleflow';
import type { DemoMember, StageConfig } from '../config';
import { showDialog } from './dialog';
import { h, readStore, writeStore } from './dom';

const STORE = 'sj.battletest.v1';

/** What is remembered between tests. */
interface Remembered {
  party?: Array<{ id: string; level: number }>;
  seed?: number;
  fullResources?: boolean;
  auto?: boolean;
  speed?: 1 | 2;
  /** The enemy group last tested on a stage ("3", "boss+1"), by stage id. */
  troop?: Record<string, string>;
}

/** The groups of enemies a stage can field, in a natural order (the numbers, then the boss groups), each with the enemies in it. Only groups that also have slots on the stage. */
export function troopsOf(stage: StageConfig): Array<{ key: string; roster: string[]; label: string }> {
  const order = (k: string): number => (k.startsWith('boss') ? 100 + (k.includes('+') ? Number(k.split('+')[1]) : 0) : Number(k));
  return Object.keys(stage.demo.rosters)
    .filter((k) => k in stage.enemySets)
    .sort((a, b) => order(a) - order(b))
    .map((key) => {
      const roster = stage.demo.rosters[key] ?? [];
      return { key, roster, label: `${key} · ${roster.map((e) => ENEMIES[e]?.name ?? e).join(', ')}` };
    });
}

export interface DialogContext {
  /** The stage being edited, unsaved changes included. */
  stage: StageConfig;
  /** The slot set shown ("3", "boss+1") and the enemies standing in it. */
  setKey: string;
  roster: string[];
  unsaved: boolean;
}

const MEMBER_IDS = Object.keys(MEMBERS) as MemberId[];

/** The loadout for crew member `id` at `level`: the stage's own gear and story flags for that member when it has them. */
function loadoutFor(stage: StageConfig, id: string, level: number): DemoMember {
  const own = stage.demo.party.find((m) => m.id === id);
  return { id, level, ...(own?.equip ? { equip: { ...own.equip } } : {}), ...(own?.flags ? { flags: [...own.flags] } : {}) };
}

function levelRange(id: string): { min: number; max: number } {
  const def = MEMBERS[id as MemberId];
  return { min: def?.baseLevel ?? 1, max: MAX_LEVEL };
}

/** The starting party for the dialog: the last test's if it still makes sense, else the stage's own. */
export function initialParty(stage: StageConfig, remembered: Remembered = readStore<Remembered>(STORE, {})): DemoMember[] {
  const base = stage.demo.party.map((m) => ({ ...m }));
  const r = remembered.party;
  if (!r || r.length !== base.length) return base;
  const ids = r.map((m) => m.id);
  if (new Set(ids).size !== ids.length || !ids.every((id) => id in MEMBERS)) return base;
  return r.map((m) => {
    const { min, max } = levelRange(m.id);
    return loadoutFor(stage, m.id, Math.max(min, Math.min(max, Math.round(m.level))));
  });
}

/** Ask what to test. Resolves with the options, or null if cancelled. */
export async function battleTestDialog(ctx: DialogContext): Promise<BattleTestOptions | null> {
  const mem = readStore<Remembered>(STORE, {});
  const party = initialParty(ctx.stage, mem);
  let tab = 0;
  let seed = mem.seed ?? ctx.stage.demo.seed;
  let full = mem.fullResources ?? true;
  let auto = mem.auto ?? false;
  let speed: 1 | 2 = mem.speed === 2 ? 2 : 1;
  const troops = troopsOf(ctx.stage);
  // The group last used on this stage if it still exists, else the one the editor is showing.
  const remembered = mem.troop?.[ctx.stage.id];
  let troopKey = troops.some((t) => t.key === remembered) ? (remembered as string) : ctx.setKey;
  if (!troops.some((t) => t.key === troopKey)) troopKey = troops[0]?.key ?? ctx.setKey;
  const rosterOf = (key: string): string[] => (key === ctx.setKey ? ctx.roster : (troops.find((t) => t.key === key)?.roster ?? ctx.roster));
  /** "Test one move": slot and ability, or null to give the orders yourself. */
  let drill: { slot: number; ability: string } | null = null;

  const tabs = h('div', { class: 'bt-tabs', role: 'tablist' });
  const panel = h('div', { class: 'bt-panel', 'data-testid': 'bt-panel' });
  const demoNow = (): BattleTestOptionsDemo => ({ ...ctx.stage.demo, party });
  type BattleTestOptionsDemo = typeof ctx.stage.demo;

  let afterRender: () => void = () => undefined;
  const render = (): void => {
    afterRender();
    tabs.replaceChildren(
      ...party.map((m, i) =>
        h('button', { type: 'button', role: 'tab', class: i === tab ? 'on' : '', 'aria-selected': String(i === tab), 'data-tab': String(i + 1), onclick: () => { tab = i; render(); } }, `[${i + 1}] ${MEMBERS[m.id as MemberId]?.name ?? m.id}`),
      ),
    );
    const m = party[tab] as DemoMember;
    const { min, max } = levelRange(m.id);
    const stats = loadoutStats(demoNow(), tab);
    const member = h(
      'select',
      {
        'aria-label': `Member in slot ${tab + 1}`,
        'data-testid': 'bt-member',
        onchange: (e: Event) => {
          const id = (e.target as HTMLSelectElement).value;
          const other = party.findIndex((p, i) => p.id === id && i !== tab);
          const mine = party[tab] as DemoMember;
          const theirs = other >= 0 ? (party[other] as DemoMember) : null;
          const clamp = (who: string, level: number): number => Math.max(levelRange(who).min, Math.min(levelRange(who).max, level));
          // Choosing someone who is already in the party swaps the two slots (each keeps the level they had).
          party[tab] = loadoutFor(ctx.stage, id, clamp(id, theirs ? theirs.level : mine.level));
          if (theirs) party[other] = loadoutFor(ctx.stage, mine.id, clamp(mine.id, mine.level));
          render();
        },
      },
      ...MEMBER_IDS.map((id) => h('option', { value: id, selected: id === m.id }, MEMBERS[id].name)),
    );
    const level = h('input', {
      type: 'number',
      min: String(min),
      max: String(max),
      step: '1',
      value: String(m.level),
      'aria-label': `Level of slot ${tab + 1}`,
      'data-testid': 'bt-level',
      onchange: (e: Event) => {
        const v = Math.round(Number((e.target as HTMLInputElement).value));
        party[tab] = { ...m, level: Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : m.level };
        render();
      },
    });
    const num = (label: string, v: number | string): Node => h('div', { class: 'bt-stat' }, h('span', {}, label), h('b', {}, String(v)));
    panel.replaceChildren(
      h('div', { class: 'bt-row' }, h('label', {}, h('span', {}, 'Member'), member), h('label', {}, h('span', {}, `Level (${min}-${max})`), level)),
      ...(stats
        ? [h(
            'div',
            { class: 'bt-status', 'data-testid': 'bt-status' },
            h('div', { class: 'bt-stats' }, num('HP', stats.maxHp), num(stats.resLabel === '—' ? 'Resource' : stats.resLabel, stats.maxTp > 0 ? stats.maxTp : '—'), num('ATK', stats.atk), num('DEF', stats.def), num('MND', stats.mnd), num('AGI', stats.agi)),
            h('div', { class: 'bt-skills' }, stats.skills.length ? `Skills: ${stats.skills.join(', ')}` : 'Knows no skills yet'),
          )]
        : []),
    );
  };
  render();

  const foes = h('div', { class: 'bt-troop', 'data-testid': 'bt-troop' });
  const renderFoes = (): void => {
    foes.replaceChildren(...rosterOf(troopKey).map((k) => h('span', { class: 'chip' }, `${ENEMIES[k]?.name ?? k} · ${ENEMIES[k]?.hp ?? '?'} HP`)));
  };
  renderFoes();
  const troopSel = h(
    'select',
    {
      'aria-label': 'Enemy group',
      'data-testid': 'bt-troop-select',
      onchange: (e: Event) => {
        troopKey = (e.target as HTMLSelectElement).value;
        renderFoes();
      },
    },
    ...troops.map((t) => h('option', { value: t.key, selected: t.key === troopKey }, t.label)),
  );

  // "Test one move": pick a hero's attack or skill and the fight plays itself with only that move, round after round.
  const drillSel = h('select', {
    'aria-label': 'Test one move',
    'data-testid': 'bt-drill',
    onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      const [slot, ...rest] = v.split(':');
      drill = v === '' ? null : { slot: Number(slot), ability: rest.join(':') };
    },
  });
  const renderDrill = (): void => {
    const options: Node[] = [h('option', { value: '' }, 'No: I give the orders')];
    party.forEach((m, i) => {
      const stats = loadoutStats(demoNow(), i);
      const who = MEMBERS[m.id as MemberId]?.name ?? m.id;
      options.push(h('option', { value: `${i}:attack`, selected: drill?.slot === i && drill.ability === 'attack' }, `${who}: Attack`));
      for (const mv of stats?.moves ?? []) options.push(h('option', { value: `${i}:${mv.id}`, selected: drill?.slot === i && drill.ability === mv.id }, `${who}: ${mv.name}`));
    });
    drillSel.replaceChildren(...options);
  };
  renderDrill();
  afterRender = renderDrill;
  const check = (label: string, on: boolean, set: (v: boolean) => void, testid: string): Node =>
    h('label', { class: 'bt-check' }, h('input', { type: 'checkbox', checked: on, 'data-testid': testid, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), h('span', {}, label));
  const speedSel = h(
    'select',
    { 'aria-label': 'Speed', 'data-testid': 'bt-speed', onchange: (e: Event) => { speed = (e.target as HTMLSelectElement).value === '2' ? 2 : 1; } },
    h('option', { value: '1', selected: speed === 1 }, '1× speed'),
    h('option', { value: '2', selected: speed === 2 }, '2× speed'),
  );
  const seedInput = h('input', { type: 'number', step: '1', value: String(seed), 'aria-label': 'Random seed', 'data-testid': 'bt-seed', onchange: (e: Event) => { const v = Math.round(Number((e.target as HTMLInputElement).value)); if (Number.isFinite(v)) seed = v; } });

  const body = h(
    'div',
    { class: 'bt' },
    h(
      'p',
      { class: 'bt-note' },
      h('span', { class: `bt-badge ${ctx.unsaved ? 'edited' : 'saved'}`, 'data-testid': 'bt-badge' }, ctx.unsaved ? 'Edited · unsaved' : 'Saved'),
      ` ${ctx.unsaved ? `Testing your unsaved changes to “${ctx.stage.name}”: the fight uses the stage exactly as it is on screen.` : `Testing “${ctx.stage.name}” as saved.`}`,
    ),
    tabs,
    panel,
    h('h3', {}, 'Troop'),
    h('div', { class: 'bt-row' }, h('label', {}, h('span', {}, 'Enemy group (the stage’s own groups)'), troopSel)),
    foes,
    h('h3', {}, 'Options'),
    h('div', { class: 'bt-options' }, check('Start at full resources', full, (v) => { full = v; }, 'bt-full'), check('Auto-play: the computer gives the heroes’ orders', auto, (v) => { auto = v; }, 'bt-auto'), h('label', { class: 'bt-seed' }, h('span', {}, 'Test one move (plays itself)'), drillSel), speedSel, h('label', { class: 'bt-seed' }, h('span', {}, 'Random seed (same seed, same fight)'), seedInput)),
    h('p', { class: 'bt-partial', 'data-testid': 'bt-partial' }, 'A partial test: not in the Battle Test yet are the timed-press ring, Combos, Items and Run (every action resolves with no timing bonus, and Combo, Item and Run say so).'),
    h('p', { class: 'bt-keys' }, 'In the fight: arrows choose, Enter confirms, Backspace steps back, A toggles auto-play, Esc returns here.'),
  );
  const result = await showDialog('Battle Test', [body], ['Cancel', 'Start'], 'Start');
  if (result !== 'Start') return null;
  writeStore(STORE, { party: party.map((m) => ({ id: m.id, level: m.level })), seed, fullResources: full, auto, speed, troop: { ...(mem.troop ?? {}), [ctx.stage.id]: troopKey } } satisfies Remembered);
  return { party: party.map((m) => ({ ...m })), roster: [...rosterOf(troopKey)], setKey: troopKey, seed, fullResources: full, speed, auto: auto || drill !== null, drill };
}
