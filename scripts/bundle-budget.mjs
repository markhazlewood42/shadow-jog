// Bundle budget (M0): run after `vite build` and `vite build --mode lab` (`npm run budget` does both). It fails if the
// shipped JavaScript outgrows its budget, so the bundle size is a gate, not a number someone has to remember to re-check.
//   node scripts/bundle-budget.mjs
//
// It reads the Vite manifests (`build.manifest: true`): dist/.vite/manifest.json for the game, and dist-lab/.vite/manifest.json for the
// engine lab page, which is NOT in the game build (it builds on its own, in `--mode lab`; the lab holds Pixi, the engine and Three until
// the game itself loads them in M6 and M7). Chunks are sorted into classes by reachability over `imports` and `dynamicImports`
// (docs/engine/tooling-and-testing.md section 10):
//
//   boot        the entry's static closure. HARD CHECK: no `pixi.js` and no `three` module in it.
//   lazy-2d     lazily loaded chunks that hold Pixi or the engine (src/sje), and no Three.
//   lazy-3d     lazily loaded chunks that hold Three (the 3D mode). Own cap.
//   lazy-other  every other lazily loaded chunk (battle, deck, tables, dev).
//   first play  boot + lazy-2d. Reported only, until M1 measures it.
//
// Which modules a chunk holds comes from its source map (`sourcemap: true` in vite.config.ts), because the manifest lists chunks, not modules.
// Two Vite traps found in the lab (tooling-and-testing.md section 10) are checked here too: no named `output.codeSplitting` group (it moved the
// preload helper into the Pixi chunk, so the entry then imported 150 kB statically) and no top-level `await renderer.init()` (it hung a build).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Largest single chunk, raw bytes; and all JavaScript, gzipped (what a player downloads).
 * Re-set 2026-09-29, when the battle system moved to its own lazily loaded chunk: the boot chunk
 * went from 558 kB to 452 kB, so its cap drops to 480 kB (it gates the first download). The
 * total grows with content (it was 186 kB of 190 before the split, 188 kB after); it now sits
 * 12 kB above the measured size, to catch an unplanned jump rather than every new line of story.
 * Total re-set to 212 kB the same evening, for the planned work on Mark's first playthrough notes
 * (Hex's deck scene and art, the shop's equip and sell-all, the damage-type symbols, the terrain
 * relief pass, the chest glow, finer creature art): measured 200 kB, with the deck scene split
 * into its own chunk so the boot chunk stays under its cap.
 * Re-set to 224 kB on 2026-09-30 for playthrough 2 (the level-up panel, the jingle, the valve
 * sounds, the equip screen) and the GPU effects layer Mark asked for (the WebGL presenter and its
 * shaders, the particle simulation and emitter presets, about 4 kB): measured 213.7 kB.
 * Re-set to 236 kB the night of 2026-09-30 (Mark): rig v2 (characters, enemies and portraits drawn
 * and animated in code from traced frames, their data loaded as JSON) and the battle skeleton
 * filled the 224; measured 224.9 kB, with room for the rest of the rig and the effects pass.
 * Raised to 238.5 kB on 2026-10-08 (D20 of docs/PIVOT-640.md), by the measured delta only: the total
 * measured 238.413 kB against 236.0, a delta of 2.413 kB, rounded up to the next 0.1 kB (2.5). The cause is the
 * surround art for the maps smaller than the 640x360 view (Mark's Review 3 pick for D7: an edge fill
 * for the nine interiors, a themed surround for the Rustyard and the Dock) and the pop-in table with
 * its curtains and hold (his D17 picks). Round 1 of WP3 kept that code in the dev build only, at
 * 235.9 kB, because nothing chose it yet; it ships now.
 * Raised to 239.5 kB on 2026-10-08 (D20, WP3 round 3), by the measured delta only: the total measured
 * 239.343 kB (239,343 bytes) against 238.413 at the 238.5 alarm, a delta of 0.930 kB, rounded up to the next
 * 0.1 kB (1.0). The causes: `field/overrects.ts` and the field code that lights only the occupied
 * parts of an overhead layer (a performance fix, D15), and the Rustyard's and the Dock's colors and
 * alphas written as named theme records (`YARD`, `DOCK`, `EDGE_FILL` in `fieldkit/surround-art.ts`)
 * instead of inline literals.
 * Raised to 240.0 kB on 2026-10-08 (D20, WP4), by the measured delta only: the total measured 239.837 kB
 * (239,837 bytes) against 239.343 at the 239.5 alarm, a delta of 0.494 kB, rounded up to the next 0.1 kB (0.5).
 * The causes: the UI layout values named in `ui/layout.ts` (the dialog cap, the menu panes, the shop, the
 * Status screen, `rowsFor`), the compact party cards beside Items and Techs, the dev-only review-switch
 * reads, and the Status screen's three ability columns.
 * Raised to 240.7 kB on 2026-10-08 (D20, WP5), by the measured delta only: the total measured 240.517 kB
 * (240,517 bytes) against 239.837 at the 240.0 alarm, a delta of 0.680 kB, rounded up to the next 0.1 kB (0.7).
 * The causes: the title's composition as named data (`scenes/title-layout.ts`), the page offsets and the
 * results-window values in `ui/layout.ts`, the re-authored comic-panel table with its pinned portrait
 * scale. Mark confirmed this raise at Review 5 (D20).
 * Raised to 240.8 kB on 2026-10-09 (D20, WP7), by the measured delta only: the total measured 240.788 kB
 * (240,788 bytes; 240,786 with the build label pinned to "pivot640") against 240.7, a delta of 0.088 kB,
 * rounded up to the next 0.1 kB (0.1). The cause: WP6 round 2 derives the set pieces of five
 * battle backdrops from the world width (named count-and-step records at the top of `art/battlebg.ts`);
 * WP6 round 1 measured 240.5 kB. WP7 changes no file under `src/`. Mark confirms this raise in the pull
 * request (D20).
 */
const CHUNK_MAX = 480 * 1000;
const GZIP_TOTAL_MAX = 240.8 * 1000;

/**
 * The lazy 3D chunk (Three, the 3D facade, the UnrealBloomPass), gzip. Set at 160 kB on 2026-10-05 (real choice C5, accepted by Mark): the spike
 * measured 145.1 kB for it. It is built only in the lab build until the game starts a hack (M7). Confirm it at M1 and M6.
 */
const LAZY_3D_GZIP_MAX = 160 * 1000;

// `first play` (boot + lazy-2d) has NO cap: it is reported until M1 measures it (estimate 330 to 430 kB gzip, low confidence).

const root = process.cwd();
const gz = (buf) => gzipSync(buf).length;
const kb = (n) => (n / 1000).toFixed(1).padStart(7);

/** The module paths a chunk holds, from its source map (empty if there is none). */
function modulesOf(dir, file) {
  const map = join(dir, `${file}.map`);
  if (!existsSync(map)) return [];
  return JSON.parse(readFileSync(map, 'utf8')).sources.map((s) => s.split('\\').join('/'));
}

/**
 * Read one build and sort its chunks into classes.
 * Returns `{ chunks: [{ file, raw, gzip, cls, pixi, three, sje, unused }], boot, ... }`.
 */
function readBuild(name, dir) {
  const manifestPath = join(dir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // The entry's static closure.
  const boot = new Set();
  const visit = (key) => {
    if (boot.has(key) || !manifest[key]) return;
    boot.add(key);
    for (const dep of manifest[key].imports ?? []) visit(dep);
  };
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  const chunks = [];
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.file.endsWith('.js')) continue;
    const text = readFileSync(join(dir, chunk.file));
    const modules = modulesOf(dir, chunk.file);
    const has = (re) => modules.some((m) => re.test(m));
    const pixi = has(/node_modules\/pixi\.js\//);
    const three = has(/node_modules\/three\//);
    const sje = has(/(^|\/)src\/sje(-lab)?\//);
    const unused = /node_modules\/pixi\.js\/lib\/environment-(browser|webworker)\//.test(key);
    let cls;
    if (boot.has(key)) cls = 'boot';
    else if (unused) cls = 'lazy-2d';
    else if (three) cls = 'lazy-3d';
    else if (pixi || sje) cls = 'lazy-2d';
    else cls = 'lazy-other';
    // Pixi's environment chunks exist because Pixi's `init` can import them. The engine skips that step (`skipExtensionImports`), so a
    // player never downloads them (canary 8 of e2e/sje-canaries.spec.ts proves it). They are listed, and left out of `first play`.
    chunks.push({ name, file: chunk.file, raw: text.length, gzip: gz(text), cls, pixi, three, unused });
  }
  return { name, dir, chunks };
}

const CLASSES = ['boot', 'lazy-2d', 'lazy-3d', 'lazy-other'];
const sum = (build, cls, field, { skipUnused = false } = {}) =>
  build ? build.chunks.filter((c) => c.cls === cls && !(skipUnused && c.unused)).reduce((n, c) => n + c[field], 0) : 0;

const game = readBuild('game', 'dist');
const lab = readBuild('lab', 'dist-lab');
if (!game || !game.chunks.length) {
  console.error('bundle budget: no manifest in dist/.vite (run `vite build` first; build.manifest is on)');
  process.exit(1);
}
let fail = false;
const problem = (msg) => {
  console.error(`bundle budget: ${msg}`);
  fail = true;
};

for (const build of [game, lab]) {
  if (!build) continue;
  console.log(`${build.name === 'game' ? '1. the shipped game (dist)' : '2. the engine lab page (dist-lab, not shipped)'}`);
  for (const c of build.chunks.sort((a, b) => a.cls.localeCompare(b.cls) || b.gzip - a.gzip)) {
    const tags = [c.pixi ? 'pixi' : '', c.three ? 'three' : '', c.unused ? 'never downloaded: skipExtensionImports' : ''].filter(Boolean).join(', ');
    console.log(`  ${c.cls.padEnd(10)} ${c.file.padEnd(34)} ${kb(c.raw)} kB  gzip ${kb(c.gzip)} kB${tags ? `  (${tags})` : ''}`);
  }
}

// ---- the report: all five classes, gzip kB, for each build ----
console.log('\nclass          game gzip     lab gzip');
for (const cls of CLASSES) console.log(`  ${cls.padEnd(12)} ${kb(sum(game, cls, 'gzip'))} kB  ${lab ? `${kb(sum(lab, cls, 'gzip'))} kB` : '     (no lab build)'}`);
const firstPlay = (b) => sum(b, 'boot', 'gzip') + sum(b, 'lazy-2d', 'gzip', { skipUnused: true });
console.log(`  ${'first play'.padEnd(12)} ${kb(firstPlay(game))} kB  ${lab ? `${kb(firstPlay(lab))} kB` : '     (no lab build)'}   (boot + lazy-2d; reported, no cap until M1)`);

// ---- hard checks ----
// 1. No Pixi or Three in `boot` of either build.
for (const build of [game, lab]) {
  if (!build) continue;
  for (const c of build.chunks.filter((x) => x.cls === 'boot')) {
    if (c.pixi) problem(`${build.name}: the boot chunk ${c.file} holds a pixi.js module (the first download must not carry the engine)`);
    if (c.three) problem(`${build.name}: the boot chunk ${c.file} holds a three module`);
  }
}
// 2. The shipped game has no engine yet (M6 and M7 relax this on purpose).
for (const c of game.chunks) {
  if (c.pixi || c.three) problem(`game: chunk ${c.file} holds ${c.pixi ? 'Pixi' : 'Three'}; the game does not load the engine before M6`);
}
// 3. The old alarms, on the shipped game: the largest chunk (raw), and all JavaScript gzipped (what a player downloads).
for (const c of game.chunks) if (c.raw > CHUNK_MAX) problem(`game: ${c.file} is ${c.raw} bytes, over the ${CHUNK_MAX} byte largest-chunk cap`);
const gameGzip = game.chunks.reduce((n, c) => n + c.gzip, 0);
console.log(`\ngame total gzip ${(gameGzip / 1000).toFixed(1)} kB (budget ${GZIP_TOTAL_MAX / 1000} kB); largest chunk budget ${CHUNK_MAX / 1000} kB`);
if (gameGzip > GZIP_TOTAL_MAX) problem(`game: total gzip ${gameGzip} is over ${GZIP_TOTAL_MAX}`);
// 4. The lazy 3D class has its own cap (the lab build, until M7).
if (lab) {
  const three = sum(lab, 'lazy-3d', 'gzip');
  console.log(`lab lazy-3d gzip ${(three / 1000).toFixed(1)} kB (budget ${LAZY_3D_GZIP_MAX / 1000} kB)`);
  if (three === 0) problem('lab: no lazy-3d chunk found (the classification is blind, or the lab no longer loads Three)');
  if (three > LAZY_3D_GZIP_MAX) problem(`lab: lazy-3d gzip ${three} is over ${LAZY_3D_GZIP_MAX}`);
  if (sum(lab, 'lazy-2d', 'gzip') === 0) problem('lab: no lazy-2d chunk found (the classification is blind)');
} else {
  problem('no lab build in dist-lab (run `vite build --mode lab`; `npm run budget` does)');
}
// 5. The two Vite traps (tooling-and-testing.md section 10).
const config = readFileSync(join(root, 'vite.config.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
if (/codeSplitting|manualChunks/.test(config)) problem('vite.config.ts names output chunk groups (codeSplitting or manualChunks): a named group for Pixi or Three moved the preload helper into it and made the entry import it statically');
function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (name.endsWith('.ts')) yield p;
  }
}
for (const f of [...sourceFiles(join(root, 'src/sje')), ...sourceFiles(join(root, 'src/sje-lab'))]) {
  const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/^await\s[^\n]*\.init\(/m.test(code)) problem(`${f}: a top-level await on init hung a production build in the lab; run init in an async function`);
}

if (fail) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
console.log('bundle budget ok');
