import { reportError } from './engine/errors';

function fail(err: unknown): void {
  const el = document.getElementById('boot');
  if (el) {
    el.classList.add('error');
    el.style.display = 'flex';
    el.textContent = `SHADOW JOG failed to start.\n\n${err instanceof Error ? err.message : String(err)}`;
  }
  console.error(err);
}

let started = false;
window.addEventListener('error', (e) => (started ? reportError(e.error ?? e.message) : fail(e.error ?? e.message)));
// The engine's awaited promises reject with `Cancelled` (its `name`) when their scene ends. That is not a bug: no notice.
window.addEventListener('unhandledrejection', (e) => {
  if ((e.reason as { name?: string } | null)?.name === 'Cancelled') return e.preventDefault();
  reportError(e.reason);
});
try {
  // The game runs on the Pixi engine (M6; the Canvas 2D path and its `?engine=sje` flag are gone). Its code, all of Pixi included, is a chunk of its own that is fetched
  // here, so this entry file stays small. A browser without WebGL 2 lands in `fail` with the message of `GlRenderer.create` (decision E5).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('engine')) console.warn('The ?engine= parameter is ignored: the new engine is the only engine.');
  void import('./sje/boot').then((m) => m.startSje(() => (started = true))).catch(fail);
} catch (e) {
  fail(e);
}
