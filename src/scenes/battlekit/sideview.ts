/**
 * The side-on battle layout (spike `spike/side-battle`, behind the URL flag `?battle=side`, DEV
 * builds only): the party stands on the right, facing left toward the enemies on the left.
 * Without the flag nothing here is used and the battle is the v0.1.0 back view.
 *
 * Flags (all DEV only):
 *   ?battle=side                the layout. The crew are the traced `south-west` views collapsed to their NATIVE resolution
 *                               (49 to 59 px tall, one art pixel per screen pixel), and every enemy is the same: collapsed to
 *                               native, drawn 1x (a punk is 46 px, a Glowrat 23 px wide, the Warden 69 px). One pixel density.
 *   ?battle=side&scale=field    the day-1 comparison: the crew from their ~30 px field `left` frame
 *   ?battle=side&enemyscale=big   round 3's look: creatures at 2x and bosses at their full trace (the Warden 138 px): 2 px blocks beside the crew's 1 px
 *   ?battle=side&enemyscale=half  humanoids and creatures native, bosses at their full trace
 *   ?battle=side&enemyscale=full  the traces as they are (91 px humanoids), the day-1 and round-1 look
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
/** `&enemyscale=`: how enemies are sized next to the crew. The default is "fit": everything at its native resolution. */
export type EnemyScale = 'fit' | 'half' | 'big' | 'full';
const ES = query().get('enemyscale');
export const ENEMY_SCALE: EnemyScale = !SIDE_VIEW ? 'full' : ES === 'full' || ES === 'half' || ES === 'big' ? ES : 'fit';

/**
 * Humanoid regular enemies, creatures and bosses. Each is collapsed to the trace's native resolution (a pixel
 * per 2x2 block, so one pixel density with the crew), then drawn at a whole-number multiple: by default 1 for all of them.
 */
const HUMANOIDS = ['punk', 'medic', 'slinger', 'ghoul', 'sentinel', 'arcanist', 'wisp', 'shade', 'bound'];
const CREATURES = ['rat', 'hound', 'drone', 'crab', 'maint', 'eel', 'turret', 'hunter'];
const BOSSES = ['brute', 'lurker', 'warden', 'warden_spirit'];
if (ENEMY_SCALE === 'fit') reduceEnemies([...HUMANOIDS, ...CREATURES, ...BOSSES], 1);
else if (ENEMY_SCALE === 'half') reduceEnemies([...HUMANOIDS, ...CREATURES], 1);
else if (ENEMY_SCALE === 'big') {
  reduceEnemies(HUMANOIDS, 1);
  reduceEnemies(CREATURES, 2);
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
  return { x: Math.round(SIDE_PARTY_X + i * SIDE_PARTY_STEP_X * step), feet: Math.round(SIDE_PARTY_FEET + i * SIDE_PARTY_STEP_Y * step) };
}
/** Slot 0's centre x and soles row, and the diagonal's step per slot (battle-world pixels). The crew are ~15 world px wide and ~29 tall. */
export const SIDE_PARTY_X = 154;
export const SIDE_PARTY_FEET = 79;
export const SIDE_PARTY_STEP_X = 17;
export const SIDE_PARTY_STEP_Y = 5.5;

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
export const SIDE_ENEMY_RIGHT = 132;
/** A group too wide for the strip (four or more) closes up (the art's transparent margins overlap, and every other enemy stands a row further back) rather than standing out over the menu column; this is the furthest left it may start (the menu's right edge is world x 44, and the art has about 3 px of transparent margin). */
export const SIDE_ENEMY_EDGE = 38;
/** Extra room (screen pixels) the command menus, the ability list and the target box leave above the party panels: the active member's panel rises 5, so the old 6 left them touching. */
export const SIDE_PANEL_GAP = 5;
/** The least room between two enemies' art (battle-world pixels), so a club or an arm never crosses the next one. */
export const SIDE_ENEMY_GAP_MIN = -8;
/** The most, so a small group doesn't scatter. */
export const SIDE_ENEMY_GAP_MAX = 6;

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
      for (const p of POSES) frames[p] = crew.poses[p] ?? crew.base;
      return { frames, glow: {}, headH: Math.ceil(crew.headPx / 2), res: 2, cycle: { idle: crew.idle, idleOrder: IDLE_ORDER, walk: crew.walk }, ...(crew.kata ? { kata: crew.kata } : {}) };
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

/** Stepping in, how many rows off its place each member's lane is at the start (they converge as they arrive). */
export const SIDE_WALK_LANES = [-3, 2, -2, 3];

/** How far (battle-world pixels) a melee strike may carry the actor, and how far in front of the target's centre it stops. */
export const SIDE_LUNGE_MAX = 84;
export const SIDE_LUNGE_STOP = 13;

export interface SideBeat {
  /** The crew frame to show: the crouch, the wind-up, or the blow. */
  frame: 'brace' | 'attack' | 'strike' | 'idle';
  /** How far along the lunge the body is (0 = in its place, 1 = at the target; a little negative = drawn back). */
  lunge: number;
  /** Speed-smear copies trailing behind the body (0: none). */
  smear: number;
}

/**
 * A melee strike in beats, `k` frames into the 34-frame pose (the hit's effects begin at frame 8): a crouch
 * drawing back (anticipation), the wind-up frame, a dash forward in two frames with a smear behind, the
 * blow held on the target through the impact, then the return to the line.
 */
export function sideBeat(k: number): SideBeat {
  if (k < 3) return { frame: 'brace', lunge: -0.05, smear: 0 };
  if (k < 6) return { frame: 'attack', lunge: -0.09, smear: 0 };
  if (k < 8) return { frame: 'strike', lunge: k < 7 ? 0.4 : 0.8, smear: 3 };
  if (k < 24) return { frame: 'strike', lunge: 1, smear: 0 };
  if (k < 34) return { frame: 'idle', lunge: Math.max(0, 1 - (k - 24) / 8), smear: 0 };
  return { frame: 'idle', lunge: 0, smear: 0 };
}
