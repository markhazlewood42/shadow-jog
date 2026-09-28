/** Shared bake context used by structure and prop painters. */
import type { Ctx } from '../engine/canvas';

export interface BakedLight {
  x: number;
  y: number;
  r: number;
  color: string;
  i: number;
  flicker?: boolean | undefined;
  /** Seed for flicker phase. */
  seed?: number | undefined;
}

export interface SortedSprite {
  canvas: HTMLCanvasElement;
  emit?: HTMLCanvasElement | undefined;
  x: number;
  y: number;
  /** Y used for depth sorting (px). */
  baseY: number;
  /** Optional per-frame animation hook (draws extra emissive on top). */
  anim?: ((ctx: Ctx, frame: number, sx: number, sy: number) => void) | undefined;
}

export interface AnimFx {
  /** Pixel rect for culling. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Draw in screen space (ox, oy = camera offset) — called after lighting (emissive). */
  draw: (ctx: Ctx, frame: number, ox: number, oy: number) => void;
  /** Draw before lighting (albedo, gets lit). */
  lit?: boolean | undefined;
}

export interface BakeCtx {
  g: Ctx;
  e: Ctx;
  o: Ctx;
  oe: Ctx;
  lights: BakedLight[];
  sprites: SortedSprite[];
  anims: AnimFx[];
  w: number;
  h: number;
  block(tx: number, ty: number): void;
  unblock(tx: number, ty: number): void;
  /** Draw to albedo and emissive layers at once. */
  both(fn: (c: Ctx) => void): void;
  bothOver(fn: (c: Ctx) => void): void;
}
