/**
 * A small typed event emitter with Phaser's names: `on`, `once`, `off`, `emit`.
 * Phaser: `Phaser.Events.EventEmitter`. The third argument is Phaser's `context`.
 *
 * Why the arrays are never changed in place: a listener may call `off` (or `on`) while an event
 * is being emitted. Each change builds a new array, so `emit` can walk the array it started with
 * and never skips or repeats a listener. `emit` itself allocates nothing, so it is safe in a tick.
 */

// biome-ignore lint/suspicious/noExplicitAny: an event map holds functions with any argument list; each call site is typed through `M`.
type AnyFn = (...args: any[]) => void;

interface Listener {
  fn: AnyFn;
  ctx: unknown;
  once: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: same reason as AnyFn. This form also accepts an interface such as SceneEvents.
export class EventEmitter<M extends { [K in keyof M]: (...a: any[]) => void } = Record<string, AnyFn>> {
  private listeners = new Map<keyof M, readonly Listener[]>();

  on<K extends keyof M>(event: K, fn: M[K], ctx?: unknown): this {
    return this.add(event, fn, ctx, false);
  }

  once<K extends keyof M>(event: K, fn: M[K], ctx?: unknown): this {
    return this.add(event, fn, ctx, true);
  }

  /** Remove listeners. No `fn`: every listener of the event. With `fn` (and `ctx`): only the matching ones. */
  off<K extends keyof M>(event: K, fn?: M[K], ctx?: unknown): this {
    const list = this.listeners.get(event);
    if (!list) return this;
    this.set(event, fn ? list.filter((l) => l.fn !== fn || (ctx !== undefined && l.ctx !== ctx)) : []);
    return this;
  }

  /** Call every listener of `event`, in the order they were added. Returns true if there was one. */
  emit<K extends keyof M>(event: K, ...args: Parameters<M[K]>): boolean {
    const list = this.listeners.get(event);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (!l) continue;
      // A once-listener is removed BEFORE it runs, so an emit inside it cannot call it twice.
      if (l.once) this.set(event, (this.listeners.get(event) ?? []).filter((x) => x !== l));
      l.fn.apply(l.ctx, args);
    }
    return true;
  }

  listenerCount(event: keyof M): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /** Drop every listener of every event. A scene calls this at shutdown, so nothing outlives it. */
  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  private add<K extends keyof M>(event: K, fn: M[K], ctx: unknown, once: boolean): this {
    this.set(event, [...(this.listeners.get(event) ?? []), { fn, ctx, once }]);
    return this;
  }

  /** Store a list, or forget the event when the list is empty. */
  private set(event: keyof M, list: readonly Listener[]): void {
    if (list.length) this.listeners.set(event, list);
    else this.listeners.delete(event);
  }
}
