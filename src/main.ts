import { Display } from './engine/display';
import { Game, FPS } from './engine/game';
import { Input } from './engine/input';
import { boot } from './boot';

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
  document.getElementById('boot')!.style.display = 'none';
  screen.focus();
  requestAnimationFrame(loop);
}

window.addEventListener('error', (e) => fail(e.error ?? e.message));
try {
  start();
} catch (e) {
  fail(e);
}
