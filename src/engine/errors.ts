/**
 * Non-fatal error reporting: logs, and shows a small in-game notice so failures are never silent.
 * Fatal boot errors are handled in main.ts.
 */
/** error/warn: something went wrong; saved: the save badge; news: good news worth a nudge (a job done). */
export type NoticeTone = 'error' | 'warn' | 'saved' | 'news';

let lastMessage = '';
let lastTone: NoticeTone = 'error';
let shownAt = -1;
/** Errors that arrived while an earlier one was still showing (it stays: it's usually the cause). */
let moreErrors = 0;

export function reportError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[SHADOW JOG]', e);
  notice(msg, 'error');
}

/** A short on-screen notice: a warning bar, or the small corner "saved" badge. */
export function notice(text: string, tone: NoticeTone): void {
  // A second error while the first is on screen doesn't replace it: the first is usually the
  // root cause, the rest its fallout. They're counted instead.
  if (tone === 'error' && lastTone === 'error' && currentNotice()) {
    moreErrors++;
    return;
  }
  if (tone === 'error') moreErrors = 0;
  lastMessage = text;
  lastTone = tone;
  shownAt = performance.now();
}

/** The current notice, or null once it has been visible for a while (the saved badge is brief). */
export function currentNotice(): { text: string; tone: NoticeTone } | null {
  const life = lastTone === 'saved' ? 1800 : 6000;
  if (shownAt < 0 || performance.now() - shownAt > life) return null;
  const more = lastTone === 'error' && moreErrors ? ` (+${moreErrors} more)` : '';
  return { text: lastMessage + more, tone: lastTone };
}
