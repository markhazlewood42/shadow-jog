/**
 * Entry of the stage lab page (/sjestage.html), DEV only. A small shell, like `main.ts` for the engine lab: the engine, Pixi and the
 * stage are loaded behind one `import()`, so the page's own chunk is the engine's, as the real game will load Pixi (decision E6).
 *
 * `index.html` is the only build input, so this page and everything it imports are NOT in the shipped game
 * (tests/sje-imports.test.ts and `npm run budget` check that).
 */

function show(err: unknown): void {
  const el = document.getElementById('status');
  if (el) el.textContent = `Stage lab failed to start: ${err instanceof Error ? err.message : String(err)}`;
  (window as unknown as { __SJESTAGE_ERROR__?: string }).__SJESTAGE_ERROR__ = err instanceof Error ? err.message : String(err);
  console.error(err);
}

async function main(): Promise<void> {
  try {
    const lab = await import('./stagelab');
    await lab.startStageLab();
  } catch (e) {
    show(e);
  }
}

void main();

export {};
