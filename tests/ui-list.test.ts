/** ListMenu: wrap-around, scrolling window, disabled rows, empty lists. */
import { describe, expect, it } from 'vitest';
import type { Input } from '../src/engine/input';
import { ListMenu } from '../src/ui/list';

/** A scripted input: one action "pressed" for the next update() call. */
function press(action: string | null): Input {
  return {
    pressed: (a: string) => a === action,
    repeat: (a: string) => a === action,
    down: () => false,
  } as unknown as Input;
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Row ${i}`, value: i }));

describe('ListMenu', () => {
  it('wraps from the top to the bottom and back', () => {
    const m = new ListMenu(items(5), 3);
    expect(m.update(press('up'))).toBe('move');
    expect(m.index).toBe(4);
    expect(m.update(press('down'))).toBe('move');
    expect(m.index).toBe(0);
  });

  it('scrolls to keep the cursor inside the visible rows', () => {
    const m = new ListMenu(items(10), 4);
    for (let i = 0; i < 6; i++) m.update(press('down'));
    expect(m.index).toBe(6);
    expect(m.scroll).toBe(3);
    m.update(press('up'));
    m.update(press('up'));
    m.update(press('up'));
    m.update(press('up'));
    expect(m.index).toBe(2);
    expect(m.scroll).toBe(2);
  });

  it('a locked row says why while it is selected, and only then', () => {
    const m = new ListMenu(
      [
        { label: 'New', value: 'new' },
        { label: 'Load', value: 'load', enabled: false, why: 'No saved games yet.' },
      ],
      3,
    );
    expect(m.why).toBeUndefined();
    m.update(press('down'));
    expect(m.why).toBe('No saved games yet.');
    expect(m.update(press('confirm'))).toBe('blocked');
    m.update(press('up'));
    expect(m.why).toBeUndefined();
  });

  it('refuses to confirm a disabled row', () => {
    const m = new ListMenu([{ label: 'Save', value: 'save', enabled: false }], 3);
    expect(m.update(press('confirm'))).toBe('blocked');
  });

  it('handles an empty list: no movement, cancel still works', () => {
    const m = new ListMenu<number>([], 3);
    expect(m.update(press('down'))).toBe(null);
    expect(m.update(press('confirm'))).toBe(null);
    expect(m.update(press('cancel'))).toBe('cancel');
    expect(m.current).toBeUndefined();
  });

  it('clamps the cursor when the list shrinks', () => {
    const m = new ListMenu(items(8), 4);
    for (let i = 0; i < 7; i++) m.update(press('down'));
    m.setItems(items(3));
    expect(m.index).toBe(2);
    expect(m.scroll).toBe(0);
  });
});
