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
 * The HUD frame: the one rectangle that every HUD anchor in `hudLayout` derives from. Mark chose
 * (D6, Review 2, 2026-10-08) to let the HUD hug the screen edges, so the frame is the whole
 * screen. A future HUD editor changes this one rectangle (or hands `hudLayout` another one) and
 * every menu, card, strip, banner and cut-in follows; the tests do that with an inset frame. The
 * world rows below (the party's feet, the enemy row) are not part of the HUD and do not follow it.
 * Two numbers guard the top text band and so do follow it: `PROMPT_CLEAR` (how far up an enemy may
 * stand) and `FLOATER_TOP` (how far up a damage number may start) both derive from the band.
 */
export const HUD_FRAME: Rect = { x: 0, y: 0, w: W, h: H };

/** A status card (one party member's panel) and the gap between neighbors, in screen pixels. */
export const CARD_W = 116, CARD_H = 52, CARD_GAP = 3;
/** The card of whoever is giving orders stands this far above the others. */
export const CARD_RAISE = 5;
/** The cards' top edge sits this far above the frame's bottom edge. */
const PANEL_INSET = 56;
/**
 * The turn-order strip: one face is `ORDER_FACE` wide (the picture is `ORDER_THUMB`, one pixel less,
 * so neighbors do not touch), an entry is `ORDER_ENTRY_H` tall, and entries are `ORDER_GAP` apart.
 */
export const ORDER_FACE = 13, ORDER_THUMB = ORDER_FACE - 1, ORDER_ENTRY_H = 14;
const ORDER_GAP = 4;
/**
 * The "TURN" label's top is this far above the strip's first entry. Its letters (eight rows with
 * their shadow) must end above the frame that the entry acting now wears, which reaches 3 px
 * above the entry, so it is 12 and not 10 (at 10 the two overlapped by 2 px).
 */
export const ORDER_LABEL_ABOVE = 12;
/**
 * The strip's column is as wide as its widest entry (a combo shows one face per partner, and the
 * widest combo has three) plus what the entry acting now adds: it steps `ORDER_STEP_OUT` toward the
 * field (the renderer moves it by this) and a pointer reaches `ORDER_POINTER_REACH` out beside it.
 */
export const STRIP_MAX_FACES = 3;
export const ORDER_STEP_OUT = 5, ORDER_POINTER_REACH = 8;
export const ORDER_COLUMN_W = STRIP_MAX_FACES * ORDER_FACE + 1 + ORDER_STEP_OUT + ORDER_POINTER_REACH;
/** Character cut-ins (a combo's partners, sliding in at the sides): card sizes, in screen pixels. */
const CUTIN_W = 132, CUTIN_W_LINE = 184, CUTIN_H = 58;
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
/** The strip's column starts this far below the frame's top: under the top band and its "TURN" label (`ORDER_LABEL_ABOVE`). */
const ORDER_FROM_TOP = 58;
/** The menus and the strip sit this far in from the frame's sides. */
const MENU_INSET = 4, ORDER_INSET = 6;
/** The command window: width, enough for "Programs"/"Spirits" plus the cursor. */
export const CMD_W = 84;
/** The round menu (Fight / Repeat / Auto / Run) is as wide as the command window and this tall. */
export const ROUND_MENU_H = 54;
/**
 * The list window (items, skills, techs) stacks above the command window. Its width follows its
 * widest row, plus `LIST_PAD_W` for the cursor and the margins, and stays between the two limits.
 */
export const LIST_MIN_W = 120, LIST_MAX_W = 210, LIST_PAD_W = 32;
export function listWindowW(widestRow: number): number {
  return Math.min(LIST_MAX_W, Math.max(LIST_MIN_W, widestRow + LIST_PAD_W));
}
/** Every menu window ends this far above the cards' top edge; the next one stacks above it. */
export const MENU_ABOVE_PANEL = 6;

/** Every HUD anchor, derived from one frame. Pure: the tests build it for the game frame and for an inset one. */
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
const TOP_BAND_BOTTOM = HUD.topBandBottom;
export const ORDER_TOP = HUD.orderTop, ORDER_RIGHT = HUD.orderRight, ORDER_LEFT = HUD.orderLeft, ORDER_BOTTOM = HUD.orderBottom;
/** Effect frames Hex's deck stays up over their card when they run a program. */
export const DECK_CUT_LIFE = 56;

// ------------------------------------------------------------------ the party row (world pixels)

/** The party's feet stand this many world pixels above the world's bottom edge (a look choice, kept from the 480x270 layout). */
const PARTY_FEET_ABOVE_EDGE = 8;
/**
 * Party feet sit well below the panel top: an over-the-shoulder view, where the status cards cover
 * the crew's legs and only heads, shoulders and raised arms show. The feet are 40 screen pixels
 * below the panel's top edge (`PARTY_BOTTOM * WORLD_SCALE - PANEL_Y`), the same relation the
 * 480x270 layout had (127 * 2 against 214); tests/battle-geom.test.ts pins it. It holds because
 * the HUD frame is the whole screen: `PARTY_BOTTOM` hangs from the world's bottom edge and
 * `PANEL_Y` from the frame's. A frame that was not the whole screen would need `PARTY_BOTTOM` to
 * follow it.
 */
export const PARTY_BOTTOM = BHT - PARTY_FEET_ABOVE_EDGE;
/** From a party member's feet up to the middle of their body: where rings, arrows and effects aim. */
export const PARTY_MID = 34;
/**
 * The tallest a party member stands above `PARTY_BOTTOM` (idle, in world pixels), measured from
 * the rig battlers (tests/fixtures/battle-sprites.json). A regular enemy's feet stay above this; a
 * boss may reach a few rows into it (see "the enemy row" below).
 */
export const PARTY_HEIGHT = 60;

/** The world x of party member `i` of `n`: over the middle of their own status card. */
export function partyX(i: number, n: number, hud: HudLayout = HUD): number {
  return Math.round((hud.cardX(i, n) + CARD_W / 2) / WORLD_SCALE);
}

// ------------------------------------------------------------------ the enemy row (world pixels)

/**
 * Regular enemies stand further back on the floor than the background's ground line, so the
 * party's heads sit below their feet: their feet stay a few world pixels above the tallest head
 * (tests/battle-geom.test.ts holds every backdrop to 2 of them). Bosses stay forward and loom over
 * the party, as they did at 480x270 (their feet then reached 22 to 28 world pixels into the head
 * row); a boss's feet may reach a few rows into it now (the test allows 6 and checks the story's
 * boss fights). The Lurker (it wades) stands a little further back, and every second enemy in a
 * row a step further than its neighbor.
 */
const ENEMY_LIFT = 14, BOSS_LIFT = 4, LURKER_LIFT = 4, ENEMY_STAGGER = 4;
/** Space between neighbors in the enemy row: the formation spreads across the wider floor. */
export const ENEMY_GAP = 20;
/**
 * The world row just under the top text band (the top line can wrap to three lines, so the band
 * is the largest the text window grows to): an enemy whose first opaque row would sit above it is
 * placed lower, so a tall boss's head is never hidden behind "Give each crew member orders" or a
 * pinned tell (the Warden's visor was). Derived from the band, not from the one-line prompt.
 */
export const PROMPT_CLEAR = Math.ceil(TOP_BAND_BOTTOM / WORLD_SCALE);
/**
 * How far down an enemy the middle of its body is (a share of its height): where a target arrow,
 * a ring or a number aims. `FIELD_MID` is the same share of the world, for a unit that is not on
 * the field.
 */
export const ENEMY_MID_AT = 0.45;
/** Where a unit that is not on the field aims: over the enemy row's middle. */
export const FIELD_MID = Math.round(BHT * ENEMY_MID_AT);
/**
 * A floater (a damage number, a status word) starts at some row, pops up `FLOATER_POP` rows, and a
 * hit then bounces up to `FLOATER_BOUNCE` more (render.ts, "Floaters"). The next floater for the
 * same target starts `FLOATER_ROW` higher: 7 px glyphs, their shadow, and air.
 */
export const FLOATER_POP = 8, FLOATER_BOUNCE = 3, FLOATER_ROW = 12;
/**
 * How long the pop takes, in frames: a floater rises `FLOATER_POP` rows over this many frames. (It is
 * 8 like the height, by chance: the height is rows, this is time.) A hit then bounces for
 * `FLOATER_BOUNCE_FRAMES` frames, starting when the pop ends. A damage-over-time tick sinks instead,
 * by at most `FLOATER_TICK_SINK` rows.
 */
export const FLOATER_POP_FRAMES = 8, FLOATER_BOUNCE_FRAMES = 12, FLOATER_TICK_SINK = 8;
/**
 * The rest of a floater's timing (tuned by eye in the 480x270 battle, kept at the same values). All
 * in frames except the rates. A floater holds still from the end of its pop until frame
 * `FLOATER_HOLD_FRAMES`, then drifts up `FLOATER_DRIFT` rows a frame; it starts to fade at frame
 * `FLOATER_FADE_START` and is gone `FLOATER_FADE_FRAMES` later. The hit's bounce is a sine wave that
 * turns `FLOATER_BOUNCE_RATE` radians a frame (about six frames from one end of a hump to the other);
 * a damage-over-time tick sinks `FLOATER_SINK_RATE` rows a frame, down to `FLOATER_TICK_SINK`.
 */
export const FLOATER_HOLD_FRAMES = 24, FLOATER_DRIFT = 0.15, FLOATER_FADE_START = 38, FLOATER_FADE_FRAMES = 12, FLOATER_BOUNCE_RATE = 0.52, FLOATER_SINK_RATE = 0.25;
/**
 * Damage numbers never rise into the top text band. This is the lowest row a floater may START at
 * (world pixels): after its pop and its bounce its top is still on the first row under the band,
 * `PROMPT_CLEAR`. Derived from the band, so it follows the HUD frame.
 */
export const FLOATER_TOP = PROMPT_CLEAR + FLOATER_POP + FLOATER_BOUNCE;

/**
 * The row where floater number `stacked` (0 for the first one showing over a target) starts, for a
 * target whose head is at `anchorY`. Over a tall enemy the stack grows downward from `FLOATER_TOP`
 * instead of upward, so the clamp cannot pile rows on each other. Pure, so the tests check it.
 */
export function floaterStart(anchorY: number, stacked: number): number {
  return Math.max(FLOATER_TOP + stacked * FLOATER_ROW, anchorY - FLOATER_POP - stacked * FLOATER_ROW);
}

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
    const w = n * ORDER_FACE + 1, h = ORDER_ENTRY_H;
    if (y + h > hud.orderBottom) break;
    out.push({ x: side === 'right' ? hud.orderRight - w : hud.orderLeft, y, w, h });
    y += h + ORDER_GAP;
  }
  return out;
}
