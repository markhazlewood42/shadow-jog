// Types for the path B tools (scripts/art/v2/pathb). Data is the parsed rook-pathb.json.
export type Expr = number | string;
export interface BoxSpec {
  part?: string;
  shape?: 'rect' | 'ell' | 'dome' | 'band';
  y?: Expr[];
  x?: Expr[];
  xe?: Expr[];
  from?: Expr[];
  to?: Expr[];
  t?: number;
  use?: string;
  mirror?: number;
}
export interface FacingData {
  yaw: number;
  mirrorName: string;
  headCenter: number;
  faceAxis: number;
  bodyCenter: number;
  face: boolean;
  itemSide: string;
  eyeOffset?: number[] | null;
  hidden: Record<string, number>;
  compare: string[][];
  boxes: BoxSpec[];
}
export interface PathBData {
  note: string;
  character: {
    id: string;
    rows: Record<string, number>;
    parts: string[];
    headParts: string[];
    torsoParts: string[];
    itemParts: string[];
    light: { vector: number[]; side: string };
    flatParts: string[];
    seams: string[][];
    folds: Record<string, { support: string; dir: number[]; len: number }[]>;
    [k: string]: unknown;
  };
  blocks: Record<string, BoxSpec[]>;
  facings: Record<string, FacingData>;
  checks: any;
}
export interface Sheet {
  facing: string;
  w: number;
  h: number;
  anchors: Record<string, number>;
  rows: Record<string, number>;
  labels: (string | null)[];
  parts: Record<string, number[]>;
  boxes: { part: string; shape: string; cells: number[][] }[];
  mirroredFrom?: string;
}
export interface CheckResult {
  name: string;
  ok: boolean;
  value: any;
  line: string;
  detail: any;
}
export interface Card {
  facing: string;
  yaw: number;
  headCenterCol: number;
  faceAxisCol: number;
  eyes: 'no face' | { rows: number[]; cells: number[][] };
  lightVector: number[];
  lightSide: string;
  guideRows: Record<string, number>;
  partLayout: { y: number; spans: { part: string; x0: number; x1: number; mainLight: string }[] }[];
  folds: { panel: string; start: number[]; dir: number[]; cells: number[][]; side: string }[];
  item: { side: string; cells: { part: string; cell: number[] }[] };
  outlineRule: string;
  mirrored: boolean;
}
export interface Shares {
  total: number;
  copy: number;
  transform: number;
  invent: number;
  share: { copy: number; transform: number; invent: number };
  perPart: Record<string, { copy: number; transform: number; invent: number }>;
  pieces: unknown[];
  cells: (string | null)[];
}
export interface FitReport {
  partMIoU: number;
  minPartIoU: number;
  perPart: Record<string, number | null>;
  silhouetteIoU: number;
  landmarkDist: Record<string, number | null>;
  maxLandmarkDist: number;
  landmarks: { sheet: Record<string, any>; given: Record<string, any> };
}
export interface Outputs {
  sheet: Sheet;
  light: Uint8Array;
  outline: Uint8Array;
  card: Card;
  checks: CheckResult[];
}
export interface All {
  facings: Record<string, Outputs>;
  mirrors: Record<string, Outputs>;
  setChecks: CheckResult[];
  shares: Record<string, Shares>;
  fit: FitReport;
}
type Img = { w: number; h: number; data: Uint8Array };

export const DATA_PATH: string;
export const SIZE: number;
export const FACINGS: string[];
export const MIRRORS: Record<string, string>;
export const LEVEL: { none: 0; shadow: 1; base: 2; lit: 3 };
export const OUTLINE: { none: 0; silhouette: 1; seam: 2 };
export function loadData(path?: string): PathBData;
export function resolve(expr: Expr, anchors: Record<string, number>): number;
export function expandBoxes(data: PathBData, list: BoxSpec[]): BoxSpec[];
export function boxCells(box: BoxSpec, anchors: Record<string, number>): number[][];
export function buildSheet(data: PathBData, facing: string): Sheet;
export function mirrorSheet(sheet: Sheet, facing: string, axis2?: number): Sheet;
export function toPartMap(sheet: Sheet): { w: number; h: number; parts: Record<string, number[]> };
export function cellOf(i: number): [number, number];
export function lightMap(data: PathBData, sheet: Sheet): Uint8Array;
export function outlineMap(data: PathBData, sheet: Sheet): Uint8Array;
export function measure(labels: (string | null)[], data: PathBData): { top: number; bottom: number; height: number; headAlone: number; shoulder: number; hip: number; areas: Record<string, number> };
export function guideRows(data: PathBData): Record<string, number>;
export function partLayout(sheet: Sheet): Card['partLayout'];
export function components(sheet: Sheet, part: string): number[][];
export function foldStrokes(data: PathBData, sheet: Sheet): { panel: string; part: string; start: number[]; dir: number[]; cells: number[][]; side: string }[];
export function buildCard(data: PathBData, sheet: Sheet): Card;
export function cardText(card: Card): string;
export function sharesByBox(data: PathBData, sheet: Sheet, sources: { name: string; labels: (string | null)[] }[]): Shares;
export function givenLabels(): (string | null)[];
export function silhouetteIoU(a: { labels: (string | null)[] }, b: { labels: (string | null)[] }): number;
export function landmarks(labels: (string | null)[], data: PathBData): Record<string, any>;
export function fitReport(data: PathBData, sheet: Sheet, given: (string | null)[]): FitReport;
export function checkHeight(data: PathBData, sheet: Sheet): CheckResult;
export function checkBottomRow(data: PathBData, sheet: Sheet): CheckResult;
export function checkHeadAlone(data: PathBData, sheet: Sheet): CheckResult;
export function checkGuideRows(data: PathBData, sheet: Sheet, given: (string | null)[]): CheckResult;
export function checkPartAreas(data: PathBData, sheet: Sheet, given: (string | null)[]): CheckResult;
export function checkConnected(data: PathBData, sheet: Sheet): CheckResult;
export function checkEyes(data: PathBData, sheet: Sheet): CheckResult;
export function checkFolds(data: PathBData, sheet: Sheet, card: Card): CheckResult;
export function checkLight(data: PathBData, sheet: Sheet, light?: Uint8Array): CheckResult;
export function checkOutline(data: PathBData, sheet: Sheet, outline?: Uint8Array): CheckResult;
export function checkMirrorAgree(data: PathBData, s: Sheet, se: Sheet): CheckResult;
export function checkDistinct(data: PathBData, sheets: Record<string, Sheet>): CheckResult;
export function templateChecks(data: PathBData, sheet: Sheet, given: (string | null)[], card: Card, light: Uint8Array, outline: Uint8Array): CheckResult[];
export function outputsOf(data: PathBData, sheet: Sheet, given: (string | null)[]): Outputs;
export function buildAll(data?: PathBData, given?: (string | null)[]): All;
export function digest(all: All): string;
export function partMapImage(data: PathBData, sheet: Sheet): Img;
export function lightMapImage(data: PathBData, sheet: Sheet, light?: Uint8Array): Img;
