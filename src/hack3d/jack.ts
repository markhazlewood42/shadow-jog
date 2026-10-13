/**
 * The JACK cover: the engine half of the transition between the 2D game and the 3D hack (M7; docs/engine/m7-brief.md decision D5, pass lines 19 to 24).
 * `transition.ts` is the pure half (the phases, the numbers, what the cover looks like at each tick). This file draws it and runs it on the game's ticks.
 *
 * WHERE IT DRAWS. On `screen.overlayRoot`, above every scene and above the HUD. It is NOT a scene: the 3D scene starts under it (a scene pushed later would sit above a cover
 * scene), and a cover that is not on the scene stack is not dropped when the story is (`game.abandon`); the door removes it in a `finally` (`dispose`).
 *
 * THE LEVELS. `game.fx.level` says what the effects can do. At `full` style A plays its screen effects (the moments `jack.*` of `src/data/fx.json`), at `lite` the dim, a
 * shake and the white flash, at `none` NOTHING from the effects system: a plain fade through the void color. No style puts a filter on the world (the cover is a layer of its own).
 *
 * This file sits in the START PATH (the door imports it): it holds style A. Styles B and C (`jackdissolve.ts`, `jackcollapse.ts`) load in a DEV build only, until Mark
 * picks one at the look checkpoint; a shipped build holds neither.
 */
import { CanvasImage, Container, drawText, type Game, Graphics, H, measure, W } from '../sje';
import { pageSeed } from '../sje/runtime/devseed';
import { TRANSITION } from './data';
import { type CoverFrame, DEFAULT_STYLE, holdLook, type JackLevel, type JackStyle, type Phase, styleFromQuery, Timeline, type TransitionParams, VOID } from './transition';

const WHITE = 0xffffff;
const CYAN = 0x3fe0f0;

/** What a run of the cover needs from the door. All sync: the cover polls them on its ticks, so no frame depends on when a promise settles. */
export interface JackRun {
  /** The hold ends when this returns true (the chunk arrived or failed). Omit it for a run with no hold (jack out). */
  holdReleased?: () => boolean;
  /** Called once, on the first tick of the swap, with the cover solid. Start (or close) the 3D scene here. `abort` goes back to the picture instead of on. */
  onSwap: () => 'go' | 'abort';
  /** The swap lasts while this is false: the 3D scene has drawn its first frame (or ended). */
  swapDone: () => boolean;
}

export interface Jack {
  /** Resolves on the first tick of the first run. The door starts the chunk load then. */
  readonly started: Promise<void>;
  /**
   * Play the cover once. Resolves `done` when the run is over and the cover is gone, or `aborted` as soon as the way back begins (the hold timed out, or `onSwap` said
   * `abort`): the story goes on while the picture comes back, and the cover removes itself when it is done.
   */
  run(r: JackRun): Promise<'done' | 'aborted'>;
  /** Take the cover away now. After an aborted run it waits for the way back to finish first. Safe to call twice. */
  dispose(): void;
}

/** What a style draws with. `jack.ts` owns the veil, the hold element and the clock; a style adds its own objects. */
export interface JackStyleDriver {
  /** Build objects into `root` (depth below the hold element). */
  setup(root: Container): void;
  /** A phase begins. `level` says which effects exist. */
  enter(phase: Phase, level: JackLevel): void;
  /** Draw one tick. `t` is the tick within the phase. */
  paint(frame: CoverFrame, phase: Phase, t: number, level: JackLevel): void;
  /** Free what `setup` made and take back any effect left in the effects system. */
  dispose(): void;
}

/** The cover, with its clock. One per hack. */
class JackCover implements Jack {
  readonly started: Promise<void>;
  private resolveStarted: () => void = () => undefined;
  private readonly root: Container;
  private readonly veilVoid: Graphics;
  private readonly veilWhite: Graphics;
  private readonly holdUi: Container;
  private readonly cursor: Graphics;
  private readonly sweep: Graphics;
  private readonly label: CanvasImage;
  private readonly level: JackLevel;
  private tl: Timeline | null = null;
  private cfg: JackRun | null = null;
  private done: ((how: 'done' | 'aborted') => void) | null = null;
  private holdStart = 0;
  private firstTick = true;
  private disposed = false;
  private disposeWhenDone = false;
  private settled = false;
  /** The run that is on now, or null. */
  private active: Promise<'done' | 'aborted'> | null = null;

  constructor(
    private readonly game: Game,
    private readonly style: JackStyle,
    private readonly params: TransitionParams,
    private readonly driver: JackStyleDriver,
  ) {
    this.started = new Promise<void>((r) => {
      this.resolveStarted = r;
    });
    this.level = game.fx.level;
    // A throw partway (a canvas that cannot be made) must not leave a half-built cover on screen or a listener behind: the door treats it as a cut, and nothing else would free it.
    try {
      this.root = new Container(game, 0, 0, 'jack');
      this.root.setDepth(1000);
      this.veilVoid = new Graphics(game).fillStyle(VOID, 1).fillRect(0, 0, W, H).setDepth(0).setVisible(false);
      this.veilWhite = new Graphics(game).fillStyle(WHITE, 1).fillRect(0, 0, W, H).setDepth(0).setVisible(false);
      this.root.add([this.veilVoid, this.veilWhite]);
      driver.setup(this.root);
      // The hold element: a blinking cursor, the line "JACKING IN", and a bar that runs along the bottom. It moves every tick.
      this.holdUi = new Container(game, 0, 0, 'jack-hold').setDepth(10).setVisible(false);
      const text = 'JACKING IN';
      const tw = measure(text) + 2;
      this.label = new CanvasImage(game, Math.floor((W - tw - 8) / 2), Math.floor(H / 2) - 6, tw, 11);
      drawText(this.label.ctx, text, 0, 0, { color: '#3fe0f0' });
      this.label.refresh();
      this.cursor = new Graphics(game, this.label.x + tw + 2, this.label.y + 1).fillStyle(CYAN, 1).fillRect(0, 0, 5, 9);
      this.sweep = new Graphics(game, 0, H - 28).fillStyle(CYAN, 0.85).fillRect(0, 0, 72, 2);
      this.holdUi.add([this.label, this.cursor, this.sweep]);
      this.root.add(this.holdUi);
      game.screen.overlayRoot.add(this.root);
      game.events.on('poststep', this.onTick);
      if (import.meta.env.DEV) jackProbe.current = this;
    } catch (e) {
      game.events.off('poststep', this.onTick);
      try {
        driver.dispose();
      } catch {
        // The first error is the one to report.
      }
      (this as unknown as { root?: Container }).root?.destroy();
      throw e;
    }
  }

  /** The phase and tick now, for tests (DEV hook) and for the unit tests of the door's order. */
  get state(): { phase: Phase; t: number; total: number; aborted: boolean } | null {
    const tl = this.tl;
    return tl ? { phase: tl.phase, t: tl.t, total: tl.total, aborted: tl.aborted } : null;
  }

  run(r: JackRun): Promise<'done' | 'aborted'> {
    if (this.disposed) return Promise.resolve('done');
    // One run at a time. A hack shorter than its own reveal calls for jack out while jack in is still on screen: the second run waits for the first to be over (the cover
    // is never replaced in the middle of a run, which would leave the first run's promise, and so the story, waiting for ever).
    const before = this.active;
    if (before) return before.then(() => this.run(r));
    const tl = new Timeline(this.params, { skipHold: !r.holdReleased });
    this.tl = tl;
    this.cfg = r;
    this.settled = false;
    const mine = new Promise<'done' | 'aborted'>((resolve) => {
      this.done = resolve;
      this.enter('out');
      this.paint();
    });
    this.active = mine;
    void mine.then(() => {
      if (this.active === mine) this.active = null;
    });
    return mine;
  }

  dispose(): void {
    if (this.disposed) return;
    // After an aborted run the picture is on its way back: let that finish, then go.
    if (this.tl?.phase === 'in' && this.tl.aborted) {
      this.disposeWhenDone = true;
      return;
    }
    this.teardown();
  }

  private teardown(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.game.events.off('poststep', this.onTick);
    try {
      this.driver.dispose();
    } finally {
      this.root.destroy();
      if (import.meta.env.DEV && jackProbe.current === this) jackProbe.current = null;
      this.finish('done');
    }
  }

  private finish(how: 'done' | 'aborted'): void {
    if (this.settled) return;
    this.settled = true;
    const d = this.done;
    this.done = null;
    d?.(how);
  }

  private enter(phase: Phase): void {
    if (phase === 'hold') this.holdStart = performance.now();
    this.driver.enter(phase, this.level);
  }

  /** One tick of the cover. A throw inside it must not leave the run pending (decision E11: a hack always resolves): the run ends `aborted` and the cover comes down. */
  private readonly onTick = (): void => {
    try {
      this.tick();
    } catch (e) {
      console.error('[sje] the transition threw; the run ends aborted:', e);
      this.finish('aborted');
      try {
        this.teardown();
      } catch (e2) {
        console.error('[sje] the transition could not be removed cleanly:', e2);
      }
    }
  };

  private tick(): void {
    if (this.firstTick) {
      this.firstTick = false;
      this.resolveStarted();
    }
    const tl = this.tl;
    const cfg = this.cfg;
    if (!tl || !cfg || tl.phase === 'done') return;
    const timedOut = tl.phase === 'hold' && performance.now() - this.holdStart >= this.params.holdBoundMs;
    const changed = tl.step({
      holdReleased: cfg.holdReleased ? cfg.holdReleased() : true,
      holdTimedOut: timedOut,
      swapDone: tl.phase === 'swap' ? cfg.swapDone() : false,
      holdFrom: this.holdFrom(),
    });
    if (changed) {
      this.enter(tl.phase);
      if (tl.phase === 'swap' && cfg.onSwap() === 'abort') {
        tl.abort(this.holdFrom());
        this.enter('in');
      }
      if (tl.phase === 'in' && tl.aborted) this.finish('aborted');
    }
    this.paint();
    if ((tl.phase as Phase) === 'done') {
      this.finish('done');
      // A run that went back to the picture (aborted) has nothing more to show: the cover goes, whether or not the door has asked yet.
      if (this.disposeWhenDone || tl.aborted) this.teardown();
    }
  }

  /** How covered the picture is at the hold look, in the unit the style's `in` phase starts from. */
  private holdFrom(): number {
    return holdLook(this.style, this.level, this.params);
  }

  private paint(): void {
    const tl = this.tl;
    if (!tl) return;
    const frame = tl.frame(this.style, this.level);
    const visible = tl.phase !== 'done';
    this.veilVoid.setVisible(visible && frame.tint === 'void' && frame.cover > 0).setAlpha(frame.cover);
    this.veilWhite.setVisible(visible && frame.tint === 'white' && frame.cover > 0).setAlpha(frame.cover);
    const showHold = frame.holdUi && !(import.meta.env.DEV && jackProbe.skipHoldUi);
    this.holdUi.setVisible(showHold);
    if (showHold) {
      this.cursor.setVisible(Math.floor(tl.t / this.params.cursorPeriod) % 2 === 0);
      this.sweep.setPosition(((tl.t * 9) % (W + 72)) - 72, H - 28);
    }
    this.driver.paint(frame, tl.phase, tl.t, this.level);
  }
}

// ---- style A: the datamosh tear ---------------------------------------------------------------------------------

/** Style A has no objects of its own: the veil is the flash, and the tear is the effects system's (`full`). */
class GlitchDriver implements JackStyleDriver {
  private lastHoldFire = -1;
  /** The glitches that the cover's own moments made. Only these are removed at the swap and at dispose: a battle hit or a story effect that is live keeps its own. */
  private readonly mine = new Set<object>();
  constructor(private readonly game: Game) {}
  private moment(name: string, x: number, y: number): void {
    const fx = this.game.fx;
    const before = new Set<object>(fx.glitches);
    fx.playMoment(name, x, y);
    for (const g of fx.glitches) if (!before.has(g)) this.mine.add(g);
  }
  private clearMine(): void {
    const list = this.game.fx.glitches;
    for (let i = list.length - 1; i >= 0; i--) if (this.mine.has(list[i] as object)) list.splice(i, 1);
    this.mine.clear();
  }
  setup(): void {}
  enter(phase: Phase, level: JackLevel): void {
    const fx = this.game.fx;
    if (level === 'none') return; // no effects call at all (pass line 23)
    const mid = { x: W / 2, y: H / 2 };
    if (level === 'full') {
      if (phase === 'out') this.moment('jack.out', mid.x, mid.y);
      else if (phase === 'hold') {
        this.lastHoldFire = 0;
        this.moment('jack.hold', mid.x, mid.y);
      } else if (phase === 'swap') {
        // The white flash covers the cut: nothing of the tear may stay behind it.
        this.clearMine();
      } else if (phase === 'in') this.moment('jack.in', mid.x, mid.y);
    } else {
      // lite: the dim, a shake, and the white veil as the flash.
      if (phase === 'out') {
        fx.playMoment('jack.lite', mid.x, mid.y);
        this.game.shake(18, 2);
      } else if (phase === 'swap') this.game.shake(8, 3);
    }
  }
  paint(_frame: CoverFrame, phase: Phase, t: number, level: JackLevel): void {
    // The sustained tear of the hold: the moment plays again every 20 ticks.
    if (phase === 'hold' && level === 'full' && t - this.lastHoldFire >= 20) {
      this.lastHoldFire = t;
      this.moment('jack.hold', W / 2, H / 2);
    }
  }
  dispose(): void {
    if (this.game.fx.level === 'full') this.clearMine();
  }
}

// ---- the choice and the maker -----------------------------------------------------------------------------------

/** What a caller may choose for one hack (`HackOptions.jack`). */
export interface JackOptions {
  /** `cut` is no transition at all. Default: the style that ships (`DEFAULT_STYLE`), or `?jack=` in a DEV build. */
  style?: JackStyle | 'cut';
  /** Fields laid over the defaults of `hacks.json` (a test shortens `holdBoundMs`). */
  params?: Partial<TransitionParams>;
}

/** The seed of the cover's noise: the page's `?seed` (DEV) and the hack's own seed. A plain mix, so one number comes out for a pair. */
function jackSeed(hackSeed: number): number {
  const page = pageSeed() ?? 0;
  return (Math.imul(page ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(hackSeed + 1, 0xc2b2ae35)) >>> 8;
}

/** DEV only: the cover that is on screen now, for the e2e hooks. Always null in a shipped build. */
export interface JackStateView {
  readonly state: { phase: Phase; t: number; total: number; aborted: boolean } | null;
}
export const jackProbe: { current: JackStateView | null; /** The mutant of pass line 20: draw no hold element. */ skipHoldUi: boolean } = { current: null, skipHoldUi: false };

/**
 * The cover for one hack, or null for a cut. Called by the door. Style A is built in. Styles B and C load in a DEV build only, from their own files, so a shipped build holds
 * neither (decision D5: only the style Mark picks ships).
 */
export async function makeJack(game: Game, hackSeed: number, options?: JackOptions): Promise<Jack | null> {
  const fromQuery = import.meta.env.DEV ? styleFromQuery(new URLSearchParams(location.search).get('jack')) : null;
  const choice = options?.style ?? fromQuery ?? DEFAULT_STYLE;
  if (choice === 'cut') return null;
  const params: TransitionParams = { ...TRANSITION, ...options?.params };
  let driver: JackStyleDriver;
  if (choice === 'glitch') driver = new GlitchDriver(game);
  else if (import.meta.env.DEV) {
    const seed = jackSeed(hackSeed);
    driver = choice === 'dissolve' ? new (await import('./jackdissolve')).DissolveDriver(game, params, seed) : new (await import('./jackcollapse')).CollapseDriver(game, params);
  } else driver = new GlitchDriver(game);
  const style: JackStyle = choice === 'glitch' || import.meta.env.DEV ? choice : 'glitch';
  return new JackCover(game, style, params, driver);
}
