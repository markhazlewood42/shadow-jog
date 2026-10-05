/**
 * Fixes carried over from the verifiers of step B0 (docs/spikes/engine-platform.md, B2 section).
 * Each fix has its own test here, named after its letter in the task:
 *   a. a scene only gets `resume` if a `push` paused it
 *   b. a scene whose lifecycle throws gives the scene below its `resume` back
 *   c. a scene object runs once; a scene closed inside `init` runs no further step
 *   d. removing a texture that an object still shows keeps the GPU data until the last object goes
 *   e. the texture store's public type is `SjTexture`, with no Pixi in it
 * (f, the raw GL read behind GlHandoff, is in tests/sje-render.test.ts; g, the canvas size at
 * every device pixel ratio, is in tests/sje-render.test.ts and e2e/sjelab.spec.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageObject } from '../src/sje/display/imageobject';
import { type SjTexture, TextureManager } from '../src/sje/display/texturemanager';
import { Scene } from '../src/sje';
import { fakeCanvas, headlessGame, TestScene } from './sjekit';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('a. resume goes only to a scene that was paused', () => {
  it('closing a scene in the MIDDLE of the stack sends no resume to the scene on top', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const a = new TestScene(log, 'a');
    const b = new TestScene(log, 'b');
    const c = new TestScene(log, 'c');
    void game.run(a);
    void game.run(b);
    void game.run(c);
    log.length = 0;
    b.close(); // c is on top, and was never paused
    expect(log).toEqual(['b:shutdown']);
    expect(game.top).toBe(c);
    // When c closes, a (paused by b's push) is the one that wakes, once.
    log.length = 0;
    c.close();
    expect(log).toEqual(['c:shutdown', 'a:resume']);
  });

  it('the plain case still works: the top scene closes and the scene below hears resume once', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const a = new TestScene(log, 'a');
    const b = new TestScene(log, 'b');
    void game.run(a);
    void game.run(b);
    log.length = 0;
    b.close();
    expect(log).toEqual(['b:shutdown', 'a:resume']);
    // And a second close of the same scene does nothing.
    b.close();
    expect(log).toEqual(['b:shutdown', 'a:resume']);
  });

  it('a scene that was resumed is not resumed again when a later scene closes', () => {
    const { game } = headlessGame();
    const log: string[] = [];
    const a = new TestScene(log, 'a');
    const b = new TestScene(log, 'b');
    const c = new TestScene(log, 'c');
    void game.run(a);
    void game.run(b);
    b.close();
    void game.run(c); // pauses a again
    log.length = 0;
    c.close();
    expect(log).toEqual(['c:shutdown', 'a:resume']);
  });
});

describe('b. a scene that throws while starting gives the scene below its resume back', () => {
  class Throwing extends Scene<void> {
    constructor(private readonly where: 'init' | 'preload' | 'create') {
      super();
    }
    override init(): void {
      if (this.where === 'init') throw new Error('boom in init');
    }
    override preload(): void {
      if (this.where === 'preload') throw new Error('boom in preload');
    }
    override create(): void {
      if (this.where === 'create') throw new Error('boom in create');
    }
    fixedUpdate(): void {}
  }

  for (const where of ['init', 'preload', 'create'] as const) {
    it(`a throw in ${where}: the promise rejects, the stack is clean, and the scene below hears pause then resume`, async () => {
      const { game } = headlessGame();
      const log: string[] = [];
      const below = new TestScene(log, 'below');
      void game.run(below);
      log.length = 0;
      await expect(game.run(new Throwing(where))).rejects.toThrow(`boom in ${where}`);
      expect(game.scene.scenes).toEqual([below]);
      expect(log).toEqual(['below:pause', 'below:resume']);
      expect(below.sys.status).toBe('running');
    });
  }
});

describe('c. a scene object runs once', () => {
  it('running a scene that already closed is rejected with a clear message', async () => {
    const { game } = headlessGame();
    const s = new TestScene<number>([], 's');
    void game.run(s);
    s.close(1);
    await expect(game.run(s)).rejects.toThrow(/already closed/);
    expect(game.scene.scenes).toEqual([]);
  });

  it('running a scene that is live (already on the stack) is rejected, and the stack is unchanged', async () => {
    const { game } = headlessGame();
    const s = new TestScene([], 's');
    void game.run(s);
    await expect(game.run(s)).rejects.toThrow(/already running/);
    expect(game.scene.scenes).toEqual([s]);
  });

  it('reset() with a closed scene is rejected BEFORE it clears the screen the player is on', async () => {
    const { game } = headlessGame();
    const keep = new TestScene([], 'keep');
    const dead = new TestScene([], 'dead');
    void game.run(dead);
    dead.close();
    void game.run(keep);
    await expect(game.reset(dead)).rejects.toThrow(/already closed/);
    expect(game.scene.scenes).toEqual([keep]);
    expect(keep.sys.status).toBe('running');
  });

  it('a scene that closes itself inside init() runs neither preload nor create, and its promise resolves', async () => {
    const { game } = headlessGame();
    const log: string[] = [];
    class Quitter extends Scene<string> {
      override init(): void {
        log.push('init');
        this.close('early');
      }
      override preload(): void {
        log.push('preload');
      }
      override create(): void {
        log.push('create');
      }
      fixedUpdate(): void {}
    }
    const below = new TestScene(log, 'below');
    void game.run(below);
    log.length = 0;
    const result = await game.run(new Quitter());
    expect(result).toBe('early');
    expect(log).toEqual(['below:pause', 'init', 'below:resume']);
    expect(game.scene.scenes).toEqual([below]);
  });

  it('a scene that closes itself inside preload() does not run create', async () => {
    const { game } = headlessGame();
    const log: string[] = [];
    class Quitter extends Scene<void> {
      override preload(): void {
        log.push('preload');
        this.close();
      }
      override create(): void {
        log.push('create');
      }
      fixedUpdate(): void {}
    }
    await game.run(new Quitter());
    expect(log).toEqual(['preload']);
    await flush();
    expect(game.scene.scenes).toEqual([]);
  });
});

describe('c2. a scene that closes itself while the frame is being prepared', () => {
  it('a prerender handler that closes its own scene does not break the draw (no camera apply on a destroyed display list)', async () => {
    const { game } = headlessGame();
    class QuitsInPrerender extends Scene<string> {
      override create(): void {
        this.events.on('prerender', () => this.close('bye'));
      }
      fixedUpdate(): void {}
    }
    const p = game.run(new QuitsInPrerender());
    game.draw();
    await expect(p).resolves.toBe('bye');
    expect(console.error).not.toHaveBeenCalled();
    expect(game.scene.scenes).toEqual([]);
  });
});

describe('d. removing a texture that an object still shows', () => {
  function setup() {
    const textures = new TextureManager();
    textures.addCanvas('hero', fakeCanvas(8, 8));
    return { textures, host: { textures } };
  }

  it('frees the KEY at once but keeps the GPU data until the last object that shows it is destroyed', () => {
    const { textures, host } = setup();
    const entry = textures.entryOf('hero');
    const a = new ImageObject(host, 0, 0, 'hero');
    const b = new ImageObject(host, 4, 0, 'hero');
    expect(entry.useCount).toBe(2);
    expect(textures.remove('hero')).toBe(true);
    expect(textures.exists('hero')).toBe(false);
    expect(entry.destroyed).toBe(false); // two objects still show it
    a.destroy();
    expect(entry.destroyed).toBe(false);
    b.destroy();
    expect(entry.destroyed).toBe(true); // the last one let go
  });

  it('destroys at once when nothing shows the texture', () => {
    const { textures } = setup();
    const entry = textures.entryOf('hero');
    textures.remove('hero');
    expect(entry.destroyed).toBe(true);
  });

  it('the key can be added again while the old picture lives on for its objects', () => {
    const { textures, host } = setup();
    const old = textures.entryOf('hero');
    const shown = new ImageObject(host, 0, 0, 'hero');
    textures.remove('hero');
    textures.addCanvas('hero', fakeCanvas(8, 8));
    const fresh = textures.entryOf('hero');
    expect(fresh).not.toBe(old);
    expect(old.destroyed).toBe(false);
    shown.destroy();
    expect(old.destroyed).toBe(true);
    expect(fresh.destroyed).toBe(false);
  });

  it('a scene that removes its textures in a shutdown listener (before its display list is destroyed) leaks nothing and throws nothing', async () => {
    const { game } = headlessGame();
    game.textures.addCanvas('tmp', fakeCanvas(8, 8));
    const entry = game.textures.entryOf('tmp');
    class S extends Scene<void> {
      override create(): void {
        this.add.image(0, 0, 'tmp');
        this.events.on('shutdown', () => this.textures.remove('tmp'));
      }
      fixedUpdate(): void {}
    }
    const s = new S();
    void game.run(s);
    s.close();
    await flush();
    expect(entry.destroyed).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('setTexture hands the use count from the old texture to the new one', () => {
    const { textures, host } = setup();
    textures.addCanvas('other', fakeCanvas(8, 8));
    const hero = textures.entryOf('hero');
    const other = textures.entryOf('other');
    const obj = new ImageObject(host, 0, 0, 'hero');
    obj.setTexture('other');
    expect([hero.useCount, other.useCount]).toEqual([0, 1]);
    textures.remove('other');
    expect(other.destroyed).toBe(false);
    obj.destroy();
    expect(other.destroyed).toBe(true);
  });

  it('prune() goes through the same rule', () => {
    const { textures, host } = setup();
    const entry = textures.entryOf('hero');
    const obj = new ImageObject(host, 0, 0, 'hero');
    expect(textures.prune('he', new Set())).toBe(1);
    expect(entry.destroyed).toBe(false);
    obj.destroy();
    expect(entry.destroyed).toBe(true);
  });
});

describe('e. the texture store hands out SjTexture, with no Pixi in the type', () => {
  it('get() and addCanvas() return SjTexture; the Pixi parts are only on entryOf (for src/sje/display)', () => {
    const t = new TextureManager();
    const added: SjTexture = t.addCanvas('a', fakeCanvas(4, 4));
    const got: SjTexture = t.get('a');
    // @ts-expect-error the Pixi texture is not part of the public type
    void got.base;
    // @ts-expect-error neither is the Pixi texture of a frame
    void got.pixiTexture;
    expect(added.key).toBe('a');
    expect(Object.keys(got)).toContain('frames'); // the data is there; only the TYPE hides the Pixi parts
    expect(t.entryOf('a').base).toBeDefined();
  });
});
