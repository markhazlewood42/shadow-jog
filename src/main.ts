import { Display } from './engine/display';
import { FPS, Game } from './engine/game';
import { H, W } from './sje/core/size';
import { Input } from './engine/input';
import { boot } from './boot';
import { currentNotice, reportError } from './engine/errors';
import { drawText, fitText, measure, wrap } from './engine/font';
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
  game.overlays.push((ctx) => {
    const n = currentNotice();
    if (!n) return;
    if (n.tone === 'saved') {
      // Small corner badge; never covers the field HUD.
      ctx.fillStyle = 'rgba(10,9,19,0.8)';
      ctx.fillRect(W - 70, H - 14, 66, 11);
      drawText(ctx, `{c}♦{/} ${n.text}`, W - 66, H - 13, { color: '#b8bcd0' });
      return;
    }
    if (n.tone === 'news') {
      // A nudge along the bottom edge: worth knowing, never in the way.
      const w = Math.min(W - 8, measure(n.text) + 20);
      ctx.fillStyle = 'rgba(10,9,19,0.86)';
      ctx.fillRect(W / 2 - w / 2, H - 16, w, 12);
      drawText(ctx, `{y}★{/} ${fitText(n.text, w - 20)}`, W / 2 - w / 2 + 5, H - 15, { color: '#e8e4ff' });
      return;
    }
    // Up to two wrapped lines; anything longer ends in an ellipsis rather than mid-word.
    // An error keeps its detail (it's what a bug report needs) but leads with what happened in the
    // game's own voice: something broke, and play carried on.
    const text = n.tone === 'warn' ? n.text : `Something glitched, and the game kept going. (${n.text})`;
    const lines = wrap(text, W - 8);
    if (lines.length > 2) lines.splice(1, lines.length - 1, fitText(lines.slice(1).join(' '), W - 8));
    ctx.fillStyle = n.tone === 'warn' ? 'rgba(46,34,6,0.92)' : 'rgba(40,6,16,0.9)';
    ctx.fillRect(0, 0, W, 3 + lines.length * 10);
    for (const [i, ln] of lines.entries()) drawText(ctx, ln, 4, 2 + i * 10, { color: n.tone === 'warn' ? '#ffe0a0' : '#ffb0b0' });
  });
  document.getElementById('boot')!.style.display = 'none';
  screen.focus();
  requestAnimationFrame(loop);
  started = true;
  // The page's own pre-start error screen (index.html) stands down.
  (window as unknown as { __sjStarted?: boolean }).__sjStarted = true;
}

let started = false;
window.addEventListener('error', (e) => (started ? reportError(e.error ?? e.message) : fail(e.error ?? e.message)));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
try {
  start();
} catch (e) {
  fail(e);
}
