/**
 * The editing session of the Battle Stage Editor (Phaser spike `spike/phaser-stage`): the data being edited, what is
 * selected, the undo history and the "has it changed since the last save?" answer, with no page and no Phaser in
 * it. The panels, the overlay and the scene all LISTEN to the session and draw what it holds, so there is one
 * place that knows the truth, and a unit test can run a whole editing session (select, drag, undo, save) directly.
 *
 * How a change happens, in plain words:
 *
 *  - A **gesture** is one thing the user does: a whole drag, one slider release, one button press. Each gesture
 *    is exactly one undo step. `edit(label, fn)` is a gesture done in one go; a drag uses `begin()`, then `live(fn)`
 *    on every mouse move (the scene and panels update at once, but no undo step yet), then `end(label)` when the
 *    mouse is released, which records the step only if something really changed.
 *  - Undo and redo hand back whole-data snapshots (`src/tools/undo.ts`), so they can never drift out of step.
 *  - **Dirty** (unsaved changes) is not a flag that can get stuck: it is "the data as text differs from the text
 *    at the last save", so undoing back to the saved state clears it by itself (`docs/TOOLING-UI.md` 2.5).
 */
import { UNDO_LIMIT, UndoStack } from '../../tools/undo';
import { resolveStage, type StageConfig, type StageEntry } from '../config';
import { cloneStage, type EditorData, type Side, settleData } from './model';
import type { HudRegionKey } from '../hudpresets';

export type { EditorData };

/** The files Save writes, as parts of the data: the stages, the foot-anchor corrections, the global HUD layout and which enemies are mirrored. */
export type Part = 'stages' | 'axes' | 'hud' | 'facing';
const PARTS: readonly Part[] = ['stages', 'axes', 'hud', 'facing'];

/** One selectable thing. Fighters and HUD boxes can be selected several at a time; the handles one at a time. */
export type Item =
  | { kind: 'fighter'; side: Side; index: number }
  | { kind: 'hud'; region: HudRegionKey }
  | { kind: 'horizon' }
  | { kind: 'floor' }
  | { kind: 'row'; index: number }
  | { kind: 'anchor'; side: Side; index: number };

export function sameItem(a: Item, b: Item): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'fighter':
    case 'anchor':
      return b.kind === a.kind && a.side === b.side && a.index === b.index;
    case 'hud':
      return b.kind === 'hud' && a.region === b.region;
    case 'row':
      return b.kind === 'row' && a.index === b.index;
    default:
      return true;
  }
}

/** What the listeners are told. */
export type SessionEvent =
  | { type: 'live'; scene?: boolean }
  | { type: 'commit'; label: string }
  | { type: 'undo'; label: string }
  | { type: 'redo'; label: string }
  | { type: 'select' }
  | { type: 'stage' }
  | { type: 'set' }
  | { type: 'saved' }
  | { type: 'settle' }
  | { type: 'revert' };

export interface LastChange {
  label: string;
  /** The current stage entry's text before and after (the JSON pane highlights what differs). */
  before: string;
  after: string;
}

/** The snapshot text of the data (what undo keeps). */
export function serialize(data: EditorData): string {
  return JSON.stringify({ stages: data.stages, axes: data.axes, hud: data.hud, facing: data.facing });
}

/**
 * Each part's text: "unsaved" is a part's text differing from its text at the last save. The text is the SETTLED data
 * (what Save would really write), so an empty "different on this stage" box, which Save drops, is not an unsaved
 * change: switching the toggle on and not changing anything leaves nothing to save.
 */
function partTexts(data: EditorData): Record<Part, string> {
  const hasEmpty = Object.values(data.stages).some((st) => st.hud !== undefined);
  let stages = data.stages;
  if (hasEmpty) {
    const tidy = cloneStage({ stages: data.stages, axes: data.axes, hud: data.hud, facing: data.facing });
    settleData(tidy);
    stages = tidy.stages;
  }
  return { stages: JSON.stringify(stages), axes: JSON.stringify(data.axes), hud: JSON.stringify(data.hud), facing: JSON.stringify(data.facing) };
}

/**
 * Add a thing to the selection, or take it out if it is already there (Shift+click or Ctrl+click, in the view or in the
 * Who's standing here panel, like Figma's layers). Only things of one kind can be selected together, and fighters
 * only from one side, so something that does not fit starts a new selection.
 */
export function toggleInSelection(selection: readonly Item[], item: Item): Item[] {
  const fits = selection.every((c) => c.kind === item.kind && (item.kind !== 'fighter' || (c.kind === 'fighter' && c.side === item.side)));
  if (!fits || (item.kind !== 'fighter' && item.kind !== 'hud')) return [item];
  return selection.some((c) => sameItem(c, item)) ? selection.filter((c) => !sameItem(c, item)) : [...selection, item];
}

export class Session {
  data: EditorData;
  stageId: string;
  /** Which enemy group is shown and edited ("1" to "6", "boss", "boss+1", "boss+2"). */
  setKey = '3';
  selection: Item[] = [];
  readonly undoStack = new UndoStack();
  /** Gestures since the last save (undo takes one off, redo puts it back): what Revert says it will throw away. */
  private steps = 0;
  /** The names of the gestures Undo would take back (last = next) and Redo would bring back, so the status line can say "Undid ...". */
  private doneLabels: string[] = [];
  private undoneLabels: string[] = [];
  /** Each file's text at the last save (or load): "unsaved" means a part's text differs from this. */
  private savedParts: Record<Part, string>;
  private savedData: EditorData;
  private gestureBefore: string | null = null;
  private gestureStageText: string | null = null;
  private lastChange: LastChange | null = null;
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  /** Turned into text for the JSON pane; set by the page (the formatter lives outside the session). */
  private readonly stageText: (stage: StageEntry) => string;

  constructor(initial: EditorData, stageId: string, stageText: (stage: StageEntry) => string = (s) => JSON.stringify(s, null, 2)) {
    this.data = cloneStage(initial);
    this.savedData = cloneStage(initial);
    this.savedParts = partTexts(this.data);
    this.stageId = stageId in initial.stages ? stageId : (Object.keys(initial.stages)[0] ?? '');
    this.stageText = stageText;
  }

  // ---------------------------------------------------------------- reading

  /** The stage being edited, as the file holds it (its HUD is only the overrides). */
  get stage(): StageEntry {
    const s = this.data.stages[this.stageId];
    if (!s) throw new Error(`No stage "${this.stageId}"`);
    return s;
  }

  /** The stage as a battle sees it: the global HUD with this stage's overrides laid over it. What the scene and the handles read. */
  get resolved(): StageConfig {
    return resolveStage(this.stage, this.data.hud);
  }

  /** The same stage as it was at the last save (for "back to the saved value" arrows); null when it did not exist then. */
  get savedStage(): StageEntry | null {
    return this.savedData.stages[this.stageId] ?? null;
  }

  /** Everything as it was at the last save (for "back to the saved value" arrows). */
  get saved(): EditorData {
    return this.savedData;
  }

  /** The global HUD layout as it was at the last save. */
  get savedHud(): EditorData['hud'] {
    return this.savedData.hud;
  }

  /** The parts that differ from the last save (so Save writes only those files). */
  get dirtyParts(): Part[] {
    const now = partTexts(this.data);
    return PARTS.filter((p) => now[p] !== this.savedParts[p]);
  }

  get dirty(): boolean {
    return this.dirtyParts.length > 0;
  }

  /** How many gestures separate the data from the last save. */
  get changeCount(): number {
    return Math.abs(this.steps);
  }

  get canUndo(): boolean {
    return this.undoStack.canUndo;
  }

  get canRedo(): boolean {
    return this.undoStack.canRedo;
  }

  /** The name of the gesture Undo would take back next ("Move Rook"), or '' when there is none. */
  get nextUndoLabel(): string {
    return this.doneLabels[this.doneLabels.length - 1] ?? '';
  }

  /** The name of the gesture Redo would bring back next, or ''. */
  get nextRedoLabel(): string {
    return this.undoneLabels[this.undoneLabels.length - 1] ?? '';
  }

  /** What the last gesture changed in the current stage's text (null until something changes). */
  get change(): LastChange | null {
    return this.lastChange;
  }

  /** The current stage's text as it was when the open gesture began (null when none is open): what a drag in progress is compared with. */
  get openGestureText(): string | null {
    return this.gestureStageText;
  }

  /** True while a drag or slider gesture is open. */
  get inGesture(): boolean {
    return this.gestureBefore !== null;
  }

  on(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SessionEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }

  // ---------------------------------------------------------------- selection and navigation

  select(items: Item[]): void {
    this.selection = items;
    this.emit({ type: 'select' });
  }

  /** The indices of the selected fighters on a side. */
  selectedFighters(side: Side): number[] {
    return this.selection.flatMap((it) => (it.kind === 'fighter' && it.side === side ? [it.index] : []));
  }

  /** Show another stage (undo history stays: it covers the whole file). */
  showStage(id: string): void {
    if (!this.data.stages[id]) throw new Error(`No stage "${id}"`);
    this.stageId = id;
    this.selection = [];
    this.lastChange = null;
    this.emit({ type: 'stage' });
  }

  showSet(key: string): void {
    this.setKey = key;
    // A selected enemy slot of another group does not exist here.
    this.selection = this.selection.filter((it) => it.kind !== 'fighter' || it.side === 'party');
    this.emit({ type: 'set' });
  }

  /** Drop selected things that no longer exist (after undo, or removing a row). */
  private tidySelection(): void {
    const s = this.data.stages[this.stageId];
    this.selection = this.selection.filter((it) => {
      if (!s) return false;
      if (it.kind === 'fighter' || it.kind === 'anchor') {
        const n = it.side === 'party' ? s.party.length : (s.enemySets[this.setKey]?.length ?? 0);
        return it.index < n;
      }
      if (it.kind === 'row') return it.index < s.rows.length;
      return true;
    });
  }

  // ---------------------------------------------------------------- gestures

  /** Start a gesture (a drag, a slider): remember the data as it is now. */
  begin(): void {
    if (this.gestureBefore !== null) return;
    this.gestureBefore = serialize(this.data);
    this.gestureStageText = this.data.stages[this.stageId] ? this.stageText(this.stage) : '';
  }

  /** Change the data during a gesture; listeners redraw at once, no undo step is made yet. */
  live(fn: (data: EditorData) => void, opts: { scene?: boolean } = {}): void {
    this.begin();
    fn(this.data);
    this.emit({ type: 'live', scene: !!opts.scene });
  }

  /** Finish the gesture. If anything changed it becomes one undo step and `label` names it. Returns whether it changed. */
  end(label: string): boolean {
    const before = this.gestureBefore;
    const beforeStage = this.gestureStageText ?? '';
    this.gestureBefore = null;
    this.gestureStageText = null;
    if (before === null) return false;
    if (serialize(this.data) === before) {
      this.emit({ type: 'commit', label: '' });
      return false;
    }
    this.undoStack.record(before);
    this.doneLabels.push(label);
    if (this.doneLabels.length > UNDO_LIMIT) this.doneLabels.shift();
    this.undoneLabels = [];
    this.steps++;
    this.tidySelection();
    this.lastChange = { label, before: beforeStage, after: this.data.stages[this.stageId] ? this.stageText(this.stage) : '' };
    this.emit({ type: 'commit', label });
    return true;
  }

  /** One whole gesture: change the data, make one undo step. */
  edit(label: string, fn: (data: EditorData) => void): boolean {
    this.begin();
    fn(this.data);
    return this.end(label);
  }

  /** Throw away an open gesture and put the data back as it was (Esc during a drag). */
  cancel(): void {
    const before = this.gestureBefore;
    this.gestureBefore = null;
    this.gestureStageText = null;
    if (before === null) return;
    this.data = JSON.parse(before) as EditorData;
    this.emit({ type: 'live', scene: true });
  }

  undo(): boolean {
    if (this.inGesture) this.end('');
    const now = serialize(this.data);
    const back = this.undoStack.undo(now);
    if (back === null) return false;
    const label = this.doneLabels.pop() ?? '';
    this.undoneLabels.push(label);
    this.restore(back, 'undo', label);
    this.steps--;
    return true;
  }

  redo(): boolean {
    const now = serialize(this.data);
    const next = this.undoStack.redo(now);
    if (next === null) return false;
    const label = this.undoneLabels.pop() ?? '';
    this.doneLabels.push(label);
    this.restore(next, 'redo', label);
    this.steps++;
    return true;
  }

  private restore(text: string, type: 'undo' | 'redo', label: string): void {
    const beforeStage = this.data.stages[this.stageId] ? this.stageText(this.stage) : '';
    this.data = JSON.parse(text) as EditorData;
    // The stage being viewed may not exist in the restored data (an undone "New stage"): fall back to the first one.
    if (!this.data.stages[this.stageId]) this.stageId = Object.keys(this.data.stages)[0] ?? this.stageId;
    this.tidySelection();
    this.lastChange = { label: `${type === 'undo' ? 'Undid' : 'Redid'} ${label}`.trim(), before: beforeStage, after: this.stage ? this.stageText(this.stage) : '' };
    this.emit({ type, label });
  }

  // ---------------------------------------------------------------- saving

  /** These files were written to disk (all of them by default): they are now the reference for "unsaved" and "back to the saved value". */
  markSaved(parts: readonly Part[] = PARTS): void {
    const now = partTexts(this.data);
    for (const p of parts) {
      this.savedParts[p] = now[p];
      (this.savedData as unknown as Record<Part, unknown>)[p] = JSON.parse(now[p]);
    }
    if (!this.dirty) this.steps = 0;
    this.emit({ type: 'saved' });
  }

  /**
   * Tidy the data before it is written (a stage override keeps only what differs from the global HUD; see
   * `settleData`). Not an undo step: it never changes what anyone sees, only how it is stored.
   */
  settle(): void {
    if (this.inGesture) return;
    if (settleData(this.data)) this.emit({ type: 'settle' });
  }

  /** Replace everything with data freshly loaded from disk (Revert, or a reload): clears the history. */
  load(data: EditorData): void {
    this.data = cloneStage(data);
    this.savedData = cloneStage(data);
    this.savedParts = partTexts(this.data);
    this.undoStack.clear();
    this.doneLabels = [];
    this.undoneLabels = [];
    this.steps = 0;
    this.lastChange = null;
    this.gestureBefore = null;
    if (!this.data.stages[this.stageId]) this.stageId = Object.keys(this.data.stages)[0] ?? this.stageId;
    this.tidySelection();
    this.emit({ type: 'revert' });
  }
}
