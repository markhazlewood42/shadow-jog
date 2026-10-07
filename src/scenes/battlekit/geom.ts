/** Battle geometry shared by the scene (layout, targeting) and the renderer. */
import { H, W } from '../../engine/game';

/**
 * Screen pixels per world pixel. The battle world (and the title's skyline, which shares this
 * grain) is drawn at half the screen size and then scaled up by this factor, so its art keeps one
 * chunky pixel size whatever the screen is. Every place that converts a world coordinate to a
 * screen coordinate multiplies by this constant, never by a bare 2: if the world layer and the
 * enemy layer ever used different factors, sprites, hit sparks and HP bars would drift apart
 * silently. The new engine's size module takes this over at M0 (`grain(2)`).
 */
export const WORLD_SCALE = 2;
/** The battle world's size in world pixels: half the screen (240x135 on a 480x270 screen). */
export const BW = W / WORLD_SCALE, BHT = H / WORLD_SCALE;
/** Top of the party panel, in screen pixels. */
export const PANEL_Y = 214;
/** Party feet sit well below the panel top (107): an over-the-shoulder view of heads, shoulders and raised arms. */
export const PARTY_BOTTOM = 127;
/** Effect frames Hex's deck stays up over their card when they run a program. */
export const DECK_CUT_LIFE = 56;
/** Battle menus hug the screen edge; CMD_W fits "Programs"/"Spirits" plus the cursor. */
export const MENU_X = 4, CMD_W = 84;

/**
 * The top line (prompt, description, message) can wrap to three lines: y 6 to 45, nearly full
 * width. Anything else drawn at the top has to stay out of this band.
 */
export const TOP_BAND_BOTTOM = 46;
/** One face in the turn-order strip, and the gap between entries. */
export const ORDER_FACE = 13, ORDER_GAP = 4;
/**
 * The strip's column: an edge of the screen below the top band and above the party panel. It
 * takes the side opposite the acting member's menus (they open on that member's side).
 */
export const ORDER_TOP = 58, ORDER_RIGHT = W - 6, ORDER_LEFT = 6, ORDER_BOTTOM = PANEL_Y - 6;

/**
 * Where each turn-order entry goes: a column down one edge, one entry per action (a combo is one
 * entry, two faces wide), aligned to that edge. Entries that won't fit above the party panel are
 * dropped (the caller shows how many). Pure, so the layout test can check it against the rest.
 */
export function orderStripLayout(faces: readonly number[], side: 'left' | 'right' = 'right'): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let y = ORDER_TOP;
  for (const n of faces) {
    const w = n * ORDER_FACE + 1, h = 14;
    if (y + h > ORDER_BOTTOM) break;
    out.push({ x: side === 'right' ? ORDER_RIGHT - w : ORDER_LEFT, y, w, h });
    y += h + ORDER_GAP;
  }
  return out;
}
