/**
 * The UI scenes that are native `sje` scenes (M8b, phase 1: card, controls, gameover, ending, placemap, saveload) and the pieces they share:
 * `ActionMap.keyName`, the `UiScene` base, the `onSound` mapping. Each scene runs on a real `Game` with no renderer and a scripted input.
 * The behavior is the old scene's: the tests press the same keys and read the same fields.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/sje/runtime/inputdevice';
import { Graphics, keyLegend, NineSlice, TextObject } from '../src/sje';
import { Game } from '../src/sje/runtime/game';
import { actionMapOf } from '../src/sje/runtime/input';
import { installCanvasStub } from './recorder';

const sfxCalls: string[] = [];
vi.mock('../src/audio/sfx', () => ({ sfx: (name: string) => void sfxCalls.push(name) }));
vi.mock('../src/audio/music', () => ({ music: () => undefined }));

/** A scripted input: one action is "pressed" (and repeating) for the tick it is set. */
class Keys {
  cur: string | null = null;
  names: Record<string, string> = { confirm: 'Z', cancel: 'X' };
  pressed = (a: string) => a === this.cur;
  repeat = (a: string) => a === this.cur;
  down = () => false;
  dir = () => null;
  update = () => undefined;
  endFrame = () => undefined;
  consume = () => undefined;
  keyName = (a: string) => this.names[a] ?? a;
  keysFor = () => ['KeyZ'];
  captureNext = () => undefined;
}

let restore: () => void;
beforeAll(() => {
  restore = installCanvasStub();
});
afterAll(() => restore());

function newGame(): { game: Game; keys: Keys } {
  const keys = new Keys();
  return { game: new Game({ renderer: { render: () => undefined }, input: keys as unknown as Input }), keys };
}

/** Press an action for one tick. */
function press(game: Game, keys: Keys, action: string): void {
  keys.cur = action;
  game.advanceTick();
  keys.cur = null;
}

function tick(game: Game, n: number): void {
  for (let i = 0; i < n; i++) game.advanceTick();
}

const textsOf = (ui: { list: readonly unknown[] }): string[] => ui.list.filter((o): o is TextObject => o instanceof TextObject).map((o) => o.text);

describe('ActionMap.keyName and keyLegend (M8b known gap)', () => {
  it('keyName asks the input for the player’s own key, so a custom binding shows in a legend', () => {
    const keys = new Keys();
    const map = actionMapOf(keys as unknown as Input);
    expect(map.keyName('confirm')).toBe('Z');
    expect(keyLegend(map, 'back', 'rebind')).toBe('{c}Z{/} rebind   {c}X{/} back');
    keys.names.cancel = 'Esc';
    expect(keyLegend(map)).toBe('{c}Esc{/} back');
  });
});

describe('the onSound mapping', () => {
  it('maps each kit sound to the sound effect of the same name', async () => {
    const { uiSound } = await import('../src/scenes/uisound');
    sfxCalls.length = 0;
    for (const s of ['cursor', 'confirm', 'cancel', 'buzz'] as const) uiSound(s);
    expect(sfxCalls).toEqual(['cursor', 'confirm', 'cancel', 'buzz']);
  });
});

describe('UiScene', () => {
  it('counts its ticks from 1, runs tick() after the count, and dim() adds one Graphics to the ui layer', async () => {
    const { UiScene } = await import('../src/scenes/uiscene');
    const seen: number[] = [];
    class Probe extends UiScene {
      override create(): void {
        this.dim(0.5);
      }
      protected tick(): void {
        seen.push(this.t);
      }
    }
    const { game } = newGame();
    const s = new Probe();
    void game.run(s);
    tick(game, 3);
    expect(seen).toEqual([1, 2, 3]);
    expect(s.sys.ui.list.filter((o) => o instanceof Graphics)).toHaveLength(1);
    s.close();
  });
});

describe('CardScene', () => {
  it('slides its window up over 8 ticks, ignores keys until tick 13, then closes on confirm', async () => {
    const { CardScene } = await import('../src/scenes/card');
    const { game, keys } = newGame();
    const card = new CardScene('Tutorial', 'Hold X to run.');
    let result: unknown = 'open';
    void game.run(card).then((r) => (result = r));
    const win = card.sys.ui.list.find((o): o is NineSlice => o instanceof NineSlice)!;
    const rest = win.y - 8;
    expect(win.y).toBe(Math.round(rest + 8));
    tick(game, 8);
    expect(win.y).toBe(Math.round(rest));
    press(game, keys, 'confirm'); // tick 9: too early
    expect(card.closed).toBe(false);
    tick(game, 3); // ticks 10 to 12
    press(game, keys, 'confirm'); // tick 13
    expect(card.closed).toBe(true);
    await Promise.resolve();
    expect(result).toBeUndefined();
  });
});

describe('ControlsScene', () => {
  it('lists the actions, draws the legend in the player’s own keys, and cancel closes', async () => {
    const { ControlsScene } = await import('../src/scenes/controls');
    const { game, keys } = newGame();
    const s = new ControlsScene();
    void game.run(s);
    tick(game, 1);
    const win = s.sys.ui.list.find((o): o is NineSlice => o instanceof NineSlice)!;
    expect(win.style.footer).toBe('{c}Z{/} rebind   {c}X{/} back');
    keys.names.cancel = 'Esc';
    tick(game, 1);
    expect(win.style.footer).toBe('{c}Z{/} rebind   {c}Esc{/} back');
    expect(textsOf(s.sys.ui)).toContain('Reset keys to defaults');
    press(game, keys, 'cancel');
    expect(s.closed).toBe(true);
  });

  it('the cursor wraps from the first row to the last', async () => {
    const { ControlsScene } = await import('../src/scenes/controls');
    const { game, keys } = newGame();
    const s = new ControlsScene();
    void game.run(s);
    press(game, keys, 'up');
    expect((s as unknown as { idx: number }).idx).toBe(10);
    s.close();
  });
});

describe('GameOverScene', () => {
  it('shows the menu at tick 70 and returns the chosen row on confirm', async () => {
    const { GameOverScene } = await import('../src/scenes/gameover');
    const { ListMenu } = await import('../src/sje');
    const { game, keys } = newGame();
    const s = new GameOverScene(true);
    let result: unknown;
    void game.run(s).then((r) => (result = r));
    const menu = s.sys.ui.list.find((o): o is InstanceType<typeof ListMenu> => o instanceof ListMenu)!;
    tick(game, 60);
    expect(menu.visible).toBe(false);
    press(game, keys, 'confirm'); // too early: the menu is not up
    expect(s.closed).toBe(false);
    tick(game, 9); // to tick 70
    expect(menu.visible).toBe(true);
    press(game, keys, 'confirm');
    expect(s.closed).toBe(true);
    await Promise.resolve();
    expect(result).toBe('retry');
  });

  it('a fight that cannot be retried starts the cursor on a row that can be chosen', async () => {
    const { GameOverScene } = await import('../src/scenes/gameover');
    const { ListMenu } = await import('../src/sje');
    const { game } = newGame();
    const s = new GameOverScene(false);
    void game.run(s);
    const menu = s.sys.ui.list.find((o): o is InstanceType<typeof ListMenu> => o instanceof ListMenu)!;
    expect(menu.index).not.toBe(0);
    s.close('title');
  });
});

describe('EndingScene', () => {
  it('turns to the next-chapter page on confirm after tick 170, then closes on confirm after tick 150 of that page', async () => {
    const { EndingScene } = await import('../src/scenes/ending');
    const { game, keys } = newGame();
    const s = new EndingScene(60 * 60 * 31);
    void game.run(s);
    tick(game, 169);
    press(game, keys, 'confirm'); // tick 170: not yet (needs more than 170)
    expect(s.closed).toBe(false);
    expect((s as unknown as { page: number }).page).toBe(0);
    press(game, keys, 'confirm'); // tick 171
    expect((s as unknown as { page: number }).page).toBe(1);
    tick(game, 149);
    press(game, keys, 'confirm'); // tick 150 of page 1: not yet
    expect(s.closed).toBe(false);
    press(game, keys, 'confirm'); // tick 151
    expect(s.closed).toBe(true);
  });

  it('the results page names the key the player confirms with', async () => {
    const { EndingScene } = await import('../src/scenes/ending');
    const { game, keys } = newGame();
    keys.names.confirm = 'Enter';
    const s = new EndingScene(0);
    void game.run(s);
    tick(game, 175);
    const visible = s.sys.ui.list.length > 0;
    expect(visible).toBe(true);
    // The prompt is a text of the results page (inside a container, so look through the whole tree).
    const all: string[] = [];
    const collect = (list: readonly unknown[]): void => {
      for (const o of list) {
        if (o instanceof TextObject) all.push(o.text);
        else if (o && typeof o === 'object' && 'list' in o) collect((o as { list: readonly unknown[] }).list);
      }
    };
    collect(s.sys.ui.list);
    expect(all).toContain('Press Enter to continue');
    s.close();
  });
});

describe('PlaceMapScene', () => {
  it('closes on cancel and on confirm', async () => {
    const { PlaceMapScene } = await import('../src/scenes/placemap');
    for (const action of ['cancel', 'confirm']) {
      const { game, keys } = newGame();
      const s = new PlaceMapScene('lantern_row');
      void game.run(s);
      tick(game, 2);
      expect(s.closed).toBe(false);
      press(game, keys, action);
      expect(s.closed).toBe(true);
    }
  });
});

describe('SaveScene', () => {
  it('cancel closes with null, and a load of an empty slot is refused with a note', async () => {
    const { SaveScene } = await import('../src/scenes/saveload');
    const { game, keys } = newGame();
    const load = new SaveScene('load');
    let result: unknown = 'open';
    void game.run(load).then((r) => (result = r));
    const info = (load as unknown as { info: { status: string }[] }).info;
    // With no saves in the test (no storage), every slot is empty: confirm is refused.
    if (info.every((i) => i.status === 'empty')) {
      sfxCalls.length = 0;
      press(game, keys, 'confirm');
      expect((load as unknown as { note: string }).note).toBe('That slot is empty.');
      expect(sfxCalls).toContain('buzz');
      expect(load.closed).toBe(false);
    }
    press(game, keys, 'cancel');
    expect(load.closed).toBe(true);
    await Promise.resolve();
    expect(result).toBeNull();
  });

  it('after a successful save the scene ignores input, so a second confirm cannot overwrite another slot', async () => {
    const { SaveScene } = await import('../src/scenes/saveload');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    try {
      const { game, keys } = newGame();
      const s = new SaveScene('save');
      void game.run(s);
      press(game, keys, 'confirm'); // writes slot 1
      expect(store.size).toBe(1);
      press(game, keys, 'down');
      press(game, keys, 'confirm'); // would write slot 2 without the guard
      expect(store.size).toBe(1);
      // Control: a fresh scene that has not saved yet does write when the cursor is on another slot.
      const fresh = new SaveScene('save');
      void game.run(fresh);
      press(game, keys, 'down');
      press(game, keys, 'confirm');
      expect(store.size).toBe(2);
      fresh.close(null);
      s.close(null);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the cursor wraps on a save screen with three slots', async () => {
    const { SaveScene } = await import('../src/scenes/saveload');
    const { game, keys } = newGame();
    const s = new SaveScene('save');
    void game.run(s);
    press(game, keys, 'up');
    expect((s as unknown as { idx: number }).idx).toBe(2);
    s.close(null);
  });
});
