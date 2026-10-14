/**
 * The UI kit inside a real native scene (M8a pass line 8): a scene that builds one of every kit part, runs, and closes, ten times over. No texture
 * outlives its scene, no object is left in the display list, and a deliberate leak is seen by the same count (the control).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/engine/input';
import { Game } from '../src/sje/runtime/game';
import { Scene } from '../src/sje/runtime/scene';
import { Bar } from '../src/sje/ui/bar';
import { Cursor } from '../src/sje/ui/cursor';
import { ListMenu } from '../src/sje/ui/listmenu';
import { NineSlice } from '../src/sje/ui/nineslice';
import { TextObject } from '../src/sje/ui/textobject';
import { installFakeDocument } from './sjeuikit';

vi.spyOn(console, 'warn').mockImplementation(() => undefined);

let restore: () => void;
beforeAll(() => {
  restore = installFakeDocument();
});
afterAll(() => restore());

const noop = () => undefined;
const input = { update: noop, endFrame: noop, consume: noop } as unknown as Input;
const newGame = (): Game => new Game({ renderer: { render: noop }, input });

/** A scene with a window, a title, a list, a bar and both cursors: what a menu scene is made of. */
class MenuScene extends Scene<string> {
  list!: ListMenu<number>;
  text!: TextObject;
  override create(): void {
    const ui = this.sys.ui;
    ui.add(new NineSlice(this, 40, 30, 300, 180, { title: 'GEAR', footer: '{c}X{/} back' }));
    this.text = new TextObject(this, 56, 44, 'A menu scene', { color: '#3fe0f0' });
    ui.add(this.text);
    this.list = new ListMenu<number>(this, 56, 60, Array.from({ length: 9 }, (_, i) => ({ label: `Item ${i}`, value: i, right: `x${i}`, icon: '*' })), { rows: 5, width: 200 });
    ui.add(this.list);
    ui.add(new Bar(this, 56, 190, 90, 3, '#62e06a', 0.6));
    ui.add(new Cursor(this, 300, 200, 'more'));
  }
  fixedUpdate(): void {
    this.list.update();
    this.text.setText(`tick ${this.sys.tick % 50}`);
  }
}

describe('the kit in a scene', () => {
  let game: Game;
  beforeEach(() => {
    game = newGame();
  });

  it('builds, runs and draws: the scene has the kit in its ui layer', () => {
    const s = new MenuScene();
    void game.run(s);
    game.advanceTick();
    game.draw();
    const kinds = s.sys.ui.list.map((o) => o.constructor.name);
    expect(kinds).toEqual(['NineSlice', 'TextObject', 'ListMenu', 'Bar', 'Cursor']);
    s.close('done');
    game.advanceTick();
  });

  it('enter and exit 10 times: no texture outlives its scene, and the scene leaves no object behind', () => {
    const before = game.textures.getTextureKeys().length;
    for (let i = 0; i < 10; i++) {
      const s = new MenuScene();
      void game.run(s);
      for (let t = 0; t < 30; t++) {
        game.advanceTick();
        game.draw();
      }
      // While it runs, the kit holds textures (the window, the texts).
      expect(game.textures.getTextureKeys().length).toBeGreaterThan(before);
      const ui = s.sys.ui;
      s.close('done');
      game.advanceTick();
      game.draw();
      expect(ui.destroyed).toBe(true);
    }
    expect(game.textures.getTextureKeys().length).toBe(before);
  });

  it('while it runs, ticks that only change text do not grow the texture count', () => {
    const s = new MenuScene();
    void game.run(s);
    game.advanceTick();
    const steady = game.textures.getTextureKeys().length;
    for (let t = 0; t < 200; t++) game.advanceTick();
    expect(game.textures.getTextureKeys().length).toBe(steady);
    s.close('done');
    game.advanceTick();
  });

  it('control: a scene that makes a kit part and does not put it in its display list leaks it, and the count sees it', () => {
    class Leaky extends Scene<string> {
      override create(): void {
        // Not added to the display list: nobody destroys it when the scene closes.
        new TextObject(this, 0, 0, 'lost');
      }
      fixedUpdate(): void {}
    }
    const before = game.textures.getTextureKeys().length;
    const s = new Leaky();
    void game.run(s);
    game.advanceTick();
    s.close('done');
    game.advanceTick();
    game.draw();
    expect(game.textures.getTextureKeys().length).toBe(before + 1);
  });
});
