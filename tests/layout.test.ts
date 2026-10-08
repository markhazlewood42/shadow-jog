/**
 * Every data-driven string drawn into a fixed box fits it: objectives, combo descriptions and
 * hints, learned-ability lines. A new or reworded line that would overflow fails here.
 */
import { describe, expect, it } from 'vitest';
import { ABILITIES, COMBOS } from '../src/data/abilities';
import { MEMBERS } from '../src/data/party';
import { H, W } from '../src/engine/game';
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

describe('place map', () => {
  it('exit labels stay on screen and never overlap, on every map, with the story at its start and its end', async () => {
    const { exitLabels } = await import('../src/scenes/placemap');
    const { getMap, mapIds } = await import('../src/data/maps');
    const { W, H } = await import('../src/engine/game');
    const bad: string[] = [];
    // Warps can appear with story flags: check with none set and with everything a warp asks for.
    const everything = new Proxy({}, { get: () => true, has: () => true }) as Record<string, unknown>;
    for (const id of mapIds()) {
      for (const flags of [{}, everything]) {
        const labels = exitLabels(getMap(id), flags);
        for (const [i, a] of labels.entries()) {
          const b = a.box;
          if (b.x < 8 || b.x + b.w > W - 8 || b.y < 18 || b.y + b.h > H - 20) bad.push(`${id}: "${a.text}" off screen`);
          for (const o of labels.slice(i + 1)) {
            const c = o.box;
            if (b.x < c.x + c.w && c.x < b.x + b.w && b.y < c.y + c.h && c.y < b.y + b.h) bad.push(`${id}: "${a.text}" overlaps "${o.text}"`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('battle turn-order strip', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // The strip, the top line and the menus all derive from the HUD frame, so each rule is checked
  // for the game's frame (the whole screen, D6 option 1) and for an inset one (the 480x270 block
  // the HUD used to fit in, off center): a frame that is not the screen must carry every piece with it.
  const frames = async () => {
    const { HUD, hudLayout } = await import('../src/scenes/battlekit/geom');
    const inset = { x: W / 16, y: H / 8, w: (W * 3) / 4, h: (H * 3) / 4 };
    return [{ frame: 'the whole screen', hud: HUD, all: true }, { frame: 'an inset frame', hud: hudLayout(inset), all: false }];
  };

  it('the top line never grows past its band: every description is at most two lines, every combo hint one', async () => {
    for (const { frame, hud } of await frames()) {
      const maxW = hud.frame.w - 44;
      for (const ab of Object.values(ABILITIES)) expect(wrap(ab.desc, maxW).length, `${frame}: ${ab.id}`).toBeLessThanOrEqual(2);
      for (const it of Object.values(ITEMS)) expect(wrap(it.desc, maxW).length, `${frame}: ${it.id}`).toBeLessThanOrEqual(2);
      // Three lines at most (two of description, one of hint): the window ends by the band's edge.
      expect(hud.topY + 6 + 3 * 11, `${frame}`).toBeLessThanOrEqual(hud.topBandBottom);
    }
  });

  it('stays clear of the top line, the target box, the party panel and the menus, in both frames', async () => {
    const { LIST_MAX_W, ORDER_LABEL_ABOVE, orderStripLayout } = await import('../src/scenes/battlekit/geom');
    // The widest crowd: a three-member combo (three faces) and eight single actions.
    const faces = [3, 1, 1, 1, 1, 1, 1, 1, 1];
    for (const { frame, hud, all } of await frames()) {
      const f = hud.frame;
      // The target box as renderTargetInfo draws it at its tallest (analyzed, three notes). It sits
      // beside the strip's column when the target is on the left, and at the frame's left edge when it is on the right.
      const box = (targetOnLeft: boolean) => ({ x: hud.targetBoxX(targetOnLeft, TARGET_INFO_W), y: hud.targetY, w: TARGET_INFO_W, h: 19 + 11 + 3 * 10 });
      const boxBesideStrip = box(true), boxAtLeftEdge = box(false);
      expect(hud.orderTop - ORDER_LABEL_ABOVE, `${frame}`).toBeGreaterThanOrEqual(hud.topBandBottom);
      for (const side of ['left', 'right'] as const) {
        // The acting member's menus open on the other side: a list window, at its widest (LIST_MAX_W,
        // 210), stacked above the command window.
        const menus = side === 'right' ? { x: hud.menuX, y: hud.topBandBottom, w: LIST_MAX_W, h: hud.panelY - hud.topBandBottom } : { x: f.x + f.w - 4 - LIST_MAX_W, y: hud.topBandBottom, w: LIST_MAX_W, h: hud.panelY - hud.topBandBottom };
        const rects = orderStripLayout(faces, side, hud);
        // The whole screen shows the whole crowd. The inset block is the old 480x270 one, which showed eight entries.
        expect(rects.length, `${frame}, ${side}`).toBeGreaterThanOrEqual(all ? faces.length : 8);
        for (const r of rects) {
          expect(r.y, `${frame}, ${side}`).toBeGreaterThanOrEqual(hud.topBandBottom);
          expect(r.y + r.h, `${frame}, ${side}`).toBeLessThanOrEqual(hud.panelY - 2);
          expect(r.x >= f.x && r.x + r.w <= f.x + f.w, `${frame}, ${side} inside the frame`).toBe(true);
          // The strip stands on the right in the game, and must clear both places the target box can
          // be. A strip on the left is only a what-if: the box does not move for it, so the box at
          // the left edge would overlap it by design; it is checked against the far box (the right-hand one) only.
          for (const b of side === 'right' ? [boxBesideStrip, boxAtLeftEdge] : [boxBesideStrip]) expect(overlap(r, b), `${frame}, ${side} strip vs target box`).toBe(false);
          expect(overlap(r, menus), `${frame}, ${side} strip vs menus`).toBe(false);
        }
      }
    }
  });

  it('a crowd that does not fit drops its last entries (the strip shows "+N"), and keeps the ones it shows above the panel', async () => {
    const { ORDER_ENTRY_H, orderStripLayout } = await import('../src/scenes/battlekit/geom');
    for (const { frame, hud } of await frames()) {
      const faces = Array<number>(40).fill(1);
      const rects = orderStripLayout(faces, 'right', hud);
      expect(rects.length, `${frame}`).toBeGreaterThan(0);
      expect(rects.length, `${frame}`).toBeLessThan(faces.length);
      expect(rects[rects.length - 1]!.y + ORDER_ENTRY_H, `${frame}`).toBeLessThanOrEqual(hud.orderBottom);
    }
  });
});
