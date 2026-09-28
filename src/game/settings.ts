/** Player preferences, persisted separately from save files. */

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
}

const KEY = 'shadowjog.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  musicVol: 0.7,
  sfxVol: 0.8,
  textSpeed: 2,
  battleSpeed: 1,
  scale: 'fit',
  shake: 2,
  crt: false,
  touch: 'auto',
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

/** Characters revealed per frame for the typewriter. */
export function charsPerFrame(): number {
  return [0, 0.5, 1, 2.5, 999][settings.textSpeed] ?? 1;
}
