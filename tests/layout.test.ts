/**
 * Every data-driven string drawn into a fixed box fits it: objectives, combo descriptions and
 * hints, learned-ability lines. A new or reworded line that would overflow fails here.
 */
import { describe, expect, it } from 'vitest';
import { ABILITIES, COMBOS } from '../src/data/abilities';
import { MEMBERS } from '../src/data/party';
import { measure, stripCodes, wrap } from '../src/engine/font';
import { OBJ } from '../src/story/chapter1';
import { COMBO_TEXT_W, EQUIP_DESC_LINES, EQUIP_DESC_W, FIELD_OBJ_W, LEVELUP_TEXT_W, MENU_OBJ_W, SHOP_COMPARE_W, TARGET_INFO_W } from '../src/ui/layout';
import { ITEMS } from '../src/data/items';

describe('text fits its box', () => {
  it('objectives: 2 lines in the menu box, 3 in the field corner', () => {
    for (const text of Object.values(OBJ)) {
      expect(wrap(text, MENU_OBJ_W).length, text).toBeLessThanOrEqual(2);
      expect(wrap(text, FIELD_OBJ_W).length, text).toBeLessThanOrEqual(3);
      for (const ln of wrap(text, MENU_OBJ_W)) expect(measure(ln), ln).toBeLessThanOrEqual(MENU_OBJ_W);
    }
  });

  it('combo log rows fit on one line, uncut', () => {
    for (const c of COMBOS) {
      const ab = ABILITIES[c.id]!;
      const names = c.parts.map((p) => `${MEMBERS[p.member as keyof typeof MEMBERS].name}: ${ABILITIES[p.ability]!.name}`).join('  +  ');
      for (const line of [ab.desc, `Hint: ${c.hint}`, names]) expect(measure(stripCodes(line)), line).toBeLessThanOrEqual(COMBO_TEXT_W);
    }
  });

  it('every learnable ability fits the level-up panel', () => {
    for (const ab of Object.values(ABILITIES)) {
      if (ab.kind === 'enemy' || ab.kind === 'combo' || ab.kind === 'item') continue;
      expect(measure(`Learned ${ab.name}!`), ab.name).toBeLessThanOrEqual(LEVELUP_TEXT_W);
    }
  });
});

describe('battle target info', () => {
  it('every enemy’s name and full weakness list share one row of the target box', async () => {
    const { ENEMIES, FAMILY_WEAK } = await import('../src/data/enemies');
    const { ELEMENT_TAG } = await import('../src/scenes/battlekit/tables');
    for (const e of Object.values(ENEMIES)) {
      const weak = { ...FAMILY_WEAK[e.family], ...(e.weak ?? {}) };
      const tags = Object.entries(weak).filter(([, v]) => (v ?? 1) > 1).map(([k]) => ELEMENT_TAG[k as keyof typeof ELEMENT_TAG]);
      const line = tags.length ? `WEAK ${tags.join(' ')}` : '';
      expect(measure(e.name) + 8 + measure(line), e.id).toBeLessThanOrEqual(TARGET_INFO_W - 16);
    }
  });
});

describe('shop and equip text', () => {
  it('an item’s own stat changes fit the shop compare line', () => {
    for (const it of Object.values(ITEMS)) {
      if (!it.slot) continue;
      const parts = (['atk', 'def', 'mnd', 'res', 'agi'] as const).filter((k) => it[k]).map((k) => `{g}${k.toUpperCase()}+${it[k]}{/}`);
      expect(measure(parts.join(' ')), it.id).toBeLessThanOrEqual(SHOP_COMPARE_W);
    }
  });
  it('every equipment description, with the can’t-use note, fits under the equip list', () => {
    const longest = Math.max(...Object.values(MEMBERS).map((m) => m.name.length));
    const who = Object.values(MEMBERS).find((m) => m.name.length === longest)!.name;
    for (const it of Object.values(ITEMS)) {
      if (!it.slot) continue;
      expect(wrap(`${it.desc} {r}${who} can’t use this.{/}`, EQUIP_DESC_W).length, it.id).toBeLessThanOrEqual(EQUIP_DESC_LINES);
    }
  });
});

describe('comic panels', () => {
  it('no speech bubble covers its speaker’s portrait, and every bubble fits its panel', async () => {
    const { PAGES, fitPanel, portraitRect, speechLayout } = await import('../src/scenes/panels');
    const { SPEAKERS } = await import('../src/data/speakers');
    for (const [id, pages] of Object.entries(PAGES)) {
      for (const page of pages) {
        for (const raw of page) {
          const pn = fitPanel(raw);
          if (!pn.speech) continue;
          const name = SPEAKERS[pn.speech.who]?.name ?? pn.speech.who;
          const b = speechLayout(pn, pn.x, name);
          const label = `${id}: ${pn.speech.text.slice(0, 30)}`;
          expect(b.bx, label).toBeGreaterThanOrEqual(pn.x);
          expect(b.bx + b.w, label).toBeLessThanOrEqual(pn.x + pn.w);
          expect(b.lines.length * 11 + 20, label).toBeLessThanOrEqual(pn.h - 8);
          const por = portraitRect(pn, pn.x);
          if (por) expect(b.bx + b.w <= por.px || b.bx >= por.px + por.pw, `${label} overlaps the portrait`).toBe(true);
        }
      }
    }
  });
});
