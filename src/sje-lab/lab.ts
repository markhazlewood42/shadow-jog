/**
 * The engine lab (DEV only, /sjelab.html): boots the Shadow Jog Engine's render stack with a sandbox
 * scene, and installs `window.__SJE__`, the hook the e2e specs (e2e/sje-canaries.spec.ts,
 * e2e/perf.spec.ts) use to step the loop deterministically and read the pixels back.
 *
 * Why a lab and not the game: the game still runs on the old Canvas 2D engine. This page is the place
 * where the NEW render stack runs for real (Pixi on the engine's own WebGL2 context, the back buffer,
 * the integer presenter, and Three on the same context), so its traps can be tested in a browser, on a GPU
 * and on software GL (SwiftShader, CI).
 *
 * M0 has no scene runtime (`Game`, `Scene`: M1). The lab composes what exists: a `GlRenderer`, a `Screen`,
 * a `TextureManager` and a `FixedLoop`. M1 replaces this composition with `Game`.
 */
import { type DisplayHost, FixedLoop, type Game, GlRenderer, H, must, Screen, TextureManager, W } from '../sje';
import { LabContent } from './content';
import { type GlCounts, installGlCounter, readGlCounts } from './glcounter';
import { installHook } from './hook';

/** The lab: the render stack, the sandbox scene and the loop, with the few verbs the hook needs. */
export class Lab {
  /** The lab's own screen, with the sandbox scene. It is the one drawn unless a `Game` is attached. */
  private readonly baseScreen: Screen;
  /** A scene runtime on the shared renderer (the 3D part of the lab runs its `Scene3D` in one). While it is attached, ITS screen is drawn. */
  private attached: Game | null = null;
  readonly host: DisplayHost = { textures: new TextureManager() };
  readonly loop: FixedLoop;
  /** The sandbox scene. `reenter` replaces it. */
  content: LabContent;
  /** Called before every draw, in order (the 3D part of the lab renders its frame here). */
  readonly beforeDraw: Array<() => void> = [];
  private ticks = 0;

  constructor(readonly renderer: GlRenderer) {
    this.baseScreen = new Screen(this.host);
    this.content = new LabContent(this.host);
    this.baseScreen.worldRoot.add(this.content.root);
    this.loop = new FixedLoop({ tick: () => this.advanceTick(), draw: () => this.draw() });
  }

  /** The screen that is drawn now: the attached game's, or the lab's own. Checks that put objects on the picture use this one. */
  get screen(): Screen {
    return this.attached ? this.attached.screen : this.baseScreen;
  }

  /** The attached game, or null. */
  get game(): Game | null {
    return this.attached;
  }

  /** Draw (and tick) this game instead of the sandbox scene. One at a time. */
  attachGame(game: Game): void {
    if (this.attached) throw new Error('Lab.attachGame: a game is attached already');
    this.attached = game;
  }

  /** Back to the sandbox scene. */
  detachGame(): void {
    this.attached = null;
  }

  /** The tick counter (one per fixed step). */
  get tick(): number {
    return this.ticks;
  }

  /** One fixed tick. The loop calls it; so does `step`. */
  advanceTick(): void {
    this.ticks++;
    this.content.fixedUpdate(this.ticks);
    this.attached?.advanceTick();
  }

  /** One draw: the screen into the back buffer, and the back buffer into the canvas. While the context is lost the renderer skips the frame itself. */
  draw(): void {
    for (const fn of this.beforeDraw) fn();
    // The game's draw runs its scenes' `prerender` handlers (a Scene3D draws its 3D frame there), then draws the screen.
    if (this.attached) this.attached.draw(0);
    else this.renderer.render(this.baseScreen);
  }

  /** Run `n` ticks with no real time passing, then draw one frame. */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.advanceTick();
    this.draw();
  }

  /** Enter and leave a fresh sandbox scene `n` times (the leak check). */
  reenter(n: number): void {
    for (let i = 0; i < n; i++) {
      this.content.destroy();
      this.content = new LabContent(this.host);
      this.baseScreen.worldRoot.add(this.content.root);
      this.step(2);
    }
  }

  counts(): GlCounts {
    return readGlCounts();
  }

  /**
   * Lose the context on purpose; resolves one macrotask AFTER the browser's lost event. The browser calls every listener of
   * `webglcontextlost` (ours, Pixi's, Three's) in turn, and a promise continuation would run between them. Restoring before the last
   * one has run is refused ("restoreContext: context restoration not allowed"), and the Pixi and Three handlers would run late.
   */
  loseContext(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.renderer.glc.off('lost', done);
        setTimeout(resolve, 0);
      };
      this.renderer.glc.on('lost', done);
      this.renderer.glc.forceLoss();
    });
  }

  /** Give the context back; resolves one macrotask after the restored event. Only valid after `loseContext()` resolved. */
  restoreContext(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.renderer.glc.off('restored', done);
        setTimeout(resolve, 0);
      };
      this.renderer.glc.on('restored', done);
      this.renderer.glc.forceRestore();
    });
  }
}

/** Boot the engine's render stack and the lab scene. */
export async function startLab(): Promise<Lab> {
  const params = new URLSearchParams(location.search);
  // Count GL objects from before the context exists, so nothing is missed.
  installGlCounter();
  const parent = must(document.getElementById('stage'), '#stage');
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  parent.appendChild(canvas);
  let renderer: GlRenderer;
  try {
    renderer = await GlRenderer.create(canvas);
  } catch (e) {
    canvas.remove();
    throw e;
  }
  const lab = new Lab(renderer);

  // The status line is a DOM element fixed over the bottom-left of the window, which is the bottom-left of the canvas when the picture fills the window. A screenshot
  // of the real loop would show it as part of the picture. So under a test driver (`navigator.webdriver`) and with `?manual` the element is REMOVED, and the same text
  // goes to the page title instead, which no screenshot shows. A person who opens the page sees the line.
  const statusEl = document.getElementById('status');
  const hideStatus = params.has('manual') || navigator.webdriver;
  if (hideStatus) statusEl?.remove();
  const say = (): void => {
    const text = `${W}x${H}  x${renderer.presenter.k}  dpr ${window.devicePixelRatio}  tick ${lab.tick}`;
    document.title = `Engine lab: ${text}`;
    if (!hideStatus && statusEl) statusEl.textContent = text;
  };
  // The size the browser says the canvas box has in DEVICE pixels, when it can say (real Chrome and Firefox).
  let observed: { w: number; h: number } | undefined;
  const fitCanvas = (): void => {
    renderer.fitToWindow(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, observed);
    lab.draw();
    say();
  };
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  try {
    const watcher = new ResizeObserver((entries) => {
      const size = entries[0]?.devicePixelContentBoxSize?.[0];
      if (size && (observed?.w !== size.inlineSize || observed?.h !== size.blockSize)) {
        observed = { w: size.inlineSize, h: size.blockSize };
        fitCanvas();
      }
    });
    watcher.observe(renderer.glc.canvas, { box: 'device-pixel-content-box' });
  } catch {
    // A browser without 'device-pixel-content-box' (Safari): the arithmetic in deviceSize() is used.
  }
  // One step, so the first picture is not the bare start state.
  lab.step(1);
  // `?manual` leaves the clock to the tests (`__SJE__.step`). Otherwise the real 60 Hz loop runs.
  if (!params.has('manual')) lab.loop.start();
  window.__SJE__ = installHook(lab);
  return lab;
}
