import { parseLive } from '../../shared/live';
import type { HttpClient } from './http';
import type { LiveBody } from './map';
import { checkProtection } from './protection';
import type { LiveStore } from './upstash';

// The local reporter (design.md section 11.1): the loop that decides WHEN to write the `live` key, and the guards around every write.
//
// One `tick()` runs each second. It does these steps in this order, and every guard is a reason to do nothing:
//   1. Collect the state (sessions, agents, worktrees) from the server's own sources. This sends nothing.
//   2. Idle exit: 30 minutes with no live shadow-jog session ends the reporter.
//   3. Protection check: the first one must say "protected" before the first write, and then one runs every 10 minutes.
//      A "public" answer stops the reporter for good, after it removes the key.
//   4. Write: when the state changed (at most once in 5 s), or as a beat (at least once in 60 s). The value is checked with `parseLive`
//      right before the write. A value that does not pass is never sent.
//
// Time comes from `deps.now` and the network from `deps.http`/`deps.store`, so a test runs all of this with a fake clock and a fake store.

export const TIMING = {
  /** How often the loop wakes up. */
  tickMs: 1000,
  /** The least time between two writes (design.md section 11.1). */
  minWriteGapMs: 5000,
  /** The most time between two writes while the reporter runs: the beat. */
  beatMs: 60_000,
  /** How often the protection check runs. */
  checkEveryMs: 10 * 60_000,
  /** While no check has said 'protected' yet, the check runs again this often (a network error at the start would otherwise cost 10 minutes). */
  retryCheckMs: 60_000,
  /** The reporter exits after this long with no live shadow-jog session. */
  idleExitMs: 30 * 60_000,
  /** After this many "no answer either way" results in a row (3 checks, 30 minutes), a verified reporter is no longer verified: it removes the key and stops writing. */
  unknownLimit: 3,
} as const;

/** Exit codes. The launcher (scripts/reporter-launch.mjs) reads them: only a crash (any other code) is started again. */
export const EXIT = { idle: 0, public: 3, notConfigured: 4 } as const;

export type ReporterDeps = {
  /** Where the hosted page lives, for the protection check. */
  hostedUrl: string;
  store: LiveStore;
  /** The client for the protection check. It never carries the store token. */
  http: HttpClient;
  /** Milliseconds since 1970. */
  now: () => number;
  /** One log line, without a time (the caller adds it). Never pass a token to it. */
  log: (message: string) => void;
  /** The state to publish now, or null when the sources have not loaded yet. A thrown error is logged and skips the tick. */
  collect: () => Promise<LiveBody | null>;
  /** Called once when the reporter must end the process. */
  onExit: (code: number) => void;
};

export type Reporter = {
  start(): void;
  stop(): void;
  /** One round of the loop. The tests call it with a fake clock. */
  tick(): Promise<void>;
};

export function createReporter(deps: ReporterDeps): Reporter {
  const { store, http, now, log, collect } = deps;
  const startedAt = now();

  let timer: NodeJS.Timeout | null = null;
  let busy = false;
  let ended = false;
  let lastLiveSessionAt = startedAt;
  let lastCheckAt: number | null = null;
  /** True after the first "protected" answer. No write happens before that. */
  let verified = false;
  /** How many checks in a row gave "no answer either way". A "protected" answer sets it to 0. */
  let unknownStreak = 0;
  let lastAttemptAt: number | null = null;
  let lastSuccessAt: number | null = null;
  let lastWrittenSignature: string | null = null;
  let writing: 'unknown' | 'ok' | 'failing' = 'unknown';
  const said = new Set<string>();

  /** Logs a message once, until `forget` is called for it. Keeps a repeating condition to one line. */
  const sayOnce = (key: string, message: string) => {
    if (said.has(key)) return;
    said.add(key);
    log(message);
  };

  function end(code: number): void {
    ended = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    deps.onExit(code);
  }

  async function runProtectionCheck(): Promise<'ok' | 'stop'> {
    lastCheckAt = now();
    const verdict = await checkProtection(http, deps.hostedUrl);
    if (verdict.kind === 'protected') {
      verified = true;
      unknownStreak = 0;
      said.delete('unverified');
      return 'ok';
    }
    if (verdict.kind === 'unknown') {
      unknownStreak += 1;
      if (verified && unknownStreak >= TIMING.unknownLimit) {
        // The page was last confirmed 30 minutes ago. Fail closed: stop writing, remove the key, and check every minute until a "protected" answer.
        verified = false;
        lastWrittenSignature = null;
        log(`protection check: no answer either way ${unknownStreak} times in a row (${verdict.why}). The reporter stops writing and removes the live key until the page is confirmed as protected.`);
        try {
          await store.deleteLive();
          log('the live key was removed');
        } catch (error) {
          log(`the live key could not be removed (${error instanceof Error ? error.message : 'unknown error'}). It expires by itself within 10 minutes.`);
        }
        return 'ok';
      }
      // Before the first "protected" answer that means no write; after it, writes go on until the limit. A line says why.
      log(`protection check: no answer either way (${verdict.why}). It will run again in ${verified ? 10 : 1} minutes.`);
      return 'ok';
    }
    // Public. Stop first, then remove the key. If the removal fails the key still expires in 600 s.
    ended = true;
    log(`protection check: STOP. ${verdict.why}. The reporter stops and removes the live key.`);
    try {
      await store.deleteLive();
      log('the live key was removed');
    } catch (error) {
      log(`the live key could not be removed (${error instanceof Error ? error.message : 'unknown error'}). It expires by itself within 10 minutes.`);
    }
    end(EXIT.public);
    return 'stop';
  }

  async function write(at: number, body: LiveBody, signature: string): Promise<void> {
    lastAttemptAt = at;
    // The gate: nothing is sent unless the contract parser accepts it. What is sent is the parser's own copy of the value, never the raw one.
    const parsed = parseLive({ writtenAt: new Date(at).toISOString(), sessions: body.sessions, worktrees: body.worktrees });
    if (!parsed.ok) {
      sayOnce(`refused:${parsed.reason}`, `refused to write: the live value does not pass the contract (${parsed.reason})`);
      return;
    }
    try {
      await store.setLive(JSON.stringify(parsed.live));
    } catch (error) {
      if (writing !== 'failing') log(`write failed (${error instanceof Error ? error.message : 'unknown error'}). It will try again.`);
      writing = 'failing';
      return;
    }
    if (writing !== 'ok') log(writing === 'failing' ? 'writes work again' : 'publishing started');
    writing = 'ok';
    lastSuccessAt = at;
    lastWrittenSignature = signature;
    said.clear();
  }

  async function tick(): Promise<void> {
    if (ended || busy) return;
    busy = true;
    try {
      // 1. Collect.
      // A failed collect counts as "no state" (null): the idle exit and the protection check below still run, and step 4 sends nothing.
      let body: LiveBody | null = null;
      try {
        body = await collect();
        said.delete('collect-failed');
      } catch (error) {
        sayOnce('collect-failed', `could not collect the state (${error instanceof Error ? error.name : 'unknown error'}). It will try again.`);
      }
      const at = now();

      // 2. Idle exit.
      if (body !== null && body.sessions.length > 0) lastLiveSessionAt = at;
      if (at - lastLiveSessionAt >= TIMING.idleExitMs) {
        log('no live shadow-jog session for 30 minutes. The reporter exits.');
        end(EXIT.idle);
        return;
      }

      // 3. Protection check.
      if (lastCheckAt === null || at - lastCheckAt >= (verified ? TIMING.checkEveryMs : TIMING.retryCheckMs)) {
        if ((await runProtectionCheck()) === 'stop') return;
      }
      if (!verified) {
        sayOnce('unverified', 'not publishing yet: the hosted page is not confirmed as protected.');
        return;
      }

      // 4. Write.
      if (body === null) return;
      const signature = JSON.stringify(body);
      const changed = signature !== lastWrittenSignature;
      const gapOk = lastAttemptAt === null || at - lastAttemptAt >= TIMING.minWriteGapMs;
      const beatDue = lastSuccessAt === null || at - lastSuccessAt >= TIMING.beatMs;
      if (gapOk && (changed || beatDue)) await write(at, body, signature);
    } catch (error) {
      // A bug must not end the loop. The message is the error name only.
      sayOnce('tick-failed', `a round failed (${error instanceof Error ? error.name : 'unknown error'}). The next round runs as usual.`);
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer !== null || ended) return;
      void tick();
      timer = setInterval(() => void tick(), TIMING.tickMs);
    },
    stop() {
      ended = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
