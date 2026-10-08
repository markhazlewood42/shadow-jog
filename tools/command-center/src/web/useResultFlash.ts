import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a result stays before the control goes back to rest: 2 seconds. */
export const RESULT_FLASH_MS = 2000;

/**
 * The state of a button that shows the result of an action for a short time and then goes back to rest (the Copy button of a box, the Copy and Download buttons of a doc).
 * `rest` is what it shows when nothing happened. `show(result)` shows a result and, after 2 seconds, `rest` again. A second result starts the 2 seconds again, and a timer
 * never outlives the component: when it leaves the page, the timer stops. The words are whatever the caller chooses, for example `'copied'` and `'failed'`.
 */
export function useResultFlash<R extends string>(rest: R, ms: number = RESULT_FLASH_MS): [R, (result: R) => void] {
  const [shown, setShown] = useState<R>(rest);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(
    (result: R) => {
      setShown(result);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(rest), ms);
    },
    [rest, ms],
  );

  return [shown, show];
}
