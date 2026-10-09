import { Display } from './engine/display';
import { FPS, Game } from './engine/game';
import { Input } from './engine/input';
import { boot } from './boot';
import { reportError } from './engine/errors';
import { drawNotice } from './noticeoverlay';
import { perf } from './engine/perf';
import { postfx } from './engine/postfx';
import { settings } from './game/settings';

function fail(err: unknown): void {
  const el = document.getElementById('boot');
  if (el) {
    el.classList.add('error');
    el.style.display = 'flex';
    el.textContent = `SHADOW JOG failed to start.\n\n${err instanceof Error ? err.message : String(err)}`;
  }
  console.error(err);
}

function start(): void {
  const screen = document.getElementById('screen') as HTMLCanvasElement;
  const display = new Display(screen);
  const input = new Input(window);
  input.applyCustom(settings.keys ?? {});
  const game = new Game(display.backCtx, input);

  const step = 1000 / FPS;
  let last = performance.now();
  let acc = 0;
  // GPU effects that can't keep up switch themselves off for the session (a weak or blocklisted
  // GPU draws them in software): a long run of frames under 25 fps, with the tab in view.
  let slowRun = 0;
  const loop = (now: number) => {
    // Scheduled first: whatever throws below, the next frame still runs.
    requestAnimationFrame(loop);
    const t0 = performance.now();
    const delta = now - last;
    acc += Math.min(250, delta);
    last = now;
    if (postfx.active && !document.hidden && delta < 250) {
      slowRun = delta > 40 ? slowRun + 1 : Math.max(0, slowRun - 2);
      if (slowRun >= 90) {
        slowRun = 0;
        window.dispatchEvent(new Event('sj-gpu-slow'));
      }
    }
    let n = 0;
    let simMs = 0;
    try {
      while (acc >= step && n < 5) {
        for (let i = 0; i < game.speed; i++) game.tick();
        acc -= step;
        n++;
      }
      if (n === 5) acc = 0;
      simMs = performance.now() - t0;
      display.beginFrame();
      game.render();
      display.present();
    } catch (e) {
      reportError(e);
    }
    perf.record(performance.now() - t0, simMs);
  };

  boot(game, display);
  // Non-fatal errors surface as a small notice instead of silently freezing; Game isolates
  // per-scene exceptions so this overlay keeps drawing even when a scene's render throws.
  game.overlays.push(drawNotice);
  document.getElementById('boot')!.style.display = 'none';
  screen.focus();
  requestAnimationFrame(loop);
  started = true;
  // The page's own pre-start error screen (index.html) stands down.
  (window as unknown as { __sjStarted?: boolean }).__sjStarted = true;
}

let started = false;
window.addEventListener('error', (e) => (started ? reportError(e.error ?? e.message) : fail(e.error ?? e.message)));
// The new engine's awaited promises reject with `Cancelled` (its `name`) when their scene ends. That is not a bug: no notice.
window.addEventListener('unhandledrejection', (e) => {
  if ((e.reason as { name?: string } | null)?.name === 'Cancelled') return e.preventDefault();
  reportError(e.reason);
});
try {
  // `?engine=sje` runs the new engine. Its code (and all of Pixi) is a separate chunk that is fetched only here.
  if (new URLSearchParams(location.search).get('engine') === 'sje') {
    void import('./sje/boot').then((m) => m.startSje(() => (started = true))).catch(fail);
  } else start();
} catch (e) {
  fail(e);
}
