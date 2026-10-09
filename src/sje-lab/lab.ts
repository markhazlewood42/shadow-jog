/**
 * The engine lab (DEV only, /sjelab.html): boots the Shadow Jog Engine's render stack with a sandbox
 * scene, and installs `window.__SJE__`, the hook the e2e specs (e2e/sje-canaries.spec.ts,
 * e2e/perf.spec.ts) use to step the loop deterministically and read the pixels back.
 *
 * Why a lab and not the game: the game still runs on the old Canvas 2D engine. This page is the place
 * where the NEW render stack runs for real (Pixi on the engine's own WebGL2 context, the back buffer,
 * the integer presenter, and later Three on the same context), so its traps can be tested in a browser,
 * on a GPU and on software GL (SwiftShader, CI).
 *
 * M0 has no scene runtime (`Game`, `Scene`: M1). The lab composes what exists: a `GlRenderer`, a `Screen`,
 * a `TextureManager` and a `FixedLoop`. M1 replaces this composition with `Game`.
 */
import { FixedLoop, GlRenderer, H, must, Screen, TextureManager, W, type DisplayHost } from '../sje';
import { LabContent } from './content';
import { installHook } from './hook';
import { type GlCounts, installGlCounter, readGlCounts } from './glcounter';

export interface Lab {
  renderer: GlRenderer;
  screen: Screen;
  host: DisplayHost;
  loop: FixedLoop;
  content: LabContent;
  /** The tick counter (one per fixed step). */
  readonly tick: number;
  /** One fixed tick. The loop calls it; so does `step`. */
  advanceTick(): void;
  /** One draw of the whole screen into the back buffer, and the back buffer into the canvas. */
  draw(): void;
  /** Run `n` ticks with no real time passing, then draw one frame. */
  step(n: number): void;
  /** Run `n` enter-and-leave cycles of a fresh lab scene (the leak check). */
  reenter(n: number): void;
  counts(): GlCounts;
  /** Called after every draw (the real loop and `step`). The 3D part of the lab uses it to render its frame first. */
  beforeDraw: Array<() => void>;
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
  const host: DisplayHost = { textures: new TextureManager() };
  const screen = new Screen(host);
  let content = new LabContent(host);
  screen.worldRoot.add(content.root);

  let tick = 0;
  const beforeDraw: Array<() => void> = [];
  const lab: Lab = {
    renderer,
    screen,
    host,
    loop: undefined as unknown as FixedLoop,
    get content() {
      return content;
    },
    set content(c: LabContent) {
      content = c;
    },
    get tick() {
      return tick;
    },
    advanceTick() {
      tick++;
      content.fixedUpdate(tick);
    },
    draw() {
      // While the context is lost nothing can be drawn; the renderer skips the frame itself.
      for (const fn of beforeDraw) fn();
      renderer.render(screen);
    },
    step(n) {
      for (let i = 0; i < n; i++) lab.advanceTick();
      lab.draw();
    },
    reenter(n) {
      for (let i = 0; i < n; i++) {
        content.destroy();
        content = new LabContent(host);
        screen.worldRoot.add(content.root);
        lab.step(2);
      }
    },
    counts: () => readGlCounts(),
    beforeDraw,
  };
  const loop = new FixedLoop({ tick: () => lab.advanceTick(), draw: () => lab.draw() });
  lab.loop = loop;

  // The status line is a DOM element fixed over the bottom-left of the window, which is the bottom-left of the canvas when the picture fills the window. A screenshot
  // of the real loop would show it as part of the picture. So under a test driver (`navigator.webdriver`) and with `?manual` the element is REMOVED, and the same text
  // goes to the page title instead, which no screenshot shows. A person who opens the page sees the line.
  const statusEl = document.getElementById('status');
  const hideStatus = params.has('manual') || navigator.webdriver;
  if (hideStatus) statusEl?.remove();
  const status = hideStatus ? null : statusEl;
  const say = (): void => {
    const text = `${W}x${H}  x${renderer.presenter.k}  dpr ${window.devicePixelRatio}  tick ${tick}`;
    document.title = `Engine lab: ${text}`;
    if (status) status.textContent = text;
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
  // One step so the first picture is not the bare start state; the pixel the boot canary reads is then something drawn.
  lab.step(1);
  // `?manual` leaves the clock to the tests (`__SJE__.step`). Otherwise the real 60 Hz loop runs.
  if (!params.has('manual')) {
    loop.start();
    renderer.glc.canvas.addEventListener('webglcontextrestored', say);
  }
  window.__SJE__ = installHook(lab);
  return lab;
}
