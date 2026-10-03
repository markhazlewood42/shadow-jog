/**
 * The editor's VIEW state: things about how the editor looks and behaves that are not stage data and are not
 * undone (which mode, which snaps and overlays are on, which layers are locked, which moment of the turn is shown,
 * and who is standing in the enemy slots for the preview). The stage data is in `Session`.
 *
 * The snap, overlay and preview choices are remembered per browser in `localStorage` (they are conveniences: a
 * browser that blocks storage simply starts from the defaults). "Who's standing here" is a PREVIEW choice: the
 * stage stores places, not people (`docs/TOOLING-UI.md` 3.3), so the previewed enemies are never saved with the stage.
 */
import { ENEMIES } from '../../data/enemies';
import { setSize, type StageBody } from '../config';
import type { Phase } from '../demo';
import type { Layer } from './hit';
import { readStore, writeStore } from './dom';
import type { OverlayShow } from './overlay';

export type Mode = 'edit' | 'play';

const KEY = 'shadowjog.stageedit.v1';

interface Remembered {
  snapRows: boolean;
  snapGrid: boolean;
  show: OverlayShow;
  jsonOpen: boolean;
  phase: Phase;
  /** stage id -> enemy group -> the enemies previewed in its slots. */
  preview: Record<string, Record<string, string[]>>;
}

const DEFAULTS: Remembered = {
  snapRows: true,
  snapGrid: false,
  show: { hud: true, guides: false, safe: false, anchors: false },
  jsonOpen: false,
  phase: 'choose',
  preview: {},
};

export class ViewState {
  mode: Mode = 'edit';
  snapRows: boolean;
  snapGrid: boolean;
  show: OverlayShow;
  jsonOpen: boolean;
  phase: Phase;
  preview: Record<string, Record<string, string[]>>;
  locked = new Set<Layer>();
  /** The enemy picked in the palette (applied with a double-click or a drag onto a slot). */
  paletteEnemy: string | null = null;

  constructor() {
    const r = { ...DEFAULTS, ...readStore<Partial<Remembered>>(KEY, {}) };
    this.snapRows = r.snapRows;
    this.snapGrid = r.snapGrid;
    // Only the overlays that exist now (an old browser may still remember a "camera" one that was taken out).
    const old = r.show as Partial<OverlayShow>;
    this.show = { hud: old.hud ?? DEFAULTS.show.hud, guides: old.guides ?? DEFAULTS.show.guides, safe: old.safe ?? DEFAULTS.show.safe, anchors: old.anchors ?? DEFAULTS.show.anchors };
    this.jsonOpen = r.jsonOpen;
    this.phase = r.phase;
    this.preview = r.preview ?? {};
  }

  remember(): void {
    const r: Remembered = { snapRows: this.snapRows, snapGrid: this.snapGrid, show: this.show, jsonOpen: this.jsonOpen, phase: this.phase, preview: this.preview };
    writeStore(KEY, r);
  }

  /** The enemies to show in an enemy group of a stage: the previewed ones if they are valid for it, else the stage's own demo roster. */
  roster(stage: StageBody, setKey: string): string[] {
    const own = stage.demo.rosters[setKey] ?? [];
    const picked = this.preview[stage.id]?.[setKey];
    if (picked && picked.length === setSize(setKey) && picked.every((k) => k in ENEMIES)) return picked;
    return own;
  }

  /** Preview a different enemy in one slot of a group (a browser-only choice). */
  setPreview(stage: StageBody, setKey: string, index: number, enemy: string): void {
    const roster = [...this.roster(stage, setKey)];
    roster[index] = enemy;
    const forStage = this.preview[stage.id] ?? {};
    forStage[setKey] = roster;
    this.preview[stage.id] = forStage;
    this.remember();
  }

  /** Forget the previewed enemies of a group. */
  clearPreview(stageId: string, setKey: string): void {
    const forStage = this.preview[stageId];
    if (forStage) delete forStage[setKey];
    this.remember();
  }
}
