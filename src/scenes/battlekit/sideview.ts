/**
 * The side-on battle layout (spike `spike/side-battle`, behind the URL flag `?battle=side`): the
 * party stands on the right, facing left toward the enemies on the left, drawn from their FIELD
 * frames at one art pixel per screen pixel (the same pixel size as the field and the enemies).
 * Without the flag nothing here is used and the battle is the v0.1.0 back view.
 */
import { type Battler, POSES, type Pose } from '../../art/battlers';
import { buildChar } from '../../art/chars';
import { feetRow, headRow } from '../../art/drawn';
import { LOOKS } from '../../data/looks';

/** True when the page was opened with `?battle=side`. */
export const SIDE_VIEW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('battle') === 'side';

/**
 * Where the party member in slot `i` (0 = front) of `n` stands, in battle-world pixels (the world is
 * 240x135, drawn at 2x): a shallow diagonal in the lower right, each one a little further up and to
 * the left than the one in front. `feet` is the row the soles sit on.
 */
export function sideSlot(i: number, n: number): { x: number; feet: number } {
  const step = Math.min(1, 3 / Math.max(1, n - 1));
  return { x: Math.round(206 - i * 19 * step), feet: Math.round(98 - i * 8 * step) };
}

/** Left edge of the first enemy: the enemies fill the left side. */
export const SIDE_ENEMY_LEFT = 10;

/** A crew member's battler built from their field `left` frame: every pose is that one frame, at 2 art pixels per world pixel. */
export function sideBattler(key: string): Battler | null {
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
