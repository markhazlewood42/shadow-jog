/**
 * The DEV hook of the 3D mode on the real game (M7 task 6; docs/engine/m7-brief.md decision D1 A: the test scene has a DEV entry and no story caller). Members on
 * `window.__SJ__`, added in a DEV build only (the engine's DEV hook, `devhook.ts`, calls `attachHackHook`; a shipped build never loads either file).
 *
 *   hackDef(id, over?)             a hack definition of `src/data/hacks.json`, with fields laid over it (a copy)
 *   hack(idOrDef, opts?)           run a hack the way a story does: through the real field script runner when a field is on the stack (`s.hack`, so the door and the
 *                                  policy loop run), else through the seam. Resolves the `HackOutcome`. `opts`: `over` (fields over the definition), `frame`
 *                                  (`shared-context` | `canvas-copy`), `contextGraceMs`, `hud`, `alternative` (`success` | `fail`: what the 2D stand-in gives)
 *   hackDev.set({ env, options })  replace the door's environment (`probe`, `load`) and/or the scene options for the hacks that start from now on; `hackDev.clear()`
 *   hackState()                    `{ running, tick, status, scene }` of the HackScene on the stack, or `{ running: false, ... }`
 *   hackChunk()                    the loaded 3D chunk (`hostsCreated`, `frame3dTestSeams`, ...): the door's one `import()`
 *   hackTest.coverInPrerender()    push an opaque scene that lets the sim below run and closes itself INSIDE its own `prerender` when armed (pass line 11)
 *   hackTest.mutantPrerender(on)   put the old `prerender` (no second pass) on the scene manager, or the real one back (the control of pass line 11)
 *   hackTest.scenes()              the class names of the scenes on the stack, bottom first
 *   hackTest.resetToIdle()         `game.reset` onto an idle scene (the story is dropped)
 *   hackTest.hudReference()        the top right HUD panel drawn with plain Canvas 2D (the game's font, no engine): `{ x, y, w, h, base64 }`, RGBA, top row first (pass line 13)
 *   hackTest.gapOverlay(on)        a filtered container (invert) with a transparent gap, over everything (the canary of pass line 10); `rects` says where the gap is
 *   hackTest.colorQuad(hex)        a flat Three quad of this exact color in front of the camera of the running HackScene; the result removes it (pass line 13)
 *
 * `?scene=hack` (src/devroutes.ts) opens the same scene on its own, for the pictures. Dev and tests only.
 */
import { colorMatrixEffect, Container, drawText, type Effect, type Game, Graphics, H, Scene, W } from '../sje';
import { type DoorEnv, loadChunk } from '../hack3d/door';
import { HUD_FIXED } from '../hack3d/hud';
import { type HackDef, type HackOptions, type HackOutcome, hackDef, hackDevOverride, runHack, setHackDevOverride } from '../game/hackseam';

/** What a test may set for one `hack()` call. */
export interface HackCallOptions {
  /** Fields laid over the definition (for example a low `traceLimit`). */
  over?: Partial<HackDef>;
  frame?: HackOptions['frame'];
  contextGraceMs?: number;
  hud?: boolean;
  bloom?: boolean;
  /** What the 2D stand-in gives when 3D is unsupported. Without it the hack counts as won (the seam's default). */
  alternative?: 'success' | 'fail';
}

export interface HackStateView {
  running: boolean;
  tick: number;
  status: string | null;
  scene: string | null;
}

interface HackSceneLike extends Scene<unknown> {
  readonly sim: { readonly tick: number; readonly status: string };
}

interface FieldLike {
  runScript(fn: (s: { hack(def: HackDef, alt?: () => Promise<'success' | 'fail'>): Promise<HackOutcome> }) => Promise<void>): Promise<boolean>;
}

/** An opaque scene that lets the scenes under it keep updating, and closes itself in its own `prerender` once armed. */
class CoverScene extends Scene<void> {
  armed = false;
  override create(): void {
    this.passUpdate = true;
    this.events.on('prerender', () => {
      if (this.armed) this.close();
    });
  }
  fixedUpdate(): void {}
}

export function attachHackHook(sj: Record<string, unknown>, game: Game): void {
  const stack = (): readonly Scene<unknown>[] => game.scene.scenes;
  const hackScene = (): HackSceneLike | null => (stack().find((s) => s.constructor.name === 'HackScene' && !s.closed) as HackSceneLike | undefined) ?? null;
  const oldPrerender = game.scene.prerender;
  let cover: CoverScene | null = null;
  let gap: { root: Container; effect: Effect } | null = null;
  let removeQuad: (() => void) | null = null;

  const hook = {
    hackDef: (id: string, over?: Partial<HackDef>): HackDef => hackDef(id, over),

    async hack(idOrDef: string | HackDef, opts: HackCallOptions = {}): Promise<HackOutcome> {
      const def = typeof idOrDef === 'string' ? hackDef(idOrDef, opts.over) : { ...idOrDef, ...opts.over };
      const alt = opts.alternative;
      const playAlt = alt ? async () => alt : undefined;
      const before = hackDevOverride();
      const options: HackOptions = { ...before?.options, ...(opts.frame ? { frame: opts.frame } : {}), ...(opts.contextGraceMs !== undefined ? { contextGraceMs: opts.contextGraceMs } : {}), ...(opts.hud !== undefined ? { hud: opts.hud } : {}), ...(opts.bloom !== undefined ? { bloom: opts.bloom } : {}) };
      setHackDevOverride({ ...before, options });
      try {
        const field = (sj.field as (() => FieldLike | null) | undefined)?.() ?? null;
        if (!field) return await runHack(game, def, playAlt);
        let outcome: HackOutcome | null = null;
        // The real field script runner: `s.hack` goes through `fieldHooks.hack`, the seam, the door and the policy loop.
        const ok = await field.runScript(async (s) => {
          outcome = await s.hack(def, playAlt);
        });
        if (!ok || !outcome) throw new Error('the field script that ran the hack failed (see the console)');
        return outcome;
      } finally {
        setHackDevOverride(before);
      }
    },

    hackDev: {
      set(o: { env?: Partial<DoorEnv>; options?: HackOptions }): void {
        setHackDevOverride(o);
      },
      clear(): void {
        setHackDevOverride(null);
      },
    },

    hackState(): HackStateView {
      const s = hackScene();
      return s ? { running: true, tick: s.sim.tick, status: s.sim.status, scene: 'HackScene' } : { running: false, tick: 0, status: null, scene: null };
    },

    hackChunk: () => loadChunk(),

    hackTest: {
      /** Push the cover (it lets the sim below run). Call `arm()` on the result to make it close itself in its next `prerender`. */
      coverInPrerender(): { arm(): void; closed(): boolean } {
        const c = new CoverScene();
        cover = c;
        void game.run(c);
        return {
          arm: () => {
            c.armed = true;
          },
          closed: () => c.closed,
        };
      },
      /** The `prerender` before M7 task 5: one pass, then the layout refresh. The control of pass line 11. */
      mutantPrerender(on: boolean): void {
        const mgr = game.scene;
        if (!on) {
          mgr.prerender = oldPrerender;
          return;
        }
        mgr.prerender = () => {
          mgr.refreshLayout();
          for (const s of mgr.scenes) {
            if (s.closed || !s.sys.visible) continue;
            s.events.emit('prerender');
            if (s.closed) continue;
            s.cameras.apply();
          }
          mgr.refreshLayout();
        };
      },
      scenes: (): string[] => stack().map((s) => s.constructor.name),
      /** `game.reset(...)` with a scene that does nothing: what a loaded save or the title screen does to a story (pass line 5). */
      resetToIdle(): void {
        void game.reset(new CoverScene());
      },

      /** The top right panel as Canvas 2D draws it: a 1 px edge, the dark fill, the text. The e2e spec compares it with the back buffer (0 differing pixels). */
      hudReference(): { x: number; y: number; w: number; h: number; base64: string } {
        const n = HUD_FIXED.node;
        const canvas = document.createElement('canvas');
        canvas.width = n.w;
        canvas.height = n.h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no 2D canvas');
        const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
        ctx.fillStyle = css(HUD_FIXED.edge);
        ctx.fillRect(0, 0, n.w, n.h);
        ctx.fillStyle = css(HUD_FIXED.panel);
        ctx.fillRect(1, 1, n.w - 2, n.h - 2);
        drawText(ctx, n.text, n.textX - n.x, n.textY - n.y, { color: n.textColor });
        const px = ctx.getImageData(0, 0, n.w, n.h).data;
        let bin = '';
        for (let i = 0; i < px.length; i++) bin += String.fromCharCode(px[i] ?? 0);
        return { x: n.x, y: n.y, w: n.w, h: n.h, base64: btoa(bin) };
      },

      /** A filtered container with a transparent gap, over the whole picture. The two bars are opaque white, and the effect inverts them; the gap is a clear column. */
      gapOverlay(on: boolean): { gapX0: number; gapX1: number; barX: number; y: number } {
        const GAP = { x0: W / 2 - 40, x1: W / 2 + 40 };
        if (on && !gap) {
          const root = new Container(game, 0, 0, 'gap-overlay');
          const g = new Graphics(game);
          g.fillStyle(0xffffff, 1).fillRect(0, 0, GAP.x0, H);
          g.fillStyle(0xffffff, 1).fillRect(GAP.x1, 0, W - GAP.x1, H);
          root.add(g);
          const effect = colorMatrixEffect([-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0]);
          root.filters.add(effect);
          game.screen.overlayRoot.add(root);
          gap = { root, effect };
        } else if (!on && gap) {
          gap.root.destroy();
          gap.effect.destroy();
          gap = null;
        }
        return { gapX0: GAP.x0, gapX1: GAP.x1, barX: 100, y: H / 2 };
      },

      async colorQuad(hex: number): Promise<void> {
        const scene = hackScene();
        if (!scene) throw new Error('no HackScene is running');
        removeQuad?.();
        const chunk = await loadChunk();
        removeQuad = chunk.devColorQuad(scene as unknown as Parameters<typeof chunk.devColorQuad>[0], hex);
      },
      removeColorQuad(): void {
        removeQuad?.();
        removeQuad = null;
      },
      coverClosed: (): boolean => cover?.closed ?? true,
    },
  };
  Object.defineProperties(sj, Object.getOwnPropertyDescriptors(hook));
}
