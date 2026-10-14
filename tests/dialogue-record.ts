/**
 * A fake `ScriptApi` that records every dialogue box a story script opens (M8a, the shop and dialogue move).
 *
 * It records what `DialogScene` would be given, in one shape for every way a script can ask for a box:
 * `say`, `narrate` and `ask` (the old calls, with the text in the script) and `line` and `choose` (the new calls, with the text in
 * `dialogue.json`). So a run of the old chapter 1 and a run of the new one can be compared line by line.
 * `resolve` is how a `line` or `choose` call turns into a box; the test passes the real loader's function, so this file does not
 * import the data (and so the same helper could record the old code before the data files existed).
 *
 * Everything else in the API does nothing, except what a branch of the story reads: flags, the party, items, and the answers to choices.
 */
import type { ScriptApi } from '../src/game/script';

/** One dialogue box, as `DialogScene` is given it. */
export interface LineRec {
  who: string | null;
  text: string;
  face?: string;
  top?: boolean;
  auto?: number;
  choices?: string[];
  cancel?: number;
}

export type FlagValue = number | boolean | string;

/** What a script needs from the world to take one branch. */
export interface World {
  flags?: Record<string, FlagValue>;
  /** Party member ids (`inParty`). */
  party?: string[];
  /** The index each choice returns, in the order the script asks (0 when the list runs out). */
  answers?: number[];
  /** What `battle` returns (default 'win'). */
  battle?: 'win' | 'lose' | 'run';
}

export type Resolve = (id: string, slots: Record<string, string | number> | undefined, kind: 'line' | 'choose') => LineRec;

/** The names `unlock` hands back (live values the story announces). */
export const UNLOCKED: Record<string, string[]> = {
  rook_tuned: ['Quickdraw', 'Reflex Burst'],
  rook_mended: ['Second Wind'],
};

export interface Recording {
  api: ScriptApi;
  lines: LineRec[];
  /** The line numbers of `story/chapter1.ts` that opened a box through `say`, `narrate` or `ask` (old code only). */
  sites: Set<number>;
  /** The ids that `line` and `choose` were called with (new code only). */
  ids: string[];
  flags: Record<string, FlagValue>;
}

/** The record without its undefined fields (so an old call with no option and a new line with no field compare equal). */
const clean = (o: { [K in keyof LineRec]?: LineRec[K] | undefined }): LineRec => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as unknown as LineRec;
};

export function record(world: World = {}, resolve?: Resolve): Recording {
  const flags: Record<string, FlagValue> = { ...(world.flags ?? {}) };
  const party = new Set(world.party ?? []);
  const answers = [...(world.answers ?? [])];
  const lines: LineRec[] = [];
  const sites = new Set<number>();
  const ids: string[] = [];

  const site = (): void => {
    const m = /story[\\/]chapter1\.ts:(\d+):/.exec(new Error().stack ?? '');
    if (m) sites.add(Number(m[1]));
  };
  const choice = (n: number): number => {
    const a = answers.shift();
    return a === undefined || a >= n ? 0 : a;
  };

  const known: Record<string, unknown> = {
    say: async (who: string | null, text: string, opts?: { face?: string; top?: boolean; auto?: number }) => {
      site();
      lines.push(clean({ who, text, face: opts?.face, top: opts?.top, auto: opts?.auto }));
    },
    narrate: async (text: string, opts?: { top?: boolean; auto?: number }) => {
      site();
      lines.push(clean({ who: null, text, top: opts?.top, auto: opts?.auto }));
    },
    ask: async (who: string | null, text: string, options: string[], opts?: { face?: string; top?: boolean; cancel?: number }) => {
      site();
      lines.push(clean({ who, text, choices: options, cancel: opts?.cancel, top: opts?.top, face: opts?.face }));
      return choice(options.length);
    },
    line: async (id: string, slots?: Record<string, string | number>) => {
      if (!resolve) throw new Error('this recording has no resolver for line()');
      ids.push(id);
      lines.push(resolve(id, slots, 'line'));
    },
    choose: async (id: string, slots?: Record<string, string | number>) => {
      if (!resolve) throw new Error('this recording has no resolver for choose()');
      ids.push(id);
      const rec = resolve(id, slots, 'choose');
      lines.push(rec);
      return choice(rec.choices?.length ?? 0);
    },
    flag: (n: string) => Boolean(flags[n]),
    get: (n: string) => flags[n],
    set: (n: string, v: FlagValue = true) => {
      flags[n] = v;
    },
    take: () => true,
    has: () => true,
    credits: () => 0,
    inParty: (id: string) => party.has(id),
    unlock: (flag: string) => UNLOCKED[flag] ?? [],
    battle: async () => world.battle ?? 'win',
  };

  // Everything not named above is a presentation step (a fade, a sound, a move): it does nothing and returns at once.
  const api = new Proxy(known, {
    get: (t, prop: string) => t[prop] ?? (() => Promise.resolve()),
  }) as unknown as ScriptApi;
  return { api, lines, sites, ids, flags };
}
