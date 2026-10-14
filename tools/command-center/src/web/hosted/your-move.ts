import type { Snapshot } from '../../github-api/types';
import { LIVE_OFFLINE_AFTER_SECONDS } from '../../shared/live';
import type { YourMoveInfo } from '../../shared/types';
import { type LiveAsk, buildYourMoveItems } from '../../shared/your-move';
import { type LiveRead, clock } from './panels';

// "Your move" on the hosted page (design.md section 5.1). The rule is the one the local page uses (src/shared/your-move.ts); this file only reads the two slots of the
// store. The sources are the same three: the open decision issues and the pull requests of the snapshot, and the live asks of the `live` key.
//
// The live asks show only while the reporter is fresh. A `live` key older than 150 s, a request that failed, a key that is gone and a value that cannot be read all hide EVERY
// live ask, and the list says why ("Reporter offline ..."). A failed reporter never shows old asks.

/** The message of the notice, and the asks, for one state of the reporter. `asks` is empty whenever `message` is not null. */
export function liveAsksOf(read: LiveRead, nowMs: number): { asks: LiveAsk[]; message: string | null } {
  const { live, status, problem } = read;
  const writtenAt = status.state === 'online' || status.state === 'offline' ? status.writtenAt : null;
  const writtenMs = writtenAt === null || writtenAt === '' ? Number.NaN : Date.parse(writtenAt);
  const since = writtenAt === null || writtenAt === '' ? '' : ` since ${clock(writtenAt)}`;

  // 1. A request that failed or a key that is gone or unreadable: the rows may be old, so there are no asks.
  if (status.state === 'error') return { asks: [], message: `Live asks are hidden: ${status.message}` };
  if (status.state === 'not-running') return { asks: [], message: 'Reporter not running. Live asks are hidden.' };
  if (status.state === 'unreadable') return { asks: [], message: `Live asks are hidden: the live value is unreadable (${status.reason}).` };
  // 2. A request that failed after a good one keeps the old value in the store. It is not fresh, and neither is its box.
  if (problem !== null && status.state !== 'offline') return { asks: [], message: `Live asks are hidden: ${problem.message}` };
  // 3. The key is older than 150 s: the state of the reporter from the server, and the same check again here with this page's clock (the page may have been open for a while).
  if (status.state === 'offline' || live === null || Number.isNaN(writtenMs) || nowMs - writtenMs > LIVE_OFFLINE_AFTER_SECONDS * 1000) {
    return { asks: [], message: `Reporter offline${since}. Live asks are hidden.` };
  }

  const asks: LiveAsk[] = live.sessions.flatMap((session) =>
    session.yourMove === null ? [] : [{ sessionId: session.id, title: session.title, lines: session.yourMove.lines, at: session.yourMove.at, light: null }],
  );
  return { asks, message: null };
}

export function buildHostedYourMove(snapshot: Snapshot, read: LiveRead, nowMs: number): YourMoveInfo {
  const { asks, message } = liveAsksOf(read, nowMs);
  const items = buildYourMoveItems({ decisions: snapshot.decisions.open, prs: snapshot.github.open, asks, nowMs });

  // A problem of the snapshot means that a source may be incomplete. The list is still made; the notice says what may be missing.
  const missing: YourMoveInfo['missing'] = [];
  if (snapshot.problems.length > 0) missing.push({ source: 'pr', message: `Snapshot incomplete: ${snapshot.problems[0]?.message ?? 'a part could not be read'}` });
  if (message !== null) missing.push({ source: 'session', message });
  return { items, missing };
}
