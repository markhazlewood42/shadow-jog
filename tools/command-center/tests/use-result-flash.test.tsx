// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResultFlash } from '../src/web/useResultFlash';

// The hook behind the Copy button of a box and the Copy and Download buttons of a doc. A small component shows what the hook holds, and the test drives it with fake timers.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Word = 'idle' | 'copied' | 'failed';

let flash: (result: Word) => void = () => undefined;
function Probe() {
  const [shown, show] = useResultFlash<Word>('idle');
  flash = show;
  return <p>{shown}</p>;
}

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const shown = () => host.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => {
  vi.useRealTimers();
  host.remove();
});

describe('useResultFlash', () => {
  it('G10: useResultFlash shows a result, resets after 2 seconds, restarts on a second result and stops its timer on unmount', () => {
    // At rest it shows the resting word.
    expect(shown()).toBe('idle');

    // A result shows at once and goes back after 2 seconds, not before.
    act(() => flash('copied'));
    expect(shown()).toBe('copied');
    act(() => vi.advanceTimersByTime(1999));
    expect(shown()).toBe('copied');
    act(() => vi.advanceTimersByTime(1));
    expect(shown()).toBe('idle');

    // A second result starts the 2 seconds again.
    act(() => flash('copied'));
    act(() => vi.advanceTimersByTime(1500));
    act(() => flash('failed'));
    expect(shown()).toBe('failed');
    act(() => vi.advanceTimersByTime(1500));
    expect(shown()).toBe('failed');
    act(() => vi.advanceTimersByTime(500));
    expect(shown()).toBe('idle');

    // After the unmount no timer is left: the pending one was stopped.
    act(() => flash('copied'));
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
