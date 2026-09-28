/**
 * Text widths inside fixed UI boxes. The screens draw data-driven strings (objectives, combo
 * descriptions, ability names) into these; tests/layout.test.ts measures every such string
 * against them, so new content can't silently overflow a box.
 */
import { W } from '../engine/game';

/** The always-on objective in the field's top-left corner (wraps, up to 3 lines). */
export const FIELD_OBJ_W = 196;
/** The objective box along the bottom of the field menu (wraps, up to 2 lines). */
export const MENU_OBJ_W = W - 116 - 28;
/** A row of the combo log (single line). */
export const COMBO_TEXT_W = W - 8 - 30 - 12;
/** A "Learned X!" line in the level-up panel (single line). */
export const LEVELUP_TEXT_W = 230 - 28;
/** Shop: a member's stat-change line in the detail pane (pane at 298, width 174; the line starts 26px in). */
/** Battle target-info box: the enemy's name left, its known weaknesses right, on one row. */
export const TARGET_INFO_W = 204;
export const SHOP_COMPARE_W = W - (96 + 196 + 6) - 8 - 16 - 18;
/** Equip screen: the item description (and "can't use" reason) under the list, 6 lines of 10px. */
export const EQUIP_DESC_W = 142;
export const EQUIP_DESC_LINES = 6;
