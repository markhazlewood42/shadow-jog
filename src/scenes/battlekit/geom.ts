/**
 * Battle geometry shared by the scene (layout, targeting) and the renderer.
 *
 * Two kinds of number live here, and they are kept apart on purpose:
 *
 * - The **world** (the backdrop, the two fighter rows, the effects) is 320x180 world pixels shown at
 *   an exact 2x. Its numbers are in world pixels: `PARTY_BOTTOM`, the enemy row, `PARTY_MID`.
 * - The **HUD** (status cards, menus, the turn strip, banners, cut-ins) is drawn at screen
 *   resolution. Every HUD anchor derives from one rectangle, `HUD_FRAME`, through `hudLayout`
 *   (decision D6 of docs/PIVOT-640.md). Its numbers are in screen pixels.
 *
 * A future battle editor will want each tuned number in one named place, so none is scattered as
 * a bare literal in the scene or the renderer.
 */
import { H, W } from '../../engine/game';
import { BHT, BW, WORLD_SCALE } from '../../art/worldsize';

// The world-size names are defined once, in the leaf module art/worldsize.ts (the backdrops need
// them too, and `art` must not import from `scenes`). They are re-exported here so the battle
// scene kit keeps importing them from its own geometry file.
export { BHT, BW, WORLD_SCALE };

// ------------------------------------------------------------------ the HUD frame (D6)

/** A rectangle in screen pixels. */
export interface Rect { x: number; y: number; w: number; h: number }

/**
 * The share of the screen that HUD option 2 keeps its HUD in: three quarters each way, which is
 * 480x270 on a 640x360 screen, the size of the screen before the move (so the old HUD layout
 * fits it exactly).
 */
const HUD_BLOCK = 3 / 4;

/**
 * The HUD frame for one of the two options Mark chooses between (D6). Option 1: the HUD hugs the
 * screen edges (the frame is the whole screen). Option 2: the HUD stays in a centered block
 * (`HUD_BLOCK` of the screen each way). Everything else is derived from the frame, so choosing an
 * option changes one rectangle and no code path.
 */
export function hudFrameFor(option: 1 | 2): Rect {
  if (option === 1) return { x: 0, y: 0, w: W, h: H };
  const w = W * HUD_BLOCK, h = H * HUD_BLOCK;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/**
 * Which option the running game uses. 1 always, except in a dev build, where `?hud=2` on the page's
 * address picks option 2 for the review pictures (read once, when this module loads). A shipped
 * build never reads the address: `import.meta.env.DEV` is false there, so the check is gone.
 */
function hudOption(): 1 | 2 {
  if (!import.meta.env.DEV || typeof location === 'undefined') return 1;
  return new URLSearchParams(location.search).get('hud') === '2' ? 2 : 1;
}

/** The HUD frame in use: the one rectangle every HUD anchor below derives from. */
export const HUD_FRAME: Rect = hudFrameFor(hudOption());

/** A status card (one party member's panel) and the gap between neighbors, in screen pixels. */
export const CARD_W = 116, CARD_H = 52, CARD_GAP = 3;
/** The card of whoever is giving orders stands this far above the others. */
export const CARD_RAISE = 5;
/** The cards' top edge sits this far above the frame's bottom edge. */
const PANEL_INSET = 56;
/** One face in the turn-order strip, and the gap between entries. */
export const ORDER_FACE = 13, ORDER_GAP = 4;
/**
 * The strip's column is as wide as its widest entry (a combo shows one face per partner, and the
 * widest combo has three) plus what the entry acting now adds (it steps 5 px toward the field and
 * an 8 px pointer sticks out beside it).
 */
export const STRIP_MAX_FACES = 3;
export const ORDER_COLUMN_W = STRIP_MAX_FACES * ORDER_FACE + 1 + 13;
/** Character cut-ins (a combo's partners, sliding in at the sides): card sizes, in screen pixels. */
export const CUTIN_W = 132, CUTIN_W_LINE = 184, CUTIN_H = 58;
/** A cut-in's top is this far above the cards' top, and the next row is this far above that. */
const CUTIN_ABOVE_PANEL = 82, CUTIN_ROW = 62;
/** Space between a cut-in and the frame's edge, or the turn strip's column. */
const CUTIN_MARGIN = 12, CUTIN_STRIP_GAP = 4;
/** The big action banner: its band is this tall, and its top is this far above the frame's middle. */
export const BANNER_H = 32;
const BANNER_ABOVE_MIDDLE = 43;
/**
 * The VICTORY banner: letters 12 rows tall drawn at 3x, in a dark band that reaches 6 px above
 * them and 4 px below (the underline sits 3 px under the letters). Its top is a share of the
 * frame's height (a look choice: the upper fifth).
 */
export const VICTORY_SCALE = 3, VICTORY_ROWS = 12;
const VICTORY_BAND_ABOVE = 6, VICTORY_BAND_BELOW = 4, VICTORY_BANNER_AT = 0.21;
/** The top prompt window (a line of text, or a pinned tell) sits this far below the frame's top. */
const TOP_LINE_AT = 6;
/** A pinned tell takes the top slot, and the top line moves this far down under it. */
const TELL_STACK = 20;
/** The enemies' HP bars never rise above this row (just under the top slot); the target box sits this far down. */
const STATUS_FROM_TOP = 24, TARGET_FROM_TOP = 44;
/** The target box's distance from the frame's side, and from the turn strip's column on the other side. */
const TARGET_FROM_SIDE = 8, TARGET_STRIP_GAP = 4;
/** The top line can wrap to three lines (6 to 45): nothing else drawn at the top may enter this band. */
const TOP_BAND = 46;
/** The strip's column starts this far below the frame's top: under the top band and its "TURN" label. */
const ORDER_FROM_TOP = 58;
/** The menus and the strip sit this far in from the frame's sides. */
const MENU_INSET = 4, ORDER_INSET = 6;
/** The command window: width, enough for "Programs"/"Spirits" plus the cursor. */
export const CMD_W = 84;

/** Every HUD anchor, derived from one frame. Pure: the tests build it for either option. */
export interface HudLayout {
  readonly frame: Rect;
  /** Top of the party panel (the status cards). */
  readonly panelY: number;
  /** Left edge of the battle menus. */
  readonly menuX: number;
  /** Top edge of the top line (the prompt, the description, a message) with no tell pinned, and with one. */
  readonly topY: number;
  readonly topYUnderTell: number;
  /** The highest row an enemy's HP bar may use, and the top of the target box. */
  readonly statusTop: number;
  readonly targetY: number;
  /** Bottom edge of the band the top line may grow into. */
  readonly topBandBottom: number;
  /** The turn strip's column: its top, bottom and the two edges an entry is aligned to. */
  readonly orderTop: number;
  readonly orderBottom: number;
  readonly orderLeft: number;
  readonly orderRight: number;
  /** Top of the big action banner, and of the VICTORY banner. */
  readonly actionBannerY: number;
  readonly victoryBannerY: number;
  /** Left edge of status card `i` of `n`: the cards are centered in the frame. */
  cardX(i: number, n: number): number;
  /** Where a character cut-in rests once it has slid in (`wide`: it carries a line of speech). */
  cutinRect(fromLeft: boolean, row: number, wide: boolean): Rect;
  /** The big action banner's band, and the VICTORY banner's dark band: both span the frame. */
  actionBannerRect(): Rect;
  victoryBandRect(): Rect;
  /**
   * Left edge of the target box (width `w`). It sits on the far side of the frame from its target,
   * clear of the turn strip on the right, so it never covers the target or the arrow over it.
   */
  targetBoxX(targetOnLeft: boolean, w: number): number;
}

export function hudLayout(frame: Rect): HudLayout {
  const right = frame.x + frame.w, bottom = frame.y + frame.h;
  const panelY = bottom - PANEL_INSET;
  const orderRight = right - ORDER_INSET;
  return {
    frame,
    panelY,
    menuX: frame.x + MENU_INSET,
    topY: frame.y + TOP_LINE_AT,
    topYUnderTell: frame.y + TOP_LINE_AT + TELL_STACK,
    statusTop: frame.y + STATUS_FROM_TOP,
    targetY: frame.y + TARGET_FROM_TOP,
    topBandBottom: frame.y + TOP_BAND,
    orderTop: frame.y + ORDER_FROM_TOP,
    orderBottom: panelY - ORDER_INSET,
    orderLeft: frame.x + ORDER_INSET,
    orderRight,
    actionBannerY: Math.round(frame.y + frame.h / 2 - BANNER_ABOVE_MIDDLE),
    victoryBannerY: Math.round(frame.y + frame.h * VICTORY_BANNER_AT),
    cardX: (i, n) => Math.round(frame.x + (frame.w - (n * CARD_W + (n - 1) * CARD_GAP)) / 2) + i * (CARD_W + CARD_GAP),
    cutinRect(fromLeft, row, wide) {
      const w = wide ? CUTIN_W_LINE : CUTIN_W;
      // The right-hand cut-ins stop short of the turn strip's column, so no cut-in covers the strip.
      const x = fromLeft ? frame.x + CUTIN_MARGIN : orderRight - ORDER_COLUMN_W - CUTIN_STRIP_GAP - w;
      return { x, y: panelY - CUTIN_ABOVE_PANEL - row * CUTIN_ROW, w, h: CUTIN_H };
    },
    actionBannerRect() {
      return { x: frame.x, y: this.actionBannerY, w: frame.w, h: BANNER_H };
    },
    victoryBandRect() {
      const letters = VICTORY_SCALE * VICTORY_ROWS;
      return { x: frame.x, y: this.victoryBannerY - VICTORY_BAND_ABOVE, w: frame.w, h: VICTORY_BAND_ABOVE + letters + VICTORY_BAND_BELOW };
    },
    targetBoxX: (targetOnLeft, w) => (targetOnLeft ? orderRight - ORDER_COLUMN_W - TARGET_STRIP_GAP - w : frame.x + TARGET_FROM_SIDE),
  };
}

/** The layout of the HUD frame in use. */
export const HUD = hudLayout(HUD_FRAME);

/** Top of the party panel, in screen pixels. */
export const PANEL_Y = HUD.panelY;
/** Battle menus hug the frame's edge. */
export const MENU_X = HUD.menuX;
export const TOP_BAND_BOTTOM = HUD.topBandBottom;
export const ORDER_TOP = HUD.orderTop, ORDER_RIGHT = HUD.orderRight, ORDER_LEFT = HUD.orderLeft, ORDER_BOTTOM = HUD.orderBottom;
/** Effect frames Hex's deck stays up over their card when they run a program. */
export const DECK_CUT_LIFE = 56;

// ------------------------------------------------------------------ the party row (world pixels)

/**
 * Party feet sit well below the panel top: an over-the-shoulder view, where the status cards cover
 * the crew's legs and only heads, shoulders and raised arms show. The feet are one constant below
 * the panel's top edge in screen pixels (`PARTY_BOTTOM * WORLD_SCALE - PANEL_Y` is 40), the same
 * relation the 480x270 layout had. The world keeps this floor in both HUD options.
 */
export const PARTY_BOTTOM = BHT - 8;
/** From a party member's feet up to the middle of their body: where rings, arrows and effects aim. */
export const PARTY_MID = 34;
/**
 * The tallest a party member stands above `PARTY_BOTTOM` (idle, in world pixels), measured from
 * the rig battlers (tests/fixtures/battle-sprites.json). The enemy row stays above this.
 */
export const PARTY_HEIGHT = 60;

/** The world x of party member `i` of `n`: over the middle of their own status card. */
export function partyX(i: number, n: number, hud: HudLayout = HUD): number {
  return Math.round((hud.cardX(i, n) + CARD_W / 2) / WORLD_SCALE);
}

// ------------------------------------------------------------------ the enemy row (world pixels)

/**
 * Regular enemies stand further back on the floor than the background's ground line, so the
 * party's heads sit below their feet; bosses stay forward and loom. The Lurker (it wades) stands a
 * little further back, and every second enemy in a row a step further than its neighbor.
 */
export const ENEMY_LIFT = 14, BOSS_LIFT = 4, LURKER_LIFT = 4, ENEMY_STAGGER = 4;
/** Space between neighbors in the enemy row: the formation spreads across the wider floor. */
export const ENEMY_GAP = 20;
/**
 * The world row just under the top prompt strip (a window at the frame's top, screen y 6 to 23):
 * an enemy whose first opaque row would sit above it is placed lower, so a tall boss's head is
 * never hidden behind "Give each crew member orders" (the Warden's visor was).
 */
export const PROMPT_CLEAR = Math.round(HUD_FRAME.y / WORLD_SCALE) + 14;
/** Where a unit that is not on the field aims: over the enemy row's middle. */
export const FIELD_MID = Math.round(BHT * 0.45);
/** Damage numbers never rise above the top band: the lowest y a floater may start at (world pixels). */
export const FLOATER_TOP = Math.round(TOP_BAND_BOTTOM / WORLD_SCALE) - 1;

/** What the enemy row needs to know of one enemy's art, in world pixels (`top`: its first opaque row). */
export interface EnemyBox { w: number; h: number; top: number; boss: boolean; lurker: boolean }

/**
 * Where each enemy stands: a row centered on the world, `ENEMY_GAP` between neighbors, feet on the
 * backdrop's `ground` line less a lift, so in every backdrop they stand on its floor. The ground
 * line does not depend on how many enemies there are: one enemy stands where four would, in the
 * middle of the row. Returns each enemy's top-left corner. Pure, so the tests check the rule.
 */
export function placeEnemies(boxes: readonly EnemyBox[], ground: number, promptClear: number = PROMPT_CLEAR): { x: number; y: number }[] {
  const total = boxes.reduce((n, b) => n + b.w, 0) + ENEMY_GAP * Math.max(0, boxes.length - 1);
  let x = Math.round((BW - total) / 2);
  return boxes.map((b, i) => {
    const feet = ground - (b.boss ? BOSS_LIFT : ENEMY_LIFT) - (b.lurker ? LURKER_LIFT : 0);
    const back = b.boss ? 0 : (i % 2) * ENEMY_STAGGER;
    const p = { x, y: Math.max(feet - b.h - back, promptClear - b.top) };
    x += b.w + ENEMY_GAP;
    return p;
  });
}

// ------------------------------------------------------------------ the turn strip

/**
 * Where each turn-order entry goes: a column down one edge, one entry per action (a combo is one
 * entry, two faces wide), aligned to that edge. Entries that won't fit above the party panel are
 * dropped (the caller shows how many). Pure, so the layout test can check it against the rest.
 */
export function orderStripLayout(faces: readonly number[], side: 'left' | 'right' = 'right', hud: HudLayout = HUD): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let y = hud.orderTop;
  for (const n of faces) {
    const w = n * ORDER_FACE + 1, h = 14;
    if (y + h > hud.orderBottom) break;
    out.push({ x: side === 'right' ? hud.orderRight - w : hud.orderLeft, y, w, h });
    y += h + ORDER_GAP;
  }
  return out;
}
