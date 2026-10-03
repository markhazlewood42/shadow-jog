import { describe, expect, it } from 'vitest';
import stagesJson from '../src/data/stages.json';
import { type StageConfig, loadStages } from '../src/stage/config';
import { buildHudView, foeViews, memberView, type TurnChipView } from '../src/stage/demo';
import { bandPlans, foeLayout, timelineLayout } from '../src/stage/hudlayout';
import { hitKind, HIT_COLOUR, hpColor, UI } from '../src/stage/hudcolours';
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
    expect([band?.x, band?.y, band?.w, band?.h]).toEqual([4, 228, 472, 40]);
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
