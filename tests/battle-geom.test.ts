/**
 * Battle geometry (PL4 and V3 of docs/PIVOT-640.md): the size relations the battle layers depend
 * on, the HUD frame and everything anchored to it, and the two fighter rows. The game's HUD frame
 * is the whole screen (D6 option 1, Mark's choice at Review 2). Every rule that derives from the
 * frame also runs on an inset frame, so the derivation itself stays tested: a frame that is not
 * the screen must carry every piece with it.
 *
 * Sizes that only the real art knows (how tall a hero stands, how wide an enemy is) come from
 * tests/fixtures/battle-sprites.json, which scripts/measure-battle-sprites.mjs writes from the game.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COMBOS } from '../src/data/abilities';
import { ENEMIES } from '../src/data/enemies';
import { H, W } from '../src/engine/game';
import {
  BHT, BOSS_OVERLAP_MAX, BW, CARD_GAP, CARD_H, CARD_RAISE, CARD_W, ENEMY_CLEARANCE, ENEMY_GAP, HUD, HUD_FRAME, ORDER_COLUMN_W, ORDER_FACE, ORDER_LABEL_ABOVE, PANEL_Y, PARTY_BOTTOM, PARTY_HEIGHT, PROMPT_CLEAR, STRIP_MAX_FACES, WORLD_SCALE,
  hudLayout, orderStripLayout, partyX, placeEnemies, type EnemyBox, type Rect,
} from '../src/scenes/battlekit/geom';
import sprites from './fixtures/battle-sprites.json';

/** True when rectangle `a` lies inside rectangle `b`. */
const inside = (a: Rect, b: Rect): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * An inset frame: 480x270 on a 640x360 screen (the block the HUD used to fit in), pushed off center
 * to the left so that "centered in the frame" and "centered on the screen" are different things.
 * The game does not use it; the tests do, to show that every anchor follows the frame it is given.
 */
const INSET: Rect = { x: W / 16, y: H / 8, w: (W * 3) / 4, h: (H * 3) / 4 };
/** The layouts the HUD rules run on: the game's own, and the inset one. */
const FRAMES = [{ frame: 'the game frame', hud: HUD }, { frame: 'an inset frame', hud: hudLayout(INSET) }];

describe('the battle world is an exact multiple of the screen', () => {
  it('BW * WORLD_SCALE is the screen width and BHT * WORLD_SCALE is the screen height', () => {
    // If the world were not an exact fraction of the screen, the backdrop would be stretched by a
    // fractional factor (the bare-flip fault: 2.667x under a 2x enemy layer) and pixels would
    // be uneven.
    expect(BW * WORLD_SCALE).toBe(W);
    expect(BHT * WORLD_SCALE).toBe(H);
  });

  it('the world size is whole pixels', () => {
    expect(Number.isInteger(BW)).toBe(true);
    expect(Number.isInteger(BHT)).toBe(true);
  });
});

describe('the HUD frame', () => {
  it('the game’s frame is the whole screen (D6 option 1: the HUD hugs the screen edges)', () => {
    expect(HUD_FRAME).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(HUD.frame).toBe(HUD_FRAME);
  });

  it('the party panel is 56 above the frame bottom: PANEL_Y is H - 56, and the panel follows any frame', () => {
    expect(PANEL_Y).toBe(H - 56);
    expect(HUD.panelY).toBe(H - 56);
    const inset = hudLayout(INSET);
    expect(inset.panelY).toBe(INSET.y + INSET.h - 56);
    expect(inset.panelY).toBeGreaterThan(INSET.y);
  });

  for (const { frame, hud } of FRAMES) {
    it(`${frame}: every anchor lies inside the frame, the menus above the cards`, () => {
      const f = hud.frame;
      expect(hud.menuX).toBeGreaterThanOrEqual(f.x);
      expect(hud.topY).toBeGreaterThanOrEqual(f.y);
      expect(hud.topBandBottom).toBeGreaterThan(hud.topY);
      expect(hud.orderTop - ORDER_LABEL_ABOVE).toBeGreaterThanOrEqual(hud.topBandBottom);
      expect(hud.orderBottom).toBeLessThan(hud.panelY);
      expect(hud.orderLeft).toBeGreaterThanOrEqual(f.x);
      expect(hud.orderRight).toBeLessThanOrEqual(f.x + f.w);
      expect(hud.panelY + CARD_H).toBeLessThanOrEqual(f.y + f.h);
      expect(hud.statusTop).toBeGreaterThan(hud.topY);
      expect(hud.targetY).toBeGreaterThanOrEqual(hud.topBandBottom - 4);
    });

    it(`${frame}: 1 to 4 status cards are centered in the frame, inside it and apart`, () => {
      for (let n = 1; n <= 4; n++) {
        const cards: Rect[] = [];
        for (let i = 0; i < n; i++) cards.push({ x: hud.cardX(i, n), y: hud.panelY - CARD_RAISE, w: CARD_W, h: CARD_H + CARD_RAISE });
        for (const [i, c] of cards.entries()) {
          expect(inside(c, hud.frame), `card ${i} of ${n}`).toBe(true);
          for (const o of cards.slice(i + 1)) expect(overlap(c, o), `cards of ${n}`).toBe(false);
        }
        for (let i = 1; i < n; i++) expect(cards[i]!.x - cards[i - 1]!.x, `${n} cards: one pitch`).toBe(CARD_W + CARD_GAP);
        const left = cards[0]!.x - hud.frame.x, right = hud.frame.x + hud.frame.w - (cards[n - 1]!.x + CARD_W);
        expect(Math.abs(left - right), `${n} cards centered`).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe('the party row', () => {
  it('each hero stands over their own status card, for 1 to 4 members, in either frame', () => {
    // Heroes stand on whole world pixels, so the middle of a hero is within one world pixel's
    // half (WORLD_SCALE / 2 screen pixels) of the middle of their card.
    const TOLERANCE = WORLD_SCALE / 2;
    for (const { frame, hud } of FRAMES) {
      for (let n = 1; n <= 4; n++) {
        for (let i = 0; i < n; i++) {
          const hero = partyX(i, n, hud) * WORLD_SCALE, card = hud.cardX(i, n) + CARD_W / 2;
          expect(Math.abs(hero - card), `${frame}, hero ${i} of ${n}`).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    }
  });

  it('the cards cover the crew from the waist down, and the heads stay clear of the cards (over the shoulder)', () => {
    // The feet sit 40 screen pixels below the panel's top edge, the relation the 480x270 layout had
    // (127 * 2 against 214), so the cards hide the legs and the upper body shows. This is a
    // relation between the world and the game's frame; the world does not follow an inset frame.
    expect(PARTY_BOTTOM * WORLD_SCALE - PANEL_Y).toBe(40);
    const headTop = (PARTY_BOTTOM - PARTY_HEIGHT) * WORLD_SCALE;
    expect(headTop, 'heads above the cards').toBeLessThan(HUD.panelY - CARD_RAISE);
    // A good part of each hero shows above the cards.
    expect(PANEL_Y - headTop).toBeGreaterThanOrEqual(60);
  });

  it('PARTY_HEIGHT covers the tallest idle hero in the measured art, and is not far above it', () => {
    const tallest = Math.max(...Object.values(sprites.party).map((p) => p.frameH - p.idleTop));
    expect(PARTY_HEIGHT).toBeGreaterThanOrEqual(tallest);
    expect(PARTY_HEIGHT).toBeLessThanOrEqual(tallest + 2);
  });
});

describe('the enemy row', () => {
  const regular = Object.entries(sprites.enemies).filter(([, e]) => !e.boss);
  const bosses = Object.entries(sprites.enemies).filter(([, e]) => e.boss);
  const boxOf = (e: { w: number; h: number; top: number; boss: boolean }, lurker = false): EnemyBox => ({ w: e.w, h: e.h, top: e.top, boss: e.boss, lurker });
  const headTop = PARTY_BOTTOM - PARTY_HEIGHT;

  /** The boss fights of the story, each on the backdrop the story gives it (src/story/chapter1.ts, `s.battle(..., { boss: true, bg })`). */
  const BOSS_FIGHTS: [string, string][] = [['knuckles', 'rustyard'], ['lurker', 'junction'], ['warden', 'core'], ['warden_spirit', 'core']];

  /** The grounds of every backdrop (the backdrops are drawn into a fake canvas: no browser here). */
  let grounds: [string, number][] = [];
  let HORIZON = 0;
  beforeAll(async () => {
    const calls = new Proxy({} as Record<string, unknown>, {
      get: (t, p: string) => {
        if (p in t) return t[p];
        if (p === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set: (t, p: string, v) => {
        t[p] = v;
        return true;
      },
    });
    (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => calls }) };
    const bg = await import('../src/art/battlebg');
    HORIZON = bg.HORIZON;
    grounds = bg.BG_IDS.map((id) => [id, bg.battleBg(id).ground]);
  });

  it('the fixture has every enemy of the game', () => {
    expect(Object.keys(sprites.enemies).sort()).toEqual(Object.keys(ENEMIES).sort());
  });

  it('every backdrop stands its enemies on the floor: the ground row is below the horizon and above the bottom edge', () => {
    expect(grounds.length).toBeGreaterThanOrEqual(8);
    for (const [id, ground] of grounds) {
      expect(ground, `${id} ground`).toBeGreaterThan(HORIZON);
      expect(ground, `${id} ground`).toBeLessThan(BHT);
    }
  });

  it('a regular enemy’s feet stay ENEMY_CLEARANCE above the party’s heads, for 1 to 4 enemies, on every backdrop', () => {
    // A named minimum, and not zero: with no clearance an enemy's feet would touch a hero's head.
    expect(ENEMY_CLEARANCE).toBeGreaterThanOrEqual(1);
    for (const [id, ground] of grounds) {
      for (const [key, e] of regular) {
        for (let n = 1; n <= 4; n++) {
          const row = Array.from({ length: n }, () => boxOf(e, key === 'lurker'));
          const spots = placeEnemies(row, ground);
          for (const [i, s] of spots.entries()) expect(s.y + e.h + ENEMY_CLEARANCE, `${id}, ${n} x ${key}, enemy ${i}`).toBeLessThanOrEqual(headTop);
        }
      }
    }
  });

  it('a boss stands on the floor too, and never lower than the party’s feet', () => {
    for (const [id, ground] of grounds) {
      for (const [key, e] of bosses) {
        const [spot] = placeEnemies([boxOf(e, key === 'lurker')], ground);
        expect(spot!.y + e.h, `${id}, ${key}`).toBeLessThanOrEqual(PARTY_BOTTOM);
        expect(spot!.y + e.h, `${id}, ${key}`).toBeGreaterThan(HORIZON);
      }
    }
  });

  it('a boss is the one exception to the clearance: in the story’s boss fights it looms a few rows into the party’s head row, up to BOSS_OVERLAP_MAX', () => {
    // Bosses loomed over the party at 480x270 (their feet reached 22 to 28 px into the head row);
    // here that is reduced to a few rows, and named. Anything deeper fails.
    expect(BOSS_OVERLAP_MAX).toBeGreaterThan(0);
    for (const [key, bg] of BOSS_FIGHTS) {
      const e = sprites.enemies[key as keyof typeof sprites.enemies];
      const ground = grounds.find(([id]) => id === bg)?.[1];
      expect(ground, `${bg} is a backdrop`).toBeDefined();
      const [spot] = placeEnemies([boxOf(e, key === 'lurker')], ground!);
      expect(spot!.y + e.h, `${key} on ${bg}`).toBeLessThanOrEqual(headTop + BOSS_OVERLAP_MAX);
    }
  });

  it('no enemy’s first opaque row enters the top text band, and the unbound Warden (the tallest) clears it without help', () => {
    const band = HUD.topBandBottom;
    // The clamp is derived from the band, not from the one-line prompt.
    expect(PROMPT_CLEAR * WORLD_SCALE).toBeGreaterThanOrEqual(band);
    for (const [id, ground] of grounds) {
      for (const [key, e] of Object.entries(sprites.enemies)) {
        for (let n = 1; n <= (e.boss ? 1 : 4); n++) {
          const spots = placeEnemies(Array.from({ length: n }, () => boxOf(e, key === 'lurker')), ground);
          for (const [i, s] of spots.entries()) expect((s.y + e.top) * WORLD_SCALE, `${id}, ${n} x ${key}, enemy ${i}`).toBeGreaterThanOrEqual(band);
        }
      }
    }
    // The Unbound Warden is the tallest enemy in the game, and it is summoned in the Warden fight
    // (the core backdrop). Without the clamp (a prompt clear of 0) it already stands below the band.
    const tallest = Object.entries(sprites.enemies).sort(([, a], [, b]) => b.h - a.h)[0]!;
    expect(tallest[0]).toBe('warden_spirit');
    const core = grounds.find(([id]) => id === 'core')![1];
    const [natural] = placeEnemies([boxOf(tallest[1])], core, 0);
    expect((natural!.y + tallest[1].top) * WORLD_SCALE, 'the Warden’s first opaque row, unclamped').toBeGreaterThanOrEqual(band);
  });

  it('the row is centered, ENEMY_GAP apart, inside the world, and no first opaque row sits under the prompt', () => {
    for (let n = 1; n <= 4; n++) {
      for (const [key, e] of regular) {
        const spots = placeEnemies(Array.from({ length: n }, () => boxOf(e)), 100);
        const first = spots[0]!, last = spots[n - 1]!;
        expect(first.x, `${n} x ${key} left edge`).toBeGreaterThanOrEqual(0);
        expect(last.x + e.w, `${n} x ${key} right edge`).toBeLessThanOrEqual(BW);
        expect(Math.abs(first.x - (BW - (last.x + e.w))), `${n} x ${key} centered`).toBeLessThanOrEqual(1);
        for (let i = 1; i < n; i++) expect(spots[i]!.x - (spots[i - 1]!.x + e.w), `${n} x ${key} gap`).toBe(ENEMY_GAP);
        for (const s of spots) expect(s.y + e.top, `${key} under the prompt`).toBeGreaterThanOrEqual(PROMPT_CLEAR);
      }
    }
    // A tall boss on a high ground line is pushed down until its head clears the top band.
    const tall = { w: 80, h: 90, top: 3, boss: true, lurker: false };
    const pushed = placeEnemies([tall], 60)[0]!;
    expect(pushed.y + tall.top).toBeGreaterThanOrEqual(PROMPT_CLEAR);
    expect((pushed.y + tall.top) * WORLD_SCALE).toBeGreaterThanOrEqual(HUD.topBandBottom);
  });

  it('the backdrops are the world’s size: BW by BHT, with their glow and foreground layers', async () => {
    const { battleBg, BG_IDS } = await import('../src/art/battlebg');
    for (const id of BG_IDS) {
      const bg = battleBg(id);
      expect(`${id} ${bg.canvas.width}x${bg.canvas.height}`).toBe(`${id} ${BW}x${BHT}`);
      if (bg.glow) expect(`${id} glow ${bg.glow.width}x${bg.glow.height}`).toBe(`${id} glow ${BW}x${BHT}`);
      if (bg.fg) expect(`${id} fg ${bg.fg.width}x${bg.fg.height}`).toBe(`${id} fg ${BW}x${BHT}`);
    }
    // The street is the one WP2b re-lays: it is made, at the world's size.
    expect(battleBg('street').canvas.width).toBe(BW);
    expect(battleBg('street').canvas.height).toBe(BHT);
  });
});

describe('cut-ins and banners', () => {
  // The cut-ins a combo shows: its partners in turn, left then right, a row for each pair.
  const partners = Math.max(...COMBOS.map((c) => c.parts.length));
  const cutins = (hud: ReturnType<typeof hudLayout>): { name: string; rect: Rect }[] => {
    const out: { name: string; rect: Rect }[] = [];
    for (let i = 0; i < partners; i++) {
      for (const wide of [false, true]) out.push({ name: `partner ${i}${wide ? ' with a line' : ''}`, rect: hud.cutinRect(i % 2 === 0, i >> 1, wide) });
    }
    return out;
  };

  it('the turn strip column is wide enough for the widest combo in the data', () => {
    expect(STRIP_MAX_FACES).toBeGreaterThanOrEqual(partners);
    expect(ORDER_COLUMN_W).toBeGreaterThanOrEqual(partners * ORDER_FACE + 1);
  });

  for (const { frame, hud } of FRAMES) {
    it(`${frame}: every character cut-in rests inside the frame, above the cards, clear of the turn strip`, () => {
      // The strip's whole column, "TURN" label included (a combo is a face wide per partner, the entry acting now steps out).
      const column: Rect = { x: hud.orderRight - ORDER_COLUMN_W, y: hud.orderTop - ORDER_LABEL_ABOVE, w: ORDER_COLUMN_W, h: hud.orderBottom - (hud.orderTop - ORDER_LABEL_ABOVE) };
      const strip = [...orderStripLayout([partners, 1, 1, 1, 1, 1, 1, 1, 1], 'right', hud), ...orderStripLayout(Array<number>(9).fill(1), 'right', hud)];
      expect(cutins(hud).length).toBeGreaterThanOrEqual(2);
      for (const { name, rect } of cutins(hud)) {
        expect(inside(rect, hud.frame), `${name} inside the frame`).toBe(true);
        expect(rect.y + rect.h, `${name} above the cards`).toBeLessThanOrEqual(hud.panelY - CARD_RAISE);
        expect(overlap(rect, column), `${name} vs the strip column`).toBe(false);
        for (const r of strip) expect(overlap(rect, r), `${name} vs a strip entry`).toBe(false);
      }
    });

    it(`${frame}: the action banner and the VICTORY band lie inside the frame, the banner above the cards`, () => {
      expect(inside(hud.actionBannerRect(), hud.frame)).toBe(true);
      expect(hud.actionBannerRect().y + hud.actionBannerRect().h).toBeLessThanOrEqual(hud.panelY - CARD_RAISE);
      expect(inside(hud.victoryBandRect(), hud.frame)).toBe(true);
      expect(hud.victoryBandRect().y).toBeGreaterThanOrEqual(hud.topBandBottom);
      expect(hud.victoryBandRect().y + hud.victoryBandRect().h).toBeLessThanOrEqual(hud.panelY - CARD_RAISE);
    });
  }

  it('the character cut-ins sit 82 above the cards and a row is 62 higher (the old layout, moved with the panel)', () => {
    expect(HUD.cutinRect(true, 0, false).y).toBe(PANEL_Y - 82);
    expect(HUD.cutinRect(true, 1, false).y).toBe(PANEL_Y - 82 - 62);
  });
});
