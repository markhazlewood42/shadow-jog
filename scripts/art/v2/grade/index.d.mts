import type { Img } from '../../pixkit/index.mjs';

export type Labels = (string | null)[];
export interface Box { x0: number; y0: number; x1: number; y1: number; w?: number; h?: number }
export interface Target { img: Img; labels: Labels | null; landmarks?: Record<string, number[]> }
export type Lab = [number, number, number];

// color.mjs
export function rgbToLab(r: number, g: number, b: number): Lab;
export function deltaE00(a: Lab, b: Lab): number;
export function deltaE76(a: Lab, b: Lab): number;
export function lumaOf(r: number, g: number, b: number): number;
export function labOfPacked(p: number): Lab;
export function pack(r: number, g: number, b: number): number;
export function de00Packed(p: number, q: number): number;

// image.mjs
export const N: number;
export const NEAR_BLACK_LUMA: number;
export function opaqueAt(img: Img, x: number, y: number): boolean;
export function packedAt(img: Img, x: number, y: number): number;
export function lumaAt(img: Img, x: number, y: number): number;
export function hexAt(img: Img, x: number, y: number): string;
export function setPixel(img: Img, x: number, y: number, packed: number): void;
export function clearPixel(img: Img, x: number, y: number): void;
export function cloneImg(img: Img): Img;
export function bboxOf(img: Img): Box | null;
export function edgeMask(img: Img): Uint8Array;
export function interiorMask(img: Img): Uint8Array;
export function opaqueMask(img: Img): Uint8Array;
export function countOpaque(img: Img): number;
export function colorCounts(img: Img): Map<number, number>;
export function nearestPacked(p: number, palette: number[]): number;
export function packedList(hexes: string[]): number[];
export function quantizeTo(img: Img, paletteHex: string[]): Img;
export function recolorOutline(img: Img, nearBlackHex: string[]): { img: Img; changed: number };
export function flipH(img: Img): Img;
export function flipLabels(labels: Labels, w: number, h: number): Labels;
export function shiftImg(img: Img, dx: number, dy: number): Img;
export function placeScaled(
  src: Img,
  labels: Labels | null,
  opts: { s: number; dx?: number; dy?: number; anchor?: 'bbox' | 'none'; target?: Box | null; size?: number },
): { img: Img; labels: Labels | null; box: Box | null };
export function toCanvas(img: Img, size?: number): Img;

// align.mjs
export const SCALES: number[];
export const SHIFT: number;
export const BF_TOL: number;
export function boundaryF(edgeA: Uint8Array, edgeB: Uint8Array, w: number, h: number, tol?: number): { f: number; p: number; r: number; nA: number; nB: number };
export function align(
  cand: Img,
  ref: { img: Img; labels: Labels | null },
  opts?: { anchor?: 'bbox' | 'none'; scales?: number[]; shift?: number },
): { s: number; dx: number; dy: number; bf1: number; ref: { img: Img; labels: Labels | null; box: Box | null } };
export function unionMask(a: Img, b: Img): Uint8Array;

// parts.mjs
export const PART_CODES: Record<string, string>;
export const PART_OF_CODE: Record<string, string>;
export const PARTS_TINT: Record<string, number[]>;
export const GROUPS: Record<string, string[]>;
export const GROUP_NAMES: string[];
export const GROUP_OF_PART: Record<string, string>;
export const HEAD_ROWS: number;
export const HEAD_POINTS: string[];
export function labelRows(labels: Labels, w: number, h: number): string[];
export function rowsToLabels(rows: string[]): Labels;
export function labelsFromPartMap(pm: { w: number; h: number; parts: Record<string, number[]> }): Labels;
export function toGroups(labels: Labels): (string | null)[];
export function colorClass(r: number, g: number, b: number): 'nb' | 'gray' | 'olive' | 'skin' | 'gold' | 'warm';
export function autoLabel(img: Img): Labels;
export function landmarksOf(labels: Labels, w: number, h: number): Record<string, number[]>;

// measures.mjs
export const TAU: number;
export const TEXTURE_STEP: number;
export const MIN_PART_CELLS: number;
export function chamfer(edgeA: Uint8Array, edgeB: Uint8Array, w: number): { mean: number; p95: number };
export function partIou(candGroups: (string | null)[], refGroups: (string | null)[]): { mean: number; min: number; per: Record<string, { iou: number; cand: number; ref: number }> };
export function valueGrid(img: Img, block?: number): (number | null)[];
export function valueStructure(a: Img, b: Img): { r: number; agree3: number; blocks: number };
export function neighborhoodShare(a: Img, b: Img, tau?: number): number;
export function colorMatch(cand: Img, ref: Img, tau?: number): { mean: number; candToRef: number; refToCand: number };
export function signature(img: Img, k?: number): { lab: Lab; w: number }[];
export function emd(a: { lab: Lab; w: number }[], b: { lab: Lab; w: number }[]): number;
export const EMD_WORST: number;
export function paletteEmd(a: Img, b: Img, k?: number): number;
export function pck(
  candLm: Record<string, number[]>,
  refLm: Record<string, number[]>,
  height: number,
  opts?: { alpha?: number; headAlpha?: number },
): { pck: number; pckHead: number; missing: string[]; dist: Record<string, number>; points: number };
export function textureDensity(img: Img, groups: (string | null)[], step?: number): Record<string, { cells: number; density: number }>;
export function textureDiff(
  dc: Record<string, { cells: number; density: number }>,
  dr: Record<string, { cells: number; density: number }>,
): { max: number; mean: number; per: Record<string, { cand: number; ref: number; diff: number }> };
export function maskGroups(img: Img, labels: Labels, keep: string[]): { img: Img; labels: Labels };
export interface Measures {
  bf1: number;
  partMiou: number;
  partMin: number;
  chamferMean: number;
  chamferP95: number;
  valueR: number;
  colorMatch: number;
  paletteEmd: number;
  pck: number;
  pckHead: number;
  textureMax: number;
}
export interface MeasureResult {
  transform: { s: number; dx: number; dy: number };
  measures: Measures;
  detail: { part: Record<string, { iou: number; cand: number; ref: number }>; pckMissing: string[]; pckDist: Record<string, number>; [k: string]: unknown };
}
export function measureAgainst(cand: Img, target: Target, opts?: { candLabels?: Labels | null; anchor?: 'bbox' | 'none'; tau?: number; groupsOnly?: string[] | null }): MeasureResult;

// hardlines.mjs
export interface LineItem { id: string; name: string; status: 'pass' | 'fail' | 'info' | 'skipped'; value: string; detail: string }
export interface TargetData { given: { orphans: number; smallRegions: number; bboxWidth: number; headWidth: number; [k: string]: unknown }; [k: string]: unknown }
export interface Spec { target: TargetData; given: Img; givenLabels: Labels; palette: string[]; nearBlack: string[] }
export interface FaceSkinRule { min?: number; max?: number; edgeCols?: number }
export interface HardLinesData {
  [k: string]: unknown;
  height: { given: number; tol: number };
  bottomRow: number;
  headAlone: { min: number; max: number };
  shoulderTol: number;
  hipTol: number;
  countFactor: number;
  flatteningFloor: number;
  distinctN: number | null;
  useReset: boolean;
  faceSkin: Record<string, FaceSkinRule | number[]>;
}
export interface StyleLineData { limit?: number; lo?: number; hi?: number; role: 'gate' | 'report'; basis: 'separates' | 'go-hard-line' | null; separates: boolean; pinned: boolean }
export interface StyleGates {
  note: string;
  calibratedOn: string;
  minGating: number;
  flatMinCells: number;
  bandPad: number;
  markGatesByEye: boolean;
  separating: string[];
  bands: Record<string, { lo: number; hi: number; frames: number }>;
  lines: Record<string, StyleLineData>;
}
export interface SwapLineData { need: number; rule: string; note: string; ownFacingNotes: Record<string, string>; recorded: { status: 'MET' | 'FAILED'; swaps: number; caught: number; rate: number; missed: string[] } }
export interface Gates {
  [k: string]: unknown;
  calibratedOn: string | null;
  targetMeasures: Record<string, { name: string; dir: 'min' | 'max'; start: number; calibrated: number | null; role: 'gate' | 'report' | null; separates?: boolean }>;
  hardLines: HardLinesData;
  passMeasures: number;
  noReference: { bf1Template: number };
  style: StyleGates;
  swapLine: SwapLineData;
}
export const GATES_PATH: string;
export function loadGates(): Gates;
export function loadSpec(): Spec;
export function hasFail(items: LineItem[]): boolean;
export function cellDiff(a: Img, b: Img, tau?: number): number;
export function headAlone(labels: Labels, w: number, b: Box): number;
export function torsoRows(labels: Labels, w: number, h: number): { shoulder: number; hip: number };
export function faceSkin(img: Img, b: Box, rows: number[]): { count: number; cells: number[][] };
export function rampLock(img: Img, templateLabels: Labels): [number, number, string | null][];
export function checkHardLines(
  img: Img,
  opts?: {
    facing?: string;
    spec?: Spec;
    gates?: Gates;
    labels?: Labels | null;
    template?: boolean;
    set?: { name: string; img: Img }[];
    name?: string;
    sheathSide?: string | null;
    exempt?: string[];
  },
): { pass: boolean; items: LineItem[]; labelSource: string; metrics: Record<string, { value: number; dir: 'min' | 'max'; limit: number | null }> };

// kitscan.mjs
export const PATCH: number;
export const MATCH_SHARE: number;
export const MIN_OPAQUE: number;
export const MIN_COLORS: number;
export const COLOR_TOL: number;
export type Transform = { kind: 'identity' } | { kind: 'mirror'; axis?: number } | { kind: 'shift'; dx: number; dy: number } | ((img: Img) => Img);
export const S3_TRANSFORMS: Transform[];
export function applyTransform(img: Img, t: Transform): Img;
export function downscale(img: Img): Img | null;
export function textGrids(text: string): Img[];
export function kitImages(file: string): { name: string; img: Img; scaled: boolean }[] | null;
export function patchSimilarity(a: Img, ax: number, ay: number, b: Img, bx: number, by: number, tol?: number): number;
export interface ScanRef { name: string; img: Img; mirrored: boolean; quantized?: boolean }
export function loadScanReferences(walkPalette?: string[]): ScanRef[];
export interface ScanFinding { file: string; at?: number[]; ref?: string; refAt?: number[]; mirrored?: boolean; quantized?: boolean; similarity?: number; kind?: string }
export function scanImages(
  images: { name: string; img: Img }[],
  opts?: { refs?: ScanRef[]; given?: Img; transforms?: Transform[]; share?: number; minOpaque?: number },
): ScanFinding[];
export function scanKit(kitDir: string, opts?: { refs?: ScanRef[]; given?: Img; transforms?: Transform[] }): { ok: boolean; files: number; findings: ScanFinding[] };
export function boxScan(kitDir: string, opts?: { boxNames?: string[]; img?: Img }): Promise<{ ok: boolean; results: { box: string; ok: boolean; findings: unknown[] }[] }>;

// calibrate.mjs
export const ROUND8_DIR: string;
export interface CalItem {
  id: string;
  group: 'pass-near' | 'pass-real' | 'fail-near' | 'fail-far' | 'info';
  target: string;
  facing: string;
  cand: Img;
  labels: Labels | null;
  labelSource: string;
  groupsOnly: string[] | null;
  hardLines: boolean;
  note: string;
  exempt: string[];
}
export interface SeparationRow {
  key: string;
  name: string;
  dir: 'min' | 'max';
  start: number;
  passWorst: { id: string; v: number };
  failBest: { id: string; v: number };
  separates: boolean;
  separatesNearOnly: boolean;
  pairAccuracy: number;
  gate: number | null;
  margin: number;
}
export interface Calibration {
  rows: (CalItem & MeasureResult)[];
  table: SeparationRow[];
  gating: string[];
  markGates: boolean;
  hardLines: { line: string; id: string; failsShouldPass: string[]; catchesShouldFail: number; shouldFailTotal: number }[];
  lineRows: { id: string; group: string; pass: boolean; failed: string[]; items: LineItem[]; metrics: Record<string, { value: number; dir: 'min' | 'max'; limit: number | null }> }[];
  distinct: { n: number; min: { a: string; b: string; cells: number }; note: string };
  items: CalItem[];
  metricRows: { name: string; dir: 'min' | 'max'; limit: number; passBreaking: number; passTotal: number; proposed: number | null }[];
}
export function makeTarget(ref: { img: Img; labels: Labels; landmarks?: Record<string, number[]> }, nearBlack: string[]): Target;
export function candidateFromRef(ref: { img: Img; labels: Labels }, spec: Spec, opts?: { h?: number; dx?: number; dy?: number }): { img: Img; labels: Labels | null };
export function recolorStep(img: Img, ramps: Record<string, string[]>, seedText: string, share?: number): Img;
export function blobImage(spec: Spec): Img;
export function rigFacing(facing: string): Img;
export function buildCalibrationItems(opts?: { spec?: Spec; t1Dir?: string | null; round8Dir?: string }): CalItem[];
export function targetsFor(spec: Spec): Record<string, Target>;
export function distinctCalibration(spec?: Spec): { n: number; min: { a: string; b: string; cells: number }; note: string };
export function runCalibration(opts?: { spec?: Spec; gates?: Gates; t1Dir?: string | null; autoLabels?: boolean; walkScope?: 'all' | 'head-torso'; log?: (s: string) => void }): Calibration;
export function formatReport(res: Calibration, gates: Gates, opts?: { date?: string; auto?: Calibration | null; walkHT?: Calibration | null; autoHT?: Calibration | null }): string;
export function writeGates(res: Calibration, gates: Gates, opts?: { date?: string; path?: string }): Gates;

// grade.mjs
export function loadCandidate(path: string): Img;
export function loadParts(path: string): Labels;
export function gateMeasures(measures: Measures, gates: Gates): { rows: { key: string; name: string; dir: string; value: number; gate: number; role: string; calibrated: boolean; pass: boolean }[]; gating: string[]; pass: boolean; passCount: number; gatingCount: number; composite: number };
export function noReferencePck(candLabels: Labels, alpha?: number): { pck: number; dist: Record<string, number> };
export interface StyleRow {
  id: string;
  name: string;
  rule: string;
  value: number | null;
  detail: string;
  dir: 'min' | 'max' | 'band';
  limit: number | number[];
  role: 'gate' | 'report';
  separates: boolean;
  pinned: boolean;
  basis: 'separates' | 'go-hard-line' | null;
  status: 'pass' | 'fail' | 'not measured';
}
export interface StyleTier { rows: StyleRow[]; extra: LineItem[]; gating: string[]; separating: string[]; minGating: number; markGatesByEye: boolean; notMeasured: string[]; pass: boolean; labelSource: string }
export interface StructureTier { items: LineItem[]; report: LineItem[]; unchecked: { id: string; what: string }[]; pass: boolean }
export interface Verdict {
  facing: string;
  labelSource: string;
  notes: string[];
  style: StyleTier;
  structure: StructureTier;
  reference: {
    mode: 'reference' | 'none';
    note: string;
    transform?: { s: number; dx: number; dy: number };
    measures?: Measures;
    rows?: { key: string; name: string; dir: string; value: number; gate: number; role: string; calibrated: boolean; pass: boolean }[];
    composite?: number;
    naive?: { partMiou: number; colorMatch: number; valueR: number };
    gain?: { partMiou: number; colorMatch: number; valueR: number };
    parts?: Record<string, { iou: number; cand: number; ref: number }>;
    pckMissing?: string[];
    pckVsSAndNe?: number;
    pckDist?: Record<string, number>;
    anchors: { name: string; composite: number; beaten: boolean }[];
  };
  pass: boolean;
  styleByEye: boolean;
}
export function styleTier(img: Img, opts: { spec: Spec; gates: Gates; labels?: Labels | null; template?: boolean; hardItems?: LineItem[]; rampLabels?: Labels | null }): StyleTier;
export const STRUCTURE_HARD_IDS: string[];
export function structureTier(cand: Img, opts: { facing: string; spec: Spec; hard: { items: LineItem[] }; labels?: Labels | null; template?: Img | null; gates: Gates; checks?: FacingChecks; idle?: IdleGuide | null }): StructureTier;
export function grade(
  cand: Img,
  opts: { facing: string; spec?: Spec; gates?: Gates; labels?: Labels | null; rampLabels?: Labels | null; set?: { name: string; img: Img }[]; anchors?: { name: string; img: Img; labels?: Labels | null }[]; template?: Img | null; sheathSide?: string | null; name?: string; checks?: FacingChecks; idle?: IdleGuide | null },
): Verdict;
export function formatVerdict(v: Verdict): string;

// refs/labels.mjs
export const REF_FACINGS: string[];
export const refImagePath: (facing: string) => string;
export const labelsPath: (facing: string) => string;
export const editsPath: string;
export function applyEdits(labels: Labels, w: number, h: number, edits: { box?: number[]; cells?: number[][]; part: string; from?: string[] }[], img?: Img | null): Labels;
export function loadRefLabels(facing: string): { facing: string; rows: string[]; autoRows: string[]; edits: { box?: number[]; cells?: number[][]; part: string; from?: string[] }[]; landmarks: Record<string, number[]>; method: string[]; labels: Labels; w: number; h: number };
export function loadReference(facing: string): { img: Img; labels: Labels; landmarks: Record<string, number[]>; file: Record<string, unknown> };
export function hasRefLabels(facing: string): boolean;

// flat.mjs
export function maskDensity(img: Img, inMask: (x: number, y: number) => boolean, step?: number): { cells: number; density: number };
export function wholeDensity(img: Img): { cells: number; density: number };
export function groupDensity(img: Img, labels: Labels): Record<string, { cells: number; density: number }>;
export function givenLabelsFor(spec: Spec, labelSource: string): Labels;
export function givenDensity(spec: Spec, labelSource: string): { groups: Record<string, { cells: number; density: number }>; whole: { cells: number; density: number } };
export function flattening(
  img: Img,
  labels: Labels,
  spec: Spec,
  labelSource: string,
  minCells: number,
): { groups: Record<string, { cand: number; given: number; ratio: number }>; lowest: number | null; whole: number | null; wholeCand: number; wholeGiven: number; densities: Record<string, { cells: number; density: number }> };

// style.mjs
export const STYLE_LINE_IDS: string[];
export interface LineMeta { name: string; dir: 'min' | 'max' | 'band'; start?: number | null; pinned: boolean; needsLabels?: boolean; rule: string }
export const LINE_META: Record<string, LineMeta>;
export function linePasses(meta: LineMeta, line: { limit?: number; lo?: number; hi?: number }, v: number | null | undefined): boolean;
export function squintClusters(img: Img): number;
export function bandingPairs(img: Img, minLen?: number): number;
export function styleValues(
  img: Img,
  opts: { spec: Spec; labels?: Labels | null; template?: boolean; flatMinCells?: number; bands?: Record<string, { lo: number; hi: number }> | null; rampLabels?: Labels | null },
): { values: Record<string, number | null>; detail: Record<string, string>; labelSource: string; groupDensity: Record<string, { cells: number; density: number }> };

// swaprate.mjs
export const SWAP_FACINGS: string[];
export const FACING_CLASSES: Record<string, string[]>;
export interface SwapRates {
  swaps: number;
  caught: number;
  rate: number | null;
  cross: { swaps: number; caught: number; rate: number | null };
  within: { swaps: number; caught: number; rate: number | null };
  missed: string[];
  own: { facing: string; pass: boolean; failed: string[] }[];
  line: number;
  met: boolean;
}
export function swapRates(opts?: { spec?: Spec; gates?: Gates; checks?: FacingChecks }): SwapRates;
export function formatSwapReport(res: SwapRates, opts?: { date?: string }): string;

// style-calibrate.mjs
export function flattenParts(img: Img, labels: Labels, palette: string[]): Img;
export function speckle(img: Img, palette: string[], opts?: { share?: number; seed?: number }): Img;
export interface StyleItem { id: string; group: 'pass' | 'fail'; kind: string; cand: Img; labels: Labels | null; rampLabels: Labels | 'auto' | null }
export function buildStyleItems(spec?: Spec, opts?: { round8Dir?: string }): StyleItem[];
export function densityBands(walkDens: Record<string, { cells: number; density: number }>[], minCells: number, pad: number): Record<string, { lo: number; hi: number; frames: number }>;
export interface StyleCalibration {
  rows: (StyleItem & { values: Record<string, number | null> })[];
  table: { id: string; name: string; dir: string; role: string; basis: string | null; separates: boolean; pinned: boolean; caught: string[]; passedFail: string[]; failTotal: number; worstPass: unknown; bestFail: unknown; limit?: number; lo?: number; hi?: number; reset: { from: number; to: number } | null; rule: string }[];
  lines: Record<string, StyleLineData>;
  bands: Record<string, { lo: number; hi: number; frames: number }>;
  floor: number;
  floorReset: { from: number; to: number } | null;
  separating: string[];
  gating: string[];
  caughtBy: Record<string, string[]>;
  uncaught: string[];
  markGatesByEye: boolean;
  pad: number;
}
export function runStyleCalibration(opts?: { spec?: Spec; minCells?: number | null; pad?: number; log?: (s: string) => void }): StyleCalibration;
export function formatStyleReport(res: StyleCalibration, opts?: { date?: string }): string;
export function writeStyleGates(res: StyleCalibration, gates: Gates, opts?: { date?: string; path?: string }): Gates;

// structure.mjs
export const FACING_CHECKS_PATH: string;
export interface EyeRule { clustersMin: number; clustersMax: number; widthMax?: number; rowSpreadMax?: number; rule: string }
export interface FacingChecks {
  note: string;
  rowTol: { value: number; rule: string };
  guideRows: { eyeFacings: string[]; rule: string };
  eyes: Record<string, EyeRule>;
  hands: { minCells: number; maxCells: number; maxBasis: string; reportCells: number; maxNote: string; farHandMin: { facings: string[]; value: number; rule: string }; count: Record<string, { min: number; max: number }>; rule: string };
  item: { edgeNearBlackMin: number; minEdgeCells: number; reset: { from: number; to: number; basis: string }; rule: string };
  litSide: { facings: string[]; groups: string[]; reportGroups: string[]; minAbsAtSe: number; legsEvidence: string; rule: string };
  sideGuide: { facings: string[]; rowTol: { value: number; rule: string }; note: string };
  uncheckedRules: { id: string; what: string }[];
  uncheckedNote: string;
}
export interface IdleRange { min: number; max: number; n: number }
export interface IdleGuide { headTop: IdleRange | null; skin: IdleRange | null; split: IdleRange | null; foot: IdleRange | null; frames: number }
export function loadFacingChecks(): FacingChecks;
export type Cell = [number, number];
export function clustersOf(cells: Cell[], conn?: 4 | 8): Cell[][];
export function eyeCells(img: Img, labels: Labels): Cell[];
export function maxRun(cells: Cell[]): number;
export function eyeSummary(img: Img, labels: Labels): { cells: number; clusters: number; widthMax: number; rowSpread: number; meanRow: number | null };
export function guideRows(img: Img, labels: Labels): { headTop: number | null; eye: number | null; shoulder: number | null; hip: number | null; foot: number | null };
export function handClusters(img: Img, labels: Labels): { size: number; width: number; x: number }[];
export function itemEdge(img: Img, labels: Labels): { cells: number; edge: number; dark: number; share: number | null };
export function litMinusShadow(img: Img, labels: Labels, group: string): number | null;
export function sideGuide(img: Img): { headTop: number; skin: number | null; split: number | null; foot: number; h: number } | null;
export function idleSideGuide(given: { top: number; bottom: number }): IdleGuide | null;
export function handBound(frames: Img[]): { max: number; bound: number };
export function structureLines(img: Img, opts: { facing: string; spec: Spec; labels?: Labels | null; checks?: FacingChecks; idle?: IdleGuide | null }): LineItem[];

// facingid.mjs
export const FACINGS: { id: string; name: string }[];
export const FACING_IDS: string[];
export const PASS_NEED: number;
export const SCALE: number;
export function facingIdPicture(given: Img, cand: Img, opts?: { scale?: number; gap?: number }): Img;
export function promptText(items: { id: string; file: string; letters: Record<string, string> }[]): string;
export interface FacingIdKey { note: string; passNeed: number; seed: number; items: Record<string, { facing: string; correct: string; letters: Record<string, string>; source: string | null }> }
export function foldersOverlap(a: string, b: string): boolean;
export function buildCalibrationTask(opts: { out: string; key: string; given?: Img; seed?: number }): { items: { id: string; file: string; letters: Record<string, string> }[]; key: FacingIdKey };
export function buildFacingIdTask(items: { cand: Img; facing: string; source?: string }[], opts: { out: string; key: string; given?: Img; seed?: number; passNeed?: number }): { items: { id: string; file: string; letters: Record<string, string> }[]; key: FacingIdKey };
export function calibrationItems(spec?: Spec): { cand: Img; facing: string; source: string }[];
export function scoreFacingId(answers: Record<string, string>, key: FacingIdKey, opts?: { need?: number | null }): { correct: number; total: number; need: number; pass: boolean; items: { id: string; answer: string | null; facing: string; picked: string | null; ok: boolean }[] };

// templatecheck.mjs
export const AXIS_SUM: number;
export const PATHB_REF: string;
export const PATHB_FILES: string[];
export function mirrorAxis(labels: Labels, axisSum?: number): Labels;
export function proxyTemplateLabels(path: string): Labels;
export function pathBLabels(opts?: { ref?: string; scratch: string; cwd?: string }): Promise<Record<string, Labels>>;
export function alignedPartMiou(candLabels: Labels, ref: { img: Img; labels: Labels }): { aligned: number; best: number; shiftOnly: number; shift0: number | null; transform: { s: number; dx: number; dy: number }; bestTransform: { s: number; dx: number; dy: number } | null; bf1: number };
export function templateTable(sources: Record<string, Record<string, Labels>>): { rows: { source: string; facing: string; aligned: number; best: number; shiftOnly: number; shift0: number | null; bestTransform: { s: number; dx: number; dy: number } | null }[] };
export function defaultSources(opts: { proxyDir: string; pathbRef?: string; scratch: string; spec?: Spec }): Promise<Record<string, unknown>>;
export function formatTemplateReport(sources: Record<string, unknown>, table: ReturnType<typeof templateTable>, opts?: { date?: string; proxyDir?: string; pathbRef?: string }): string;
