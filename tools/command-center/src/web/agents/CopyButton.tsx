import { AlertCircle, Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// The small Copy button of a box on the Agents page (design 5.4, revision 2). A web page cannot open a file: address, so a box does not link to its file: the button copies the
// path of the file to the clipboard, and the person pastes it where it is needed. The icon says what happened, for 2 seconds, and then the button is ready again.

/** How long the button shows the result of a copy before it goes back to the copy icon. */
const RESULT_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

const ICONS = { idle: Copy, copied: Check, failed: AlertCircle } as const;

/**
 * A button that copies `path`. Its name is always "Copy path" (a screen reader says the title of the box before it, because the button is inside the box's group). After a copy
 * the icon is a check; when the browser refuses it is an alert icon and the label "Copy failed" next to it. The result is also in a status region that is on the page from the
 * start, so that a screen reader says it: a region that is added together with its words is often not read.
 */
export function CopyButton({ path }: { path: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A timer must not outlive its button: when a box leaves the page, its timer is stopped.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    let result: CopyState;
    try {
      // The clipboard belongs to the browser. A page may use it only when it is a secure page (https, or localhost, which this one is) and the person lets it. The browser says
      // no by rejecting the call, or by having no `navigator.clipboard` at all, which throws here too. Either way the button says so, and never says "Copied" for a copy that did not happen.
      await navigator.clipboard.writeText(path);
      result = 'copied';
    } catch {
      result = 'failed';
    }
    setState(result);
    // A second copy starts the 2 seconds again.
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), RESULT_MS);
  }

  const Icon = ICONS[state];
  const words = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : '';
  return (
    <span className="-my-1 flex shrink-0 items-center gap-1">
      {/* The label is seen only when the copy failed. After a copy the check is enough for the eye, and the words are for a screen reader. */}
      <span role="status" className={state === 'failed' ? 'text-xs leading-4 whitespace-nowrap text-cc-ink' : 'sr-only'}>
        {words}
      </span>
      <button
        type="button"
        aria-label="Copy path"
        data-copy={state}
        onClick={() => void copy()}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-rule hover:text-cc-ink cc-focus-ring"
      >
        <Icon aria-hidden className={`size-3.5 ${state === 'idle' ? '' : 'text-cc-ink'}`} />
      </button>
    </span>
  );
}
