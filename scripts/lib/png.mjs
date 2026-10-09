/**
 * A small PNG reader for the pivot tools (scripts/pixel-diff.mjs, scripts/check-shots.mjs), so they
 * need no package. It reads what Playwright writes (8-bit RGB or RGBA, not interlaced) and, for
 * completeness, 8-bit grayscale and palette images. Anything else throws with a clear message.
 *
 * How a PNG is built: an 8-byte signature, then chunks (length, type, data, CRC). IHDR gives the
 * size and the pixel format. The IDAT chunks together hold one zlib stream of the image rows, and
 * each row starts with a filter byte that says how its bytes were predicted from their neighbors
 * (none, left, up, average, Paeth). Decoding is: inflate, undo the filter row by row, then expand
 * each pixel to four RGBA bytes.
 */
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Encode RGBA bytes as a PNG file (8-bit RGBA, no filter, one IDAT). The tools use it for diff
 * pictures, where size does not matter; a real image encoder would pick row filters to compress
 * better.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba 4 bytes per pixel, row by row
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: the pixel buffer does not match the size');
  // Every row starts with the filter byte 0 (none).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
  return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** One PNG chunk: length, type, data, CRC-32 of type and data. */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/** CRC-32 as PNG uses it (the same polynomial as zip and gzip). */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Bytes per pixel for each PNG color type at 8 bits per sample. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Decode a PNG file's bytes.
 * @param {Buffer} buf the whole file
 * @returns {{ width: number, height: number, data: Uint8Array }} `data` holds RGBA bytes, 4 per pixel, row by row
 */
export function decodePng(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG file');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, alphaTable = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len; // 4 length + 4 type + data + 4 CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') alphaTable = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('PNG has no IHDR chunk');
  if (bitDepth !== 8) throw new Error(`PNG bit depth ${bitDepth} is not supported (only 8)`);
  if (interlace) throw new Error('interlaced PNG is not supported');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`PNG color type ${colorType} is not supported`);
  if (colorType === 3 && !palette) throw new Error('palette PNG has no PLTE chunk');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG image data is too short');
  const pixels = unfilter(raw, stride, height, channels);

  const data = new Uint8Array(width * height * 4);
  for (let p = 0, s = 0; p < width * height; p++, s += channels) {
    const o = p * 4;
    switch (colorType) {
      case 6: // RGBA
        data[o] = pixels[s]; data[o + 1] = pixels[s + 1]; data[o + 2] = pixels[s + 2]; data[o + 3] = pixels[s + 3];
        break;
      case 2: // RGB
        data[o] = pixels[s]; data[o + 1] = pixels[s + 1]; data[o + 2] = pixels[s + 2]; data[o + 3] = 255;
        break;
      case 0: // gray
        data[o] = data[o + 1] = data[o + 2] = pixels[s]; data[o + 3] = 255;
        break;
      case 4: // gray + alpha
        data[o] = data[o + 1] = data[o + 2] = pixels[s]; data[o + 3] = pixels[s + 1];
        break;
      case 3: { // palette index
        const i = pixels[s];
        data[o] = palette[i * 3]; data[o + 1] = palette[i * 3 + 1]; data[o + 2] = palette[i * 3 + 2];
        data[o + 3] = alphaTable && i < alphaTable.length ? alphaTable[i] : 255;
        break;
      }
    }
  }
  return { width, height, data };
}

/**
 * Undo the per-row filters. Each row of `raw` is one filter byte and then `stride` bytes.
 * Returns the rows' bytes without the filter bytes.
 */
function unfilter(raw, stride, height, bpp) {
  const out = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride); // the row above, all zero above the first row
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0; // left
      const b = prev[i]; // up
      const c = i >= bpp ? prev[i - bpp] : 0; // up-left
      let v = src[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: v += paeth(a, b, c); break;
        default: throw new Error(`PNG row ${y} has unknown filter ${filter}`);
      }
      row[i] = v & 255;
    }
    prev = row;
  }
  return out;
}

/** The Paeth predictor: whichever of left, up and up-left is nearest to left + up - upLeft. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
