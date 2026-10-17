// Types for the proxy tools. The shapes are loose on purpose (any): the spec, template and report objects are plain data described in the headers of the .mjs files.
import type { Img } from '../../pixkit/index.mjs';

export interface Template { w: number; h: number; facing: string; yaw: number; pose: Record<string, number[]>; joints: Record<string, { R: number[]; t: number[] }>; id: (string | null)[]; label: (string | null)[]; level: Int8Array; outline: Uint8Array; depth: Float64Array; point: (number[] | null)[]; normal: (number[] | null)[] }
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface PartMap { w: number; h: number; parts: Record<string, number[]> }
export interface ClassCell { cls: 'copy' | 'transform' | 'invent'; letter?: string; src?: { name: string; x: number; y: number }; why?: string }
export interface Classification { cells: (ClassCell | null)[]; counts: { copy: number; transform: number; invent: number }; why: Record<string, number>; total: number; share: number; copyShare: number; transformShare: number }
export interface LevelTEntry { x: number; y: number; kind: string; letter: string; part: string | null; detail: string }
export interface LevelTResult { conflicts: LevelTEntry[]; warnings: LevelTEntry[]; counts: Record<string, number> }
export interface TemplateData { format: string; facing: string; yaw: number; size: number; name: string; ids: string[]; idx: number[]; level: number[]; outline: number[]; ramps: Record<string, { shadow: string; base: string; lit: string; outline: string }>; labels: Record<string, string>; codes: Record<string, string>; locked: Record<string, string>; soft: Record<string, string>; hash: string }
export interface CheckLine { name: string; ok: boolean; value: unknown; expect: unknown; detail: string; gate: boolean }
export interface CheckResult { facing: string; ok: boolean; lines: CheckLine[]; info: Record<string, any> }
export type Spec = any;
export type { Img };

export const AREA_GROUPS: Record<string, string[]>;
export const AREA_TOLERANCE: number;
export const FACING_NAMES: string[];
export const FACING_YAW: Record<string, number>;
export const FIT_LINES: { mIoU: number; landmarkPx: number };
export const FORMAT: string;
export const GRID_HEADER: string;
export class GridError extends Error { problems?: string[] }
export const HEAD_ALONE_ROWS: number;
export const LEVELS: any;
export const LEVEL_GRAY: any;
export const N: number;
export const PART_COLORS: any;
export const PRIM_TYPES: any;
export const SAMPLE_LEVELS: any;
export const SIZE: number;
export class SpecError extends Error { problems?: string[] }
export const TEMPLATE_FORMAT: string;
export class TemplateMismatch extends Error { problems?: string[] }
export function approvedSource(...args: any[]): any;
export function axisSumOf(...args: any[]): any;
export function buildCard(...args: any[]): any;
export function buildKit(...args: any[]): any;
export function buildSolids(...args: any[]): any;
export function cameraBasis(...args: any[]): any;
export function cellOf(...args: any[]): any;
export function classImage(...args: any[]): any;
export function classesText(...args: any[]): any;
export function classifyCells(...args: any[]): any;
export function cutSamples(...args: any[]): any;
export function emptyCells32(...args: any[]): any;
export function faceAxis(...args: any[]): any;
export function facingName(...args: any[]): any;
export function facingYaw(...args: any[]): any;
export function fitLight(...args: any[]): any;
export function fitObjective(...args: any[]): any;
export function fitReport(...args: any[]): any;
export function flatCells(...args: any[]): any;
export function foldStrokes(...args: any[]): any;
export function formatChecks(...args: any[]): any;
export function formatFitReport(...args: any[]): any;
export function formatGrid32(...args: any[]): any;
export function formatLevelT(...args: any[]): any;
export function formatShares(...args: any[]): any;
export function givenLabels(...args: any[]): any;
export function givenLevels(...args: any[]): any;
export function givenSource(...args: any[]): any;
export function gridToImage32(...args: any[]): any;
export function groupOfLetter(...args: any[]): any;
export function guardPenalty(...args: any[]): any;
export function guideRows(...args: any[]): any;
export function idsOfLabel(...args: any[]): any;
export function imageToFlat32(...args: any[]): any;
export function isOpaqueAt(...args: any[]): any;
export function jointTransforms(...args: any[]): any;
export function labelAgreement(...args: any[]): any;
export function labelMeasures(...args: any[]): any;
export function landmarkDistances(...args: any[]): any;
export function levelOfLetter(...args: any[]): any;
export function levelT(...args: any[]): any;
export function levelTSheet(...args: any[]): any;
export function levelTViews(...args: any[]): any;
export function lightAgreement(...args: any[]): any;
export function lightPanel(...args: any[]): any;
export function lightWords(...args: any[]): any;
export function lineCells(...args: any[]): any;
export function loadSpec(...args: any[]): any;
export function maskedCell(...args: any[]): any;
export function mirrorCells(...args: any[]): any;
export function opaqueCount(...args: any[]): any;
export function optimizeSpec(...args: any[]): any;
export function parseGrid32(...args: any[]): any;
export function partIds(...args: any[]): any;
export function partIoU(...args: any[]): any;
export function partPanel(...args: any[]): any;
export function partPoint(...args: any[]): any;
export function previewImage(...args: any[]): any;
export function project(...args: any[]): any;
export function rampLetters(...args: any[]): any;
export function rebuildFacing(...args: any[]): any;
export function renderTemplate(...args: any[]): any;
export function resolveSpec(...args: any[]): any;
export function rowRuns(...args: any[]): any;
export function sampleSheet(...args: any[]): any;
export function samplesText(...args: any[]): any;
export function specProblems(...args: any[]): any;
export function stringifySpec(...args: any[]): any;
export function stylePose(...args: any[]): any;
export function suggestRamps(...args: any[]): any;
export function templateChecks(...args: any[]): any;
export function sideLandmarkLines(...args: any[]): any;
export function reducedRowCounts(...args: any[]): any;
export function structureOf(...args: any[]): any;
export function templateData(...args: any[]): any;
export function templateHash(...args: any[]): any;
export function templateKitImage(...args: any[]): any;
export function templateText(...args: any[]): any;
export function tunablePaths(...args: any[]): any;
export function validateSpec(...args: any[]): any;
export function writePreview(...args: any[]): any;
export function writeRebuild(...args: any[]): any;
export function writeSamples(...args: any[]): any;
export function yawOf(...args: any[]): any;
export * from './pathc-types.mjs';
