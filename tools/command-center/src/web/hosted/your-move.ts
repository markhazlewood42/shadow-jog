import type { Snapshot } from '../../github-api/types';
import { LIVE_OFFLINE_AFTER_SECONDS } from '../../shared/live';
import type { YourMoveInfo } from '../../shared/types';
import { FUTURE_SLACK_MS, type LiveAsk, buildYourMoveItems } from '../../shared/your-move';
import { type LiveRead, clock } from './panels';

// "Your move" on the hosted page (design.md section 5.1). The rule is the one the local page uses (src/shared/your-move.ts); this file only reads the two slots of the
// store. The sources are the same two: the open decision issues of the snapshot, and the live asks of the `live` key.
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
  //    A key written more than a minute in the future is offline too: its age is negative, so "older than 150 s" never holds, and a wrong clock would show asks for ever.
  if (status.state === 'offline' || live === null || Number.isNaN(writtenMs) || nowMs - writtenMs > LIVE_OFFLINE_AFTER_SECONDS * 1000 || nowMs - writtenMs < -FUTURE_SLACK_MS) {
    return { asks: [], message: `Reporter offline${since}. Live asks are hidden.` };
  }

  const asks: LiveAsk[] = live.sessions.flatMap((session) =>
    session.yourMove === null ? [] : [{ sessionId: session.id, title: session.title, lines: session.yourMove.lines, at: session.yourMove.at, light: null }],
  );
  return { asks, message: null };
}

export function buildHostedYourMove(snapshot: Snapshot, read: LiveRead, nowMs: number): YourMoveInfo {
  const { asks, message } = liveAsksOf(read, nowMs);
  const items = buildYourMoveItems({ decisions: snapshot.decisions.open, asks, nowMs });

  const missing: YourMoveInfo['missing'] = [];
  // A problem of the snapshot means that a source may be incomplete. The list is still made; the notice names the source that may be missing items. Only a problem of the
  // decision issues (`decision...`) touches this list. A problem about pull requests (a cut or partial list), branches or workstream files does not: the list holds no
  // pull request, so it is not named here.
  const problem = snapshot.problems.find((candidate) => candidate.code.startsWith('decision'));
  if (problem !== undefined) {
    missing.push({ source: 'decision-issue', message: `Snapshot incomplete: ${problem.message}` });
  }
  if (message !== null) missing.push({ source: 'session', message });
  return { items, missing };
}
