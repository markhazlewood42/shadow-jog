/**
 * The DEV hook of the field stage (M5 task 5; docs/engine/m5-brief.md): members on `window.__SJ__`, added in a DEV build only (the engine's DEV hook, `devhook.ts`, calls
 * `attachFieldHook`; a shipped build never loads either file).
 *
 *   fieldStage                   the stage of the field that is on, as plain data (the map, the scroll, how many props are built and shown, the light paints). `null`
 *                                when no field is staged (the default path, or a menu over nothing). No Pixi object is in it.
 *   fieldStageSnapshot()         the stage's state as JSON, or null.
 *   fieldStageRestore(snap)      show a snapshot of this stage; `fieldStageRelease()` goes back to the live view. A snapshot that cannot be shown throws its message.
 *   fieldStageLoadMap(bad)       the editor contract's control: ask the stage to load a map that breaks the rules; the answer is the message, and the stage keeps its map.
 */
import { fieldStage, type FieldStageDescription, type FieldStageSnapshot } from '../fieldstage/stagescene';
import type { StageMap } from '../scenes/fieldkit/fieldseam';

export interface FieldHook {
  readonly fieldStage: FieldStageDescription | null;
  fieldStageSnapshot(): FieldStageSnapshot | null;
  fieldStageRestore(s: FieldStageSnapshot): void;
  fieldStageRelease(): void;
  /** Try to load a map with a layer of the wrong size (a copy of the shown map), and return the refusal message, or null if it was accepted. */
  fieldStageLoadBadMap(): string | null;
}

/** Put the field members on `window.__SJ__`. `Object.defineProperties` keeps the `fieldStage` getter live. */
export function attachFieldHook(sj: Record<string, unknown>): void {
  const hook: FieldHook = {
    get fieldStage() {
      return fieldStage()?.describe() ?? null;
    },
    fieldStageSnapshot: () => fieldStage()?.snapshot() ?? null,
    fieldStageRestore: (s) => {
      const st = fieldStage();
      if (!st) throw new Error('no field stage is on');
      st.restore(s);
    },
    fieldStageRelease: () => fieldStage()?.release(),
    fieldStageLoadBadMap: () => {
      const st = fieldStage();
      const f = (sj as { field?: () => { map: StageMap } | null }).field?.();
      if (!st || !f) throw new Error('no field stage is on');
      const bad: StageMap = { ...f.map, def: f.map.def, w: f.map.w + 1 };
      try {
        st.loadMap(bad);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  };
  Object.defineProperties(sj, Object.getOwnPropertyDescriptors(hook));
}
