import type { Img } from '../../pixkit/index.mjs';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export type NamedRect = Rect & { name: string };
export interface BoxOverlay {
  box: Rect;
  fill: boolean;
  color: number[];
}
export class GridError extends Error {}
export const AXIS: number;
export const FRAME: number;
export const MASK_RGB: number[];
export const CHECK_BOX: number[][];
export const OUTLINE_BOX: number[];
export const OUTLINE_MIRROR_HOME: number[];
export const FAMILY_LIST: string[];
export function boxW(b: Rect): number;
export function boxH(b: Rect): number;
export function mirrorBox<T extends Rect>(b: T): T;
export function boxHeader(b: Rect): string;
export function emptyBoxCells(b: Rect): string[][];
export function formatBoxGrid(cells: string[][], b: Rect): string;
export function parseBoxGrid(text: string, b: Rect): string[][];
export function boxGridToImage(cells: string[][], b: Rect): Img;
export function composite(blank: Img, boxImg: Img, b: Rect): Img;
export function mirrorImage(img: Img): Img;
export function gridOverlay(boxes: BoxOverlay[], originX?: number, originY?: number): (out: Img, ml: number, mt: number, k: number) => void;
export function frameScaled(img: Img, boxes: BoxOverlay[], k: number): Img;
export function frame32(img: Img, boxes: BoxOverlay[], family?: string | null): Img;
export function box32(boxImg: Img, b: Rect): Img;
