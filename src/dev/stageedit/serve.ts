/**
 * The Battle Stage Editor's save endpoint (dev server only; ET task 4). `vite.config.ts` mounts the two handlers below at `/__stage/stages` and `/__stage/hud`.
 *
 * Node only: it reads and writes files. It imports nothing from the engine, so `vite.config.ts` can load it at start-up. The checks are done by `prepareSave` (`save.ts`), which the
 * config loads through the dev server (`server.ssrLoadModule`) and hands in, so the server always runs the checks as they are on disk now, and a test hands in the same function.
 *
 * `GET  /__stage/stages`  the stage files as text: `{ ok, problems: [], stages, axes, facing, heroes, scratch }`.
 * `POST /__stage/stages`  ONE Save. The body is `{ stages, axes, hud, facing, heroes, write }` (see `save.ts`). Answers:
 *     403  the request did not come from the dev server's own pages (`sameOrigin`), so a web page on another site cannot write project files;
 *     413  the body is bigger than a Save can be;
 *     400  the body is not JSON, or a check of `prepareSave` refused it (the words are in `problems`); nothing was written;
 *     500  the files could not be written; none was changed (or, if putting an old file back failed too, the message names the files in an unknown state);
 *     200  the files were written ALL TOGETHER (`writeTogether`: a temporary file for each, then a rename for each, the old text put back if one rename fails);
 *          `{ ok: true, written: [...], stages, ... }` with the text of each file written.
 *     `?dry=1` (any `dry` parameter) checks and formats and answers 200 with the text and `dry: true`, and writes nothing (`written` then names the parts that a real Save would write). The tests use it.
 * `GET  /__stage/hud`     the HUD file as text. A POST there is refused (405): the HUD is saved together with the stages, which checks it against them.
 *
 * WHICH FILES. Only the 640x360 set the game reads, by FIXED paths (decision 4 of ET): `stages-640.json`, `hud-640.json`, and the shared `axes.json`, `enemyfacing.json`, `heroes.json`.
 * The 480x270 set (`stages.json`, `hud.json`) is frozen for the parity fixtures: no request can name it, because no file name ever comes from a request.
 *
 * THE TEST SEAM (for tests only). `?scratch=<name>` (letters, digits and dashes) makes both endpoints read and write a private copy in
 * `<scratchRoot>/<name>/` instead of the real files; the repo sets `scratchRoot` to `tests/fixtures/stagedata/.scratch` (git-ignored), so a test that saves and reloads writes
 * under the test fixtures and never touches `src/data`. A file of a scratch copy that has never been saved reads the real file. The editor page passes the parameter on only when
 * its own address has one (the specs open `/stageedit.html?scratch=<name>`); nothing in the editor sets it.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { sameOrigin } from '../sameorigin';
import type { Prepared, SaveOptions, SavePart } from './save';
import { saveFailureMessage, writeTogether } from './writeset';

/** The most a Save may post. A full set is about 30 kB; this leaves room and stops a runaway body. */
export const MAX_BODY = 1_000_000;

/** The five files of the 640 set, by part. */
export const PART_FILES: Readonly<Record<SavePart, string>> = {
  stages: 'stages-640.json',
  axes: 'axes.json',
  hud: 'hud-640.json',
  facing: 'enemyfacing.json',
  heroes: 'heroes.json',
};

export interface StageServeOptions {
  /** The folder of the real files (`src/data`). */
  dataDir: string;
  /** Where `?scratch=<name>` copies live (`tests/fixtures/stagedata/.scratch`). Left out: the seam is off and a `scratch` parameter is refused. */
  scratchRoot?: string;
  /** `prepareSave` of `save.ts`, as it is now (the config loads it through the dev server; a test passes the module's own). */
  prepare: (body: unknown, currentHudText?: string, opts?: SaveOptions) => Prepared;
  /** The set's screen, for `prepareSave` (`SET_SCREEN`). */
  screen: SaveOptions['screen'];
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function reply(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** The folder a request reads and writes: the scratch copy it names, or null for the real files. Throws one readable sentence for a bad name. */
function folderFor(url: URL, opts: StageServeOptions): string | null {
  const name = url.searchParams.get('scratch');
  if (name === null) return null;
  if (!opts.scratchRoot) throw new Error('scratch copies are off on this server');
  if (!/^[a-z0-9-]{1,48}$/.test(name)) throw new Error('a scratch name is letters, digits and dashes');
  return join(opts.scratchRoot, name);
}

/** The path of every part: in the scratch folder, or in the real one. Fixed names only. */
function pathsIn(dir: string): Record<SavePart, string> {
  return Object.fromEntries((Object.keys(PART_FILES) as SavePart[]).map((p) => [p, join(dir, PART_FILES[p])])) as Record<SavePart, string>;
}

/** The text of one part: the scratch copy when it exists, else the real file. */
function readPart(part: SavePart, dir: string | null, opts: StageServeOptions): string {
  const own = dir ? join(dir, PART_FILES[part]) : null;
  return readFileSync(own && existsSync(own) ? own : join(opts.dataDir, PART_FILES[part]), 'utf8');
}

/** The handlers for `/__stage/stages` and `/__stage/hud`. */
export function stageHandlers(opts: StageServeOptions): { stages: Handler; hud: Handler } {
  const stages: Handler = (req, res) => {
    let url: URL;
    let dir: string | null;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
      dir = folderFor(url, opts);
    } catch (e) {
      reply(res, 400, { ok: false, problems: [e instanceof Error ? e.message : String(e)] });
      return;
    }
    if (req.method === 'GET') {
      try {
        reply(res, 200, { ok: true, problems: [], stages: readPart('stages', dir, opts), axes: readPart('axes', dir, opts), facing: readPart('facing', dir, opts), heroes: readPart('heroes', dir, opts), scratch: dir !== null });
      } catch (e) {
        reply(res, 500, { ok: false, problems: [`could not read the stage files: ${String(e)}`] });
      }
      return;
    }
    if (req.method !== 'POST') {
      reply(res, 405, { ok: false, problems: ['GET or POST only'] });
      return;
    }
    if (!sameOrigin(req)) {
      reply(res, 403, { ok: false, problems: ['writes only from the dev server’s own pages'] });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) {
        reply(res, 413, { ok: false, problems: [`the body is bigger than ${MAX_BODY} bytes`] });
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reply(res, 400, { ok: false, problems: ['not valid JSON'] });
        return;
      }
      // Check everything together: the new HUD layout, the stages against it, the axes. A body without a HUD layout is a stage-only save, checked against the HUD file now on disk.
      let made: Prepared;
      try {
        made = opts.prepare(data, readPart('hud', dir, opts), { screen: opts.screen });
      } catch (e) {
        reply(res, 400, { ok: false, problems: [`the body could not be checked: ${e instanceof Error ? e.message : String(e)}`] });
        return;
      }
      if (!made.ok) {
        reply(res, 400, { ok: false, problems: made.problems });
        return;
      }
      const texts: Record<SavePart, string | undefined> = { stages: made.stagesText, axes: made.axesText, hud: made.hudText, facing: made.facingText, heroes: made.heroesText };
      const target = pathsIn(dir ?? opts.dataDir);
      try {
        if (!url.searchParams.has('dry')) {
          // The scratch folder is made only now, by a request that passed every check.
          if (dir) mkdirSync(dir, { recursive: true });
          writeTogether(made.write.flatMap((part) => (texts[part] === undefined ? [] : [{ path: target[part], text: texts[part] as string }])));
        }
        reply(res, 200, {
          ok: true,
          problems: [],
          dry: url.searchParams.has('dry'),
          stages: made.stagesText,
          axes: made.axesText,
          ...(made.hudText !== undefined ? { hud: made.hudText } : {}),
          ...(made.facingText !== undefined ? { facing: made.facingText } : {}),
          ...(made.heroesText !== undefined ? { heroes: made.heroesText } : {}),
          written: made.write,
          file: dir ? `scratch copy ${url.searchParams.get('scratch')}` : 'src/data',
        });
      } catch (e) {
        reply(res, 500, { ok: false, problems: [saveFailureMessage(e)] });
      }
    });
  };

  const hud: Handler = (req, res) => {
    let dir: string | null;
    try {
      dir = folderFor(new URL(req.url ?? '/', 'http://localhost'), opts);
    } catch (e) {
      reply(res, 400, { ok: false, problems: [e instanceof Error ? e.message : String(e)] });
      return;
    }
    if (req.method === 'GET') {
      try {
        reply(res, 200, { ok: true, problems: [], hud: readPart('hud', dir, opts), scratch: dir !== null });
      } catch (e) {
        reply(res, 500, { ok: false, problems: [`could not read the HUD file: ${String(e)}`] });
      }
      return;
    }
    // The HUD is never written on its own: it is saved with the stages (POST /__stage/stages), which checks it against them.
    reply(res, 405, { ok: false, problems: ['GET only. The HUD layout is saved together with the stages: POST to /__stage/stages'] });
  };

  return { stages, hud };
}
