import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLive } from '../src/shared/live';
import { type ReporterDeps, EXIT, TIMING, createReporter } from '../src/server/publish/reporter';
import type { LiveBody } from '../src/server/publish/map';
import { TOKEN, body, fakeHttp, fakeStore, response, row } from './publish-helpers';

// The loop of the reporter with a fake clock, a fake store and a fake network. Each test calls tick() and moves the clock itself.

const PROTECTED = response(401);
const PUBLIC = response(200, JSON.stringify({ reporter: { state: 'online' }, live: null }));

function rig(options: { answers?: Parameters<typeof fakeHttp>; collect?: () => Promise<LiveBody | null>; idleExit?: boolean } = {}) {
  const clock = { t: Date.parse('2026-10-12T09:00:00.000Z') };
  const store = fakeStore();
  const net = fakeHttp(...(options.answers ?? [PROTECTED]));
  const logs: string[] = [];
  const exits: number[] = [];
  let current: LiveBody | null = body();
  const deps: ReporterDeps = {
    hostedUrl: 'https://cc.example.vercel.app',
    store,
    http: net.http,
    now: () => clock.t,
    log: (message) => logs.push(message),
    collect: options.collect ?? (async () => current),
    onExit: (code) => exits.push(code),
    ...(options.idleExit === undefined ? {} : { idleExit: options.idleExit }),
  };
  const reporter = createReporter(deps);
  return {
    reporter,
    store,
    net,
    logs,
    exits,
    clock,
    set: (next: LiveBody | null) => {
      current = next;
    },
    advance: (ms: number) => {
      clock.t += ms;
    },
  };
}

describe('the write schedule', () => {
  it('writes once on the first round, after the protection check says protected, and stamps writtenAt with the clock', async () => {
    const r = rig();
    await r.reporter.tick();
    expect(r.net.calls).toHaveLength(1);
    expect(r.net.calls[0]?.url).toBe('https://cc.example.vercel.app/api/live');
    expect(r.store.sets).toHaveLength(1);
    const parsed = parseLive(JSON.parse(r.store.sets[0] as string));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.live.writtenAt).toBe('2026-10-12T09:00:00.000Z');
  });

  it('writes a change at most once in 5 seconds', async () => {
    const r = rig();
    await r.reporter.tick();
    r.advance(1000);
    r.set(body([row({ title: 'changed' })]));
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1); // 1 s after the last write: held back
    r.advance(3999);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1); // 4.999 s: still held back
    r.advance(1);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(2); // 5 s: the change goes out
    expect(JSON.parse(r.store.sets[1] as string).sessions[0].title).toBe('changed');
  });

  it('writes at most 12 times in a minute when the state changes every second', async () => {
    const r = rig();
    for (let second = 0; second < 60; second++) {
      r.set(body([row({ title: `t${second}` })]));
      await r.reporter.tick();
      r.advance(1000);
    }
    expect(r.store.sets.length).toBeLessThanOrEqual(12);
    expect(r.store.sets.length).toBeGreaterThanOrEqual(10);
  });

  it('sends nothing for an unchanged state until 60 seconds pass, then sends the beat', async () => {
    const r = rig();
    await r.reporter.tick();
    r.advance(TIMING.beatMs - 1);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
    r.advance(1);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(2);
    expect(JSON.parse(r.store.sets[1] as string).writtenAt).toBe(new Date(r.clock.t).toISOString());
  });

  it('retries a failed write after 5 seconds, logs the failure once, and says when writes work again', async () => {
    const r = rig();
    r.store.failWrites = true;
    await r.reporter.tick();
    r.advance(1000);
    await r.reporter.tick(); // too soon to retry
    r.advance(4000);
    await r.reporter.tick(); // retry, fails again
    expect(r.logs.filter((line) => line.startsWith('write failed'))).toHaveLength(1);
    expect(r.store.sets).toHaveLength(0);
    r.store.failWrites = false;
    r.advance(5000);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
    expect(r.logs).toContain('writes work again');
  });

  it('skips the round when the sources are not ready (collect gives null) and sends nothing', async () => {
    const r = rig({ collect: async () => null });
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(0);
  });
});

describe('the parseLive gate', () => {
  it('refuses to write a value that does not pass parseLive, and logs the reason once', async () => {
    const bad = { sessions: [{ ...row(), state: 'sleeping' }], worktrees: [] } as unknown as LiveBody;
    const r = rig({ collect: async () => bad });
    await r.reporter.tick();
    r.advance(6000);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(0);
    expect(r.logs.filter((line) => line.startsWith('refused to write'))).toHaveLength(1);
  });

  it('sends the parser copy of the value: a field the contract does not name is dropped', async () => {
    const sneaky = { sessions: [{ ...row(), messageText: 'SECRET PROMPT' }], worktrees: [{ path: 'C:/w', branch: null, dirty: 0, fileBody: 'SECRET FILE' }] } as unknown as LiveBody;
    const r = rig({ collect: async () => sneaky });
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
    expect(r.store.sets[0]).not.toContain('SECRET');
  });
});

describe('the protection check', () => {
  it('writes nothing before the first answer says protected, and asks again after a minute', async () => {
    const r = rig({ answers: [response(503), PROTECTED] });
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(0);
    r.advance(30_000);
    await r.reporter.tick(); // too soon for another check
    expect(r.net.calls).toHaveLength(1);
    expect(r.store.sets).toHaveLength(0);
    r.advance(30_000);
    await r.reporter.tick();
    expect(r.net.calls).toHaveLength(2);
    expect(r.store.sets).toHaveLength(1);
  });

  it('treats a redirect to the Vercel login as protected', async () => {
    const r = rig({ answers: [response(307, '', 'https://vercel.com/sso-api?url=x')] });
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
  });

  it('stops for good on a public page: removes the key, writes nothing more, and exits with code 3', async () => {
    const r = rig({ answers: [PROTECTED, PUBLIC] });
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
    r.advance(TIMING.checkEveryMs);
    r.set(body([row({ title: 'newer' })]));
    await r.reporter.tick();
    expect(r.store.deletes).toBe(1);
    expect(r.store.sets).toHaveLength(1); // no write after the verdict, though the state changed
    expect(r.exits).toEqual([EXIT.public]);
    expect(r.logs.some((line) => line.includes('STOP'))).toBe(true);
    r.advance(60_000);
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
    expect(r.store.deletes).toBe(1);
  });

  it('never writes at all when the very first check finds a public page', async () => {
    const r = rig({ answers: [PUBLIC] });
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(0);
    expect(r.store.deletes).toBe(1);
    expect(r.exits).toEqual([EXIT.public]);
  });

  it('checks again every 10 minutes', async () => {
    const r = rig();
    await r.reporter.tick();
    r.advance(TIMING.checkEveryMs - 1);
    await r.reporter.tick();
    expect(r.net.calls).toHaveLength(1);
    r.advance(1);
    await r.reporter.tick();
    expect(r.net.calls).toHaveLength(2);
  });

  it.each([
    ['a 5xx', response(502)],
    ['a network error', new TypeError('fetch failed')],
    ['a timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
  ])('changes nothing on %s after the page was confirmed protected: it keeps publishing and keeps the key', async (_label, failure) => {
    const r = rig({ answers: [PROTECTED, failure] });
    await r.reporter.tick();
    r.advance(TIMING.checkEveryMs);
    r.set(body([row({ title: 'later' })]));
    await r.reporter.tick();
    expect(r.net.calls).toHaveLength(2);
    expect(r.store.deletes).toBe(0);
    expect(r.exits).toEqual([]);
    expect(r.store.sets).toHaveLength(2);
  });

  it('fails closed after 3 "no answer" results in a row: it removes the key, stops writing, and checks every minute until a "protected" answer', async () => {
    const r = rig({ answers: [PROTECTED, response(503), response(503), response(503), response(503), PROTECTED] });
    await r.reporter.tick(); // protected: the first write
    expect(r.store.sets).toHaveLength(1);
    for (const count of [1, 2]) {
      r.advance(TIMING.checkEveryMs);
      r.set(body([row({ title: `unknown ${count}` })]));
      await r.reporter.tick();
      expect(r.store.sets).toHaveLength(1 + count); // one or two "no answer" results: still publishing
      expect(r.store.deletes).toBe(0);
    }
    r.advance(TIMING.checkEveryMs);
    r.set(body([row({ title: 'unknown 3' })]));
    await r.reporter.tick(); // the third in a row: stop
    expect(r.store.deletes).toBe(1);
    expect(r.store.sets).toHaveLength(3);
    expect(r.exits).toEqual([]);
    r.advance(TIMING.beatMs);
    r.set(body([row({ title: 'after the stop' })]));
    await r.reporter.tick(); // the check runs again after 1 minute, not 10: still no answer, still no write
    expect(r.net.calls).toHaveLength(5);
    expect(r.store.sets).toHaveLength(3);
    r.advance(TIMING.retryCheckMs);
    await r.reporter.tick(); // a "protected" answer: writing starts again
    expect(r.net.calls).toHaveLength(6);
    expect(r.store.sets).toHaveLength(4);
  });

  it('a "protected" answer resets the count of "no answer" results', async () => {
    const r = rig({ answers: [PROTECTED, response(503), response(503), PROTECTED, response(503), response(503)] });
    await r.reporter.tick();
    for (let i = 0; i < 5; i++) {
      r.advance(TIMING.checkEveryMs);
      r.set(body([row({ title: `round ${i}` })]));
      await r.reporter.tick();
    }
    expect(r.net.calls).toHaveLength(6);
    expect(r.store.deletes).toBe(0);
    expect(r.store.sets).toHaveLength(6);
  });

  it('sends the check with no cookie, no authorization header and no token', async () => {
    const r = rig();
    await r.reporter.tick();
    const request = r.net.calls[0]?.request;
    expect(request?.method).toBe('GET');
    const names = Object.keys(request?.headers ?? {}).map((name) => name.toLowerCase());
    expect(names).not.toContain('authorization');
    expect(names).not.toContain('cookie');
    expect(JSON.stringify(r.net.calls)).not.toContain(TOKEN);
  });
});

describe('the idle exit', () => {
  it('with idleExit false (a start by hand) there is no exit after hours with no live session, and the reporter still publishes and checks', async () => {
    const r = rig({ idleExit: false });
    r.set(body([]));
    await r.reporter.tick();
    for (let hour = 0; hour < 3; hour++) {
      r.advance(TIMING.idleExitMs * 2);
      await r.reporter.tick();
    }
    expect(r.exits).toEqual([]);
    expect(r.store.sets.length).toBeGreaterThan(1); // the beat goes on
    expect(r.net.calls.length).toBeGreaterThan(1); // the protection check goes on
  });

  it('with idleExit false the protection rule still stops the reporter when the page is public (code 3)', async () => {
    const r = rig({ idleExit: false, answers: [PUBLIC] });
    await r.reporter.tick();
    expect(r.exits).toEqual([EXIT.public]);
  });

  it('exits with code 0 after 30 minutes with no live session, and not before', async () => {
    const r = rig();
    r.set(body([]));
    await r.reporter.tick();
    r.advance(TIMING.idleExitMs - 1000);
    await r.reporter.tick();
    expect(r.exits).toEqual([]);
    r.advance(1000);
    await r.reporter.tick();
    expect(r.exits).toEqual([EXIT.idle]);
  });

  it('counts the 30 minutes from the last time a session was live', async () => {
    const r = rig();
    await r.reporter.tick(); // a session is live now
    r.advance(25 * 60_000);
    await r.reporter.tick(); // still live at minute 25
    r.set(body([]));
    r.advance(29 * 60_000);
    await r.reporter.tick();
    expect(r.exits).toEqual([]);
    r.advance(60_000);
    await r.reporter.tick();
    expect(r.exits).toEqual([EXIT.idle]);
  });

  it('a session that comes back resets the 30 minutes', async () => {
    const r = rig();
    r.set(body([]));
    await r.reporter.tick();
    r.advance(29 * 60_000);
    r.set(body());
    await r.reporter.tick();
    r.set(body([]));
    r.advance(29 * 60_000);
    await r.reporter.tick();
    expect(r.exits).toEqual([]);
  });
});

describe('a collect that always throws', () => {
  it('still reaches the idle exit after 30 minutes', async () => {
    const r = rig({
      collect: async () => {
        throw new Error('the sources are broken');
      },
    });
    await r.reporter.tick();
    r.advance(TIMING.idleExitMs - 1000);
    await r.reporter.tick();
    expect(r.exits).toEqual([]);
    r.advance(1000);
    await r.reporter.tick();
    expect(r.exits).toEqual([EXIT.idle]);
    expect(r.store.sets).toHaveLength(0);
  });
});

describe('logs', () => {
  it('never contain the token (the token is not given to the reporter loop at all)', async () => {
    const r = rig({ answers: [response(503)] });
    r.store.failWrites = true;
    await r.reporter.tick();
    expect(r.logs.join('\n')).not.toContain(TOKEN);
  });
});

// F4: a normal end removes the live key, so the page does not show ended sessions as live for up to 10 minutes.
describe('the live key on a normal end', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the idle exit removes the key BEFORE it asks the process to exit', async () => {
    const r = rig();
    let exitsWhenDeleted = -1;
    const original = r.store.deleteLive;
    r.store.deleteLive = async () => {
      exitsWhenDeleted = r.exits.length;
      await original();
    };
    r.set(body([]));
    await r.reporter.tick(); // a write happens: the key exists now
    expect(r.store.sets).toHaveLength(1);
    r.advance(TIMING.idleExitMs);
    await r.reporter.tick();
    expect(r.exits).toEqual([EXIT.idle]);
    expect(r.store.deletes).toBe(1);
    expect(exitsWhenDeleted).toBe(0); // the delete ran while no exit had been asked for yet
  });

  it('stop (SIGINT, SIGTERM) removes the key once, however often it is called', async () => {
    const r = rig();
    await r.reporter.tick();
    expect(r.store.sets).toHaveLength(1);
    await r.reporter.stop();
    await r.reporter.stop();
    expect(r.store.deletes).toBe(1);
    expect(r.logs.some((line) => line.includes('the live key was removed'))).toBe(true);
  });

  it('stop removes nothing when this reporter never wrote (it never touches a key that is not its own)', async () => {
    const r = rig({ answers: [response(503)] }); // never verified, so never writes
    await r.reporter.tick();
    await r.reporter.stop();
    expect(r.store.sets).toHaveLength(0);
    expect(r.store.deletes).toBe(0);
  });

  it('after the idle exit has removed the key, the stop that follows does not remove it again', async () => {
    const r = rig();
    r.set(body([]));
    await r.reporter.tick();
    r.advance(TIMING.idleExitMs);
    await r.reporter.tick();
    await r.reporter.stop();
    expect(r.store.deletes).toBe(1);
  });

  it('a failed removal is logged and does not throw; the exit still happens', async () => {
    const r = rig();
    r.set(body([]));
    await r.reporter.tick();
    r.store.deleteLive = async () => {
      throw new Error('the store answered with status 500');
    };
    r.advance(TIMING.idleExitMs);
    await r.reporter.tick();
    expect(r.exits).toEqual([EXIT.idle]);
    expect(r.logs.some((line) => line.includes('could not be removed') && line.includes('status 500'))).toBe(true);
  });

  it('a store that never answers cannot keep the process from exiting: the removal is cut off after exitDeleteMs', async () => {
    vi.useFakeTimers();
    const r = rig();
    r.set(body([]));
    await r.reporter.tick();
    r.store.deleteLive = () => new Promise<void>(() => {});
    r.advance(TIMING.idleExitMs);
    const round = r.reporter.tick();
    await vi.advanceTimersByTimeAsync(TIMING.exitDeleteMs - 1);
    expect(r.exits).toEqual([]); // still waiting
    await vi.advanceTimersByTimeAsync(2);
    await round;
    expect(r.exits).toEqual([EXIT.idle]);
    expect(r.logs.some((line) => line.includes('could not be removed') && line.includes('timed out'))).toBe(true);
  });

  it('stop with a store that never answers returns after exitDeleteMs', async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.reporter.tick();
    r.store.deleteLive = () => new Promise<void>(() => {});
    const stopped = r.reporter.stop();
    await vi.advanceTimersByTimeAsync(TIMING.exitDeleteMs + 1);
    await stopped;
    expect(r.logs.some((line) => line.includes('timed out'))).toBe(true);
  });
});
