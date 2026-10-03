/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { DEV_TOOLS } from './src/dev/tools';
import { defineConfig } from 'vitest/config';

const FX_FILE = resolve(import.meta.dirname, 'src/data/fx.json');
type FxDataModule = typeof import('./src/engine/fxdata');
type RigCheckModule = typeof import('./src/art/rig2/check');

/**
 * Whether a request to one of the dev server's write endpoints came from the dev server's own pages
 * (the editors), not from another site open in the browser: a browser marks a cross-site request
 * (Sec-Fetch-Site) and names the page's origin (Origin), and a page elsewhere could otherwise post
 * to localhost and overwrite project files (Copilot review of main, 2026-10-02). A request with
 * neither (a script, node's fetch) is allowed: it isn't a web page.
 */
function sameOrigin(req: import('node:http').IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * The FX lab's save endpoint (dev server only): GET /__fxlab/fx returns src/data/fx.json; POST
 * checks the posted data (engine/fxdata.ts `checkFx`) and writes it in the file's own format.
 * `?dry=1` checks and formats without writing (the tests use it). Answers with JSON:
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
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', async () => {
          // The checks and the file format, through the dev server (the same code the game and the
          // lab run, current after any edit to it).
          const { checkFx, formatFx } = (await server.ssrLoadModule('/src/engine/fxdata.ts')) as FxDataModule;
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
            if (!(req.url ?? '').includes('dry=1')) writeFileSync(FX_FILE, text);
            reply(200, { ok: true, text });
          } catch (e) {
            reply(500, { ok: false, problems: [`couldn't write fx.json: ${String(e)}`] });
          }
        });
      });
    },
  };
}

const STAGES_FILE = resolve(import.meta.dirname, 'src/data/stages.json');
const AXES_FILE = resolve(import.meta.dirname, 'src/data/axes.json');
const HUD_FILE = resolve(import.meta.dirname, 'src/data/hud.json');
type StageSaveModule = typeof import('./src/stage/edit/save');

/**
 * The Battle Stage Editor's save endpoint (dev server only): GET /__stage/stages returns the two data files
 * (src/data/stages.json and src/data/axes.json) as text; POST checks the posted `{ stages, axes }` with the module
 * the game loads them with (src/stage/edit/save.ts: `checkStagesWith`, which lays each stage's HUD overrides over the
 * global hud.json AS IT IS ON DISK, the way the game's loader does) and, only if both are fine, writes both in the
 * editor's stable format. It answers `{ ok, problems: [] }` (docs/TOOLING-UI.md 2.5).
 *
 * `?dry=1` checks and formats without writing. `?scratch=<name>` (letters, digits, dashes) reads and writes a
 * private copy in the OS temp folder instead of the repo files, which is how the tests save and reload without
 * touching the real data: a scratch name that has never been saved reads the real files.
 *
 * The one global HUD layout (src/data/hud.json) has its own endpoint, /__stage/hud, with the same contract: GET
 * returns the file as text, POST checks the posted `{ layout }` with the HUD loader's own check
 * (`prepareHudSave`) and writes it in the editor's stable format. Stage saves and HUD saves never share a request.
 */
function stageEdit(): Plugin {
  const scratchDir = (url: URL): string | null => {
    const name = url.searchParams.get('scratch');
    if (!name) return null;
    if (!/^[a-z0-9-]{1,48}$/.test(name)) throw new Error('a scratch name is letters, digits and dashes');
    const dir = join(tmpdir(), 'shadowjog-stageedit', name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return {
    name: 'shadowjog-stageedit',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__stage/stages', (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        let dir: string | null;
        let url: URL;
        try {
          url = new URL(req.url ?? '/', 'http://localhost');
          dir = scratchDir(url);
        } catch (e) {
          reply(400, { ok: false, problems: [String(e instanceof Error ? e.message : e)] });
          return;
        }
        const stagesPath = dir ? join(dir, 'stages.json') : STAGES_FILE;
        const axesPath = dir ? join(dir, 'axes.json') : AXES_FILE;
        const hudPath = dir ? join(dir, 'hud.json') : HUD_FILE;
        if (req.method === 'GET') {
          const from = (path: string, real: string) => readFileSync(existsSync(path) ? path : real, 'utf8');
          reply(200, { ok: true, problems: [], stages: from(stagesPath, STAGES_FILE), axes: from(axesPath, AXES_FILE), scratch: !!dir });
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
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', async () => {
          const { prepareSave } = (await server.ssrLoadModule('/src/stage/edit/save.ts')) as StageSaveModule;
          let data: unknown;
          try {
            data = JSON.parse(body);
          } catch {
            reply(400, { ok: false, problems: ['not valid JSON'] });
            return;
          }
          // Check the stages against the global HUD file as it is on disk right now (the scratch copy if there is one), as the game's loader does.
          const hudOnDisk = readFileSync(existsSync(hudPath) ? hudPath : HUD_FILE, 'utf8');
          const made = prepareSave(data, hudOnDisk);
          if (!made.ok) {
            reply(400, { ok: false, problems: made.problems });
            return;
          }
          try {
            if (!url.searchParams.has('dry')) {
              writeFileSync(stagesPath, made.stagesText);
              writeFileSync(axesPath, made.axesText);
            }
            reply(200, { ok: true, problems: [], stages: made.stagesText, axes: made.axesText, file: dir ? `scratch copy ${url.searchParams.get('scratch')}` : 'src/data/stages.json' });
          } catch (e) {
            reply(500, { ok: false, problems: [`couldn't write the stage files: ${String(e)}`] });
          }
        });
      });
      server.middlewares.use('/__stage/hud', (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        let dir: string | null;
        let url: URL;
        try {
          url = new URL(req.url ?? '/', 'http://localhost');
          dir = scratchDir(url);
        } catch (e) {
          reply(400, { ok: false, problems: [String(e instanceof Error ? e.message : e)] });
          return;
        }
        const hudPath = dir ? join(dir, 'hud.json') : HUD_FILE;
        if (req.method === 'GET') {
          reply(200, { ok: true, problems: [], hud: readFileSync(existsSync(hudPath) ? hudPath : HUD_FILE, 'utf8'), scratch: !!dir });
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
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', async () => {
          const { prepareHudSave } = (await server.ssrLoadModule('/src/stage/edit/save.ts')) as StageSaveModule;
          let data: { layout?: unknown };
          try {
            data = JSON.parse(body) as { layout?: unknown };
          } catch {
            reply(400, { ok: false, problems: ['not valid JSON'] });
            return;
          }
          const made = prepareHudSave(data.layout);
          if (!made.ok) {
            reply(400, { ok: false, problems: made.problems });
            return;
          }
          try {
            if (!url.searchParams.has('dry')) writeFileSync(hudPath, made.text);
            reply(200, { ok: true, problems: [], hud: made.text, file: dir ? `scratch copy ${url.searchParams.get('scratch')}` : 'src/data/hud.json' });
          } catch (e) {
            reply(500, { ok: false, problems: [`couldn't write hud.json: ${String(e)}`] });
          }
        });
      });
    },
  };
}

const ART_PASS = resolve(import.meta.dirname, 'media/art-pass');

/**
 * The art-pass review endpoint (dev server only; the art itself stays in media/, out of git until
 * Mark picks). GET /__artpass/data gathers every generated asset's meta.json with the saved review
 * and the pass's spend; POST /__artpass/review saves the review (picks, verdicts, notes) to
 * media/art-pass/review.json. The review page is artreview.html; see scripts/pixellab/.
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
            let body = '';
            req.on('data', (chunk: Buffer) => {
              body += chunk.toString('utf8');
              if (body.length > 2_000_000) req.destroy();
            });
            req.on('end', () => {
              try {
                const data = JSON.parse(body) as { assets?: unknown };
                if (!data || typeof data !== 'object' || typeof data.assets !== 'object') {
                  reply(400, { ok: false, problem: 'expected { assets: {...} }' });
                  return;
                }
                writeFileSync(`${ART_PASS}/review.json`, `${JSON.stringify({ ...data, saved: new Date().toISOString() }, null, 1)}\n`);
                reply(200, { ok: true });
              } catch (e) {
                reply(400, { ok: false, problem: `couldn't save: ${String(e)}` });
              }
            });
            return;
          }
          reply(404, { ok: false, problem: 'GET /data or POST /review' });
        } catch (e) {
          reply(500, { ok: false, problem: String(e) });
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
 * Answers `{ ok: true }` or `{ ok: false, problem }`.
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
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', async () => {
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
          try {
            writeFileSync(SKELETON_FILE, `${JSON.stringify(data, null, 1)}
`);
            reply(200, { ok: true });
          } catch (e) {
            reply(500, { ok: false, problem: `couldn't write skeleton.json: ${String(e)}` });
          }
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

/** The short git commit the build was made from; a build with no .git folder (or no git) says 'nogit'. */
function buildSha(): string {
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

export default defineConfig({
  base: './',
  // `define` swaps these names for the given values wherever they appear in the source, at build time
  // (and in tests), so src/version.ts can show the version and commit without reading any file at runtime.
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION), __BUILD_SHA__: JSON.stringify(buildSha()) },
  plugins: [fxLab(), stageEdit(), artPass(), rigEdit(), devTools()],
  server: { port: 3007, watch: { usePolling: true } },
  // The chunk warning matches the CI budget (scripts/bundle-budget.mjs).
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: true, chunkSizeWarningLimit: 480 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
