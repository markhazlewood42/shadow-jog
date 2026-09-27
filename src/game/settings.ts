/** Player preferences, persisted separately from save files. */

export interface Settings {
  musicVol: number;
  sfxVol: number;
  /** 1 = slow, 2 = normal, 3 = fast, 4 = instant */
  textSpeed: number;
  /** 1 = normal, 2 = fast, 3 = faster */
  battleSpeed: number;
  scale: 'fit' | 'integer';
  shake: boolean;
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
  shake: true,
  crt: false,
  touch: 'auto',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
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

/** Characters revealed per frame for the typewriter. */
export function charsPerFrame(): number {
  return [0, 0.5, 1, 2.5, 999][settings.textSpeed] ?? 1;
}
