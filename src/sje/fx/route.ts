/**
 * Routing: make the `postfx` module singleton of the old engine (src/engine/postfx.ts) hand every call to the `FxSystem` of the new engine
 * (docs/engine/m2-brief.md task 7). The scenes, `moments.ts`, `battlekit/gpufx.ts` and `src/boot.ts` import `postfx` and call it. They stay as
 * they are: under `?engine=sje` `src/sje/boot.ts` calls `routePostfx` once, and from then on `postfx.shock(...)` is `game.fx.shock(...)`.
 *
 * Why this works with no change to the old file: `PostFx` and `FxSystem` both extend `FxState`, so they have the same shape. The state is plain
 * fields (own properties of the `postfx` object), the methods and the `ui` / `glow` accessors sit on the `FxState` prototype. Each one is
 * replaced on the `postfx` object by a property that reads, writes or calls the same name on the target. The target's own override wins, so
 * `postfx.update()` ages the delayed moment layers too (`FxSystem.update`) and `postfx.ui` marks the UI layer as touched (`FxSystem.ui`).
 *
 * `update()` runs once per tick, called by the game's ticker (src/boot.ts) through `postfx`. The `Game` of the new engine does not call it
 * as well: that would age every effect twice (fxsystem.ts header).
 *
 * Follows: nothing in Phaser. Ours (a seam of the migration; it goes at M6 when the old `postfx` goes).
 */
import type { FxState } from './fxstate';

type Anything = Record<string, unknown>;

/** The names of the state fields and the methods that `FxState` gives to both paths. */
function sharedNames(local: FxState): string[] {
  const names = new Set<string>(Object.keys(local));
  for (let p = Object.getPrototypeOf(local) as object | null; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as object | null) {
    for (const n of Object.getOwnPropertyNames(p)) if (n !== 'constructor') names.add(n);
  }
  return [...names];
}

/** Is `name` a method on this object (looked up along the prototype chain, without reading any accessor)? */
function isMethod(obj: object, name: string): boolean {
  for (let o: object | null = obj; o; o = Object.getPrototypeOf(o) as object | null) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d) return typeof d.value === 'function';
  }
  return false;
}

/**
 * Point `local` (the `postfx` singleton) at the effects system that `target()` returns. `target` is a function so the routing follows a
 * replaced system. Returns the undo: the original fields and methods come back (a test, and the day the old path takes over again).
 */
export function routePostfx(local: FxState, target: () => FxState): () => void {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const first = target();
  for (const name of sharedNames(local)) {
    saved.set(name, Object.getOwnPropertyDescriptor(local, name));
    if (isMethod(first, name)) {
      Object.defineProperty(local, name, {
        configurable: true,
        enumerable: false,
        value: (...args: unknown[]): unknown => {
          const t = target();
          return ((t as unknown as Record<string, (...a: unknown[]) => unknown>)[name] as (...a: unknown[]) => unknown).apply(t, args);
        },
      });
    } else {
      Object.defineProperty(local, name, {
        configurable: true,
        enumerable: true,
        get: () => (target() as unknown as Anything)[name],
        set: (v: unknown) => {
          (target() as unknown as Anything)[name] = v;
        },
      });
    }
  }
  return () => {
    for (const [name, d] of saved) {
      if (d) Object.defineProperty(local, name, d);
      else delete (local as unknown as Anything)[name];
    }
  };
}
