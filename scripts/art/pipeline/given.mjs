// Sources for the pipeline: the given frame (walk frame 4), the 8 walk frames, the battle idle, and the target.json writer.
// The given comes from the committed walk zip (Node built-ins only), so tests and CI do not need the Temp folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { crop } from '../pixkit/png.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const WALK_ZIP = `${REPO}/spritefusion-tests/rook-overworld-walk.zip`;
export const TARGET_JSON = `${REPO}/docs/spikes/rook-turnaround/target.json`;
export const IDLE_SHEET = `${REPO}/public/art/crew/rook/idle/spritesheet.png`;
export const GIVEN_FRAME = 4;
/** CLI output folder. Never the repo. ROOK_PIPELINE_OUT overrides it. */
export const OUT_DIR = process.env.ROOK_PIPELINE_OUT ?? 'C:/Users/markh/AppData/Local/Temp/rook-pipeline';

/** Read one file out of a zip (central directory, stored or deflated). */
export function unzipEntry(zipPath, name) {
  const z = readFileSync(zipPath);
  const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = z.readUInt32LE(eocd + 16);
  for (let n = z.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = z.readUInt16LE(p + 10);
    const size = z.readUInt32LE(p + 20);
    const nameLen = z.readUInt16LE(p + 28);
    const extraLen = z.readUInt16LE(p + 30);
    const commentLen = z.readUInt16LE(p + 32);
    const local = z.readUInt32LE(p + 42);
    if (z.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + z.readUInt16LE(local + 26) + z.readUInt16LE(local + 28);
      const data = z.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not in ${zipPath}`);
}

const decode = (buf) => {
  const p = PNG.sync.read(buf);
  return { w: p.width, h: p.height, data: new Uint8Array(p.data) };
};
const split = (img, fw, fh) => {
  const out = [];
  for (let y = 0; y + fh <= img.h; y += fh) for (let x = 0; x + fw <= img.w; x += fw) out.push(crop(img, x, y, fw, fh));
  return out;
};

let walkCache = null;
/** The 8 walk frames (32x32 each), fresh copies each call. */
export function loadWalkFrames() {
  walkCache ??= split(decode(unzipEntry(WALK_ZIP, 'spritesheet.png')), 32, 32);
  return walkCache.map((f) => ({ w: f.w, h: f.h, data: new Uint8Array(f.data) }));
}
/** The given frame: walk frame 4 (target.json givenFrame). */
export const loadGiven = () => loadWalkFrames()[GIVEN_FRAME];
/** Battle idle frames (79x68), facing right. Null when the sheet is not in the repo. */
export function loadIdleFrames() {
  if (!existsSync(IDLE_SHEET)) return null;
  return split(decode(readFileSync(IDLE_SHEET)), 79, 68);
}

/** Set target.json "pipeline.<key>" and leave every other key as it is. */
export function writeTargetKey(key, value, path = TARGET_JSON) {
  const t = JSON.parse(readFileSync(path, 'utf8'));
  t.pipeline = { ...(t.pipeline ?? {}), [key]: value };
  writeFileSync(path, `${JSON.stringify(t, null, 2)}\n`);
}
export const readTarget = (path = TARGET_JSON) => JSON.parse(readFileSync(path, 'utf8'));
export const ensureDir = (d) => mkdirSync(d, { recursive: true });
