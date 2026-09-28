/**
 * Every data-driven string drawn into a fixed box fits it: objectives, combo descriptions and
 * hints, learned-ability lines. A new or reworded line that would overflow fails here.
 */
import { describe, expect, it } from 'vitest';
import { ABILITIES, COMBOS } from '../src/data/abilities';
import { MEMBERS } from '../src/data/party';
import { measure, stripCodes, wrap } from '../src/engine/font';
import { OBJ } from '../src/story/chapter1';
import { COMBO_TEXT_W, FIELD_OBJ_W, LEVELUP_TEXT_W, MENU_OBJ_W } from '../src/ui/layout';

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
