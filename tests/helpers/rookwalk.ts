/** Test helper: the Rook walk sheet is committed as a zip, so write its spritesheet.png to the temp folder once and return the path. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const WALK_ZIP = 'spritefusion-tests/rook-overworld-walk.zip';

/** Read one file out of a zip with Node built-ins only (central directory, stored or deflated). */
function unzipEntry(zipPath: string, name: string): Buffer {
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

export function walkSheet(): string {
  const dir = join(tmpdir(), 'pixlint-walk-sheet');
  const sheet = join(dir, 'spritesheet.png');
  if (!existsSync(sheet)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(sheet, unzipEntry(WALK_ZIP, 'spritesheet.png'));
  }
  return sheet;
}
