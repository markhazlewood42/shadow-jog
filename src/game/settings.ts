/** Player preferences, persisted separately from save files. */
import type { Action } from '../engine/input';

export interface Settings {
  musicVol: number;
  sfxVol: number;
  /** 1 = slow, 2 = normal, 3 = fast, 4 = instant */
  textSpeed: number;
  /** 1 = normal, 2 = fast, 3 = faster */
  battleSpeed: number;
  /** Always `integer`: the `fit` mode was dropped (Mark, 2026-10-09). A saved `fit` becomes `integer` in `backfill()`. */
  scale: 'integer';
  /** 0 = off, 1 = gentle, 2 = full. */
  shake: number;
  /** Full-screen flashes (hits, combos, the finale): 0 = off, 1 = reduced, 2 = full. */
  flash: number;
  /** Freeze-frames on heavy hits. */
  hitPause: boolean;
  touch: 'auto' | 'on' | 'off';
  /** Timed presses in battle: rings to hit (on), always a good press (assist), or none (off). */
  timing: 'on' | 'assist' | 'off';
  /** The player's own key for an action (on top of the defaults), by KeyboardEvent.code. */
  keys: Partial<Record<Action, string>>;
  /** GPU effects (engine/postfx.ts): bloom, shockwaves, particles. `none`, or without WebGL 2, the
   *  game draws exactly as before. `auto` picks the level the machine can hold; `full` asks for all of it.
   *  Replaces the old `gpuFx` flag (`backfill()` maps true to `auto`, false to `none`). */
  fxLevel: FxSetting;
}

export type FxSetting = 'none' | 'auto' | 'full';
const FX_SETTINGS: readonly FxSetting[] = ['none', 'auto', 'full'];

const KEY = 'shadowjog.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  musicVol: 0.7,
  sfxVol: 0.8,
  textSpeed: 2,
  battleSpeed: 1,
  scale: 'integer',
  // Gentle by default; players who want the full kick can turn it up.
  shake: 1,
  flash: 2,
  hitPause: true,
  touch: 'auto',
  timing: 'on',
  keys: {},
  fxLevel: 'auto',
};

/**
 * Bring a stored settings object up to date: fill what it lacks from the defaults and migrate the old shapes. Pure (no storage), so a test
 * can feed it any old save.
 *
 *  - v1 stored `shake` as on/off.
 *  - An old CRT toggle never did anything: dropped.
 *  - `gpuFx` (a boolean) became `fxLevel`: true is `auto`, false is `none`. An `fxLevel` that is already there wins.
 *  - `scale: 'fit'` became `integer` when the fit mode was dropped (Mark, 2026-10-09). Any other value is `integer` too.
 */
export function backfill(stored: unknown): Settings {
  const old = (stored && typeof stored === 'object' ? stored : {}) as Partial<Settings> & { gpuFx?: unknown; crt?: unknown; shake?: unknown };
  const s: Settings & { gpuFx?: unknown; crt?: unknown } = { ...DEFAULT_SETTINGS, ...old, scale: 'integer' } as Settings;
  if (typeof old.shake === 'boolean') s.shake = old.shake ? 2 : 0;
  delete s.crt;
  if (!FX_SETTINGS.includes(old.fxLevel as FxSetting)) {
    if (typeof old.gpuFx === 'boolean') s.fxLevel = old.gpuFx ? 'auto' : 'none';
    else s.fxLevel = DEFAULT_SETTINGS.fxLevel;
  }
  delete s.gpuFx;
  return s;
}

function load(): Settings {
  try {
    // Where storage is blocked, even naming localStorage throws, so the check sits inside the try.
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (raw) {
      return backfill(JSON.parse(raw));
    }
  } catch {
    /* storage unavailable (private mode) — defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Are GPU effects asked for? (`fxLevel` is not `none`.) */
export function gpuWanted(): boolean {
  return settings.fxLevel !== 'none';
}

/** Multiplier applied to every full-screen flash (0 skips them). */
export function flashScale(): number {
  return [0, 0.4, 1][settings.flash] ?? 1;
}

/** Multiplier applied to every screen shake. */
export function shakeScale(): number {
  return [0, 0.45, 1][settings.shake] ?? 1;
}

/** The steps of the text and battle speed options, in order. The settings store a 1-based step. */
export const TEXT_SPEEDS = [
  { label: 'Slow', cps: 0.5 },
  { label: 'Normal', cps: 1 },
  { label: 'Fast', cps: 2.5 },
  { label: 'Instant', cps: 999 },
] as const;
export const BATTLE_SPEEDS = [
  { label: 'Normal', mult: 1 },
  { label: 'Fast', mult: 1.5 },
  { label: 'Faster', mult: 2.2 },
] as const;

/** A 1-based step into a table, clamped (a hand-edited or stale settings value can't miss). */
function step<T>(table: readonly T[], n: number): T {
  return table[Math.min(table.length, Math.max(1, Math.round(n) || 1)) - 1]!;
}
export const textSpeed = () => step(TEXT_SPEEDS, settings.textSpeed);
export const battleSpeed = () => step(BATTLE_SPEEDS, settings.battleSpeed);

/** Characters revealed per frame for the typewriter. */
export function charsPerFrame(): number {
  return textSpeed().cps;
}
