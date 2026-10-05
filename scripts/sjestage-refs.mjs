// Makes the REFERENCE FRAMES for the battle stage parity harness (step B1 of the engine-platform spike, e2e/sjestage.spec.ts).
//
// What it does: starts the dev server of the PHASER spike's checkout (branch spike/phaser-stage, a git worktree of this repo, by default
// ../shadow-jog-phaser) on port 3007, opens ITS stage lab (/stagelab.html), turns the lab into the B1 slice through the lab's own scene methods
// (one stage, one hero, one enemy, HUD off, the seed and the ticks of src/battlestage/slice.json), stops the lab's real-time clock so the
// scene only moves when told to, and saves 480x270 raw RGBA frames (4 bytes a pixel, top row first, straight from the Phaser canvas), one file per
// sprite mode, renderer kind and tick: <mode>-<kind>-t<tick>.rgba, plus manifest-<kind>.json. Then it stops the server it started.
//
// Why a renderer KIND (gpu or soft): the street's neon glow layer is painted by the game's canvas 2D code, and Chrome's GPU canvas and its software canvas
// differ by 1/255 in the glow's translucent pixels (1,732 pixels of the 240x135 layer, 3.6% of the 480x270 picture). Both pages show the same difference, so the
// harness compares like with like: the engine in a GPU browser against the Phaser page in a GPU browser, the engine in a software browser (CI) against the
// Phaser page in a software browser. Run the script once with and once without --no-gpu to make both.
//
//   node scripts/sjestage-refs.mjs --out <folder> [--modes standins,art] [--phaser <checkout>] [--no-gpu] [--fixtures]
//
//   --out       where the raw frames go (outside the repo: they are pictures; Mark's art must never be committed).
//   --modes     standins (the code-drawn crew, what CI has) and/or art (Mark's Sprite Fusion sheets, when his git-ignored folder is here).
//               Default: standins, plus art if the folder is here.
//   --phaser    the Phaser spike's checkout. Default: ../shadow-jog-phaser next to this repo. It is only READ; nothing in it is changed or built.
//   --no-gpu    run the browser with its software GL and software canvas (what CI's browser does) instead of the GPU. Files are named ...-soft-... then.
//   --fixtures  also write the STAND-IN frames, gzipped, to tests/fixtures/sjestage/ (the references CI compares with, because CI has no Phaser
//               checkout). Mark's art is never written there. Run it for both kinds (with and without --no-gpu).
//
// It refuses to start if something already answers on port 3007 (never kill a process this script did not start), and it only ever stops the
// server process tree it started itself.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const out = opt('out');
if (!out) {
  console.error('usage: node scripts/sjestage-refs.mjs --out <folder> [--modes standins,art] [--phaser <checkout>] [--no-gpu] [--fixtures]');
  process.exit(2);
}
const phaserDir = resolve(opt('phaser', join(root, '..', 'shadow-jog-phaser')));
const PORT = 3007;
const BASE = `http://localhost:${PORT}`;
const slice = JSON.parse(readFileSync(join(root, 'src/battlestage/slice.json'), 'utf8'));
const haveArt = existsSync(join(phaserDir, 'spritefusion-tests', 'extracted', 'kit-battle-idle', 'metadata.json'));
const modes = opt('modes', haveArt ? 'standins,art' : 'standins').split(',');
if (modes.includes('art') && !haveArt) {
  console.error("Mark's sprite folder is not here (spritefusion-tests/extracted/kit-battle-idle), so the 'art' mode cannot be captured.");
  process.exit(2);
}
const W = 480;
const H = 270;
const kind = flag('no-gpu') ? 'soft' : 'gpu';

/** Does anything answer on the port? */
async function answers() {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(join(phaserDir, 'src', 'stage', 'stagescene.ts'))) {
  console.error(`${phaserDir} is not the Phaser spike's checkout (no src/stage/stagescene.ts).`);
  process.exit(2);
}
if (await answers()) {
  console.error(`Something already answers on ${BASE}. Stop it first (this script never kills a process it did not start).`);
  process.exit(2);
}

// The Phaser checkout's own dev server. `--strictPort`: if 3007 were taken Vite would quietly pick another port.
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: phaserDir, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d;
});
server.stderr.on('data', (d) => {
  serverLog += d;
});
function stopServer() {
  if (server.exitCode !== null || !server.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-server.pid);
  } catch {
    // already gone
  }
}
process.on('exit', stopServer);

/** In the Phaser page: turn the lab into the slice, freeze its clock, and return the frames at these ticks (base64 RGBA each). */
async function captureInPage(page, sliceSpec) {
  return page.evaluate(async (s) => {
    const hook = window.__stagelab;
    if (!hook || !hook.ready) throw new Error('the Phaser lab is not ready');
    const scene = hook.scene();
    const game = hook.game;
    if (!scene || !game) throw new Error('no Phaser scene');
    // The scene only moves when told to: take away the per-refresh clock (its own accumulator would add ticks).
    scene.update = () => {};
    // The slice, through the scene's public methods. The stage file as the lab loaded it, with the slice's lineup and seed.
    const cfg = JSON.parse(JSON.stringify(scene.config));
    cfg.demo.lineup = s.lineup.slice();
    cfg.floor.seed = s.seed;
    // HUD off, in the stage data's own terms: every region and the name tab are set to never show, and the enemies get no health bars.
    for (const name of ['turnOrder', 'partyStatus', 'commands', 'enemyInfo', 'banner', 'combo']) cfg.hud[name].show = 'never';
    if (cfg.hud.activeTag) cfg.hud.activeTag.show = 'never';
    cfg.hud.enemyInfo.barsOnStage = undefined;
    scene.applyStage(cfg);
    scene.setEnemies(s.enemies.slice(), s.setKey);
    scene.frame = 0;
    scene.worldFrame = 0;
    const party = scene.fighters.filter((f) => f.side === 'party');
    const foes = scene.fighters.filter((f) => f.side === 'enemy');
    if (party.length !== s.lineup.length || foes.length !== s.enemies.length) throw new Error(`expected ${s.lineup.length} + ${s.enemies.length} figures, found ${party.length} + ${foes.length}`);
    // The stage's own markers: the ring under the acting hero and under the target.
    for (const f of scene.fighters) {
      f.active = false;
      f.target = false;
    }
    const hero = party[s.active];
    const aimed = foes[s.target];
    if (hero) hero.active = true;
    if (aimed) aimed.target = true;
    // HUD off: no windows, no tags, and no health bars (the bar is a HUD element in this slice).
    scene.hudObjects?.destroy();
    for (const f of scene.fighters) {
      f.bar?.destroy();
      f.bar = null;
      f.barTag?.destroy();
      f.barTag = undefined;
      scene.restyleFighter(f);
    }
    const facts = scene.fighters.map((f) => ({ id: f.id, side: f.side, depth: f.depth, x: f.x, y: f.y }));
    const grab = () =>
      new Promise((resolve, reject) => {
        game.events.once('postrender', () => {
          try {
            const c = document.createElement('canvas');
            c.width = game.canvas.width;
            c.height = game.canvas.height;
            const g = c.getContext('2d', { willReadFrequently: true });
            if (!g) throw new Error('no 2d canvas');
            g.drawImage(game.canvas, 0, 0);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            let bin = '';
            for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
            resolve({ w: c.width, h: c.height, base64: btoa(bin) });
          } catch (e) {
            reject(e);
          }
        });
      });
    const frames = [];
    let at = 0;
    for (const tick of s.ticks) {
      scene.step(tick - at);
      at = tick;
      const f = await grab();
      frames.push({ tick, ...f });
    }
    return { frames, facts, standIns: hook.standIns, renderer: hook.renderer, tickAfter: scene.frame };
  }, sliceSpec);
}

const manifest = { generatedBy: 'scripts/sjestage-refs.mjs', date: new Date().toISOString(), w: W, h: H, slice, phaserCommit: '', kind, modes: {}, files: {} };
try {
  manifest.phaserCommit = execFileSync('git', ['-C', phaserDir, 'rev-parse', 'HEAD']).toString().trim();
  // Wait for the server (the first answer can take a while: Vite is scanning dependencies).
  for (let i = 0; i < 120 && !(await answers()); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!(await answers())) throw new Error(`the Phaser dev server did not start:\n${serverLog}`);

  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge', args: flag('no-gpu') ? ['--disable-gpu', '--disable-accelerated-2d-canvas'] : [] });
  try {
    for (const mode of modes) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const problems = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(m.text());
      });
      page.on('pageerror', (e) => problems.push(e.message));
      // ?clean: no pickers over the corner. ?standins: skip Mark's sheets on purpose.
      await page.goto(`${BASE}/stagelab.html?clean${mode === 'standins' ? '&standins' : ''}`);
      await page.waitForFunction(() => window.__stagelab?.ready === true || !!window.__stagelab?.error, undefined, { timeout: 60_000 });
      const got = await captureInPage(page, slice);
      if (got.standIns !== (mode === 'standins')) throw new Error(`asked for ${mode} but the Phaser lab says standIns=${got.standIns}`);
      if (problems.length) throw new Error(`the Phaser page logged errors: ${problems.join(' | ')}`);
      manifest.modes[mode] = { renderer: got.renderer, figures: got.facts };
      for (const f of got.frames) {
        const raw = Buffer.from(f.base64, 'base64');
        if (f.w !== W || f.h !== H || raw.length !== W * H * 4) throw new Error(`the Phaser canvas is ${f.w}x${f.h}, expected ${W}x${H}`);
        const name = `${mode}-${kind}-t${f.tick}.rgba`;
        writeFileSync(join(out, name), raw);
        manifest.files[name] = { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
        if (flag('fixtures') && mode === 'standins') {
          const dir = join(root, 'tests', 'fixtures', 'sjestage');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${name}.gz`), gzipSync(raw, { level: 9 }));
        }
        console.log(`${name}  ${raw.length} bytes  sha256 ${manifest.files[name].sha256.slice(0, 12)}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, `manifest-${kind}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  if (flag('fixtures')) {
    const fixtureManifest = { ...manifest, modes: { standins: manifest.modes.standins }, files: Object.fromEntries(Object.entries(manifest.files).filter(([n]) => n.startsWith('standins-'))), date: undefined };
    writeFileSync(join(root, 'tests', 'fixtures', 'sjestage', `manifest-${kind}.json`), `${JSON.stringify(fixtureManifest, null, 2)}\n`);
  }
  console.log(`done: ${Object.keys(manifest.files).length} frames in ${out} (Phaser commit ${manifest.phaserCommit.slice(0, 9)})`);
} finally {
  stopServer();
}
