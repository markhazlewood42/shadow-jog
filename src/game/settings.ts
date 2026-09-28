/** Player preferences, persisted separately from save files. */
import type { Action } from '../engine/input';

export interface Settings {
  musicVol: number;
  sfxVol: number;
  /** 1 = slow, 2 = normal, 3 = fast, 4 = instant */
  textSpeed: number;
  /** 1 = normal, 2 = fast, 3 = faster */
  battleSpeed: number;
  scale: 'fit' | 'integer';
  /** 0 = off, 1 = gentle, 2 = full. */
  shake: number;
  crt: boolean;
  touch: 'auto' | 'on' | 'off';
  /** Timed presses in battle: rings to hit (on), always a good press (assist), or none (off). */
  timing: 'on' | 'assist' | 'off';
  /** The player's own key for an action (on top of the defaults), by KeyboardEvent.code. */
  keys: Partial<Record<Action, string>>;
}

const KEY = 'shadowjog.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  musicVol: 0.7,
  sfxVol: 0.8,
  textSpeed: 2,
  battleSpeed: 1,
  scale: 'fit',
  // Gentle by default; players who want the full kick can turn it up.
  shake: 1,
  crt: false,
  touch: 'auto',
  timing: 'on',
  keys: {},
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      // v1 stored shake as on/off.
      if (typeof s.shake === 'boolean') s.shake = s.shake ? 2 : 0;
      return s;
    }
  } catch {
    /* storage unavailable (private mode) — defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export const settings: Settings = typeof localStorage === 'undefined' ? { ...DEFAULT_SETTINGS } : load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
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
