/**
 * The seam between the shipped field and a stage that draws it (M5 task 7; docs/engine/m5-brief.md sections 1 and 4). It follows the battle's seam
 * (`battlekit/stageseam.ts`, M3).
 *
 * The field scene (`scenes/field.ts`) keeps every rule: movement, warps, events, scripts, the camera target, the weather and dust motes. It normally draws the whole
 * picture into a Canvas 2D (`FieldScene.render`). Under `?engine=sje` a STAGE can draw it instead: a scene of the new engine that stands UNDER the field on the scene
 * stack and shows the map's baked layers, the props, the chests and the actors (sorted by y), the light map, the animations and the screen-fixed layer as engine
 * objects, while the field's own canvas, above it, carries only the dev overlay.
 *
 * The stage READS the field each frame through `FieldStageSource` (below), the way the battle stage reads the battle scene. The field implements it; this file holds the
 * types because the field may not import the stage's code (the stage is a flag-only chunk). Without the flag no provider is registered, `fieldStages.open` answers
 * null, and the field draws as it always did: this file adds no Pixi and no stage code to the default path.
 *
 * Coordinates in this file are map pixels (0,0 is the top-left of the map; `FieldStageView.cx, cy` is where the camera's top-left corner is in them).
 */
import { notice } from '../../engine/errors';
import type { Game } from '../../engine/game';
import type { AnimFx, BakedLight, SortedSprite } from '../../field/bake';
import type { Rect } from '../../field/overrects';
import type { FieldScene } from '../field';

/** A map as the stage needs it: its baked layers and what is drawn on them each frame. `FieldMap` (src/field/fieldmap.ts) is one. */
export interface StageMap {
  readonly def: { readonly id: string; readonly kind: string; readonly ambient: string; readonly voidColor?: string | undefined };
  /** Size in tiles. */
  readonly w: number;
  readonly h: number;
  /** The four baked layers, each w*TS by h*TS pixels. The over layers hold something only if `hasOver`. */
  readonly ground: HTMLCanvasElement;
  readonly emit: HTMLCanvasElement;
  readonly over: HTMLCanvasElement;
  readonly overEmit: HTMLCanvasElement;
  readonly hasOver: boolean;
  /** The parts of the over layers that hold anything, in map pixels. */
  readonly overRects: readonly Rect[];
  readonly lights: readonly BakedLight[];
  readonly sprites: readonly SortedSprite[];
  readonly anims: readonly AnimFx[];
}

/** One actor to draw this frame (the field lists only the visible ones, in its draw order: NPCs, then the party). */
export interface StageActor {
  /** The field's actor object: the stage uses it only as the identity of a view it keeps. */
  ref: object;
  /** This frame's picture. */
  image: HTMLCanvasElement;
  /** Top-left in map pixels (`Actor.drawX()`, `drawY()`). */
  x: number;
  y: number;
  /** The feet in map pixels (`Actor.px`, `py`): the sort line, and where the contact shadow goes. */
  px: number;
  py: number;
}

/** One chest. */
export interface StageChest {
  /** Tile. */
  tx: number;
  ty: number;
  kind: 'crate' | 'locker' | 'case';
  open: boolean;
}

/** Everything the stage draws for one frame. The field keeps ONE of these and fills it in place, so a frame allocates none. */
export interface FieldStageView {
  map: StageMap;
  /** The field's frame counter (update ticks): every animation counts it. */
  frame: number;
  /** The camera origin without the screen shake. The surround is painted from this. */
  camX: number;
  camY: number;
  /** The camera origin with the shake: where the map is drawn. Whole pixels (negative for a map smaller than the view). */
  cx: number;
  cy: number;
  actors: StageActor[];
  chests: StageChest[];
}

/** What the stage needs from the field. */
export interface FieldStageSource {
  /** Fill and return this frame's view. Called once per frame, in the stage's draw phase. */
  view(): FieldStageView;
  /**
   * Paint the screen-fixed layer onto a cleared W x H context: the dust, the weather, the pop-in curtains, the emotes, the interact cue, the area banner and the objective
   * (the old painters, unchanged). Returns false when nothing was drawn, so the stage can leave the picture out. The dev overlay is not in it: it stays on the field's own canvas.
   */
  paintScreen(ctx: CanvasRenderingContext2D, cx: number, cy: number): boolean;
  /** The old-look picture of the field, for the screen snapshot of a battle's intro (`Game.ctx`). */
  paintLegacy(ctx: CanvasRenderingContext2D): void;
  /** The stage failed (a draw threw): the field takes back its own drawing and shows a notice. The stage closes itself after this call. */
  stageFailed(error: unknown): void;
}

/** What the field holds of its stage. */
export interface FieldStage {
  readonly closed: boolean;
  /** Take the stage off the scene stack. Safe to call twice. */
  close(): void;
}

/** Something that can make a stage for a field scene (the engine's boot glue registers one under the flag). */
export interface FieldStageProvider {
  /** Build the stage for this field and put it on the scene stack UNDER the field. Resolves null when it cannot (the field then draws itself, as without the flag). */
  open(game: Game, field: FieldScene): Promise<FieldStage | null>;
  /** Start loading the stage's code, so the first field frame does not wait for it. Never rejects. */
  warm?(): void;
}

/** The words of the in-game notice (a warning bar) when the stage cannot be made or fails: the field then uses the old view. */
export const FIELD_STAGE_FAILED_NOTICE = 'The new field view could not load, so the field uses the old view.';

let provider: FieldStageProvider | null = null;

/** Register (or, with null, remove) the provider. Called by `src/sje/boot.ts` under `?engine=sje`, and by tests. */
export function setFieldStageProvider(p: FieldStageProvider | null): void {
  provider = p;
}

export const fieldStages = {
  /** True when a stage can be made. */
  get available(): boolean {
    return provider !== null;
  },
  /** A stage for this field, or null (no provider, or the provider could not make one). */
  async open(game: Game, field: FieldScene): Promise<FieldStage | null> {
    return provider ? provider.open(game, field) : null;
  },
  /** Start loading the stage's code ahead of the first field (no effect without a provider). */
  warm(): void {
    provider?.warm?.();
  },
};

/**
 * A provider that loads the real one with `load` on first use (the M3 fix-round rule, `battlekit/stageseam.ts` `lazyStageProvider`). `src/sje/boot.ts` registers it, with
 * `load` a dynamic `import()` of the stage's code. The load can fail (a network error, a stale deploy), and `open` of the real provider can throw. The field must not cost
 * the player that: the failure is a notice in the game's own bar and a null answer, so the field draws itself with the old renderer. It never rejects.
 */
export function lazyFieldStageProvider(load: () => Promise<FieldStageProvider>): FieldStageProvider {
  return {
    async open(game: Game, field: FieldScene): Promise<FieldStage | null> {
      try {
        return await (await load()).open(game, field);
      } catch (e) {
        console.warn(`[field stage] could not load, so the field draws itself: ${e instanceof Error ? e.message : String(e)}`);
        notice(FIELD_STAGE_FAILED_NOTICE, 'warn');
        return null;
      }
    },
    warm(): void {
      // A failed warm-up says nothing: the real attempt, on the first field, shows the notice if it still fails.
      load().catch(() => undefined);
    },
  };
}
