import { describe, expect, it } from 'vitest';
import stagesJson from '../src/data/stages.json';
import { type StageConfig, loadStages } from '../src/stage/config';
import { buildHudView, foeViews, memberView, type TurnChipView } from '../src/stage/demo';
import { bandPlans, foeLayout, foeName, stageBarSize, targetTab, timelineLayout } from '../src/stage/hudlayout';
import { hitKind, HIT_COLOUR, hpColor, numberScale, UI } from '../src/stage/hudcolours';
import { iconRaw, COMMAND_ICONS } from '../src/stage/icons';
import { applyPreset, PRESET_IDS } from '../src/stage/hudpresets';
import { pickStatuses, STATUS_LOOK, STATUS_MAX } from '../src/stage/hudstatus';
import { enemyParty } from '../src/battle/setup';

const street = (): StageConfig => JSON.parse(JSON.stringify(loadStages(stagesJson).street)) as StageConfig;

/** A turn order of n chips alternating heroes and foes, the first being NOW. */
const order = (n: number): TurnChipView[] => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? { side: 'party' as const, index: i % 4 } : { side: 'enemy' as const, index: i % 3 }));

describe('HUD polish: the unified bottom band', () => {
  it('the shipped boxes are framed as one window from the party table to the enemy box, with a divider in each gap', () => {
    const plans = bandPlans(street().hud);
    expect(plans).toHaveLength(1);
    const [band] = plans;
    expect(band?.members).toEqual(['partyStatus', 'commands', 'enemyInfo']);
    expect([band?.x, band?.y, band?.w, band?.h]).toEqual([4, 226, 472, 42]);
    expect(band?.dividers).toEqual([202, 318]);
  });

  it('every preset gives a band (the floating-menu one keeps its menu apart), so switching presets never loses the frame', () => {
    for (const id of PRESET_IDS) {
      const s = street();
      applyPreset(s.hud, id, true);
      const plans = bandPlans(s.hud);
      const members = plans.flatMap((p) => p.members).sort();
      if (id === 'ps4-panels') expect({ id, members }).toEqual({ id, members: ['enemyInfo', 'partyStatus'] });
      else expect({ id, members }).toEqual({ id, members: ['commands', 'enemyInfo', 'partyStatus'] });
      for (const p of plans) expect(p.x + p.w).toBeLessThanOrEqual(480);
    }
  });

  it('a box hidden by hand leaves the band, and a box moved off the row is framed on its own', () => {
    const s = street();
    s.hud.commands.show = 'never';
    // Party and enemy boxes are now 120 px apart: two lone boxes, no band.
    expect(bandPlans(s.hud)).toEqual([]);
    // The menu floats above the band: the party table and the enemy box are on the row and 120 px apart, so each stands alone.
    const t = street();
    t.hud.commands.y = 180;
    expect(bandPlans(t.hud)).toEqual([]);
    // Move the enemy box next to the party table instead, and those two share a band without the menu.
    t.hud.enemyInfo.x = t.hud.partyStatus.x + t.hud.partyStatus.w + 4;
    expect(bandPlans(t.hud).flatMap((p) => p.members).sort()).toEqual(['enemyInfo', 'partyStatus']);
  });
});

describe('HUD polish: the timeline', () => {
  const t = street().hud.turnOrder;

  it('chips sit a chip and a gap apart and the next round is previewed after a tick, in order, inside the box', () => {
    const turns = order(7);
    const [now, ...rest] = turns;
    const place = timelineLayout(t, rest, now);
    expect(place.chips).toHaveLength(rest.length);
    expect(place.pitch).toBe(t.chip + 4);
    expect(place.later.length).toBeGreaterThan(0);
    // The preview starts again from NOW and follows the same order.
    expect(place.later.map((c) => `${c.side}${c.index}`)).toEqual(turns.slice(0, place.later.length).map((c) => `${c.side}${c.index}`));
    const markX = place.roundMark ?? -1;
    expect(markX).toBeGreaterThan((place.chips[place.chips.length - 1]?.x ?? 0) + t.chip);
    for (const c of place.later) {
      expect(c.x).toBeGreaterThan(markX);
      expect(c.x + t.chip).toBeLessThanOrEqual(place.line.x1);
    }
  });

  it('a crowded fight packs this round and drops the preview; the smallest fight (four heroes against one foe) fills the track instead of leaving it bare', () => {
    const crowded = timelineLayout(t, order(10).slice(1), order(10)[0]);
    expect(crowded.chips).toHaveLength(9);
    expect(crowded.later).toHaveLength(0);
    expect(crowded.roundMark).toBeNull();
    const small = timelineLayout(t, order(5).slice(1), order(5)[0]);
    // The chips of this round and the preview together reach well past the middle of the track.
    const far = Math.max(...[...small.chips, ...small.later].map((c) => c.x + t.chip));
    expect(far).toBeGreaterThan(small.line.x0 + (small.line.x1 - small.line.x0) * 0.5);
  });

  it('without a NOW chip given there is no preview (the old call still works)', () => {
    const place = timelineLayout(t, order(5).slice(1));
    expect(place.later).toEqual([]);
    expect(place.roundMark).toBeNull();
  });
});

describe('HUD polish: the enemy box sizes itself to its contents', () => {
  it('a lone foe is a read-out, two to four a list that spreads over the box, five and six two columns', () => {
    expect(foeLayout(1, 40).mode).toBe('detail');
    for (const n of [2, 3, 4]) {
      const lay = foeLayout(n, 40);
      expect(lay.mode).toBe('list');
      expect(lay.rows * lay.rowH).toBeLessThanOrEqual(40 - 4);
    }
    expect(foeLayout(2, 40).rowH).toBeGreaterThan(foeLayout(4, 40).rowH);
    for (const n of [5, 6]) {
      const lay = foeLayout(n, 40);
      expect(lay).toMatchObject({ mode: 'grid', rows: 3 });
      expect(lay.rows * lay.rowH).toBeLessThanOrEqual(36);
    }
  });

  it('a duplicate foe has the same letter in its name and its tag, and a lone one has none', () => {
    const views = foeViews(enemyParty(['rustfang_punk', 'glowrat', 'rustfang_punk']));
    expect(views.map((v) => v.tag)).toEqual(['A', '', 'B']);
    for (const v of views) expect(v.tag === '' || v.name.endsWith(` ${v.tag}`)).toBe(true);
  });
});

describe('HUD polish: states you can read', () => {
  it('a health bar is green above half, amber under half, red under a quarter', () => {
    expect([1, 0.51, 0.5, 0.26, 0.25, 0.1, 0].map(hpColor)).toEqual([UI.green, UI.green, UI.amber, UI.amber, UI.red, UI.red, UI.red]);
  });

  it('a damage number is pale, amber for a critical, cyan for a weak spot (a critical wins when both)', () => {
    expect([hitKind(false, false), hitKind(true, false), hitKind(false, true), hitKind(true, true)]).toEqual(['normal', 'crit', 'weak', 'crit']);
    expect(new Set(Object.values(HIT_COLOUR)).size).toBe(3);
  });

  it('every status the engine has a look for draws five rows of five, and a hero shows the three most urgent', () => {
    for (const [id, look] of Object.entries(STATUS_LOOK)) {
      expect({ id, rows: look.rows.length, widths: new Set(look.rows.map((r) => r.length)) }).toEqual({ id, rows: 5, widths: new Set([5]) });
      expect(look.rows.join('')).toContain('#');
    }
    const { shown, more } = pickStatuses(['atk_up', 'poison', 'guard', 'stun', 'regen']);
    expect(shown).toEqual(['stun', 'poison', 'guard']);
    expect(shown).toHaveLength(STATUS_MAX);
    expect(more).toBe(2);
    expect(pickStatuses([])).toEqual({ shown: [], more: 0 });
  });

  it('the party table’s view carries the engine’s statuses', () => {
    const v = buildHudView(street().demo, '3', 'choose');
    expect(v.party.every((m) => Array.isArray(m.status))).toBe(true);
    const demo = street().demo;
    const party = buildHudView(demo, '3', 'choose').party;
    expect(party[0]).toBeDefined();
    const c = { ...enemyParty(['glowrat'])[0], key: 'kit', status: [{ id: 'poison' as const, turns: 2 }] };
    expect(memberView(c as never).status).toEqual(['poison']);
  });
});

/** WCAG relative luminance and contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('HUD polish round 2', () => {
  it('secondary text (hints, resource labels, unfocused codes) is at least 7:1 on the panel; text standing by or out of play is at least 4.5:1', () => {
    expect(contrast(UI.dim, UI.fillBot)).toBeGreaterThanOrEqual(7);
    expect(contrast(UI.dim, UI.fillTop)).toBeGreaterThanOrEqual(7);
    expect(contrast(UI.soft, UI.fillBot)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(UI.disabled, UI.fillBot)).toBeGreaterThanOrEqual(4.5);
  });

  it('a damage number is 3x for an ordinary hit and 4x for a critical or a weak spot', () => {
    expect([numberScale('normal'), numberScale('crit'), numberScale('weak')]).toEqual([3, 4, 4]);
  });

  it('status colours say the kind: buff arrows cyan, debuff arrows red, poison purple; every stat has its own arrow shape, and a debuff is its buff upside down', () => {
    const ups = ['atk_up', 'def_up', 'res_up', 'agi_up'] as const;
    for (const id of ups) expect(STATUS_LOOK[id].colour).toBe(UI.cyan);
    for (const id of ['atk_down', 'def_down', 'agi_down'] as const) expect(STATUS_LOOK[id].colour).toBe('#ff6b6b');
    expect(new Set(ups.map((id) => STATUS_LOOK[id].rows.join('/'))).size).toBe(4);
    expect([...STATUS_LOOK.atk_up.rows].reverse()).toEqual([...STATUS_LOOK.atk_down.rows]);
    expect(STATUS_LOOK.poison.colour).toBe('#c27cff');
    // No two statuses share both a colour and a shape.
    const seen = new Set(Object.values(STATUS_LOOK).map((l) => `${l.colour}|${l.rows.join('/')}`));
    expect(seen.size).toBe(Object.keys(STATUS_LOOK).length);
  });

  it('a foe in capitals prints as a name, a name already in mixed case is left alone', () => {
    expect([foeName('WARDEN'), foeName('Sewer Ghoul'), foeName('Rustfang Punk A'), foeName('A')]).toEqual(['Warden', 'Sewer Ghoul', 'Rustfang Punk A', 'A']);
  });

  it('the foe view carries the engine’s statuses for the list to draw', () => {
    const c = { ...enemyParty(['glowrat'])[0], status: [{ id: 'poison' as const, turns: 2 }] };
    expect(foeViews([c as never])[0]?.status).toEqual(['poison']);
  });

  it('every command icon is drawn with a dark outline round it, and only that outline reaches the edge of its 16 px square', () => {
    for (const kind of COMMAND_ICONS) {
      const raw = iconRaw(kind);
      const px = (x: number, y: number): string => [0, 1, 2, 3].map((k) => raw.px[(y * 16 + x) * 4 + k] ?? 0).join(',');
      let drawn = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (px(x, y) !== '0,0,0,0') drawn++;
      expect({ kind, ok: drawn > 80 }).toEqual({ kind, ok: true });
      for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]] as const) expect({ kind, x, y, edge: ['0,0,0,0', '7,6,13,255'].includes(px(x, y)) }).toEqual({ kind, x, y, edge: true });
    }
  });

  it('the aimed-at foe’s name tab sits above its head when there is room, and BESIDE a tall foe instead of over its face', () => {
    // A short foe low on the screen: the tab is above, centred, clear of the banner.
    const rat = targetTab({ x: 300, top: 150, left: 280, right: 320 }, 40, 480, 56);
    expect(rat).toEqual({ x: 280, y: 136, side: 'above' });
    // The sewer Ghoul stands from y 46: above would be under the banner, so the tab goes to the right of its widest edge, at the clear line.
    const ghoul = { x: 305, top: 46, left: 275, right: 340 };
    const tab = targetTab(ghoul, 60, 480, 56);
    expect(tab.side).toBe('right');
    expect(tab.x).toBeGreaterThan(ghoul.right);
    expect(tab.y).toBe(56);
    // No room on the right (a foe at the screen's edge): the tab goes left of it, and stays on the screen.
    const edge = targetTab({ x: 440, top: 46, left: 410, right: 475 }, 60, 480, 56);
    expect(edge.side).toBe('left');
    expect(edge.x + 60).toBeLessThan(410);
  });

  it('the Warden’s health bar on the stage is wide and tall, an ordinary foe’s is the stage’s own', () => {
    expect(stageBarSize(false, { w: 32, h: 2 })).toEqual({ w: 32, h: 2 });
    expect(stageBarSize(true, { w: 32, h: 2 })).toEqual({ w: 96, h: 4 });
  });
});
