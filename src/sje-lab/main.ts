/**
 * Entry of the engine lab page (/sjelab.html), DEV only. A small shell: the engine, Pixi and the
 * lab are loaded behind one `import()`, as the real game will load Pixi (decision E6). That also
 * puts the engine in its own chunk, so `scripts/sjelab-size.mjs` can measure it.
 *
 * `index.html` is the only build input, so this page, `lab.ts` and everything it imports are NOT
 * in the shipped game (tests/sje-imports.test.ts and `npm run budget` check that).
 */

function show(err: unknown): void {
  const el = document.getElementById('status');
  if (el) el.textContent = `Engine lab failed to start: ${err instanceof Error ? err.message : String(err)}`;
  (window as unknown as { __SJE_ERROR__?: string }).__SJE_ERROR__ = err instanceof Error ? err.message : String(err);
  console.error(err);
}

async function main(): Promise<void> {
  try {
    const lab = await import('./lab');
    await lab.startLab();
  } catch (e) {
    show(e);
  }
}

void main();
