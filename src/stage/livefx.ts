/**
 * The Battle Test's visual effects (Phaser spike `spike/phaser-stage`): the glow and shards of a hit, the sword-cut
 * picture, the floating damage numbers and the screen shake. They are Phaser objects, but their motion is a plain
 * function of AGE, counted in ticks, never of Phaser's wall-clock timers and tweens:
 *
 *   - Phaser's particle emitter and tweens run on real milliseconds, so the same hit would look slightly different
 *     on a 60 Hz and a 144 Hz screen, and a test could never step a hit one tick at a time. Here an effect's frame,
 *     size, position and opacity at age `n` come from arithmetic on `n` (and a seeded random for the shards), so
 *     `scene.step(n)` replays the exact same picture on any machine.
 *   - Pixel art must stay on whole pixels. Phaser would happily draw a particle at x = 103.4 or scale a picture by
 *     1.37, which smears pixels. Positions here are rounded, sizes jump between pre-drawn pictures, and fades are
 *     steps of opacity.
 *
 * What Phaser still does for us here: it holds the objects, draws them in depth order with the right blend mode (the
 * glow uses ADD, "add this colour to what is behind", which is what makes it light up instead of paint over), and
 * keeps the textures on the graphics card.
 *
 * These effects run on the FX clock, which does not stop in a hitstop (the world freezes; the spark keeps swelling),
 * as in fighting games.
 */
import Phaser from 'phaser';
import { hexRgb, type Raw, seeded } from './pixels';
import { blowRaw, glowRaw, slashRaw, starRaw } from './fx';
import { addCanvasOnce, rawToCanvas } from './textures';
import { textAt, textTexture, UI } from './hudkit';
import type { HitEffect } from './moves';
import { MARK_DEPTH } from './hud';

/** The prefixes of the textures this file makes (the HUD's clean-up leaves them alone; `LiveFx.destroy` removes them). */
export const HIT_PREFIX = 'hit-';
export const NUM_PREFIX = 'num-';

interface Effect {
  /** Advance to the next tick; false when finished. */
  step(age: number): boolean;
  destroy(): void;
}

export class LiveFx {
  private effects: Array<{ born: number; fx: Effect }> = [];
  private clock = 0;
  private shaking = { amp: 0, left: 0, total: 1 };

  constructor(private readonly scene: Phaser.Scene) {}

  /** How many effects are alive (for tests). */
  get count(): number {
    return this.effects.length;
  }

  /** The texture for a picture, made once. */
  private tex(key: string, make: () => Raw): string {
    const k = `${HIT_PREFIX}${key}`;
    if (!this.scene.textures.exists(k)) addCanvasOnce(this.scene.textures, k, rawToCanvas(make()));
    return k;
  }

  private add(fx: Effect): void {
    this.effects.push({ born: this.clock, fx });
  }

  // ---------------------------------------------------------------- the effects

  /** A glow that swells and fades in 10 ticks (additive). `big` for a heavy hit. */
  glow(x: number, y: number, color: string, depth: number, big: boolean): void {
    const sizes = big ? [8, 14, 20, 24, 18, 12, 8] : [5, 9, 13, 10, 7, 4];
    const img = this.scene.add.image(Math.round(x), Math.round(y), this.tex(`glow-${sizes[0]}-${color.slice(1)}`, () => glowRaw(sizes[0] ?? 5, color))).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    this.add({
      step: (age) => {
        const i = Math.floor(age / 1.5);
        const r = sizes[i];
        if (r === undefined) return false;
        img.setTexture(this.tex(`glow-${r}-${color.slice(1)}`, () => glowRaw(r, color)));
        img.setAlpha(i > sizes.length - 3 ? 0.6 : 1);
        return true;
      },
      destroy: () => img.destroy(),
    });
  }

  /** The picture of a blow where it lands: a sword cut that draws itself in, a ring burst, or a star. */
  blow(x: number, y: number, effect: HitEffect, facing: 1 | -1, depth: number): void {
    if (effect === 'none' || effect === 'heal') return;
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (effect === 'cut') {
      // A hit from the left (facing 1) draws the stroke down and to the right; from the right it is mirrored.
      const flip = facing < 0;
      const steps = [0.4, 0.75, 1];
      const img = this.scene.add.image(cx, cy, this.tex(`cut-${flip ? 'l' : 'r'}-0`, () => slashRaw(steps[0] ?? 1, flip))).setDepth(depth);
      this.add({
        step: (age) => {
          if (age >= 12) return false;
          const i = Math.min(2, age);
          img.setTexture(this.tex(`cut-${flip ? 'l' : 'r'}-${i}`, () => slashRaw(steps[i] ?? 1, flip)));
          img.setAlpha(age < 7 ? 1 : age < 9 ? 0.75 : age < 11 ? 0.5 : 0.3);
          return true;
        },
        destroy: () => img.destroy(),
      });
    } else if (effect === 'blow') {
      const img = this.scene.add.image(cx, cy, this.tex('blow', blowRaw)).setDepth(depth);
      this.add({
        step: (age) => {
          if (age >= 10) return false;
          img.setAlpha(age < 5 ? 1 : age < 8 ? 0.7 : 0.4);
          return true;
        },
        destroy: () => img.destroy(),
      });
    } else {
      const radii = [3, 6, 8, 6, 4];
      const img = this.scene.add.image(cx, cy, this.tex('star-3', () => starRaw(3, UI.amber))).setDepth(depth);
      this.add({
        step: (age) => {
          const r = radii[Math.floor(age / 1.4)];
          if (r === undefined) return false;
          img.setTexture(this.tex(`star-${r}`, () => starRaw(r, UI.amber)));
          return true;
        },
        destroy: () => img.destroy(),
      });
    }
  }

  /** A burst of little squares flying out of (x, y) and falling: `heavy` throws more. Seeded, so the same hit throws the same shards. */
  shards(x: number, y: number, facing: 1 | -1, heavy: boolean, seed: number, depth: number): void {
    const rnd = seeded(seed);
    const colours = ['#ffffff', '#3fe0f0', '#ffcc3d'];
    const n = heavy ? 12 : 6;
    for (let i = 0; i < n; i++) {
      // Mostly out along the blow's direction, some straight up and a few back.
      const ang = ((rnd() * 200 - 100) * Math.PI) / 180;
      const speed = 1.4 + rnd() * (heavy ? 3 : 2);
      const vx = Math.cos(ang) * speed * facing;
      const vy = Math.sin(ang) * speed - 0.8;
      const life = 12 + Math.floor(rnd() * 8);
      const colour = colours[i % colours.length] ?? '#ffffff';
      const key = this.tex(`shard-${colour.slice(1)}`, () => {
        // A 2x2 square of one colour.
        const s: Raw = { w: 2, h: 2, px: new Uint8ClampedArray(16) };
        const c = hexRgb(colour);
        for (let p = 0; p < 4; p++) s.px.set([c[0], c[1], c[2], 255], p * 4);
        return s;
      });
      const img = this.scene.add.image(Math.round(x), Math.round(y), key).setDepth(depth);
      this.add({
        step: (age) => {
          if (age >= life) return false;
          // x = x0 + vx * (sum of friction^k), y gains a little gravity: a closed form, so any age can be asked directly.
          const f = 0.88;
          const travel = (1 - f ** (age + 1)) / (1 - f);
          img.setPosition(Math.round(x + vx * travel), Math.round(y + vy * travel + 0.16 * age * age * 0.5));
          img.setAlpha(age > life - 4 ? 0.5 : 1);
          return true;
        },
        destroy: () => img.destroy(),
      });
    }
  }

  /**
   * A floating number: rises one pixel every other tick for 20 ticks, holds, then blinks out (46 ticks in all). Drawn in the
   * game's bitmap font at 2x with an outline. `label` (CRIT, MISS) sits over it at 1x.
   */
  number(x: number, y: number, text: string, color: string, label: string | null, scale = 2): void {
    const t = textTexture(this.scene.textures, text, { color, shadow: false, outline: UI.outline, scale, prefix: NUM_PREFIX });
    const at = textAt(t, text, Math.round(x), Math.round(y), 'center', scale);
    const img = this.scene.add.image(at.x, at.y, t.key).setOrigin(0, 0).setDepth(MARK_DEPTH);
    let tag: Phaser.GameObjects.Image | null = null;
    if (label) {
      const l = textTexture(this.scene.textures, label, { color: UI.amber, shadow: false, outline: UI.outline, prefix: NUM_PREFIX });
      const la = textAt(l, label, Math.round(x), Math.round(y) - 9, 'center');
      tag = this.scene.add.image(la.x, la.y, l.key).setOrigin(0, 0).setDepth(MARK_DEPTH);
    }
    const y0 = at.y;
    const ly0 = tag?.y ?? 0;
    this.add({
      step: (age) => {
        if (age >= 46) return false;
        const rise = Math.min(10, Math.floor(age / 2));
        img.setY(y0 - rise);
        tag?.setY(ly0 - rise);
        const visible = age < 32 || age % 4 < 2;
        img.setVisible(visible);
        tag?.setVisible(visible);
        return true;
      },
      destroy: () => {
        img.destroy();
        tag?.destroy();
      },
    });
  }

  /** Shake the stage (not the HUD) by up to `amp` pixels for `ticks` ticks. */
  shake(amp: number, ticks: number): void {
    if (amp <= 0 || ticks <= 0) return;
    this.shaking = { amp, left: ticks, total: ticks };
  }

  // ---------------------------------------------------------------- time

  /** One tick of the FX clock. */
  tick(): void {
    this.clock++;
    this.effects = this.effects.filter((e) => {
      const alive = e.fx.step(this.clock - e.born - 1);
      if (!alive) e.fx.destroy();
      return alive;
    });
    const cam = this.scene.cameras.main;
    const s = this.shaking;
    if (s.left > 0) {
      const a = Math.max(1, Math.round((s.amp * s.left) / s.total));
      cam.setScroll(s.left % 2 === 0 ? a : -a, s.left % 3 === 0 ? 1 : 0);
      s.left--;
    } else cam.setScroll(0, 0);
  }

  /** Remove every effect and the textures they made. */
  destroy(): void {
    for (const e of this.effects) e.fx.destroy();
    this.effects = [];
    this.scene.cameras.main.setScroll(0, 0);
    for (const key of this.scene.textures.getTextureKeys()) if (key.startsWith(HIT_PREFIX) || key.startsWith(NUM_PREFIX)) this.scene.textures.remove(key);
  }
}
