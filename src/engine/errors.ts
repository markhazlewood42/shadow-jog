/**
 * Non-fatal error reporting: logs, and shows a small in-game notice so failures are never silent.
 * Fatal boot errors are handled in main.ts.
 */
let lastMessage = '';
let shownAt = -1;
let listeners: ((msg: string) => void)[] = [];

export function reportError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[SHADOW JOG]', e);
  lastMessage = msg;
  shownAt = performance.now();
  for (const l of listeners) l(msg);
}

export function onError(fn: (msg: string) => void): void {
  listeners.push(fn);
}

export function clearErrorListeners(): void {
  listeners = [];
}

/** The current notice text, or null once it has been visible for a while. */
export function currentNotice(): string | null {
  if (shownAt < 0 || performance.now() - shownAt > 6000) return null;
  return lastMessage;
}
