/**
 * The side-on battle layout (spike `spike/side-battle`, behind the URL flag `?battle=side`, DEV
 * builds only). Without the flag nothing here is used and the battle is the v0.1.0 back view.
 *
 * Flags (all DEV only):
 *   ?battle=side                Sprite Fusion art (`art=sf`, the default): Mark's own sprites, loaded from `spritefusion-tests/` through the dev
 *                               server (never copied or committed). The party stands on the LEFT facing RIGHT (every Sprite Fusion sprite faces right, so
 *                               none is mirrored) and the enemies on the right. All four crew are Mark's art. Enemies get a dark outline and a
 *                               despeckle (`&finish=0` for round 1's look). Round 4: regulars at 1.25x native (an area-vote scale, party-sized) and bosses at exactly 2x; `&regscale=` and `&bossscale=` (1 to 2) restore the old 1.5 and 1.75 looks.
 *   ?battle=side&art=code       the first loop's layout, kept for comparison: party on the right facing left, code-drawn crew (the traced `south-west`
 *                               views collapsed to their NATIVE resolution, 49 to 59 px tall), every enemy collapsed to native and drawn 1x.
 *   ?battle=side&clean=0        Sprite Fusion art without the colour clean-up (the raw ~1,000 shades a sprite)
 *   ?battle=side&scale=field    the day-1 comparison: the crew from their ~30 px field `left` frame
 *   ?battle=side&enemyscale=big   round 3's look: creatures at 2x and bosses at their full trace (the Warden 138 px): 2 px blocks beside the crew's 1 px
 *   ?battle=side&enemyscale=half  humanoids and creatures native, bosses at their full trace
 *   ?battle=side&enemyscale=full  the traces as they are (91 px humanoids), the day-1 and round-1 look
 */
import { type Battler, POSES, type Pose } from '../../art/battlers';
import { buildChar } from '../../art/chars';
import { feetRow, headRow } from '../../art/drawn';
import { finishEnemies, liftEnemies, reduceEnemies } from '../../art/rig2/enemy';
import { SF_SLOTS, SF_WALK, SF_WALK_START_X } from '../../art/rig2/sfgeom';
import { IDLE_ORDER, buildSideCrew } from '../../art/rig2/sidecrew';
import { mirrorBattler, sfBattler } from '../../art/rig2/sfcrew';
import { LOOKS } from '../../data/looks';

const query = (): URLSearchParams => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

/** True when the page was opened with `?battle=side` on a DEV build; a shipped build ignores the flag. */
export const SIDE_VIEW: boolean = import.meta.env.DEV && query().get('battle') === 'side';
/**
 * Which art the side view uses: Mark's Sprite Fusion sprites (`sf`, the default: party left facing right, enemies right) or the first loop's
 * code-drawn crew (`&art=code`: party right facing left, enemies left). The game's own `?art=` flag (drawn/classic/review) is a different
 * thing; `&art=code` here is `art=code` in the same URL, which that code ignores.
 */
export const SF: boolean = SIDE_VIEW && query().get('art') !== 'code';
/** The way the party faces: +1 (right) for Sprite Fusion art, -1 (left) for the code-drawn crew. A strike lunges along it; a hit knocks a body back against it. */
export const FACE: 1 | -1 = SF ? 1 : -1;

/** Which size the crew are drawn at: battle (the default) or the field frame. */
export const SIDE_SCALE: 'battle' | 'field' = query().get('scale') === 'field' ? 'field' : 'battle';
/** `&enemyscale=`: how enemies are sized next to the crew. The default is "fit": everything at its native resolution. */
export type EnemyScale = 'fit' | 'half' | 'big' | 'full' | 'native';
const ES = query().get('enemyscale');
export const ENEMY_SCALE: EnemyScale = !SIDE_VIEW ? 'full' : ES === 'full' || ES === 'half' || ES === 'big' || ES === 'native' ? ES : 'fit';
/**
 * Sprite Fusion art, enemies (round 3): WHOLE multiples of the trace's native resolution only. Round 2 grew the traces by 1.5 and 1.75; a native pixel then
 * became one or two screen pixels by turns (uneven grain, mushy faces) beside the crew's even 1:1 pixels. Now a regular enemy is drawn at 1x native (a punk
 * about 48 px, the ghoul 50, beside Kit's 64: small, but one grain with the crew) and a boss at exactly 2x (the Warden 138 px, the grain of the backdrop and of
 * v0.1.0's Warden). `&regscale=1.5` / `&bossscale=1.75` (any value from 1 to 2) bring back the old non-integer looks for comparison. The real fix for
 * party-sized regulars is new enemy art at crew density (see the missing-frames list in the spike notes).
 */
const numFlag = (k: string, lo: number, hi: number, d: number): number => {
  const v = Number(query().get(k));
  return v >= lo && v <= hi ? v : d;
};
export const SF_ENEMY_MULT = { regular: numFlag('regscale', 1, 2, 1.25), boss: numFlag('bossscale', 1, 2, 2) } as const;

/**
 * Humanoid regular enemies, creatures and bosses. Each is collapsed to the trace's native resolution (a pixel
 * per 2x2 block, so one pixel density with the crew), then drawn at a whole-number multiple: by default 1 for all of them.
 */
const HUMANOIDS = ['punk', 'medic', 'slinger', 'ghoul', 'sentinel', 'arcanist', 'wisp', 'shade', 'bound'];
const CREATURES = ['rat', 'hound', 'drone', 'crab', 'maint', 'eel', 'turret', 'hunter'];
const BOSSES = ['brute', 'lurker', 'warden', 'warden_spirit'];
if (SF && ENEMY_SCALE === 'fit') {
  reduceEnemies([...HUMANOIDS, ...CREATURES], SF_ENEMY_MULT.regular);
  reduceEnemies(BOSSES, SF_ENEMY_MULT.boss);
}
if (SF && ENEMY_SCALE !== 'full' && query().get('finish') !== '0') {
  // Round 2: a dark outline, despeckle, and the punk and the ghoul turned to face the party (the rest are symmetric or already face left). `&finish=0` shows the plain scaled trace.
  finishEnemies([...HUMANOIDS, ...CREATURES, ...BOSSES], ['punk', 'ghoul']);
  // Round 4: the ghoul is a dark grey body on a navy street: its dark tones are lifted a fifth of the way to light so the silhouette holds.
  liftEnemies(['ghoul'], 0.2);
}
if (SF && ENEMY_SCALE === 'fit') {
  /* (scaling registered above) */
} else if (SF && ENEMY_SCALE === 'native') reduceEnemies([...HUMANOIDS, ...CREATURES, ...BOSSES], 1);
else if (SF && ENEMY_SCALE === 'full') {
  /* the traces as they are */
} else if (ENEMY_SCALE === 'fit') reduceEnemies([...HUMANOIDS, ...CREATURES, ...BOSSES], 1);
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
  // Sprite Fusion art: the mirror of the layout below. Slot 0 (Kit, the first panel) is the top-right one, nearest the enemies, and each next slot is a step lower and to the left.
  if (SF) return SF_SLOTS[Math.min(i, SF_SLOTS.length - 1)] ?? { x: 110, feet: 78 };
  return { x: Math.round(SIDE_PARTY_X + i * SIDE_PARTY_STEP_X * step), feet: Math.round(SIDE_PARTY_FEET + i * SIDE_PARTY_STEP_Y * step) };
}
/** Slot 0's centre x and soles row, and the diagonal's step per slot (battle-world pixels). The crew are ~15 world px wide and ~29 tall. */
export const SIDE_PARTY_X = 154;
export const SIDE_PARTY_FEET = 79;
export const SIDE_PARTY_STEP_X = 17;
export const SIDE_PARTY_STEP_Y = 5.5;

/**
 * Sprite Fusion layout (battle-world pixels, 240x135 at 2x): the party's places are `SF_SLOTS` in `rig2/sfgeom.ts` (a diagonal climbing to the top-left,
 * spaced by the sprites' real widths, the back two over the menu column). The enemies' strip runs from Kit's front edge plus a 24 art px lane to short
 * of the turn strip (world x 226); `tests/sflayout.test.ts` checks both against Mark's PNGs.
 */
export const SF_PARTY_X = SF_SLOTS[0]?.x ?? 111;
export const SF_PARTY_FEET = SF_SLOTS[0]?.feet ?? 78;
/** Sprite Fusion layout: the enemies' strip. */
export const SF_ENEMY_LEFT = 140;
export const SF_ENEMY_RIGHT = 226;
/** Sprite Fusion layout: the least gap (world pixels) between neighbours in one row before the small creatures drop to a front row, the most a small group spreads to, and how many rows lower that front row stands. */
export const SF_ENEMY_GAP_ROW = 4;
export const SF_ENEMY_GAP_MAX = 14;
export const SF_ENEMY_FRONT_DROP = 9;
/** Sprite Fusion layout: the enemies' feet stand this many rows above slot 0's (a regular, a boss), the depth of the street. */
export const SF_ENEMY_LIFT = 1;
export const SF_BOSS_LIFT = 3;

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
export const WALK_SPEED = SF ? 2 : 1.5;
/**
 * Sprite Fusion art: the last SF_WALK_EASE world pixels slow the walk to a quarter of its speed (a stop, not a halt): over that stretch the remaining
 * distance is r = E(4/3)e^(-0.75vt/E) - E/3, which starts at the walking speed (no jump) and reaches 0 after (E/0.75v) ln 4 frames.
 */
export const SF_WALK_EASE = 24;
/** How far (battle-world pixels) the party still has to walk `t` frames after the walk began, for a walk of `full` pixels in all. */
export function walkRemaining(full: number, t: number): number {
  if (!SF) return Math.max(0, full - t * WALK_SPEED);
  const E = Math.min(SF_WALK_EASE, full);
  const t1 = (full - E) / WALK_SPEED;
  if (t <= t1) return full - t * WALK_SPEED;
  const r = ((E * 4) / 3) * Math.exp((-0.75 * WALK_SPEED * (t - t1)) / E) - E / 3;
  return Math.max(0, r);
}
/** Frames the whole walk takes. */
export function walkFrames(full: number): number {
  if (!SF) return Math.ceil(full / WALK_SPEED);
  const E = Math.min(SF_WALK_EASE, full);
  return Math.ceil((full - E) / WALK_SPEED + ((E / (0.75 * WALK_SPEED)) * Math.log(4)));
}
/**
 * Sprite Fusion art, round 3: the walk-in is per member (`SF_WALK` in rig2/sfgeom.ts). `i` is the member's place in the line, `slotX` its slot's x,
 * `t` the frames since the walk began (negative: it has not). Returns how far (battle-world pixels, negative = left of the slot) the member still has to
 * go, whether it is moving, and its opacity (Hex and Sable fade in over their short step). The same ease as `walkRemaining` stops each one, at that
 * member's own speed.
 */
export function sfWalkState(i: number, slotX: number, t: number, introducing: boolean): { left: number; moving: boolean; alpha: number } {
  const w = SF_WALK[Math.min(i, SF_WALK.length - 1)];
  if (!w) return { left: 0, moving: false, alpha: 1 };
  const full = w.run ? slotX - SF_WALK_START_X : -w.from;
  const tt = t - w.delay;
  if (t < 0 && !introducing) return { left: 0, moving: false, alpha: 1 };
  if (t < 0 || tt < 0) return { left: -full, moving: true, alpha: w.fade > 0 ? 0 : 1 };
  const E = Math.min(SF_WALK_EASE, full);
  const t1 = (full - E) / w.speed;
  const left = tt <= t1 ? full - tt * w.speed : Math.max(0, ((E * 4) / 3) * Math.exp((-0.75 * w.speed * (tt - t1)) / E) - E / 3);
  return { left: -left, moving: left > 0.05, alpha: w.fade > 0 ? Math.min(1, tt / w.fade) : 1 };
}
/** Frames until the last member has stopped (the orders wait for it). */
export function sfWalkTotal(): number {
  let most = 0;
  for (const [i, w] of SF_WALK.entries()) {
    const full = w.run ? (SF_SLOTS[i]?.x ?? 0) - SF_WALK_START_X : -w.from;
    const E = Math.min(SF_WALK_EASE, full);
    most = Math.max(most, w.delay + Math.ceil((full - E) / w.speed + (E / (0.75 * w.speed)) * Math.log(4)));
  }
  return most;
}
/** Sprite Fusion art: the last few pixels of the walk where the run eases into the stance (Kit's skid). */
export const SF_SETTLE_DIST = 8;
export const WALK_FRAMES_PER_STEP = 4;
/** Where a stepping-in member starts: just past the right edge (Sprite Fusion art: just past the left edge, the walk the other way). */
export const WALK_FROM = SF ? -24 : 252;
/** How long each step of the wait loop lasts (frames at 60 a second: about half a second, RPG Maker's pace), choosing orders and not. */
export const IDLE_FRAMES_PER_STEP = 30;
export const IDLE_FRAMES_PER_STEP_ACTIVE = 20;

/** The frames the idle loop plays: 1-2-3-2. */
export const IDLE_FRAME_ORDER = IDLE_ORDER;

/** A crew member's side-on battler: at battle scale from the traced view, or (`scale=field`) from the field `left` frame. */
export function sideBattler(key: string): Battler | null {
  if (SF) {
    // Sprite Fusion art where Mark has made it; otherwise (Sable) the first loop's crew member turned to face right.
    const sf = sfBattler(key);
    if (sf) return sf;
    const code = codeBattler(key);
    return code ? mirrorBattler(code) : null;
  }
  return codeBattler(key);
}

/** The first loop's crew member (code-drawn, facing left), or the field frame at `scale=field`. */
function codeBattler(key: string): Battler | null {
  if (SIDE_SCALE === 'battle') {
    const crew = buildSideCrew(key);
    if (crew) {
      const frames = {} as Record<Pose, HTMLCanvasElement>;
      for (const p of POSES) frames[p] = crew.poses[p] ?? crew.base;
      return { frames, glow: {}, headH: Math.ceil(crew.headPx / 2), res: 2, cycle: { idle: crew.idle, idleOrder: IDLE_ORDER, walk: crew.walk }, ...(crew.kata ? { kata: crew.kata } : {}), ...(crew.kataPlain ? { kataPlain: crew.kataPlain } : {}) };
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

/** Sprite Fusion art (round 4): how many screen pixels over the top of an enemy's art the bottom of its health bar's plate stands (the plate is 7 tall); the target chevron hangs over it. Round 3 was 3 and the plate overlapped the head by 2. */
export const SF_BAR_RISE = 8;
