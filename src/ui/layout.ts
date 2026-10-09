/**
 * Layout numbers of the UI screens, in one place (the editor rule of docs/IDEAS.md: no decision may
 * make a future visual editor harder, so a size is a named value here, never a literal inside draw
 * code). A future UI editor would change these values and nothing else. Every value is plain data;
 * the few helpers below only turn data into data.
 *
 * Text widths inside fixed boxes come first: the screens draw data-driven strings (objectives,
 * combo descriptions, ability names) into them, and tests/layout.test.ts measures every such string
 * against them, so new content can't silently overflow a box. The rest of the file holds the sizes
 * that WP4 of the 640x360 move chose (docs/PIVOT-640.md, D8): the dialog cap, the menu panes, the
 * shop, the Status screen.
 */
import { H, W } from '../sje/core/size';

// ------------------------------------------------------------------ text widths

/** The always-on objective in the field's top-left corner (wraps, up to 3 lines). */
export const FIELD_OBJ_W = 196;
/** A row of the combo log (single line). */
export const COMBO_TEXT_W = W - 8 - 30 - 12;
/** A "Learned X!" line in the level-up panel (single line). */
export const LEVELUP_TEXT_W = 230 - 28;
/** Battle target-info box: the enemy's name left, its known weaknesses right, on one row. */
export const TARGET_INFO_W = 204;
/** Equip screen: the item description (and "can't use" reason) under the stats box, 6 lines of 10px. */
export const EQUIP_DESC_W = 142;
export const EQUIP_DESC_LINES = 6;

// ------------------------------------------------------------------ rows follow the height

/**
 * How many rows of `rowH` pixels fit in `availH` pixels: the one rule for "list rows follow the
 * window height" (docs/PIVOT-640.md, WP4). Every scrolling list gets its row count here, from the
 * height of the window that holds it, so a taller or shorter screen needs no edit. Never fewer than 1.
 */
export function rowsFor(availH: number, rowH = 11): number {
  return Math.max(1, Math.floor(availH / rowH));
}

// ------------------------------------------------------------------ the dialog box (D8)

/**
 * The dialog box is capped and centered (D8, Mark's Review 4 pick): 464 px wide, which is
 * what the box was at 480x270 (the screen less 8 px a side). Capped at 464, the text is 448 px wide
 * (392 with a portrait), so every authored line wraps exactly as it did before the move
 * (`tests/dialog-wrap.test.ts` proves it for every line in the game).
 */
export const DIALOG_MAX_W = 464;
/** The side margin of the dialog box: the box is centered and never closer than this to the screen edge. */
export const DIALOG_SIDE_MARGIN = 8;
/** Space between the box edge and its text, each side. */
export const DIALOG_PAD = 8;
/** What a portrait takes from the text width: the picture (48) and its frame and gap (8). */
export const DIALOG_PORTRAIT_COL = 56;

/** The dialog box width: capped at `DIALOG_MAX_W` (Mark's pick at Review 4, D8), or the screen less its margins if that is less. */
export function dialogBoxW(): number {
  return Math.min(DIALOG_MAX_W, W - 2 * DIALOG_SIDE_MARGIN);
}

/** The text width inside a dialog box of width `boxW`, with or without a portrait. */
export function dialogTextW(boxW: number, portrait: boolean): number {
  return boxW - 2 * DIALOG_PAD - (portrait ? DIALOG_PORTRAIT_COL : 0);
}

// ------------------------------------------------------------------ the field menu (D8)

/** The left command column of the field menu: its x, width, and the gap before the panes. */
export const MENU_RAIL_X = 8;
export const MENU_RAIL_W = 92;
export const MENU_GAP = 8;
/** Where the panes right of the rail start. */
export const MENU_PANE_X = MENU_RAIL_X + MENU_RAIL_W + MENU_GAP;
/**
 * The widest a list pane of the menu gets (Items, Techs, the equip slots, Save, the objective): 364
 * px, what these panes were at 480x270 (the screen less the rail, less the margins), close to the
 * 360 that D8 names. A pane stretched to the whole right side would put a label and its count 450 px
 * apart (Mark picked the cap at Review 4, D8).
 */
export const MENU_PANE_MAX_W = 364;
/** The width of a menu list pane: capped, or the whole right side if that is less. */
export function menuPaneW(): number {
  const room = W - MENU_PANE_X - 8;
  return Math.min(MENU_PANE_MAX_W, room);
}
/** The objective box along the bottom of the field menu (wraps, up to 2 lines): the pane less its margins. */
export const MENU_OBJ_W = MENU_PANE_MAX_W - 28;
/** The party cards: the width of an HP or TP bar on a full card, and of a compact card. */
export const CARD_BAR_W = 200;
export const CARD_H = 50;
export const CARD_COMPACT_H = 44;
export const CARD_GAP = 4;
/** The narrowest a strip of compact cards can be (a sprite, a name, and two short bars). */
export const CARD_COMPACT_MIN_W = 120;
/**
 * The strip right of the Items and Techs lists, where the party stays in compact cards: it starts after
 * the list and the gap, and runs to the screen's margin. It exists only when it is at least
 * `CARD_COMPACT_MIN_W` wide (at 640 it is 152 px; at 480x270 there is no room).
 */
export function menuCardStrip(): { x: number; w: number } | null {
  const x = MENU_PANE_X + menuPaneW() + MENU_GAP;
  const w = W - 8 - x;
  return w >= CARD_COMPACT_MIN_W ? { x, w } : null;
}
/** With no strip, the list narrows while the player picks who gets an item or a tech, and the cards come back beside it (the old way). */
export const TARGET_PANE_W = 186;
export const TARGET_CARD_GAP = 6;
/** One row of a list, and of the combo log. */
export const LIST_ROW_H = 11;
export const COMBO_ROW_H = 36;
/** Where the combo log's rows start, under its header. */
export const COMBO_TOP = 40;
/** The room under the Equip screen's windows for the objective box. */
export const EQUIP_BOTTOM_PAD = 38;
/** The Equip screen: the slots window, the stats box, and the gap between the boxes. */
export const EQUIP_SLOTS_H = 64;
export const EQUIP_STATS_Y = 8 + EQUIP_SLOTS_H + 6;
export const EQUIP_STATS_W = 150;
export const EQUIP_STATS_H = 88;
export const EQUIP_GAP = 6;
/** The description under the stats box starts this far below it. */
export const EQUIP_DESC_GAP = 6;
/** The item or tech list's window: its height, and the room kept under the rows for the description. */
export const MENU_LIST_BOTTOM_PAD = 34;
export const MENU_DESC_ROOM = 40;
/** The Bestiary and Places lists: the list window's width, and where its first row is. */
export const MENU_SIDE_LIST_W = 150;
export const MENU_SIDE_LIST_TOP = 24;
/** The Bestiary's picture box, and the Places detail's first row. */
export const BESTIARY_BOX_W = 120;
export const BESTIARY_BOX_H = 104;

// ------------------------------------------------------------------ the Status screen

/** The stat block: where it starts and how wide it is (labels left, values right). */
export const STATUS_STATS_W = 200;
export const STATUS_STATS_X = W - 22 - STATUS_STATS_W;
/** The bio wraps to the room between the portrait column and the stat block. */
export const STATUS_TEXT_X = 94;
export const STATUS_BIO_W = STATUS_STATS_X - 16 - STATUS_TEXT_X;
/** The lower half: where the abilities start, and their columns (nine rows a column, as before). */
export const STATUS_ABILITY_X = 200;
export const STATUS_ABILITY_COL_W = 140;
export const STATUS_ABILITY_COLS = 3;
export const STATUS_ABILITY_ROWS = 9;
/** What an ability name is cut to, in a column. */
export const STATUS_ABILITY_TEXT_W = STATUS_ABILITY_COL_W - 6;
/** The wound line is cut to the bio's width. */
export const STATUS_WOUND_W = STATUS_BIO_W;
/**
 * The Status screen's rows. The window is 344 px tall now (it was 254), so the rows are spaced
 * STATUS_ROW_H apart (they were 11) and the screen fills its height: the stat rows, the equipment
 * rows and the ability rows all share the pitch. The divider sits under the stat block, and the
 * lower half starts under it.
 */
export const STATUS_ROW_H = 14;
export const STATUS_DIVIDER_Y = 22 + 8 * STATUS_ROW_H + 6;
export const STATUS_LOWER_Y = STATUS_DIVIDER_Y + 6 + 14;

// ------------------------------------------------------------------ the shop (D8)

/**
 * The shop: its list is widened to 240 px (D8's recommendation; it was 196 at 480x270, and the
 * detail pane took all the new width: 334 px). `SHOP_COMPARE_W` is the room of a member's stat-change
 * line in the detail pane (the pane less its margins; the name and the line start after the sprite).
 */
export const SHOP_LIST_X = 96;
export const SHOP_LIST_W = 240;
export const SHOP_DETAIL_GAP = 6;
export const SHOP_DETAIL_X = SHOP_LIST_X + SHOP_LIST_W + SHOP_DETAIL_GAP;
export const SHOP_TOP = 46;
export const SHOP_COMPARE_W = W - SHOP_DETAIL_X - 8 - 16;
/** A crew sprite in the compare rows: its scale, and the gap between it and the name beside it. */
export const COMPARE_SPRITE_SCALE = 0.8;
export const COMPARE_SPRITE_GAP = 4;


// ------------------------------------------------------------------ full-page scenes (WP5)

/**
 * The height the ending, game-over and deck pages were composed for (480x270). Their top-down
 * layouts are kept as they were, and one named offset, `PAGE_DY`, moves the whole block down to the
 * middle of the taller screen. This is the only place that remembers the old height.
 */
export const COMPOSED_FOR_H = 270;
/** Half of the extra height: the vertical offset of every top-down page (45 px at 640x360). */
export const PAGE_DY = Math.round((H - COMPOSED_FOR_H) / 2);
/** The "Press Z" prompt of a page keeps this far from the bottom edge, and the street line of Game over this far. */
export const PAGE_PROMPT_FROM_BOTTOM = 20;
export const STREET_FROM_BOTTOM = 26;
/** The red glow behind the crew on Game over reaches this far up from the street: a 0.74 share of the height (200 of 270). */
export const GLOW_REACH = Math.round(H * 0.74);

/** The results page: its window keeps the width it had (the screen less 120 px at 480), centered, and its rows sit inside it. */
export const RESULTS_W = 360;
export const RESULTS_X = Math.round((W - RESULTS_W) / 2);
/** The crew row under the results: one card per member, this far apart; a card is the portrait (32 px) and a gap, then the name and the level. */
export const RESULTS_CARD_STEP = 82;
export const RESULTS_CARD_FACE = 36;
