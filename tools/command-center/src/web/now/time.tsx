import { useEffect, useState } from 'react';

// How the Now page says "how long": the time that a thing has run, and how long ago something happened. A dashboard is read at a glance, so both are
// short ("12 min", "3 h ago"), and the exact moment stays in the page as a <time> element for anyone who wants it.

/** How long a thing ran or has been running, in the two biggest units that matter: "45 s", "12 min", "3 h 5 min", "2 d 4 h". A negative length (two clocks that differ) is 0. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/** How long ago a time was, as "just now", "12 min ago", "3 h ago" or "2 d ago". A time that is not a time is shown as it is, and a time ahead of the clock is "just now". */
export function formatAge(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const minutes = Math.floor((nowMs - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/**
 * The time now, as milliseconds, and the page draws again every `everyMs` so that a "12 min ago" does not stand still. (A panel loads again when its data
 * changes, but an age changes with the clock and not with the data.)
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** An age as a <time> element: short words on the page, and the exact moment (in the person's own time zone) in the tooltip and in `dateTime`. */
export function Age({ iso, now }: { iso: string; now: number }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={Number.isNaN(date.getTime()) ? iso : date.toLocaleString()}>
      {formatAge(iso, now)}
    </time>
  );
}
