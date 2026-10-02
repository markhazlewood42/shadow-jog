/**
 * The side-on battle layout (spike `spike/side-battle`, behind the URL flag `?battle=side`, DEV
 * builds only): the party stands on the right, facing left toward the enemies on the left.
 * Without the flag nothing here is used and the battle is the v0.1.0 back view.
 *
 * Flags (all DEV only):
 *   ?battle=side                the layout, the crew at BATTLE scale (~47 px tall, from the traced west view)
 *   ?battle=side&scale=field    the day-1 comparison: the crew from their ~30 px field `left` frame
 *   ?battle=side&enemyscale=half  humanoid regular enemies shrunk by half (nearest), creatures and bosses stay large
 */
import { type Battler, POSES, type Pose } from '../../art/battlers';
import { buildChar } from '../../art/chars';
import { feetRow, headRow } from '../../art/drawn';
import { halveEnemies } from '../../art/rig2/enemy';
import { IDLE_ORDER, buildSideCrew } from '../../art/rig2/sidecrew';
import { LOOKS } from '../../data/looks';

const query = (): URLSearchParams => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

/** True when the page was opened with `?battle=side` on a DEV build; a shipped build ignores the flag. */
export const SIDE_VIEW: boolean = import.meta.env.DEV && query().get('battle') === 'side';
/** Which size the crew are drawn at: battle (the default) or the field frame. */
export const SIDE_SCALE: 'battle' | 'field' = query().get('scale') === 'field' ? 'field' : 'battle';
/** `&enemyscale=half`: humanoid regular enemies are drawn at half size, so a 91 px punk stands as tall as the crew. */
export const ENEMY_HALF: boolean = SIDE_VIEW && query().get('enemyscale') === 'half';

/** The humanoid regular enemies (not the boss "Knuckles", not creatures): the ones `enemyscale=half` shrinks. */
const HALF_SPRITES = ['punk', 'medic', 'slinger', 'ghoul', 'sentinel', 'arcanist'];
if (ENEMY_HALF) halveEnemies(HALF_SPRITES);

/**
 * Where the party member in slot `i` (0 = front) of `n` stands, in battle-world pixels (the world is
 * 240x135, drawn at 2x): a shallow diagonal in the lower right, each one a little further up and to
 * the left than the one in front. `feet` is the row the soles sit on.
 */
export function sideSlot(i: number, n: number): { x: number; feet: number } {
  const step = Math.min(1, 3 / Math.max(1, n - 1));
  return { x: Math.round(208 - i * 17 * step), feet: Math.round(98 - i * 8 * step) };
}

/** Left edge of the first enemy: the command menus own the left column (x 4 to 88 on screen), so the enemies start right of it. */
export const SIDE_ENEMY_LEFT = 46;
/** How much higher up the street the enemies stand than in the back view (battle-world pixels): behind every crew row, and clear of the windows under them. */
export const SIDE_ENEMY_LIFT = 10;
/** The same for a boss, less: a tall boss's health bar would run into the top message window. */
export const SIDE_BOSS_LIFT = 6;
/** Right limit of the enemies: the rear party slot's left edge. */
export const SIDE_ENEMY_RIGHT = 140;

/** How the party steps in from the right edge at the start of a fight: world pixels per frame, and frames per step. */
export const WALK_SPEED = 1.4;
export const WALK_FRAMES_PER_STEP = 4;
/** Where a stepping-in member starts: just past the right edge. */
export const WALK_FROM = 252;

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
