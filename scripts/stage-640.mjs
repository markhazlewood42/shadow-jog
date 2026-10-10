#!/usr/bin/env node
// M3 task 9 (decision 4 of docs/engine/m3-brief.md): make the 640x360 stage set from the 480x270 files.
//
//   node scripts/stage-640.mjs            write src/data/stages-640.json and src/data/hud-640.json
//   node scripts/stage-640.mjs --check    exit 1 when the committed files are not what the transform makes, compared as data (tests/battlestage-640.test.ts does the same)
//
// The 480x270 files (src/data/stages.json, hud.json) stay as they are: they are the source, and the regression goldens are made from them. This script is a FIXED,
// DOCUMENTED transform, not a tuning pass. Mark reviews the pictures and then edits the 640 files by hand (or in the editor, milestone ET); once he does, stop running
// this script (it would overwrite his values), and the test that compares the files with the transform goes with it.
//
// THE TRANSFORM. The 480x270 composition is CENTERED on the 640x360 screen, and the extra room is sky above and floor below (the 320x180 backdrop art of the game paints the sky):
//
//   DX = (640 - 480) / 2 = 80      every x of the design moves right by DX
//   DY = (360 - 270) / 2 = 45      every y of the stage (horizon, rows, floor stripes) moves down by DY
//
//   stage.screen            { w: 640, h: 360 }
//   stage.push              the legacy battle's push camera as data: zoom 0.09 (1.09x), ramp 4 frames, 20 frames in all (src/battlestage/push.ts LEGACY_PUSH)
//   backdrop.horizonY       + DY                       (the horizon is 145)
//   backdrop.shiftY         horizonY - 176             (the 320x180 art's kerb row is (HORIZON 84 + 4) * 2 = 176; reproject backdrops only)
//   backdrop.wallOffset     { x: DX, y: DY }           (a "replace" wall, the sewer's, is painted for 480x270: it is placed at this offset and its edges are repeated outwards)
//   floor.y0                = horizonY
//   floor.y1                360                        (the floor runs to the bottom of the larger screen: DY more floor above the old bottom and DY below it)
//   floor.stripes[].y       + DY
//   everything else of the floor (colors, band start and growth, grid spacing and vanish point, haze, seed...) is unchanged
//   rows[].y                + DY
//   party[].x, enemySets[][].x   + DX                  (dy and order are offsets, they stay)
//   shadow, depthTint, sort, demo   unchanged
//   stage.hud (overrides)   moved like the global HUD below
//
// The global HUD (hud.json -> hud-640.json): every box moves right by DX (the HUD is centered like the stage) and a box in the lower half (y >= 135) moves down by 2 * DY, to
// the bottom edge; a box in the upper half keeps its y, at the top edge. Sizes and everything else stay.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FROM = { w: 480, h: 270 };
export const TO = { w: 640, h: 360 };
export const DX = (TO.w - FROM.w) / 2;
export const DY = (TO.h - FROM.h) / 2;
/** The row of the 320x180 backdrop art where its kerb is, on the 640x360 screen. */
export const ART_KERB_ROW_640 = 176;
export const LEGACY_PUSH = { zoom: 0.09, rampFrames: 4, lifeFrames: 20 };
const REGIONS = ['turnOrder', 'commands', 'partyStatus', 'enemyInfo', 'banner', 'combo'];

const copy = (v) => JSON.parse(JSON.stringify(v));

/** A HUD box (or a stage's override of one) moved to the larger screen. Fields it does not name stay out. */
function moveBox(box) {
  const out = { ...box };
  if (typeof box.x === 'number') out.x = box.x + DX;
  if (typeof box.y === 'number') out.y = box.y >= FROM.h / 2 ? box.y + 2 * DY : box.y;
  return out;
}

/** hud.json -> the same layout for the 640x360 screen. */
export function transformHud(hud) {
  const out = copy(hud);
  for (const k of REGIONS) out.layout[k] = moveBox(out.layout[k]);
  return out;
}

/** One stage entry of stages.json -> the same stage laid out on the 640x360 screen. */
export function transformStage(stage) {
  const s = copy(stage);
  const out = {};
  for (const [key, value] of Object.entries(s)) {
    out[key] = value;
    if (key === 'name') {
      out.screen = { ...TO };
      out.push = { ...LEGACY_PUSH };
    }
  }
  const b = out.backdrop;
  b.horizonY += DY;
  if (b.mode === 'reproject') b.shiftY = b.horizonY - ART_KERB_ROW_640;
  else b.wallOffset = { x: DX, y: DY };
  const f = out.floor;
  f.y0 = b.horizonY;
  f.y1 = TO.h;
  for (const st of f.stripes ?? []) st.y += DY;
  for (const r of out.rows) r.y += DY;
  for (const q of out.party) q.x += DX;
  for (const set of Object.values(out.enemySets)) for (const q of set) q.x += DX;
  if (out.hud) for (const [region, box] of Object.entries(out.hud)) out.hud[region] = moveBox(box);
  return out;
}

/** stages.json -> stages-640.json. */
export function transformStages(stages) {
  return Object.fromEntries(Object.entries(stages).map(([id, s]) => [id, transformStage(s)]));
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(join(root, 'src', 'data', name), 'utf8'));
/** The text of a data file: 2-space JSON, LF line ends, a final newline. */
export const format = (data) => `${JSON.stringify(data, null, 2)}\n`;

/** What the 640 files should contain, as data, made from the committed 480 files. */
export function make() {
  return { 'stages-640.json': transformStages(read('stages.json')), 'hud-640.json': transformHud(read('hud.json')) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const [name, data] of Object.entries(make())) {
    const file = join(root, 'src', 'data', name);
    if (check) {
      // Compared as data, so the formatting (biome writes the arrays on one line) never matters.
      let same = false;
      try {
        same = JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))) === JSON.stringify(data);
      } catch {
        // missing or unreadable counts as different
      }
      if (!same) {
        console.error(`${name} is not what scripts/stage-640.mjs makes from the 480x270 files`);
        bad++;
      }
    } else {
      writeFileSync(file, format(data));
      console.log(`wrote src/data/${name}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
