/**
 * The shared undo stack for every Shadow Jog design tool (`docs/TOOLING-UI.md` section 2.5).
 *
 * How undo works here, in plain words: before a change is made, the tool hands this stack a **snapshot** of
 * its whole data (as text). Undo gives that snapshot back and keeps the present one so Redo can return to it.
 * Because a snapshot is the whole data object rather than a list of "what changed", undo can never get out of
 * step with the data, whatever the tool changes; the price is memory, which for a few kilobytes of JSON times
 * 100 steps is nothing.
 *
 * One step is one **gesture** (a whole drag, a slider release, one list action), not one mouse-move: the tool
 * calls `record` once when the gesture ends. RPG Maker goes back 20 steps; ours goes back 100, as the animation
 * editor's stack already does (`src/dev/rigedit.ts`).
 *
 * The stack knows nothing about what the snapshots mean, so the animation editor, FX lab and art review can use
 * it too. Snapshots are strings (usually `JSON.stringify` of the data), which also makes "has anything changed
 * since the last save?" a plain comparison.
 */

/** How many steps back a tool can go. */
export const UNDO_LIMIT = 100;

export class UndoStack {
  private past: string[] = [];
  private future: string[] = [];

  constructor(private readonly limit = UNDO_LIMIT) {}

  /** Remember `before`, the state just BEFORE a change. A new change ends the redo history (you cannot redo what you have overwritten). */
  record(before: string): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** How many steps Undo can go back. */
  get depth(): number {
    return this.past.length;
  }

  /** Go back one step: gives the earlier state, and keeps `current` so Redo can come forward again. Null when there is nothing to undo. */
  undo(current: string): string | null {
    const back = this.past.pop();
    if (back === undefined) return null;
    this.future.push(current);
    return back;
  }

  /** Go forward one step again: gives the state Undo left, and keeps `current` for another Undo. Null when there is nothing to redo. */
  redo(current: string): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  /** Forget everything (a new file was loaded, so old snapshots no longer apply). */
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
