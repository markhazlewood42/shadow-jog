/**
 * The pictures a move can show (Phaser spike `spike/phaser-stage`): a *still* is one finished picture with a
 * stand-on point, the unit the move frames of `moves.ts` refer to by name (`rook.windup`).
 *
 * WHY STILLS ARE NOT SHEET FRAMES. Mark's idle loops are neat strips of equal cells, but his strike drawings are
 * single PNGs of different sizes: Rook's overhead wind-up is 69x110, his low follow-through 101x66, his crouch
 * 105x53. Padding them to one size would be work for him, and "one offset per animation" would make the body slide
 * (see `docs/TOOLING-UI.md` 4.2). So each still keeps its own canvas and its own AXIS, the pixel it stands on. When a
 * move shows a still, the stage draws it so its axis lands on the fighter's ground point (plus the frame's offset),
 * and every frame of the move shares that one ground point.
 *
 * HOW ROOK'S STILLS ARE MADE. The side-view spike already worked out how to line these drawings up and how to
 * make the in-between poses Mark has not drawn (`src/art/rig2/sfstrike.ts`: rows removed from his wind-up legs for the
 * stand-up, the sword cut out and a code-drawn blade with a solid crescent for the swing frames). That module is plain
 * pixel maths on arrays, so it runs here unchanged: `buildSfStrike` returns every frame on ONE canvas with its soles on
 * the bottom row and the idle frame laid in a known place (`readyAt`), which is how the axis is found: it is wherever
 * the idle loop's own foot anchor (`feet.ts`) falls on that canvas, so Rook does not move a pixel when his idle loop
 * hands over to the dip and back.
 *
 * ON A MACHINE WITHOUT MARK'S FOLDER (CI) the same names are built from code-drawn blocks (`buildStandInStrike`):
 * a figure that crouches, stands, swings a blade with the same swipe crescents and follows through. They are not
 * art; they keep the whole pipeline (moves, lunge, hitstop, effects) running and tested everywhere.
 */
import type Phaser from 'phaser';
import { dropStrays } from '../art/rig2/sfpunch';
import { buildKitSet, buildStrikeSet, type StrikeSet } from './strike';
import type { FootAnchor } from './feet';
import type { Raw } from './pixels';
import { bakeFrame, type BakePlan } from './proportions';
import { addCanvasOnce, rawToCanvas } from './textures';
import type { StillDef } from './moves';

/** The loader keys of Mark's drawings: Rook's three strike frames and Kit's six combo frames. */
export const STRIKE_ART = {
  s1: { key: 'sf-rook-strike1', file: 'rook-battle-strike1.png' },
  s2: { key: 'sf-rook-strike2', file: 'rook-battle-strike2.png' },
  crouch: { key: 'sf-rook-crouched', file: 'rook-battle-crouched.png' },
  run: { key: 'sf-kit-running', file: 'kit-battle-running.png' },
  load: { key: 'sf-kit-punch1', file: 'kit-battle-punch1.png' },
  jab: { key: 'sf-kit-punch2', file: 'kit-battle-punch2.png' },
  cross: { key: 'sf-kit-punch3', file: 'kit-battle-punch3.png' },
  kick: { key: 'sf-kit-kick', file: 'kit-battle-kick.png' },
  low: { key: 'sf-kit-crouched', file: 'kit-battle-crouched.png' },
} as const;

const ART_BASE = '/spritefusion-tests/';

/** What the stage remembers about one still. */
export interface StillInfo {
  /** The texture's key. */
  texture: string;
  /** The picture's size. */
  w: number;
  h: number;
  /** The pixel it stands on, before any foot-anchor correction from `axes.json`. */
  axisX: number;
  axisY: number;
}

/** Queue Mark's drawings on a loader (skipped when already in the texture list). */
export function queueStrikeArt(load: Phaser.Loader.LoaderPlugin, textures: Phaser.Textures.TextureManager): void {
  for (const a of Object.values(STRIKE_ART)) if (!textures.exists(a.key)) load.image(a.key, `${ART_BASE}${a.file}`);
}

/**
 * A still's texture name. `tag` names the hero's proportions it was baked with (the bracket ends the name), so a changed
 * proportion makes a new picture and the old one can be found by its name and removed.
 */
export const stillTexture = (id: string, tag = ''): string => `still-${id.replace('.', '-')}${tag ? `[${tag}]` : ''}`;

/**
 * One fighter's side of what `registerStills` needs: their idle loop AS DRAWN, frame by frame, and the foot anchor
 * measured on it (the strike and punch pictures are built from the drawn art), and how the hero's proportions
 * (`proportions.ts`) change the result: the plan to lay on every picture, its name, and how far the re-measured baked
 * foot is from where the drawn anchor went.
 */
export interface FighterIdle {
  idle: Raw[];
  foot: FootAnchor;
  plan: BakePlan;
  tag: string;
  footDelta: { x: number; y: number };
}

/** What `registerStills` needs from the texture side (kept as plain values and functions so this file does not import the whole pipeline). */
export interface StillSources {
  textures: Phaser.Textures.TextureManager;
  /** Each art set's fighter. */
  fighters: Record<StillDef['art'], FighterIdle>;
  /** Read a loaded texture's pixels. */
  read: (key: string) => Raw;
  /** True to draw the code-made stand-ins instead of using Mark's drawings. */
  standIns: boolean;
}

/**
 * Make a texture for every still the move file declares (once: a restarted scene finds them again) and return what is
 * known about each. The axis of every still of a set is the idle loop's foot anchor placed on the shared canvas.
 * A set is built the first time one of its stills is wanted.
 */
export function registerStills(src: StillSources, declared: Record<string, StillDef>): Record<string, StillInfo> {
  const out: Record<string, StillInfo> = {};
  const { textures } = src;
  const sets = new Map<StillDef['art'], StrikeSet>();
  const read = (a: { key: string }): Raw => dropStrays(src.read(a.key));
  const build = (art: StillDef['art']): StrikeSet => {
    const have = sets.get(art);
    if (have) return have;
    const f = src.fighters[art];
    const made =
      art === 'sf-rook'
        ? buildStrikeSet(f.idle, f.foot, src.standIns ? null : { s1: read(STRIKE_ART.s1), s2: read(STRIKE_ART.s2), crouch: read(STRIKE_ART.crouch) })
        : buildKitSet(f.idle, f.foot, src.standIns ? null : { run: read(STRIKE_ART.run), load: read(STRIKE_ART.load), jab: read(STRIKE_ART.jab), cross: read(STRIKE_ART.cross), kick: read(STRIKE_ART.kick), low: read(STRIKE_ART.low) });
    sets.set(art, made);
    return made;
  };
  for (const [id, def] of Object.entries(declared)) {
    const f = src.fighters[def.art];
    const key = stillTexture(id, f.tag);
    if (!textures.exists(key)) {
      const b = build(def.art);
      const raw = b.frames[def.key];
      if (!raw) throw new Error(`Still "${id}" asks for "${def.key}", which the ${def.art} art does not have (it has: ${Object.keys(b.frames).join(', ')})`);
      // The hero's proportions: the same rows and columns as the idle loop got, laid on this picture about its axis (`guard`: a pose
      // that is not the idle's skips a pick that would fall in its own head or feet). The axis follows the baked idle's feet.
      const baked = bakeFrame(raw, { x: b.axisX, y: b.axisY }, f.plan, true);
      const texture = addCanvasOnce(textures, key, rawToCanvas(baked.raw));
      texture.customData = { axisX: baked.anchor.x + f.footDelta.x, axisY: baked.anchor.y + f.footDelta.y, w: baked.raw.w, h: baked.raw.h };
    }
    const data = textures.get(key).customData as { axisX: number; axisY: number; w: number; h: number };
    out[id] = { texture: key, w: data.w, h: data.h, axisX: data.axisX, axisY: data.axisY };
  }
  return out;
}
