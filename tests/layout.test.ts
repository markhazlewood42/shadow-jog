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
  /** Every panel of every page, labeled. */
  const allPanels = async () => {
    const { PAGES } = await import('../src/scenes/panels');
    return Object.entries(PAGES).flatMap(([id, pages]) => pages.flatMap((page, pi) => page.map((pn, i) => ({ pn, label: `${id} page ${pi + 1} panel ${i + 1}` }))));
  };

  it('no speech bubble covers its speaker’s portrait, and every bubble fits its panel (at the pinned 2x and at the 3x variant)', async () => {
    const { portraitRect, speechLayout } = await import('../src/scenes/panels');
    const { SPEAKERS } = await import('../src/data/speakers');
    for (const scale of [null, 3]) {
      for (const { pn: raw, label: where } of await allPanels()) {
        // 3x is the review variant of D9: the same panels with every portrait pinned to it.
        const pn = scale && raw.portrait ? { ...raw, portrait: { ...raw.portrait, scale } } : raw;
        if (!pn.speech) continue;
        const name = SPEAKERS[pn.speech.who]?.name ?? pn.speech.who;
        const b = speechLayout(pn, pn.x, name);
        const label = `${where} at ${scale ?? 2}x: ${pn.speech.text.slice(0, 30)}`;
        expect(b.bx, label).toBeGreaterThanOrEqual(pn.x);
        expect(b.bx + b.w, label).toBeLessThanOrEqual(pn.x + pn.w);
        expect(b.lines.length * 11 + 20, label).toBeLessThanOrEqual(pn.h - 8);
        const por = portraitRect(pn, pn.x);
        if (por) expect(b.bx + b.w <= por.px || b.bx >= por.px + por.pw, `${label} overlaps the portrait`).toBe(true);
      }
    }
  });

  it('all 17 panels lie inside the frame 8..W-8 by 8..H-18 (PL4), and every portrait is pinned and fits its panel', async () => {
    const { PANEL_FRAME, portraitRect } = await import('../src/scenes/panels');
    const { W, H } = await import('../src/engine/game');
    const panels = await allPanels();
    expect(panels.length).toBe(17);
    expect(PANEL_FRAME).toEqual({ x0: 8, y0: 8, x1: W - 8, y1: H - 18 });
    const bad: string[] = [];
    for (const { pn, label } of panels) {
      if (pn.x < 8 || pn.y < 8 || pn.x + pn.w > W - 8 || pn.y + pn.h > H - 18) bad.push(`${label}: ${pn.x},${pn.y} ${pn.w}x${pn.h} leaves the frame`);
      if (pn.portrait) {
        if (pn.portrait.scale === undefined) bad.push(`${label}: the portrait scale is not pinned`);
        const por = portraitRect(pn, pn.x);
        if (por && (por.px < pn.x || por.px + por.pw > pn.x + pn.w)) bad.push(`${label}: the portrait leaves its panel`);
        if (por && por.pw > pn.h) bad.push(`${label}: the portrait is taller than its panel`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('panels on one page do not overlap, and a page fills its frame (no panel leaves a strip wider than a gutter)', async () => {
    const { PAGES, PANEL_FRAME } = await import('../src/scenes/panels');
    const bad: string[] = [];
    for (const [id, pages] of Object.entries(PAGES)) {
      pages.forEach((page, pi) => {
        for (const [i, a] of page.entries()) {
          for (const c of page.slice(i + 1)) if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) bad.push(`${id} page ${pi + 1}: panels overlap`);
        }
        const right = Math.max(...page.map((p) => p.x + p.w)), bottom = Math.max(...page.map((p) => p.y + p.h));
        if (PANEL_FRAME.x1 - right > 6 || PANEL_FRAME.y1 - bottom > 6) bad.push(`${id} page ${pi + 1}: the panels stop short of the frame (right ${right}, bottom ${bottom})`);
      });
    }
    expect(bad).toEqual([]);
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

describe('the Status screen (WP4)', () => {
  it('every bio and the wound line end above the divider that opens the lower half', async () => {
    const { STATUS_BIO_W, STATUS_DIVIDER_Y } = await import('../src/ui/layout');
    for (const [id, m] of Object.entries(MEMBERS)) {
      const lines = wrap(m.bio, STATUS_BIO_W).length;
      // The bio starts at y 74 with a 10 px pitch; the wound line (Rook) is one more row, 12 px under it.
      expect(74 + lines * 10 + 12, `${id}'s bio is ${lines} lines`).toBeLessThanOrEqual(STATUS_DIVIDER_Y);
    }
  });

  it('every member’s abilities, known and locked, fit the three columns of nine rows', async () => {
    const { STATUS_ABILITY_COLS, STATUS_ABILITY_ROWS } = await import('../src/ui/layout');
    const { applyStage } = await import('../src/game/stages');
    const { knownAbilities, lockedAbilities } = await import('../src/game/party');
    const stateMod = await import('../src/game/state');
    let judged = 0;
    for (const stage of ['start', 'sinkline', 'annex', 'finale']) {
      applyStage(stage);
      // `state` is a live binding that `applyStage` replaces, so it is read through the module after the stage is applied.
      for (const m of Object.values(stateMod.state.members)) {
        if (!m) continue;
        judged++;
        const n = knownAbilities(m).length + lockedAbilities(m).length;
        expect(n, `${m.id} at ${stage}`).toBeLessThanOrEqual(STATUS_ABILITY_COLS * STATUS_ABILITY_ROWS);
      }
    }
    expect(judged).toBeGreaterThanOrEqual(10);
  });

  it('the stat block, the bio and the ability columns sit inside the window', async () => {
    const { STATUS_ABILITY_COL_W, STATUS_ABILITY_COLS, STATUS_ABILITY_X, STATUS_BIO_W, STATUS_STATS_W, STATUS_STATS_X, STATUS_TEXT_X } = await import('../src/ui/layout');
    // The window runs 8..W-8; its content keeps a 2 px frame and a few px of room.
    expect(STATUS_STATS_X + STATUS_STATS_W).toBeLessThanOrEqual(W - 18);
    expect(STATUS_TEXT_X + STATUS_BIO_W).toBeLessThan(STATUS_STATS_X);
    expect(STATUS_ABILITY_X + STATUS_ABILITY_COLS * STATUS_ABILITY_COL_W).toBeLessThanOrEqual(W - 16);
  });
});

describe('list rows follow the window height (WP4)', () => {
  it('rowsFor gives the rows that fit, and at least one', async () => {
    const { rowsFor } = await import('../src/ui/layout');
    expect(rowsFor(110, 11)).toBe(10);
    expect(rowsFor(120, 11)).toBe(10);
    expect(rowsFor(121, 11)).toBe(11);
    expect(rowsFor(5, 11)).toBe(1);
    // The combo log: 8 rows at 360 high, 6 at 270 high (the old count).
    expect(rowsFor(H - 8 - 40, 36)).toBe(8);
    expect(rowsFor(270 - 8 - 40, 36)).toBe(6);
  });
});

describe('the dialog and menu caps (D8 defaults)', () => {
  it('the dialog box is capped at 464 and the menu panes at 364, and both fit the screen', async () => {
    const { DIALOG_MAX_W, MENU_PANE_MAX_W, MENU_PANE_X, dialogBoxW, menuPaneW, menuCardStrip } = await import('../src/ui/layout');
    expect(dialogBoxW()).toBe(Math.min(DIALOG_MAX_W, W - 16));
    expect(menuPaneW()).toBe(Math.min(MENU_PANE_MAX_W, W - MENU_PANE_X - 8));
    // At 640 the strip right of the list holds the compact cards; they fit the margin.
    const strip = menuCardStrip();
    expect(strip).not.toBeNull();
    expect(strip!.x + strip!.w).toBe(W - 8);
  });
});
