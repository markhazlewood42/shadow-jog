/**
 * The field's two windows as kit parts (M8c group G; docs/engine/m8-brief.md, the Record): the objective box in the top-left corner and the area banner.
 *
 * A real `FieldScene` runs on a real `Game` here, as in tests/field-native.test.ts. The HUD (`fieldkit/hud.ts`) syncs once for each DRAWN frame (the `prerender` handler),
 * as the old canvas code did, so a test draws with `game.draw()`. Every proof that something DOES happen has a control: a case where it must not.
 *
 *   1. The objective box: where it sits, what it says, its alpha while the leader walks, and when it hides.
 *   2. A box is built again only when what it shows changes (the flash is a change, the next frame of the same flash is not).
 *   3. The banner: its text fades in over 20 ticks and out over the last 30 and is gone after 200 ticks; its scrim and rule stay canvas painting (the scene's `renderBanner`).
 *   4. Ten fields in a row leave no texture and no object behind.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/sje/runtime/inputdevice';
import { type Container, type GameObject, NineSlice, TextObject } from '../src/sje';
import { Game } from '../src/sje/runtime/game';
import { installCanvasStub } from './recorder';
import { recorder } from './sjeuikit';

vi.mock('../src/audio/sfx', () => ({ sfx: () => undefined }));
vi.mock('../src/audio/music', () => ({ music: () => undefined, placeMusic: () => undefined, previewMusic: () => undefined, pushMusic: () => undefined, popMusic: () => undefined }));
vi.mock('../src/audio/engine', () => ({ audio: { duck: () => undefined, applyVolumes: () => undefined, onUnlock: () => undefined, unlock: () => undefined } }));

class Keys {
  pressed = () => false;
  repeat = () => false;
  down = () => false;
  carry = () => undefined;
  dir = () => null;
  update = () => undefined;
  endFrame = () => undefined;
  consume = () => undefined;
  keyName = (a: string) => ({ confirm: 'Z', cancel: 'X' })[a] ?? a;
  keysFor = () => ['KeyZ'];
  captureNext = () => undefined;
}

let restoreCanvas: () => void;
beforeAll(() => {
  restoreCanvas = installCanvasStub();
});
afterAll(() => restoreCanvas());

let game: Game;
beforeEach(async () => {
  game = new Game({ renderer: { render: () => undefined }, input: new Keys() as unknown as Input });
  const { applyStage } = await import('../src/game/stages');
  applyStage('finale');
});

type Loose = Record<string, unknown> & { sys: { ui: Container }; close(r?: unknown): void; leader: { moving: boolean } };

async function field(map = 'lantern_row'): Promise<Loose> {
  const { FieldScene } = await import('../src/scenes/field');
  const f = new FieldScene(map, 10, 10, 'down') as unknown as Loose;
  void game.run(f as never);
  game.advanceTick();
  return f;
}

/** The objective the field shows: the story's flag wins over the scene's own text, so the test sets the flag. */
async function objective(text: string): Promise<void> {
  const { state } = await import('../src/game/state');
  state.flags.objective = text;
}

/** One drawn frame (the HUD syncs on it). */
const draw = (): void => game.draw();
const tick = (n = 1): void => {
  for (let i = 0; i < n; i++) game.advanceTick();
};

const hud = (f: Loose) => f.hud as { objectiveBox: Container; bannerBox: Container };
const texts = (c: Container): string[] => c.list.filter((o): o is TextObject => o instanceof TextObject).map((o) => o.text);
const kids = (c: Container): GameObject[] => [...c.list];
/** The same objects, in the same order (identity, not a deep compare: a box built again has equal-looking new objects). */
const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((o, i) => o === b[i]);

describe('the objective box', () => {
  it('sits in the top-left corner: the lines of the objective, the first with the arrow, over a canvas plate and an amber stripe', async () => {
    const f = await field();
    await objective('Find Dutch at the bar. Ask about the job.');
    draw();
    const box = hud(f).objectiveBox;
    expect(box.visible).toBe(true);
    const lines = box.list.filter((o): o is TextObject => o instanceof TextObject);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]?.text.startsWith('{y}▶{/} ')).toBe(true);
    expect([lines[0]?.x, lines[0]?.y]).toEqual([9, 6]);
    // The box holds the texts only: the plate and the stripe are canvas art (`paintPlate`, proved in the next test).
    expect(box.list.every((o) => o instanceof TextObject)).toBe(true);
    // Alpha: 0.9 standing, 0.55 while the leader walks.
    expect(box.alpha).toBeCloseTo(0.9, 5);
    f.leader.moving = true;
    draw();
    expect(box.alpha).toBeCloseTo(0.55, 5);
  });

  it('paints the plate and the stripe on the canvas with the old calls: (4, 4, w, h) and a 2 px stripe, at the box alpha; nothing while it is hidden', async () => {
    const f = await field();
    await objective('Find Dutch at the bar.');
    draw();
    const h = hud(f) as unknown as { paintPlate(ctx: unknown): boolean; objW: number; objLines: string[] };
    const plate = (): string[] => {
      const r = recorder();
      h.paintPlate(r.ctx);
      return r.log;
    };
    const height = 4 + h.objLines.length * 10;
    const standing = plate();
    expect(standing.filter((l) => l.startsWith('fillRect'))).toEqual([`fillRect(4,4,${h.objW},${height})`, `fillRect(4,4,2,${height})`]);
    // Control: the alpha follows the leader (0.9 standing, 0.55 walking), and a hidden objective paints nothing.
    f.leader.moving = true;
    draw();
    const r = recorder();
    h.paintPlate(r.ctx);
    expect(r.log).toContain('globalAlpha=0.55');
    f.busy = 1;
    draw();
    const none = recorder();
    expect(h.paintPlate(none.ctx)).toBe(false);
    expect(none.log).toEqual([]);
  });

  it('hides during a cutscene or dialogue (busy) and in an interior', async () => {
    const f = await field();
    await objective('Find Dutch at the bar.');
    draw();
    const box = hud(f).objectiveBox;
    expect(box.visible).toBe(true);
    f.busy = 1;
    draw();
    expect(box.visible).toBe(false);
    f.busy = 0;
    draw();
    expect(box.visible).toBe(true);
    // Control: the interior of a building has no objective box at all.
    const inside = await field('bar');
    await objective('Find Dutch at the bar.');
    draw();
    expect(hud(inside).objectiveBox.visible).toBe(false);
  });

  it('is built again only when what it shows changes: the same objects frame after frame inside one flash step, new ones when the text changes', async () => {
    const f = await field();
    await objective('Find Dutch at the bar.');
    draw();
    const box = hud(f).objectiveBox;
    // The first draw counts the flash down from 150 only when the text CHANGED; the first text has no flash.
    const first = kids(box);
    for (let i = 0; i < 20; i++) draw();
    expect(same(kids(box), first)).toBe(true);
    // Control: a new objective flashes (a new stripe color, so new objects), and its text is the new text.
    await objective('Go to the Annex.');
    draw();
    expect(same(kids(box), first)).toBe(false);
    expect(texts(box).some((t) => t.includes('Go to the Annex.'))).toBe(true);
    const flashing = kids(box);
    draw();
    // One frame later, inside the same ten-frame step of the flash: the same objects.
    expect(same(kids(box), flashing)).toBe(true);
    // Ten frames later the flash toggles: the same objects, recolored in place (no rebuild).
    const colorOf = () => (box.list.find((o): o is TextObject => o instanceof TextObject) as TextObject).style.color;
    const before = colorOf();
    for (let i = 0; i < 10; i++) draw();
    expect(same(kids(box), flashing)).toBe(true);
    expect(colorOf()).not.toBe(before);
  });
});

describe('the area banner', () => {
  it('fades in over 20 ticks, holds, fades out over the last 30, and is gone after 200; its name and sub line are the texts', async () => {
    const f = await field();
    (f.showBanner as (t: string, s: string) => void).call(f, 'Lantern Row', 'Chapter One');
    const box = hud(f).bannerBox;
    draw();
    // Tick 0: nothing to see yet.
    expect(box.visible).toBe(false);
    tick(10);
    draw();
    expect(box.visible).toBe(true);
    expect(box.alpha).toBeCloseTo(0.5, 5);
    expect(texts(box)).toEqual(['Lantern Row', 'Chapter One']);
    tick(10);
    draw();
    expect(box.alpha).toBe(1);
    tick(160);
    draw();
    // 180 ticks: 20 of the last 30 left.
    expect(box.alpha).toBeCloseTo(20 / 30, 5);
    tick(21);
    draw();
    expect(box.visible).toBe(false);
  });

  it('the name and the sub line are built once for their text; the scrim and the growing rule are painted by the scene while the banner shows', async () => {
    const { W } = await import('../src/sje/core/size');
    const { measure } = await import('../src/sje');
    const f = await field();
    (f.showBanner as (t: string, s: string) => void).call(f, 'Lantern Row', 'Chapter One');
    const box = hud(f).bannerBox;
    tick(25);
    draw();
    const built = kids(box);
    expect(built.map((o) => (o as TextObject).text)).toEqual(['Lantern Row', 'Chapter One']);
    // The name sits 3 px into the band, the sub line 16 px: the old calls.
    expect(built.map((o) => [o.x, o.y])).toEqual([[W / 2, 21], [W / 2, 34]]);
    tick(20);
    draw();
    expect(same(kids(box), built)).toBe(true);
    // The scrim: the band across the top (x, 18, w, 26) and a rule of round(t / 30 * (w - 40)) px centered on the middle, as the old code painted them.
    const w = measure('Lantern Row') + 40;
    const x = Math.round((W - w) / 2);
    const paint = (t: number): string[] => {
      (f.banner as { t: number }).t = t;
      const r = recorder();
      (f.renderBanner as (ctx: unknown) => boolean).call(f, r.ctx);
      return r.log.filter((l) => l.startsWith('fillRect'));
    };
    const early = paint(15);
    expect(early).toEqual([`fillRect(${x},18,${w},26)`, `fillRect(${Math.round(W / 2 - Math.round(0.5 * (w - 40)) / 2)},31,${Math.round(0.5 * (w - 40))},1)`]);
    // Control: a later tick has a wider rule, and a banner that is gone paints nothing.
    const late = paint(30);
    expect(late[1]).toBe(`fillRect(${Math.round(W / 2 - (w - 40) / 2)},31,${w - 40},1)`);
    (f as unknown as { banner: unknown }).banner = null;
    const none = recorder();
    expect((f.renderBanner as (ctx: unknown) => boolean).call(f, none.ctx)).toBe(false);
    expect(none.log).toEqual([]);
    // Control: another banner text is another build.
    (f.showBanner as (t: string, s: string) => void).call(f, 'Sinkline', '');
    tick(2);
    draw();
    expect(same(kids(box), built)).toBe(false);
  });
});

describe('ten fields in a row leave nothing behind', () => {
  it('open, show the objective and the banner, close: the texture count and the display list return to where they began', async () => {
    const before = game.textures.getTextureKeys().length;
    for (let i = 0; i < 10; i++) {
      const f = await field();
      await objective('Find Dutch at the bar.');
      (f.showBanner as (t: string, s: string) => void).call(f, 'Lantern Row', 'Chapter One');
      tick(30);
      draw();
      const ui = f.sys.ui;
      f.close();
      tick();
      draw();
      expect(ui.destroyed).toBe(true);
    }
    expect(game.textures.getTextureKeys().length).toBe(before);
  });

  it('control: a window made and not added to the display list is a leak, and the count sees it', async () => {
    const before = game.textures.getTextureKeys().length;
    const f = await field();
    new NineSlice(f as never, 0, 0, 50, 30);
    f.close();
    tick();
    draw();
    expect(game.textures.getTextureKeys().length).toBe(before + 1);
  });
});
