/**
 * The parity harness of the stage slice, tested on made-up pictures (cleanup items C1 and C2 of docs/spikes/engine-platform.md). The e2e spec
 * (`e2e/sjestage.spec.ts`) runs the same code on the real frames and has its own negative controls in the real scene. Here the gates are
 * shown to fail what they must fail, without a browser:
 *  - the STRICT gate passes an exact copy and the renderer's own 1/255 noise, and fails a shadow or a figure that is one pixel off, a haze that
 *    rounds one step differently, and a 2/255 step inside the noise mask;
 *  - the PINS pass when every input file has the recorded hash and fail, with the message a designer needs, when one changed, is missing or is not recorded.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { changedInputs, compareFrames, H, pinHash, pinMessage, pinnedText, rendererMask, strictCompare, W } from '../e2e/sjestageparity';

/** A made-up stage: a floor gradient, a soft oval shadow (dark, translucent edge) and a figure with a body block and a lighter head. */
function scene(shadowX: number, bodyX: number): Buffer {
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // The floor: a smooth ramp, so a shadow's edge is a small step on a changing background (the hard case for a loose gate).
      let r = 40 + (y >> 2);
      let g = 38 + (x >> 4);
      let b = 70;
      // A soft oval shadow, 60 wide and 14 high, with a faint edge ring (alpha 0.12) and a darker core (alpha 0.3).
      const dx = (x - (shadowX + 100)) / 30;
      const dy = (y - 200) / 7;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const a = d > 0.8 ? 0.12 : 0.3;
        r = Math.round(r * (1 - a));
        g = Math.round(g * (1 - a));
        b = Math.round(b * (1 - a));
      }
      // The figure: a body block 14 wide and 40 high on the shadow, and a head 8 square.
      if (x >= bodyX + 94 && x < bodyX + 108 && y >= 160 && y < 200) [r, g, b] = [200, 120, 40];
      if (x >= bodyX + 97 && x < bodyX + 105 && y >= 150 && y < 158) [r, g, b] = [230, 190, 150];
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  return px;
}

/** A mask of a glow band above the floor, the way the real one is: rows 20 to 40, every pixel. */
function glowMask(): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 20; y < 40; y++) m.fill(1, y * W, (y + 1) * W);
  return m;
}

const copy = (b: Buffer): Buffer => Buffer.from(b);
const bump = (b: Buffer, x: number, y: number, by: number): void => {
  b[(y * W + x) * 4] = Math.min(255, (b[(y * W + x) * 4] ?? 0) + by);
};

describe('the strict regression gate (C1)', () => {
  const ref = scene(0, 0);
  const mask = glowMask();

  it('passes an exact copy', () => {
    const r = strictCompare(copy(ref), ref, mask);
    expect(r.ok).toBe(true);
    expect(r.outside + r.insideOver1 + r.insideNoise).toBe(0);
  });

  it('fails a SHADOW one pixel off, to the left or the right, and so does a figure one pixel off', () => {
    for (const dx of [-1, 1]) {
      const shadow = strictCompare(scene(dx, 0), ref, mask);
      expect(shadow.ok, `shadow moved by ${dx}`).toBe(false);
      expect(shadow.outside).toBeGreaterThan(0);
      const body = strictCompare(scene(0, dx), ref, mask);
      expect(body.ok, `figure moved by ${dx}`).toBe(false);
      expect(body.outside).toBeGreaterThan(0);
    }
  });

  it('shows why the 2/255 gate alone was too loose: a shadow one pixel off is a few hundred pixels, far under 3% of the picture', () => {
    const loose = compareFrames(scene(1, 0), ref);
    // The percentage rule of exit criterion 7 lets this through by a wide margin. (The channel rule may or may not catch it, depending on how dark the shadow is.)
    expect(loose.pct).toBeLessThan(3);
    expect(loose.differing).toBeGreaterThan(0);
    expect(strictCompare(scene(1, 0), ref, mask).ok).toBe(false);
  });

  it('fails a depth haze that rounds one step differently: ONE pixel off by 1/255 outside the mask', () => {
    const wrong = copy(ref);
    bump(wrong, 100, 200, 1);
    const r = strictCompare(wrong, ref, mask);
    expect(r.ok).toBe(false);
    expect(r.outside).toBe(1);
    expect(r.samples[0]).toMatchObject({ x: 100, y: 200 });
  });

  it('allows the renderer’s own 1/255 inside the mask, and only there', () => {
    const noisy = copy(ref);
    for (let x = 0; x < W; x += 3) bump(noisy, x, 25, 1);
    const inside = strictCompare(noisy, ref, mask);
    expect(inside.ok).toBe(true);
    expect(inside.insideNoise).toBeGreaterThan(100);
    // The same 1/255 on a floor row is a failure.
    const onFloor = copy(ref);
    bump(onFloor, 7, 220, 1);
    expect(strictCompare(onFloor, ref, mask).ok).toBe(false);
  });

  it('fails a step of 2/255 inside the mask: the noise allowance is 1, no more', () => {
    const wrong = copy(ref);
    bump(wrong, 50, 30, 2);
    const r = strictCompare(wrong, ref, mask);
    expect(r.ok).toBe(false);
    expect(r.insideOver1).toBe(1);
  });

  it('refuses two pictures of different sizes', () => {
    expect(() => strictCompare(Buffer.alloc(8), Buffer.alloc(12), mask)).toThrow(/differ in size/);
  });
});

describe('the renderer mask', () => {
  it('is every pixel where the GPU and the software reference differ, over all the pairs', () => {
    const a = scene(0, 0);
    const b = copy(a);
    bump(b, 10, 10, 1);
    const c = copy(a);
    bump(c, 20, 30, 1);
    const mask = rendererMask([{ gpu: a, soft: b }, { gpu: a, soft: c }, { gpu: a, soft: copy(a) }]);
    expect(mask[10 * W + 10]).toBe(1);
    expect(mask[30 * W + 20]).toBe(1);
    expect(mask.reduce((n, v) => n + v, 0)).toBe(2);
  });
});

describe('the pinned inputs (C2)', () => {
  const files = ['src/data/stages.json', 'src/data/heroes.json'];
  const recorded = { 'src/data/stages.json': 'aaaaaaaaaaaaaaaa', 'src/data/heroes.json': 'bbbbbbbbbbbbbbbb' };

  it('are fine when every file has the recorded hash', () => {
    expect(changedInputs('.', files, recorded, (f) => (recorded as Record<string, string>)[f] ?? '')).toEqual([]);
  });

  it('name the file that changed, and the message says what to do before any pixel is compared', () => {
    const problems = changedInputs('.', files, recorded, (f) => (f.endsWith('heroes.json') ? 'cccccccccccccccc' : 'aaaaaaaaaaaaaaaa'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('src/data/heroes.json: changed');
    const message = pinMessage(problems);
    expect(message).toContain('design data changed since the references were made: regenerate with node scripts/sjestage-refs.mjs');
    expect(message).toContain('src/data/heroes.json');
  });

  it('name a file the manifest does not record (a manifest made before the pin existed)', () => {
    const problems = changedInputs('.', files, undefined, () => 'x');
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('the manifest has no hash for it');
  });

  it('hash text with LF line ends, so a Windows checkout and a Linux one agree', () => {
    expect(pinnedText(Buffer.from('a\r\nb\r\n')).toString()).toBe('a\nb\n');
    expect(pinnedText(Buffer.from('a\nb\n')).toString()).toBe('a\nb\n');
  });

  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const listed = (JSON.parse(readFileSync(`${root}tests/fixtures/sjestage/inputs.json`, 'utf8')) as { files: string[] }).files;

  it('are the real files: every input in inputs.json can be read and hashed', () => {
    for (const f of listed) expect(pinHash(root, f), f).toMatch(/^[0-9a-f]{64}$/);
  });

  // Round 3: the pins missed src/data/enemies.ts, which the stage reads for each enemy's picture, mirror and axis key. This test reads the
  // imports of the stage code itself, so a new data import cannot slip past the pins again.
  // src/data/party.ts is the one deliberate exception: the stage reads only the hero NAME from it (no pixel), and its bio text differs between
  // this repo and the Phaser checkout, so pinning it would stop scripts/sjestage-refs.mjs from running.
  // src/data/abilities.ts (M3 task 6) is read by the live battle's HUD view and the headless driver (a skill's name and cost, the combos), never by the slice the goldens show.
  const NOT_PINNED = new Map([
    ['src/data/party.ts', 'only the hero name is read, never drawn; the bio text differs in the Phaser checkout'],
    ['src/data/abilities.ts', 'read by the live battle and the headless driver (skill names and costs), not by the parity slice'],
  ]);

  it('cover every src/data file the stage code imports (src/battlestage/*.ts), except the ones named on purpose', () => {
    const imported = new Set<string>();
    for (const file of readdirSync(`${root}src/battlestage`).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(`${root}src/battlestage/${file}`, 'utf8');
      for (const m of text.matchAll(/from '\.\.\/data\/([A-Za-z0-9_.-]+)'/g)) {
        // A '.json' import keeps its extension, a TypeScript module does not.
        const name = m[1] ?? '';
        imported.add(`src/data/${name.includes('.') ? name : `${name}.ts`}`);
      }
    }
    expect(imported.size, 'the scan found the imports').toBeGreaterThanOrEqual(7);
    const missing = [...imported].filter((f) => !listed.includes(f) && !NOT_PINNED.has(f));
    expect(missing, 'imported by the stage but not pinned in inputs.json').toEqual([]);
    expect(listed, 'enemies.ts is pinned').toContain('src/data/enemies.ts');
    for (const f of NOT_PINNED.keys()) expect(imported.has(f), `${f} is still imported (else drop it from NOT_PINNED)`).toBe(true);
  });
});
