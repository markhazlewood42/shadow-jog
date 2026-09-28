/**
 * Input: keyboard, gamepad and touch, unified into abstract actions.
 * Call `update()` once per fixed tick BEFORE scene updates.
 */

export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'menu' | 'dash' | 'fullscreen';

export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'confirm', 'cancel', 'menu', 'dash', 'fullscreen'];

const KEYMAP: Record<string, Action> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'confirm', Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
  KeyX: 'cancel', Escape: 'cancel', Backspace: 'cancel',
  KeyC: 'menu', Tab: 'menu',
  ShiftLeft: 'dash', ShiftRight: 'dash',
  KeyF: 'fullscreen',
};

/** A key code as a player reads it. */
/** The four directions, in a fixed order (hoisted: dir() runs every field tick). */
const DIRS = ['up', 'down', 'left', 'right'] as const;

export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'NumEnter',
    Space: 'Space', Backspace: 'Bksp', Tab: 'Tab', ShiftLeft: 'Shift', ShiftRight: 'RShift', ControlLeft: 'Ctrl', ControlRight: 'RCtrl',
    AltLeft: 'Alt', AltRight: 'RAlt',
  };
  if (names[code]) return names[code]!;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code;
}

const REPEAT_DELAY = 16;
const REPEAT_RATE = 4;

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export class Input {
  private keys = new Set<Action>();
  private touchHeld = new Set<Action>();
  private padHeld = new Set<Action>();
  private held = new Map<Action, number>();
  private readonly prev = new Set<Action>();
  private justDown = new Set<Action>();
  /** Keyboard presses between ticks (so a very quick tap is never lost). */
  private tapped = new Set<Action>();
  lastDevice: InputDevice = 'keyboard';
  /** Effective key map: the defaults, with the player's custom keys applied. */
  private map: Record<string, Action> = { ...KEYMAP };
  /** When set, the next key press goes here (key rebinding) instead of to an action. */
  private capture: ((code: string) => void) | null = null;
  /** Raw key events for text entry / debug; cleared each tick. */
  typed: string[] = [];
  anyPressed = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (this.capture && !e.repeat) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      const a = this.map[e.code];
      if (a || e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab' || e.code === 'Backspace') e.preventDefault();
      if (e.repeat) return;
      this.lastDevice = 'keyboard';
      this.typed.push(e.key);
      if (a) {
        this.keys.add(a);
        this.tapped.add(a);
      }
    });
    target.addEventListener('keyup', (e) => {
      const a = this.map[e.code];
      if (a) this.keys.delete(a);
    });
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.touchHeld.clear();
    });
  }

  /** Apply the player's custom keys (one extra key per action) on top of the defaults. */
  applyCustom(custom: Partial<Record<Action, string>>): void {
    this.map = { ...KEYMAP };
    for (const [a, code] of Object.entries(custom) as [Action, string][]) if (code) this.map[code] = a;
    this.keys.clear();
  }

  /** Every key currently mapped to an action. */
  keysFor(action: Action): string[] {
    return Object.keys(this.map).filter((c) => this.map[c] === action);
  }

  /**
   * Give `action` the key `code`. Returns the new custom map, or null if that would leave some
   * other action with no key at all.
   */
  bind(action: Action, code: string, custom: Partial<Record<Action, string>>): Partial<Record<Action, string>> | null {
    const next = { ...custom };
    for (const a of Object.keys(next) as Action[]) if (next[a] === code) delete next[a];
    next[action] = code;
    const trial = { ...KEYMAP };
    for (const [a, c] of Object.entries(next) as [Action, string][]) trial[c] = a;
    if (ACTIONS.some((a) => !Object.values(trial).includes(a))) return null;
    this.applyCustom(next);
    return next;
  }

  /** Hand the next key press to `cb` instead of the game (for rebinding). */
  captureNext(cb: (code: string) => void): void {
    this.capture = cb;
  }

  /** Touch overlay hooks. */
  setTouch(action: Action, down: boolean): void {
    this.lastDevice = 'touch';
    if (down) {
      this.touchHeld.add(action);
      this.tapped.add(action);
    } else this.touchHeld.delete(action);
  }

  private pollPad(): void {
    this.padHeld.clear();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p?.connected) continue;
      const b = (i: number) => !!p.buttons[i]?.pressed;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      const add = (a: Action, on: boolean) => {
        if (on) this.padHeld.add(a);
      };
      add('up', b(12) || ay < -0.5);
      add('down', b(13) || ay > 0.5);
      add('left', b(14) || ax < -0.5);
      add('right', b(15) || ax > 0.5);
      add('confirm', b(0));
      add('cancel', b(1));
      add('menu', b(9) || b(3));
      add('dash', b(2) || b(5) || b(7));
      if (this.padHeld.size) this.lastDevice = 'gamepad';
    }
  }

  update(): void {
    this.pollPad();
    this.justDown.clear();
    this.anyPressed = false;
    for (const a of ACTIONS) {
      const down = this.keys.has(a) || this.padHeld.has(a) || this.touchHeld.has(a) || this.tapped.has(a);
      if (down) {
        this.held.set(a, (this.held.get(a) ?? 0) + 1);
        if (!this.prev.has(a)) {
          this.justDown.add(a);
          this.anyPressed = true;
        }
      } else this.held.delete(a);
    }
    this.prev.clear();
    for (const k of this.held.keys()) this.prev.add(k);
    // A tap that was released before this tick still counts as held for exactly one tick.
    this.tapped.clear();
    for (const a of this.justDown) if (!this.keys.has(a) && !this.padHeld.has(a) && !this.touchHeld.has(a)) this.prev.delete(a);
  }

  /** Clear typed buffer — call after scenes have consumed it. */
  endFrame(): void {
    this.typed.length = 0;
  }

  pressed(a: Action): boolean {
    return this.justDown.has(a);
  }

  down(a: Action): boolean {
    return this.held.has(a);
  }

  /** Pressed, or held long enough to auto-repeat (menus). */
  repeat(a: Action): boolean {
    const n = this.held.get(a);
    if (!n) return false;
    if (n === 1) return true;
    return n > REPEAT_DELAY && (n - REPEAT_DELAY) % REPEAT_RATE === 0;
  }

  /** Swallow current presses so the next scene doesn't see them. */
  consume(): void {
    this.justDown.clear();
  }

  /** Directional input with priority to the most recently pressed axis. */
  dir(): 'up' | 'down' | 'left' | 'right' | null {
    let best: 'up' | 'down' | 'left' | 'right' | null = null;
    let bestN = Infinity;
    for (const d of DIRS) {
      const n = this.held.get(d);
      if (n !== undefined && n < bestN) {
        bestN = n;
        best = d;
      }
    }
    return best;
  }
}
