/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { withBody } from './src/dev/endpoint';
import { dryFlag, isDry, sameOrigin } from './src/dev/sameorigin';
import { stageHandlers } from './src/dev/stageedit/serve';
import { DEV_TOOLS } from './src/dev/tools';
import { defineConfig } from 'vitest/config';

const FX_FILE = resolve(import.meta.dirname, 'src/data/fx.json');
type FxDataModule = typeof import('./src/sje/fx/fxdata');
type RigCheckModule = typeof import('./src/art/rig2/check');
type StageSaveModule = typeof import('./src/dev/stageedit/save');

/**
 * The FX lab's save endpoint (dev server only): GET /__fxlab/fx returns src/data/fx.json; POST
 * checks the posted data (engine/fxdata.ts `checkFx`) and writes it in the file's own format.
 * `?dry=1` (see `isDry`) checks and formats without writing (the tests use it). Answers with JSON:
 * `{ ok: true, text }` or `{ ok: false, problems }`.
 */
function fxLab(): Plugin {
  return {
    name: 'shadowjog-fxlab',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fxlab/fx', (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET') {
          reply(200, { ok: true, text: readFileSync(FX_FILE, 'utf8') });
          return;
        }
        if (req.method !== 'POST') {
          reply(405, { ok: false, problems: ['GET or POST only'] });
          return;
        }
        if (!sameOrigin(req)) {
          reply(403, { ok: false, problems: ['writes only from the dev server’s own pages'] });
          return;
        }
        if (dryFlag(req.url) === 'invalid') {
          reply(400, { ok: false, problems: ['dry must be 0 or 1, once, or left out'] });
          return;
        }
        // An oversize body is answered 413 at once and no more of it is read, a failure of the handler (fxdata.ts with a syntax error mid-edit makes ssrLoadModule reject) is answered 500: see withBody.
        withBody(req, res, {
          max: 1_000_000,
          reply,
          tooBig: { ok: false, problems: ['the body is bigger than 1000000 bytes'] },
          failed: (message) => ({ ok: false, problems: [`could not check the fx data: ${message}`] }),
          handle: async (body) => {
            // The checks and the file format, through the dev server (the same code the game and the
            // lab run, current after any edit to it).
            const { checkFx, formatFx } = (await server.ssrLoadModule('/src/sje/fx/fxdata.ts')) as FxDataModule;
            let data: unknown;
            try {
              data = JSON.parse(body);
            } catch {
              reply(400, { ok: false, problems: ['not valid JSON'] });
              return;
            }
            const problems = checkFx(data);
            if (problems.length) {
              reply(400, { ok: false, problems });
              return;
            }
            const text = formatFx(data as Parameters<typeof formatFx>[0]);
            try {
              if (!isDry(req.url)) writeFileSync(FX_FILE, text);
              reply(200, { ok: true, text });
            } catch (e) {
              console.error('[dev server] could not write fx.json:', e);
              reply(500, { ok: false, problems: ["couldn't write fx.json (the detail is in the dev server console)"] });
            }
          },
        });
      });
    },
  };
}

const STAGE_DATA_DIR = resolve(import.meta.dirname, 'src/data');
/** The test seam of the stage editor's save endpoint: `?scratch=<name>` reads and writes a private copy under the test fixtures (src/dev/stageedit/serve.ts). Git-ignored. */
const STAGE_SCRATCH_DIR = resolve(import.meta.dirname, 'tests/fixtures/stagedata/.scratch');

/**
 * The Battle Stage Editor's save endpoint (dev server only; the editor is /stageedit.html). GET /__stage/stages returns the 640 set's stage files (stages-640.json, axes.json,
 * enemyfacing.json, heroes.json) as text, GET /__stage/hud its HUD (hud-640.json); POST /__stage/stages saves ALL the files of one Save together or none (a refused Save changes
 * nothing), from the dev server's own pages only (403 from another site), and writes the 640 set only (ET decision 4). `?dry=1` checks and writes nothing (the tests use it).
 * The handlers, the answers and the test seam are in src/dev/stageedit/serve.ts; the checks are `prepareSave` of src/dev/stageedit/save.ts, loaded through the dev server so they are
 * current after any edit.
 */
function stageEdit(): Plugin {
  return {
    name: 'shadowjog-stageedit',
    apply: 'serve',
    configureServer(server) {
      const load = async () => (await server.ssrLoadModule('/src/dev/stageedit/save.ts')) as StageSaveModule;
      // The module is loaded once per request, before the handler runs, so a request always meets the checks as they are on disk now.
      const handle = (which: 'stages' | 'hud') => (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        // A failure of the load and a throw inside the handler (for example a malformed `req.url`) are both answered 500: the throw must not become an unhandled rejection (PR 86 review, round 4, finding 5).
        const fail = (what: string, e: unknown): void => {
          if (res.headersSent) return;
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          console.error(`[dev server] ${what}:`, e); // the detail stays on the server: it can name absolute paths
          res.end(JSON.stringify({ ok: false, problems: [`${what} (the detail is in the dev server console)`] }));
        };
        void load().then(
          (save) => {
            try {
              stageHandlers({ dataDir: STAGE_DATA_DIR, scratchRoot: STAGE_SCRATCH_DIR, prepare: save.prepareSave, screen: save.SET_SCREEN })[which](req, res);
            } catch (e) {
              fail('the stage endpoint failed', e);
            }
          },
          (e: unknown) => fail('could not load the save checks', e),
        );
      };
      server.middlewares.use('/__stage/stages', handle('stages'));
      server.middlewares.use('/__stage/hud', handle('hud'));
    },
  };
}

/** Where the art-pass data is. `SJ_ART_PASS_DIR` (set by playwright.config.ts) points it at the committed fixture `tests/fixtures/artpass`, so the specs do not need Mark's local, git-ignored `media/art-pass`. */
const ART_PASS = resolve(import.meta.dirname, process.env.SJ_ART_PASS_DIR ?? 'media/art-pass');

/**
 * The art-pass review endpoint (dev server only; the art itself stays in media/, out of git until
 * Mark picks). GET /__artpass/data gathers every generated asset's meta.json with the saved review
 * and the pass's spend; POST /__artpass/review saves the review (picks, verdicts, notes) to
 * media/art-pass/review.json. The review page is artreview.html; see scripts/pixellab/.
 * `POST /review?dry=1` (see `dryFlag`: only the value `1`; `dry=0` or no flag writes; any other form is a 400) checks the body and writes nothing (the tests use it): `{ ok: true, dry: true }` or the same 400 as a real save.
 */
function artPass(): Plugin {
  const readJson = (path: string): unknown => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
  return {
    name: 'shadowjog-artpass',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__artpass', (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        const route = (req.url ?? '').split('?')[0];
        try {
          if (req.method === 'GET' && route === '/data') {
            const dir = `${ART_PASS}/assets`;
            const assets = existsSync(dir)
              ? readdirSync(dir)
                  .filter((d) => existsSync(`${dir}/${d}/meta.json`))
                  .map((d) => readJson(`${dir}/${d}/meta.json`))
              : [];
            const ledger = existsSync(`${ART_PASS}/ledger.jsonl`)
              ? readFileSync(`${ART_PASS}/ledger.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { estimate?: number })
              : [];
            reply(200, {
              ok: true,
              assets,
              review: readJson(`${ART_PASS}/review.json`) ?? { assets: {} },
              spend: { requests: ledger.length, estimated: ledger.reduce((n, l) => n + (l.estimate ?? 0), 0), balance: readJson(`${ART_PASS}/balance.json`) },
            });
            return;
          }
          if (req.method === 'POST' && route === '/review') {
            if (!sameOrigin(req)) {
              reply(403, { ok: false, problem: 'writes only from the dev server’s own pages' });
              return;
            }
            if (dryFlag(req.url) === 'invalid') {
              reply(400, { ok: false, problem: 'dry must be 0 or 1, once, or left out' });
              return;
            }
            // An oversize body is answered 413 at once and no more of it is read; a failure of the handler is answered 500: see withBody.
            withBody(req, res, {
              max: 2_000_000,
              reply,
              tooBig: { ok: false, problem: 'the body is bigger than 2000000 bytes' },
              failed: (message) => ({ ok: false, problem: `couldn't save: ${message}` }),
              handle: (body) => {
                try {
                  const data = JSON.parse(body) as { assets?: unknown };
                  // `assets` is a plain object: `null` and an array are refused, because a real save would write them to review.json.
                  if (!data || typeof data !== 'object' || typeof data.assets !== 'object' || data.assets === null || Array.isArray(data.assets)) {
                    reply(400, { ok: false, problem: 'expected { assets: {...} }' });
                    return;
                  }
                  if (isDry(req.url)) {
                    reply(200, { ok: true, dry: true });
                    return;
                  }
                  writeFileSync(`${ART_PASS}/review.json`, `${JSON.stringify({ ...data, saved: new Date().toISOString() }, null, 1)}\n`);
                  reply(200, { ok: true });
                } catch (e) {
                  reply(400, { ok: false, problem: `couldn't save: ${String(e)}` });
                }
              },
            });
            return;
          }
          reply(404, { ok: false, problem: 'GET /data or POST /review' });
        } catch (e) {
          console.error('[dev server] the review endpoint failed:', e);
          reply(500, { ok: false, problem: 'the review endpoint failed (the detail is in the dev server console)' });
        }
      });
    },
  };
}

const SKELETON_FILE = resolve(import.meta.dirname, 'public/art/rig/skeleton.json');

/**
 * The animation editor's save endpoint (dev server only; the editor is /rigedit.html):
 * GET /__rig/skeleton returns public/art/rig/skeleton.json; POST, from the dev server's own pages
 * only, checks the posted skeletons' whole structure (src/art/rig2/check.ts) and writes them.
 * Answers `{ ok: true }` or `{ ok: false, problem }`. `?dry=1` runs every check and writes nothing (the tests use it): `{ ok: true, dry: true }`.
 */
function rigEdit(): Plugin {
  return {
    name: 'shadowjog-rigedit',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__rig/skeleton', (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET') {
          reply(200, { ok: true, data: JSON.parse(readFileSync(SKELETON_FILE, 'utf8')) });
          return;
        }
        if (req.method !== 'POST') {
          reply(405, { ok: false, problem: 'GET or POST only' });
          return;
        }
        if (!sameOrigin(req)) {
          reply(403, { ok: false, problem: 'writes only from the dev server’s own pages' });
          return;
        }
        if (dryFlag(req.url) === 'invalid') {
          reply(400, { ok: false, problem: 'dry must be 0 or 1, once, or left out' });
          return;
        }
        // An oversize body is answered 413 at once and no more of it is read; a failure of the handler is answered 500: see withBody.
        withBody(req, res, {
          max: 1_000_000,
          reply,
          tooBig: { ok: false, problem: 'the body is bigger than 1000000 bytes' },
          failed: (message) => ({ ok: false, problem: `could not check the skeletons: ${message}` }),
          handle: async (body) => {
            let data: unknown;
            try {
              data = JSON.parse(body);
            } catch {
              reply(400, { ok: false, problem: 'not valid JSON' });
              return;
            }
            // The checks through the dev server (current after any edit to them).
            const { checkSkeletons } = (await server.ssrLoadModule('/src/art/rig2/check.ts')) as RigCheckModule;
            const problems = checkSkeletons(data);
            // A save never drops someone the file has (an empty or partial post would wipe them).
            // Only once the check has shown it's an object: `id in null` would throw (Copilot review of PR #1).
            if (!problems.length) {
              const gone = Object.keys(JSON.parse(readFileSync(SKELETON_FILE, 'utf8')) as object).filter((id) => !(id in (data as object)));
              if (gone.length) problems.push(`would remove ${gone.join(', ')}`);
            }
            if (problems.length) {
              reply(400, { ok: false, problem: problems.slice(0, 5).join('; ') + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : '') });
              return;
            }
            if (isDry(req.url)) {
              reply(200, { ok: true, dry: true });
              return;
            }
            try {
              writeFileSync(SKELETON_FILE, `${JSON.stringify(data, null, 1)}
`);
              reply(200, { ok: true });
            } catch (e) {
              console.error('[dev server] could not write skeleton.json:', e);
              reply(500, { ok: false, problem: "couldn't write skeleton.json (the detail is in the dev server console)" });
            }
          },
        });
      });
    },
  };
}

/**
 * `npm run dev` prints the main dev tools under the server's own addresses (the full list is the
 * DEV menu on the game page; both come from src/dev/tools.ts).
 */
function devTools(): Plugin {
  return {
    name: 'shadowjog-devtools',
    apply: 'serve',
    configureServer(server) {
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        print();
        const base = (server.resolvedUrls?.local[0] ?? 'http://localhost:3007/').replace(/\/$/, '');
        const main = DEV_TOOLS.flatMap((g) => g.tools).filter((t) => t.print);
        const width = Math.max(...main.map((t) => t.name.length));
        server.config.logger.info('\n  Dev tools (all of them: the DEV tab on the game page, or the ` key):');
        for (const t of main) server.config.logger.info(`  [2m➜[0m  ${t.name.padEnd(width)}  [36m${base}${t.path}[0m`);
      };
    },
  };
}

/** The game's version, from package.json: the one place it is written down. */
const APP_VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * The short git commit the build was made from (the title screen shows it); a build with no .git
 * folder (or no git) says 'nogit'. `SJ_BUILD_SHA` overrides it: a screenshot compare across two
 * commits (docs/PIVOT-640.md, PL2) pins the label, so the only pixels that differ are real ones.
 * Unset, which is every normal build, it is the real commit.
 */
function buildSha(): string {
  const pinned = process.env.SJ_BUILD_SHA;
  if (pinned) return pinned;
  try {
    // cwd pins git to this project's folder, so a build started from elsewhere can't stamp another repo's commit.
    return (
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'nogit'
    );
  } catch {
    return 'nogit';
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  // The lab page needs none of the game's art (public/art).
  ...(mode === 'lab' ? { publicDir: false } : {}),
  // `define` swaps these names for the given values wherever they appear in the source, at build time
  // (and in tests), so src/version.ts can show the version and commit without reading any file at runtime.
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION), __BUILD_SHA__: JSON.stringify(buildSha()) },
  plugins: [fxLab(), artPass(), rigEdit(), stageEdit(), devTools()],
  server: { port: 3007, watch: { usePolling: true } },
  // Pixi and Three load lazily (the lab page now, the 3D mode later). Without this, the dev server finds each one on its
  // first import, optimizes it and RELOADS the page, in the middle of an e2e run (docs/engine/tooling-and-testing.md section 10).
  optimizeDeps: { include: ['pixi.js', 'three', 'three/examples/jsm/postprocessing/UnrealBloomPass.js'] },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: true,
    // The chunk warning matches the CI budget (scripts/bundle-budget.mjs).
    chunkSizeWarningLimit: 480,
    // dist/.vite/manifest.json: scripts/bundle-budget.mjs sorts the chunks into classes by it. It adds a file and changes no JavaScript.
    manifest: true,
    // The engine lab page builds on its own, in `--mode lab` into dist-lab (scripts/bundle-budget.mjs runs it). The game build
    // (index.html only) never holds the lab, Pixi or Three, until the game itself loads the engine (M6) and the 3D mode (M7).
    ...(mode === 'lab' ? { outDir: 'dist-lab', rollupOptions: { input: { sjelab: resolve(import.meta.dirname, 'sjelab.html') } } } : {}),
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
