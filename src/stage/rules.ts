/**
 * The battle stage design's rules, in ONE place (Phaser spike `spike/phaser-stage`).
 *
 * The side-battle design (`docs/spikes/side-battle-stage.md`) came with a list of acceptance checks: the horizon sits
 * at 92 to 112, depth rows are 14 to 24 px apart, a gap of at least 55 px between the heroes and the enemies, nothing
 * reaching up into the top HUD band... This file is that list as pure functions, plain words in, plain words out.
 *
 * Two readers use it, so they cannot drift apart:
 *   - the stage lab's test (`e2e/stagelab-stage.spec.ts`) runs every rule on every enemy count of both stages;
 *   - the Battle Stage Editor runs the same rules LIVE while you work and shows each broken one as a warning
 *     (a red outline on the fighter, the "Warnings" chip, a line in the status bar). A warning never blocks saving:
 *     the rules are the design's advice, and Mark is the designer.
 *
 * "Layout" rules look at the stage alone (horizon, rows, HUD size). "Figure" rules need the real size of the sprites
 * on the stage, so the page measures them (`StageScene.figureBoxesFor`) and passes the boxes in. Every function
 * returns what broke and WHO broke it (`culprits`, so the editor can outline them); an empty list means it passes.
 */
import { ART_KERB_ROW, type FigureBox, SCREEN_H, SCREEN_W, type StageConfig } from './config';

/** The design's numbers, named so a rule and its message always agree. */
export const RULE_LIMITS = {
  /** The least gap, in px, between the heroes' right-most edge and the enemies' left-most edge. */
  gap: 55,
  /** The nearest enemy's left edge may be no further left than this x. */
  nearest: 260,
  /** An enemy's right edge must stay this many px inside the screen's right edge. */
  edgeMargin: 4,
  /** The horizon's allowed range. */
  horizon: [92, 112] as const,
  /** The allowed distance between neighbouring depth rows. */
  rowGap: [14, 24] as const,
  /** The share of the screen that must show floor between the HUD bands. */
  floorShare: 0.45,
} as const;

export type RuleId = 'horizon' | 'kerb' | 'rowGaps' | 'hudShare' | 'bottomBand' | 'frontShadow' | 'floorShare' | 'gap' | 'nearest' | 'edge' | 'topBand';

/** One fighter that breaks a rule: its side and its place in that side's list (the numbering the editor uses: P1.., E1..). */
export interface Culprit {
  side: 'party' | 'enemy';
  index: number;
}

/** A rule that is broken right now. */
export interface RuleBreak {
  rule: RuleId;
  /** Plain words: what is wrong and what the design needs. */
  text: string;
  /** The fighters to outline in red (none for a rule about the stage itself). */
  culprits: Culprit[];
}

/** A broken rule with where it applies: one enemy count of the stage (`setKey`), or the whole stage (null). */
export interface StageWarning extends RuleBreak {
  stageId: string;
  setKey: string | null;
}

/**
 * How far right a hero's drawn edge may reach so the "gap" rule still holds, when the nearest enemy's drawn left edge is at
 * `nearestEnemyLeft`: the gap is `nearest enemy left edge - farthest hero right edge`, and it must be `RULE_LIMITS.gap` or more.
 * (The editor's Align uses this so it never lands a hero where the stage would then warn.)
 */
export function heroRightLimit(nearestEnemyLeft: number): number {
  return nearestEnemyLeft - RULE_LIMITS.gap;
}

/** The same rule seen from the enemies: the least x their drawn left edge may have when the farthest hero's drawn right edge is at `furthestHeroRight`. */
export function enemyLeftLimit(furthestHeroRight: number): number {
  return furthestHeroRight + RULE_LIMITS.gap;
}

/** Why each rule exists, for the chip's tooltip and the notes: what the player would notice if it were ignored. */
export const RULE_WHY: Record<RuleId, string> = {
  horizon: 'The wall and the floor need room: with the horizon too high or too low the floor is cramped or the skyline is cut.',
  kerb: 'The old street picture is slid so its kerb lands on the horizon. Another shift leaves a gap or an overlap.',
  rowGaps: 'Rows 14 to 24 px apart read as depth. Closer and fighters merge, further and the stage falls apart.',
  hudShare: 'The always-on HUD may cover only a small part of the screen so the stage stays visible.',
  bottomBand: 'The bottom HUD band may not grow too tall, or it hides the front row.',
  frontShadow: 'The front row’s shadow needs a little clear floor above the bottom band.',
  floorShare: 'Under half of the screen showing floor between the HUD bands makes the fight feel cramped.',
  gap: 'Heroes and enemies need a clear gap between them so attacks have room to travel and the two sides read as two sides.',
  nearest: 'An enemy too far left crowds the heroes.',
  edge: 'An enemy that touches the screen’s right edge looks cut off.',
  topBand: 'A fighter that reaches into the top HUD band is covered by the turn-order bar.',
};

// ------------------------------------------------------------------ layout rules (the stage alone)

/**
 * The rules for a stage's LAYOUT, in plain words (empty when it passes): the horizon sits at 92 to 112, depth rows are
 * 14 to 24 px apart, the HUD's always-on share of the screen is under the limit, the bottom band leaves room above it,
 * and enough floor shows between the HUD bands.
 */
export function layoutBreaks(s: StageConfig): RuleBreak[] {
  const out: RuleBreak[] = [];
  const add = (rule: RuleId, text: string): void => {
    out.push({ rule, text, culprits: [] });
  };
  const hz = s.backdrop.horizonY;
  if (hz < RULE_LIMITS.horizon[0] || hz > RULE_LIMITS.horizon[1]) add('horizon', `horizon ${hz} is outside ${RULE_LIMITS.horizon[0]} to ${RULE_LIMITS.horizon[1]}`);
  if (s.backdrop.mode === 'reproject' && s.backdrop.shiftY !== hz - ART_KERB_ROW) add('kerb', `shiftY ${s.backdrop.shiftY} should be ${hz - ART_KERB_ROW} so the old picture's kerb lands on the horizon`);
  const ys = s.rows.map((r) => r.y);
  const gaps = ys.slice(1).map((y, i) => y - (ys[i] ?? 0));
  if (gaps.some((g) => g < RULE_LIMITS.rowGap[0] || g > RULE_LIMITS.rowGap[1])) add('rowGaps', `row gaps ${gaps.join(', ')} are not all ${RULE_LIMITS.rowGap[0]} to ${RULE_LIMITS.rowGap[1]}`);
  const h = s.hud;
  const area = h.turnOrder.w * h.turnOrder.h + h.partyStatus.w * h.partyStatus.h;
  const share = area / (SCREEN_W * SCREEN_H);
  if (share > h.limits.maxScreenShare) add('hudShare', `always-on HUD takes ${(share * 100).toFixed(1)}% of the screen (limit ${h.limits.maxScreenShare * 100}%)`);
  const band = h.partyStatus.y;
  if (SCREEN_H - band > h.limits.maxBottomBand) add('bottomBand', `bottom band is ${SCREEN_H - band} px tall (limit ${h.limits.maxBottomBand})`);
  const last = Math.max(...ys);
  // The deepest shadow sits just under the front row's feet (its height is half the oval plus a row of rim).
  const lowest = last + Math.ceil(s.shadow.maxW / s.shadow.aspect / 2) + 2;
  if (band - lowest < h.limits.minClearAboveBottom) add('frontShadow', `front shadow ends ${band - lowest} px above the bottom band (need ${h.limits.minClearAboveBottom})`);
  if ((band - s.floor.y0) / SCREEN_H < RULE_LIMITS.floorShare) add('floorShare', `only ${(((band - s.floor.y0) / SCREEN_H) * 100).toFixed(1)}% of the screen shows floor between the HUD bands (need ${RULE_LIMITS.floorShare * 100}%)`);
  return out;
}

/** `layoutBreaks` as plain sentences. */
export function checkLayout(s: StageConfig): string[] {
  return layoutBreaks(s).map((b) => b.text);
}

// ------------------------------------------------------------------ figure rules (need the sprites' sizes)

/**
 * The rules that need the sprites' real sizes: a gap of at least 55 px between the sides, the nearest enemy no further
 * left than 260, no enemy past 476, and nothing reaching into the top HUD band. `figures` is everyone standing on the
 * stage for one enemy count: the heroes and that count's enemies, in the order the editor numbers them.
 */
export function figureBreaks(s: StageConfig, figures: readonly FigureBox[]): RuleBreak[] {
  const out: RuleBreak[] = [];
  // Number each figure within its own side (P1.., E1..) so a break can name who is to blame.
  const seen = { party: 0, enemy: 0 };
  const who = figures.map((f): Culprit => ({ side: f.side, index: seen[f.side]++ }));
  const culprits = (pick: (f: FigureBox) => boolean): Culprit[] => figures.flatMap((f, i) => (pick(f) ? [who[i] as Culprit] : []));
  const heroes = figures.filter((f) => f.side === 'party');
  const foes = figures.filter((f) => f.side === 'enemy');
  if (heroes.length && foes.length) {
    const nearest = Math.min(...foes.map((f) => f.left));
    const heroEdge = Math.max(...heroes.map((f) => f.right));
    const lane = nearest - heroEdge;
    // Everyone who is part of the squeeze: the enemies closer than the gap allows, and the heroes that close in on them.
    if (lane < RULE_LIMITS.gap) out.push({ rule: 'gap', text: `the gap between the heroes and the enemies is ${lane} px (need ${RULE_LIMITS.gap})`, culprits: culprits((f) => (f.side === 'enemy' ? f.left < heroEdge + RULE_LIMITS.gap : f.right > nearest - RULE_LIMITS.gap)) });
    if (nearest < RULE_LIMITS.nearest) out.push({ rule: 'nearest', text: `the nearest enemy's left edge is ${nearest} (need ${RULE_LIMITS.nearest} or more)`, culprits: culprits((f) => f.side === 'enemy' && f.left < RULE_LIMITS.nearest) });
    const far = Math.max(...foes.map((f) => f.right));
    const farLimit = SCREEN_W - RULE_LIMITS.edgeMargin;
    if (far > farLimit) out.push({ rule: 'edge', text: `an enemy reaches x ${far} (keep it at ${farLimit} or less)`, culprits: culprits((f) => f.side === 'enemy' && f.right > farLimit) });
  }
  const topBand = s.hud.turnOrder.y + s.hud.turnOrder.h;
  const high = culprits((f) => f.top < topBand);
  if (high.length) out.push({ rule: 'topBand', text: `${high.length} fighter${high.length === 1 ? ' reaches' : 's reach'} into the top HUD band (above y ${topBand})`, culprits: high });
  return out;
}

/** `figureBreaks` as plain sentences (what the stage lab's test compares). */
export function checkFigures(s: StageConfig, figures: readonly FigureBox[]): string[] {
  return figureBreaks(s, figures).map((b) => b.text);
}

// ------------------------------------------------------------------ everything for one stage

/**
 * Every broken rule of one stage: the layout rules once (for the whole stage) and the figure rules once per enemy count.
 * `boxesBySet` maps an enemy count ("3", "boss"...) to the figures standing on the stage for it.
 */
export function stageWarnings(s: StageConfig, boxesBySet: Readonly<Record<string, readonly FigureBox[]>>): StageWarning[] {
  const out: StageWarning[] = layoutBreaks(s).map((b) => ({ ...b, stageId: s.id, setKey: null }));
  for (const [setKey, boxes] of Object.entries(boxesBySet)) for (const b of figureBreaks(s, boxes)) out.push({ ...b, stageId: s.id, setKey });
  return out;
}
