/**
 * The side-on battle layout (spike `spike/side-battle`, behind the URL flag `?battle=side`, DEV
 * builds only): the party stands on the right, facing left toward the enemies on the left.
 * Without the flag nothing here is used and the battle is the v0.1.0 back view.
 *
 * Flags (all DEV only):
 *   ?battle=side                the layout, the crew at BATTLE scale (~47 px tall, from the traced west view),
 *                               regular enemies at the default size ("fit": humanoids ~0.6, creatures ~0.75 of the trace)
 *   ?battle=side&scale=field    the day-1 comparison: the crew from their ~30 px field `left` frame
 *   ?battle=side&enemyscale=half  humanoids and creatures at the trace's native resolution (a humanoid is the crew's height)
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
export type EnemyScale = 'fit' | 'half' | 'full';
export const ENEMY_SCALE: EnemyScale = !SIDE_VIEW ? 'full' : query().get('enemyscale') === 'full' ? 'full' : query().get('enemyscale') === 'half' ? 'half' : 'fit';

/**
 * Humanoid regular enemies, and creatures. Each is collapsed to the trace's native resolution (a pixel
 * per 2x2 block), then drawn 1 (half), 1.25 (fit, humanoids: a punk is about 57 px beside the crew's
 * 47) or 1.5 (fit, creatures: a Glowrat is about 35 px wide) times that.
 */
const HUMANOIDS = ['punk', 'medic', 'slinger', 'ghoul', 'sentinel', 'arcanist', 'wisp', 'shade', 'bound'];
const CREATURES = ['rat', 'hound', 'drone', 'crab', 'maint', 'eel', 'turret', 'hunter'];
if (ENEMY_SCALE === 'half') reduceEnemies([...HUMANOIDS, ...CREATURES], 1);
else if (ENEMY_SCALE === 'fit') {
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
  return { x: Math.round(150 + i * 20 * step), feet: Math.round(76 + i * 7 * step) };
}

/** Left edge of the first enemy: the command menus own the left column (x 4 to 88 on screen), so the enemies start right of it. */
export const SIDE_ENEMY_LEFT = 46;
/** How much higher up the street the enemies stand than in the back view (battle-world pixels): their feet at row ~72, a few above slot 0's (76), and clear of the windows under them. */
export const SIDE_ENEMY_LIFT = 8;
/** The same for a boss, less: a tall boss's health bar would run into the top message window. */
export const SIDE_BOSS_LIFT = 6;
/** Right limit of the enemies: slot 0's left edge (a staff or a ponytail reaches past the body). */
export const SIDE_ENEMY_RIGHT = 134;
/** A group too wide for the strip (four or more) may stand out over the menu column, down to here; the menus start under the enemies' feet, so nothing overlaps. */
export const SIDE_ENEMY_EDGE = 6;
/** Extra room (screen pixels) the command menus, the ability list and the target box leave above the party panels: the active member's panel rises 5, so the old 6 left them touching. */
export const SIDE_PANEL_GAP = 5;
/** The least room between two enemies' art (battle-world pixels), so a club or an arm never crosses the next one. */
export const SIDE_ENEMY_GAP_MIN = 2;
/** The most, so a small group doesn't scatter. */
export const SIDE_ENEMY_GAP_MAX = 10;

/** How the party steps in from the right edge at the start of a fight: world pixels per frame, and frames per step. */
export const WALK_SPEED = 1.4;
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
