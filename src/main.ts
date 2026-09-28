import { Display } from './engine/display';
import { Game, FPS } from './engine/game';
import { Input } from './engine/input';
import { boot } from './boot';
import { currentNotice, reportError } from './engine/errors';
import { drawText } from './engine/font';

function fail(err: unknown): void {
  const el = document.getElementById('boot');
  if (el) {
    el.classList.add('error');
    el.style.display = 'flex';
    el.textContent = 'SHADOW JOG failed to start.\n\n' + (err instanceof Error ? err.message : String(err));
  }
  console.error(err);
}

function start(): void {
  const screen = document.getElementById('screen') as HTMLCanvasElement;
  const display = new Display(screen);
  const input = new Input(window);
  const game = new Game(display.backCtx, input);

  const step = 1000 / FPS;
  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    acc += Math.min(250, now - last);
    last = now;
    let n = 0;
    while (acc >= step && n < 5) {
      for (let i = 0; i < game.speed; i++) game.tick();
      acc -= step;
      n++;
    }
    if (n === 5) acc = 0;
    game.render();
    display.present();
    requestAnimationFrame(loop);
  };

  boot(game, display);
  // Non-fatal errors surface as a small notice instead of silently freezing.
  game.overlays.push((ctx) => {
    const msg = currentNotice();
    if (!msg) return;
    ctx.fillStyle = 'rgba(40,6,16,0.9)';
    ctx.fillRect(0, 0, 480, 13);
    drawText(ctx, `Something went wrong: ${msg}`.slice(0, 90), 4, 2, { color: '#ffb0b0' });
  });
  document.getElementById('boot')!.style.display = 'none';
  screen.focus();
  requestAnimationFrame(loop);
  started = true;
}

let started = false;
window.addEventListener('error', (e) => (started ? reportError(e.error ?? e.message) : fail(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
try {
  start();
} catch (e) {
  fail(e);
}
