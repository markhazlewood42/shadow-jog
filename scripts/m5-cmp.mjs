// Local tool: how different are two pictures? usage: node scripts/m5-cmp.mjs a.png b.png [diff.png]
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from './lib/png.mjs';
const [a, b, out] = process.argv.slice(2);
const A = decodePng(readFileSync(a)), B = decodePng(readFileSync(b));
let n1 = 0, n8 = 0, n32 = 0, max = 0;
const o = new Uint8Array(A.width * A.height * 4);
for (let i = 0; i < A.data.length; i += 4) {
  const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
  if (d > 0) n1++;
  if (d > 8) n8++;
  if (d > 32) n32++;
  if (d > max) max = d;
  const v = Math.min(255, d * 8);
  o[i] = v; o[i + 1] = v; o[i + 2] = v; o[i + 3] = 255;
}
const t = A.width * A.height;
console.log(`${a}: >0 ${(n1 / t * 100).toFixed(2)}%  >8 ${(n8 / t * 100).toFixed(2)}%  >32 ${(n32 / t * 100).toFixed(3)}%  max ${max}`);
if (out) writeFileSync(out, encodePng(A.width, A.height, o));
