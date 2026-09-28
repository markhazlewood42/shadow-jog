/** Input: edge detection, hold, auto-repeat, direction priority, taps shorter than a tick. */
import { describe, expect, it } from 'vitest';
import { Input } from '../src/engine/input';

type Handler = (e: { code: string; key: string; repeat: boolean; preventDefault(): void }) => void;

/** A stand-in window: records listeners so the test can fire key events at them. */
function fakeWindow() {
  const listeners: Record<string, Handler[]> = {};
  const target = {
    addEventListener: (type: string, fn: Handler) => {
      listeners[type] ??= [];
      listeners[type]!.push(fn);
    },
  };
  const fire = (type: string, code: string, repeat = false) => {
    for (const fn of listeners[type] ?? []) fn({ code, key: code, repeat, preventDefault: () => undefined });
  };
  return {
    input: new Input(target as unknown as Window),
    down: (code: string) => fire('keydown', code),
    up: (code: string) => fire('keyup', code),
    blur: () => fire('blur', ''),
  };
}

describe('input', () => {
  it('reports a press on exactly one tick, and holds while the key is down', () => {
    const w = fakeWindow();
    w.down('KeyZ');
    w.input.update();
    expect(w.input.pressed('confirm')).toBe(true);
    expect(w.input.down('confirm')).toBe(true);
    w.input.update();
    expect(w.input.pressed('confirm')).toBe(false);
    expect(w.input.down('confirm')).toBe(true);
    w.up('KeyZ');
    w.input.update();
    expect(w.input.down('confirm')).toBe(false);
  });

  it('auto-repeats a held direction after a delay, at a fixed rate', () => {
    const w = fakeWindow();
    w.down('ArrowDown');
    const fired: number[] = [];
    for (let f = 1; f <= 40; f++) {
      w.input.update();
      if (w.input.repeat('down')) fired.push(f);
    }
    expect(fired[0]).toBe(1); // the initial press
    expect(fired[1]).toBe(20); // first repeat after the delay
    expect(fired[2]! - fired[1]!).toBe(4); // then every 4 ticks
  });

  it('favours the most recently pressed direction', () => {
    const w = fakeWindow();
    w.down('ArrowUp');
    for (let i = 0; i < 5; i++) w.input.update();
    w.down('ArrowRight');
    w.input.update();
    expect(w.input.dir()).toBe('right');
    w.up('ArrowRight');
    w.input.update();
    expect(w.input.dir()).toBe('up');
  });

  it('never loses a tap that is released before the next tick', () => {
    const w = fakeWindow();
    w.down('Enter');
    w.up('Enter');
    w.input.update();
    expect(w.input.pressed('confirm')).toBe(true);
    w.input.update();
    expect(w.input.down('confirm')).toBe(false);
  });

  it('releases everything when the window loses focus', () => {
    const w = fakeWindow();
    w.down('ArrowLeft');
    w.input.update();
    w.blur();
    w.input.update();
    expect(w.input.down('left')).toBe(false);
    expect(w.input.dir()).toBe(null);
  });
});
