/**
 * The side-on battle layout (spike `spike/side-battle`, behind the URL flag `?battle=side`, DEV
 * builds only): the party stands on the right, facing left toward the enemies on the left.
 * Without the flag nothing here is used and the battle is the v0.1.0 back view.
 *
 * Flags (all DEV only):
 *   ?battle=side                the layout, the crew at BATTLE scale (~47 px tall, from the traced west view),
 *                               regular enemies at "fit": humanoids at the trace's native resolution (the crew's height),
 *                               creatures at twice it, both whole-number sizes
 *   ?battle=side&scale=field    the day-1 comparison: the crew from their ~30 px field `left` frame
 *   ?battle=side&enemyscale=half  humanoids and creatures both at the trace's native resolution
 *   ?battle=side&enemyscale=wide  round 2's look: humanoids 1.25x and creatures 1.5x native (fractional: uneven line widths)
 *   ?battle=side&enemyscale=full  the traces as they are (91 px humanoids), the day-1 and round-1 look
 *   Bosses (Knuckles, the Lurker, the Warden) are never reduced (Final Fantasy VI style: big bosses, party-sized grunts).
 */
import { type Battler, POSES, type Pose } from '../../art/battlers';
import { buildChar } from '../../art/chars';
import { feetRow, headRow } from '../../art/drawn';
import { reduceEnemies } from '../../art/rig2/enemy';
import { IDLE_ORDER, buildSideCrew } from '../../art/rig2/sidecrew';
import { LOOKS } from '../../data/looks';

const query = (): URLSearchParams => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

/** True when the page was opened with `?battle=side` on a DEV build; a shipped build ignores the flag. */
export const SIDE_VIEW: boolean = import.meta.env.DEV && query().get('battle') === 'side';
/** Which size the crew are drawn at: battle (the default) or the field frame. */
export const SIDE_SCALE: 'battle' | 'field' = query().get('scale') === 'field' ? 'field' : 'battle';
/** `&enemyscale=`: how regular enemies are sized next to a 47 px crew. The default is "fit". */
export type EnemyScale = 'fit' | 'half' | 'wide' | 'full';
const ES = query().get('enemyscale');
export const ENEMY_SCALE: EnemyScale = !SIDE_VIEW ? 'full' : ES === 'full' || ES === 'half' || ES === 'wide' ? ES : 'fit';

/**
 * Humanoid regular enemies, and creatures. Each is collapsed to the trace's native resolution (a pixel
 * per 2x2 block, so one pixel density with the crew), then drawn at a WHOLE-number multiple by default
 * (round 3: every fractional stretch doubled every fifth row or column and left beaded outlines):
 * humanoids at 1 (a punk is 46 px, the crew's height), creatures at 2 (a Glowrat is about 47 px wide).
 */
const HUMANOIDS = ['punk', 'medic', 'slinger', 'ghoul', 'sentinel', 'arcanist', 'wisp', 'shade', 'bound'];
const CREATURES = ['rat', 'hound', 'drone', 'crab', 'maint', 'eel', 'turret', 'hunter'];
if (ENEMY_SCALE === 'half') reduceEnemies([...HUMANOIDS, ...CREATURES], 1);
else if (ENEMY_SCALE === 'fit') {
  reduceEnemies(HUMANOIDS, 1);
  reduceEnemies(CREATURES, 2);
} else if (ENEMY_SCALE === 'wide') {
  reduceEnemies(HUMANOIDS, 1.25);
  reduceEnemies(CREATURES, 1.5);
}

/**
 * Where the party member in slot `i` (0 = front) of `n` stands, in battle-world pixels (the world is
 * 240x135, drawn at 2x). RPG Maker's diagonal: slot 0 (the first panel, Kit) is the top-left one,
 * nearest the enemies, and each next slot is a step lower and to the right, so the line reads left
 * to right in the same order as the status panels under it. `feet` is the row the soles sit on.
 * Slot 0's feet are a few pixels below the enemies' (a shared ground plane); the last slot's stay
 * above the foreground rail (world row 98).
 */
export function sideSlot(i: number, n: number): { x: number; feet: number } {
  const step = Math.min(1, 3 / Math.max(1, n - 1));
  return { x: Math.round(130 + i * 23 * step), feet: Math.round(76 + i * 7 * step) };
}

/** Left edge of the first enemy: the command menus own the left column (x 4 to 88 on screen), so the enemies start right of it. */
export const SIDE_ENEMY_LEFT = 46;
/** How much higher up the street the enemies stand than in the back view (battle-world pixels): their feet at row ~72, a few above slot 0's (76), and clear of the windows under them. */
export const SIDE_ENEMY_LIFT = 8;
/**
 * Per backdrop, how far the enemies stand up the street from the party's ground line, where the default
 * does not put their feet on the floor (data, not a per-enemy fix). The sewer's lit walkway starts lower
 * than the street's pavement, so its enemies stand 5 px lower than the default.
 */
export const SIDE_ENEMY_LIFT_BY_BG: Record<string, number> = { sewer: 3 };
/** The same for a boss, less: a tall boss's health bar would run into the top message window. */
export const SIDE_BOSS_LIFT = 6;
/** Right limit of the enemies: slot 0's left edge (a staff or a ponytail reaches past the body). */
export const SIDE_ENEMY_RIGHT = 120;
/** A group too wide for the strip (four or more) closes up (the art's transparent margins overlap, and every other enemy stands a row further back) rather than standing out over the menu column; this is the furthest left it may start (the menu's right edge is world x 44, and the art has about 3 px of transparent margin). */
export const SIDE_ENEMY_EDGE = 38;
/** Extra room (screen pixels) the command menus, the ability list and the target box leave above the party panels: the active member's panel rises 5, so the old 6 left them touching. */
export const SIDE_PANEL_GAP = 5;
/** The least room between two enemies' art (battle-world pixels), so a club or an arm never crosses the next one. */
export const SIDE_ENEMY_GAP_MIN = -5;
/** The most, so a small group doesn't scatter. */
export const SIDE_ENEMY_GAP_MAX = 10;

/** How the party steps in from the right edge at the start of a fight: world pixels per frame, and frames per step. */
export const WALK_SPEED = 1.5;
export const WALK_FRAMES_PER_STEP = 4;
/** Where a stepping-in member starts: just past the right edge. */
export const WALK_FROM = 252;
/** How long each step of the wait loop lasts (frames at 60 a second: about half a second, RPG Maker's pace), choosing orders and not. */
export const IDLE_FRAMES_PER_STEP = 30;
export const IDLE_FRAMES_PER_STEP_ACTIVE = 20;

/** The frames the idle loop plays: 1-2-3-2. */
export const IDLE_FRAME_ORDER = IDLE_ORDER;

/** A crew member's side-on battler: at battle scale from the traced view, or (`scale=field`) from the field `left` frame. */
export function sideBattler(key: string): Battler | null {
  if (SIDE_SCALE === 'battle') {
    const crew = buildSideCrew(key);
    if (crew) {
      const frames = {} as Record<Pose, HTMLCanvasElement>;
      for (const p of POSES) frames[p] = crew.base;
      return { frames, glow: {}, headH: Math.ceil(crew.headPx / 2), res: 2, cycle: { idle: crew.idle, idleOrder: IDLE_ORDER, walk: crew.walk } };
    }
  }
  const look = LOOKS[key as keyof typeof LOOKS];
  const sprite = look ? buildChar(look).frames.left[0] : undefined;
  if (!sprite) return null;
  // Crop to the soles, so the frame's bottom edge is where the feet are.
  const feet = feetRow(sprite) + 1;
  const c = document.createElement('canvas');
  c.width = sprite.width;
  c.height = feet;
  c.getContext('2d')?.drawImage(sprite, 0, 0);
  const frames = {} as Record<Pose, HTMLCanvasElement>;
  for (const p of POSES) frames[p] = c;
  return { frames, glow: {}, headH: Math.ceil((feet - headRow(c)) / 2), res: 2 };
}
