/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { DEV_TOOLS } from './src/dev/tools';
import { defineConfig } from 'vitest/config';

const FX_FILE = resolve(import.meta.dirname, 'src/data/fx.json');
type FxDataModule = typeof import('./src/engine/fxdata');

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
 * The animation editor's endpoints (dev server only; the editor is /rigedit.html). /__rig/ask: see
 * below. Saving:
 * GET /__rig/skeleton returns public/art/rig/skeleton.json, POST checks the posted skeletons (each
 * has an arm and poses) and writes them. Answers `{ ok: true }` or `{ ok: false, problem }`.
 */
function rigEdit(): Plugin {
  return {
    name: 'shadowjog-rigedit',
    apply: 'serve',
    configureServer(server) {
      // "Ask Claude": Claude Code, headless, looks at the pose and Mark's note and answers with a
      // changed pose (scripts/rig-ask.mjs). One at a time.
      let asking = false;
      server.middlewares.use('/__rig/ask', (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') {
          reply(405, { ok: false, problem: 'POST only' });
          return;
        }
        if (asking) {
          reply(409, { ok: false, problem: 'Claude is still working on the last question.' });
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 8_000_000) req.destroy();
        });
        req.on('end', async () => {
          asking = true;
          try {
            const { askClaude } = await import('./scripts/rig-ask.mjs');
            const answer = await askClaude(JSON.parse(body));
            reply(200, { ok: true, ...answer });
          } catch (e) {
            reply(500, { ok: false, problem: e instanceof Error ? e.message : String(e) });
          } finally {
            asking = false;
          }
        });
      });
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
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
          if (body.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          let data: Record<string, { arm?: unknown; poses?: unknown }>;
          try {
            data = JSON.parse(body);
          } catch {
            reply(400, { ok: false, problem: 'not valid JSON' });
            return;
          }
          const bad = Object.entries(data ?? {}).find(([, r]) => !r || typeof r.arm !== 'object' || typeof r.poses !== 'object');
          if (!data || typeof data !== 'object' || bad) {
            reply(400, { ok: false, problem: bad ? `${bad[0]} has no arm or poses` : 'expected an object of skeletons' });
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

export default defineConfig({
  base: './',
  plugins: [fxLab(), artPass(), rigEdit(), devTools()],
  server: { port: 3007, watch: { usePolling: true } },
  // The chunk warning matches the CI budget (scripts/bundle-budget.mjs).
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: true, chunkSizeWarningLimit: 480 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
