/// <reference types="node" />
/**
 * Audio evidence: every song rendered offline through the game's own mix graph (reverb spaces,
 * bus compressors, limiter, default volumes), then measured: peak, RMS, clipping, loudness range
 * over 3 s windows, and energy by band. Writes a report and a spectrogram per song to
 * docs/quality/evidence/audio/, and WAVs to playtest/audio/ (not committed) for listening.
 * Run: npx playwright test e2e/audio-evidence.spec.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';

const OUT = 'docs/quality/evidence/audio';
const WAVS = 'playtest/audio';
const SECONDS = 24;

type Report = {
  name: string;
  peakDb: number;
  rmsDb: number;
  clipped: number;
  rangeDb: number;
  bands: number[];
  png: string;
  wav: string;
};

test('render and measure every song', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  mkdirSync(WAVS, { recursive: true });
  await page.goto('/?debug');
  await page.waitForTimeout(800);
  const names = await page.evaluate(`(async () => Object.keys((await import('/src/audio/songs.ts')).SONGS))()`) as string[];
  const rows: Report[] = [];
  for (const name of names) {
    const r = (await page.evaluate(`(async () => {
      const { renderSong } = await import('/src/audio/music.ts');
      const buf = await renderSong(${JSON.stringify(name)}, ${SECONDS});
      const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, sr = buf.sampleRate;
      const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
      let peak = 0, sum = 0, clipped = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (a > peak) peak = a;
        if (a >= 0.999) clipped++;
        sum += (L[i] * L[i] + R[i] * R[i]) / 2;
      }
      // Loudness range: RMS over 3 s windows (the first second skipped: fade-in and pickup).
      const win = sr * 3, rms = [];
      for (let s = sr; s + win <= n; s += sr) {
        let w = 0;
        for (let i = s; i < s + win; i++) w += (L[i] * L[i] + R[i] * R[i]) / 2;
        rms.push(db(Math.sqrt(w / win)));
      }
      // Energy by band and a spectrogram, from 2048-point FFTs every 1024 samples (mono).
      const N = 2048, hop = 1024, frames = Math.floor((n - N) / hop);
      const edges = [0, 120, 500, 2000, 6000, sr / 2];
      const band = [0, 0, 0, 0, 0];
      const W = 600, H = 200, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d'), img = g.createImageData(W, H);
      const re = new Float64Array(N), im = new Float64Array(N);
      const fft = () => {
        for (let i = 1, j = 0; i < N; i++) {
          let bit = N >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
        }
        for (let len = 2; len <= N; len <<= 1) {
          const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
          for (let i = 0; i < N; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
              const ur = re[i + k], ui = im[i + k];
              const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
              re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
              const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
            }
          }
        }
      };
      const col = new Float64Array(H);
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); re[i] = ((L[f * hop + i] + R[f * hop + i]) / 2) * w; im[i] = 0; }
        fft();
        col.fill(0);
        const pw = new Float64Array(N / 2);
        for (let k = 1; k < N / 2; k++) {
          const p = re[k] * re[k] + im[k] * im[k], hz = k * sr / N;
          pw[k] = p;
          for (let b = 0; b < 5; b++) if (hz >= edges[b] && hz < edges[b + 1]) band[b] += p;
        }
        // Log-frequency rows, 40 Hz .. 16 kHz: each row takes the strongest bin in its range (or
        // the nearest bin, where rows are narrower than a bin at the low end).
        for (let y = 0; y < H; y++) {
          const f0 = 40 * Math.pow(16000 / 40, (H - 1 - y) / H), f1 = 40 * Math.pow(16000 / 40, (H - y) / H);
          const k0 = Math.max(1, Math.floor(f0 * N / sr)), k1 = Math.max(k0, Math.floor(f1 * N / sr));
          let m = 0;
          for (let k = k0; k <= k1 && k < N / 2; k++) m = Math.max(m, pw[k]);
          col[y] = m;
        }
        const x = Math.floor(f * W / frames);
        // Inferno-like ramp: black, purple, red, orange, pale yellow.
        const stops = [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]];
        for (let y = 0; y < H; y++) {
          const v = Math.max(0, Math.min(1, (10 * Math.log10(col[y] + 1e-12) + 20) / 60)) * (stops.length - 1);
          const i0 = Math.min(stops.length - 2, Math.floor(v)), t = v - i0, a0 = stops[i0], a1 = stops[i0 + 1];
          const o = (y * W + x) * 4;
          for (let c = 0; c < 3; c++) img.data[o + c] = Math.round(a0[c] + (a1[c] - a0[c]) * t);
          img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      const total = band.reduce((a, b) => a + b, 0) || 1;
      // 16-bit stereo WAV.
      const bytes = 44 + n * 4, dv = new DataView(new ArrayBuffer(bytes));
      const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
      dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true);
      dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) {
        dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      }
      let bin = '';
      const u8 = new Uint8Array(dv.buffer);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return {
        name: ${JSON.stringify(name)}, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), clipped,
        rangeDb: rms.length ? Math.max(...rms) - Math.min(...rms) : 0,
        bands: band.map((b) => (b / total) * 100),
        png: cv.toDataURL('image/png').split(',')[1], wav: btoa(bin),
      };
    })()`)) as Report;
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.png, 'base64'));
    writeFileSync(`${WAVS}/${name}.wav`, Buffer.from(r.wav, 'base64'));
    rows.push(r);
  }
  // Sound effects against the music: each rendered alone through the same graph at default volume.
  const sfxRows = (await page.evaluate(`(async () => {
    const { renderSfx } = await import('/src/audio/sfx.ts');
    const out = [];
    for (const name of ['cursor', 'confirm', 'hit', 'crit', 'heal', 'combo', 'explosion']) {
      const buf = await renderSfx(name);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      let peak = 0, sum = 0, loud = 0;
      for (let i = 0; i < L.length; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        peak = Math.max(peak, a);
        if (a > 0.001) { sum += (L[i] * L[i] + R[i] * R[i]) / 2; loud++; }
      }
      out.push({ name, peakDb: 20 * Math.log10(Math.max(1e-9, peak)), rmsDb: 10 * Math.log10(Math.max(1e-12, sum / Math.max(1, loud))) });
    }
    return out;
  })()`)) as { name: string; peakDb: number; rmsDb: number }[];
  const f = (x: number) => x.toFixed(1).padStart(6);
  const lines = [
    `Every song rendered offline for ${SECONDS} s through the game's mix graph at default volumes (music 0.7).`,
    'Peak and RMS in dBFS; range = loudest minus quietest 3 s window; bands = share of spectral energy.',
    'Spectrograms: docs/quality/evidence/audio/<song>.png (time →, 40 Hz – 16 kHz log ↑). WAVs: playtest/audio/.',
    '',
    `${'song'.padEnd(14)}  peak    rms  range  clipped   <120   -500   -2k    -6k    6k+`,
    ...rows.map((r) => `${r.name.padEnd(14)}${f(r.peakDb)}${f(r.rmsDb)}${f(r.rangeDb)}${String(r.clipped).padStart(8)} ${r.bands.map((b) => f(b)).join('')}`),
    '',
    'Sound effects (default volume; RMS over the audible part):',
    `${'sfx'.padEnd(14)}  peak    rms`,
    ...sfxRows.map((r) => `${r.name.padEnd(14)}${f(r.peakDb)}${f(r.rmsDb)}`),
  ];
  writeFileSync('docs/quality/evidence/audio.txt', `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
});
