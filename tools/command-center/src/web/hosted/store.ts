import type { Snapshot } from '../../github-api/types';
import type { LiveAnswer } from '../../hosted/live';
import type { ChangeEvent, ModuleName } from '../../shared/types';
import { type FetchFn, type HostedError, badResponse, fetchHostedJson } from './fetch';
import { type Poller, type VisibilitySource, createPoller, documentVisibility } from './poller';

// The data of the hosted page: two slots, one for `/api/snapshot` and one for `/api/live`. The store fetches them (once on demand, and then on a poll while
// someone listens), keeps the last good answer of each, and tells the listeners which modules changed. It is the hosted replacement of the event stream:
// the panels already reload when a module "changed", so they need no change of their own (see api.ts).

export const SNAPSHOT_URL = '/api/snapshot';
export const LIVE_URL = '/api/live';
/** Design.md section 4.3: the snapshot is polled every 15 s and the live key every 10 s. */
export const SNAPSHOT_INTERVAL_MS = 15_000;
export const LIVE_INTERVAL_MS = 10_000;

/** The modules whose panels are made from the snapshot, and from the live key. A change of a slot reloads the panels that listen to these. */
export const SNAPSHOT_MODULES: readonly ModuleName[] = ['github', 'ci', 'git', 'status', 'decisions'];
export const LIVE_MODULES: readonly ModuleName[] = ['agents', 'sessions'];

/** The state of the connection, as the "Live" label of the Now page shows it. */
export type HostedConnection = 'connecting' | 'live' | 'offline';

/** What one slot holds. `data` is the last good answer and stays when a later poll fails. `at` is when that answer arrived. */
export type Slot<T> = { data: T | null; at: string | null; error: HostedError | null; loaded: boolean };

export type HostedEvent = { type: 'connection'; state: HostedConnection } | { type: 'changed'; event: ChangeEvent } | { type: 'status' };

export type HostedStore = {
  snapshot(): Slot<Snapshot>;
  live(): Slot<LiveAnswer>;
  /** Fetches a slot now. A request that arrives while one is in flight shares it. */
  load(kind: 'snapshot' | 'live'): Promise<void>;
  /**
   * Makes sure that a slot has been fetched. It loads when nothing has loaded yet. When the last try failed, it loads again only after the poll interval of the slot has passed
   * (so a failing endpoint is asked about once an interval, however many panels ask), or when `allowRetry` was called (the Retry button).
   */
  ensure(kind: 'snapshot' | 'live'): Promise<void>;
  /** The person pressed Retry: for the next 2 s an errored slot loads again at once. */
  allowRetry(): void;
  /** Listens to changes. The first listener starts the polls, the last one stops them. The listener is told the connection at once. */
  subscribe(listener: (event: HostedEvent) => void): () => void;
  connection(): HostedConnection;
  /** True while the last answer of either slot said that the login is gone. */
  loginExpired(): boolean;
};

export type StoreDeps = {
  fetchImpl?: FetchFn;
  now?: () => Date;
  visibility?: VisibilitySource;
  snapshotIntervalMs?: number;
  liveIntervalMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The fields of a snapshot that the page reads. The adapter is tested on its side: this is only the guard against an answer that is not a snapshot at all. */
export function looksLikeSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;
  const { github, decisions, ci, main } = value;
  return (
    typeof value.at === 'string' &&
    Array.isArray(value.branches) &&
    Array.isArray(value.workstreams) &&
    Array.isArray(value.problems) &&
    isRecord(github) &&
    Array.isArray(github.open) &&
    Array.isArray(github.merged) &&
    isRecord(decisions) &&
    Array.isArray(decisions.open) &&
    Array.isArray(decisions.recent) &&
    isRecord(ci) &&
    isRecord(main)
  );
}

export function looksLikeLiveAnswer(value: unknown): value is LiveAnswer {
  return isRecord(value) && isRecord(value.reporter) && typeof value.reporter.state === 'string' && 'live' in value;
}

/**
 * What identifies a snapshot for the "did it change" test. The time it was made (`at`) and what the calls cost (`cost`: the rate-limit counters) change on every answer, so they stay out.
 * Checked against `Snapshot` (src/github-api/types.ts) and the shared types: no other field is volatile. Every other time in it (`updatedAt`, `mergedAt`, `createdAt`, a branch `date`) is the
 * time of an event on GitHub, so a change of it is a real change. There is no relative age ("3 min ago") in the snapshot: the page makes those from its own clock. The lists that depend on
 * the clock (merged in the last 7 days, answered in the last week, merged less than 14 days ago) change when a row falls out of the window, which is a real change too.
 */
function snapshotKey(snapshot: Snapshot): string {
  return JSON.stringify({ ...snapshot, at: null, cost: null });
}

/** What identifies a live answer: the reporter state and the value. The age in seconds moves on every answer, so it stays out. */
function liveKey(answer: LiveAnswer): string {
  return JSON.stringify({ state: answer.reporter.state, live: answer.live });
}

const emptySlot = <T>(): Slot<T> => ({ data: null, at: null, error: null, loaded: false });

export function createHostedStore(deps: StoreDeps = {}): HostedStore {
  const fetchImpl = deps.fetchImpl;
  const now = deps.now ?? (() => new Date());
  const visibility = deps.visibility ?? documentVisibility;

  const slots = { snapshot: emptySlot<Snapshot>(), live: emptySlot<LiveAnswer>() };
  const keys = { snapshot: '', live: '' };
  const intervals = { snapshot: deps.snapshotIntervalMs ?? SNAPSHOT_INTERVAL_MS, live: deps.liveIntervalMs ?? LIVE_INTERVAL_MS };
  /** When each slot was last asked for (ms), by the poll or by a panel. */
  const lastTry = { snapshot: Number.NEGATIVE_INFINITY, live: Number.NEGATIVE_INFINITY };
  let retryUntil = Number.NEGATIVE_INFINITY;
  const inFlight: { snapshot: Promise<void> | null; live: Promise<void> | null } = { snapshot: null, live: null };
  const listeners = new Set<(event: HostedEvent) => void>();
  let pollers: Poller[] = [];
  let lastConnection: HostedConnection = 'connecting';
  let lastLogin = false;

  function emit(event: HostedEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  function modulesChanged(modules: readonly ModuleName[]): void {
    const at = now().toISOString();
    for (const module of modules) emit({ type: 'changed', event: { module, at } });
  }

  function connection(): HostedConnection {
    if (!slots.snapshot.loaded && !slots.live.loaded) return 'connecting';
    // A failed request of either slot is a lost connection. A reporter that is offline is not: that answer arrived.
    return slots.snapshot.error !== null || slots.live.error !== null ? 'offline' : 'live';
  }

  const loginExpired = (): boolean => slots.snapshot.error?.kind === 'login' || slots.live.error?.kind === 'login';

  function announceState(): void {
    const state = connection();
    if (state !== lastConnection) {
      lastConnection = state;
      emit({ type: 'connection', state });
    }
    const login = loginExpired();
    if (login !== lastLogin) {
      lastLogin = login;
      emit({ type: 'status' });
    }
  }

  async function loadSnapshot(): Promise<void> {
    const result = await fetchHostedJson<unknown>(SNAPSHOT_URL, fetchImpl);
    const slot = slots.snapshot;
    const before = slot.error?.code ?? null;
    slot.loaded = true;
    if (!result.ok) {
      slot.error = result.error;
    } else if (!looksLikeSnapshot(result.data)) {
      slot.error = badResponse('snapshot');
    } else {
      const key = snapshotKey(result.data);
      const changed = key !== keys.snapshot || slot.error !== null;
      keys.snapshot = key;
      slot.data = result.data;
      slot.at = now().toISOString();
      slot.error = null;
      announceState();
      if (changed) modulesChanged(SNAPSHOT_MODULES);
      return;
    }
    announceState();
    // A new kind of error (or the first one) reloads the panels, so they show it above the last good data. The same error again changes nothing.
    if (slot.error?.code !== before) modulesChanged(SNAPSHOT_MODULES);
  }

  async function loadLive(): Promise<void> {
    const result = await fetchHostedJson<unknown>(LIVE_URL, fetchImpl);
    const slot = slots.live;
    const before = slot.error?.code ?? null;
    slot.loaded = true;
    if (!result.ok) {
      slot.error = result.error;
    } else if (!looksLikeLiveAnswer(result.data)) {
      slot.error = badResponse('live');
    } else {
      const key = liveKey(result.data);
      const changed = key !== keys.live || slot.error !== null;
      keys.live = key;
      slot.data = result.data;
      slot.at = now().toISOString();
      slot.error = null;
      announceState();
      if (changed) modulesChanged(LIVE_MODULES);
      return;
    }
    announceState();
    if (slot.error?.code !== before) modulesChanged(LIVE_MODULES);
  }

  function load(kind: 'snapshot' | 'live'): Promise<void> {
    const running = inFlight[kind];
    if (running !== null) return running;
    lastTry[kind] = now().getTime();
    const task = (kind === 'snapshot' ? loadSnapshot() : loadLive()).finally(() => {
      inFlight[kind] = null;
    });
    inFlight[kind] = task;
    return task;
  }

  function ensure(kind: 'snapshot' | 'live'): Promise<void> {
    const slot = slots[kind];
    if (slot.loaded && slot.error === null) return Promise.resolve();
    const at = now().getTime();
    // An errored slot is not asked again before its interval has passed, unless the person pressed Retry. The panels then show the error that is already known.
    if (slot.error !== null && inFlight[kind] === null && at >= retryUntil && at - lastTry[kind] < intervals[kind]) return Promise.resolve();
    return load(kind);
  }

  function allowRetry(): void {
    retryUntil = now().getTime() + 2_000;
  }

  function startPollers(): void {
    pollers = [
      createPoller({ run: () => load('snapshot'), intervalMs: intervals.snapshot, visibility }),
      createPoller({ run: () => load('live'), intervalMs: intervals.live, visibility }),
    ];
    for (const poller of pollers) poller.start();
  }

  function stopPollers(): void {
    for (const poller of pollers) poller.stop();
    pollers = [];
  }

  return {
    snapshot: () => slots.snapshot,
    live: () => slots.live,
    load,
    ensure,
    allowRetry,
    connection,
    loginExpired,
    subscribe(listener) {
      listeners.add(listener);
      listener({ type: 'connection', state: connection() });
      if (listeners.size === 1) startPollers();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopPollers();
      };
    },
  };
}

/** The store of the page. */
export const hostedStore: HostedStore = createHostedStore();
