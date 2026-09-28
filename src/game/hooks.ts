/**
 * Late-bound hooks the field calls into (menus, battles, shops, inventory UI).
 * Systems install themselves here at boot, which keeps FieldScene free of import cycles.
 */
import type { Ctx } from '../engine/canvas';
import type { FieldScene } from '../scenes/field';
import type { BattleResult } from './script';
import type { MemberId } from './state';

export interface BattleOpts {
  canRun?: boolean;
  boss?: boolean;
  music?: string;
  bg?: string;
  loseOk?: boolean;
}

export const fieldHooks: {
  openMenu?: (f: FieldScene) => void;
  /** Called after each completed leader step. Return true if it took control (e.g. an encounter). */
  onStep?: (f: FieldScene) => boolean;
  onEnterMap?: (f: FieldScene) => void;
  onWarp?: (f: FieldScene) => void;
  give?: (f: FieldScene, item: string, qty: number, quiet: boolean) => Promise<void>;
  take?: (item: string, qty: number) => boolean;
  join?: (f: FieldScene, id: MemberId, quiet: boolean) => Promise<void>;
  leave?: (f: FieldScene, id: MemberId) => void;
  restoreParty?: () => void;
  refreshFocus?: () => void;
  battle?: (f: FieldScene, encounter: string, opts: BattleOpts) => Promise<BattleResult>;
  shop?: (f: FieldScene, id: string) => Promise<void>;
  inn?: (f: FieldScene, price: number, name?: string) => Promise<void>;
  clinic?: (f: FieldScene) => Promise<void>;
  panels?: (f: FieldScene, id: string) => Promise<void>;
  endChapter?: (f: FieldScene) => Promise<void>;
  savePrompt?: (f: FieldScene) => Promise<void>;
  tutorial?: (f: FieldScene, title: string, body: string) => Promise<void>;
  renderOverlay?: (f: FieldScene, ctx: Ctx) => void;
} = {};
