/**
 * Helpers for the engine's unit tests (tests/sje-*.test.ts). Node has no canvas and no GPU, so:
 *  - a "canvas" is just an object with a size (Pixi builds a texture source around it without
 *    touching it until a renderer uploads it, and there is no renderer in Node);
 *  - a headless game has a renderer that draws nothing, so the scene stack, the loop and the
 *    display list all run against the REAL Pixi scene classes.
 */
import { type FrameRenderer, Game, Scene } from '../src/sje';
import { noopInput } from './game-cases';

export function fakeCanvas(w: number, h: number): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

export interface Headless {
  game: Game;
  /** How many times the renderer was asked to draw. */
  renders: { count: number };
  /** Set `lost` to make the fake renderer report a lost WebGL context (`Game.contextLost`). */
  gl: { lost: boolean };
  /** Run one browser frame of `ms` real milliseconds through the real FixedLoop. */
  frame(ms: number): void;
}

/** A game whose renderer draws nothing and whose clock the test drives by hand. */
export function headlessGame(onRender?: () => void): Headless {
  const renders = { count: 0 };
  const gl = { lost: false };
  const renderer: FrameRenderer = {
    get contextLost() {
      return gl.lost;
    },
    render: () => {
      renders.count++;
      onRender?.();
    },
  };
  let callback: ((now: number) => void) | null = null;
  let now = 0;
  const game = new Game({
    renderer,
    input: noopInput,
    loop: {
      requestFrame: (cb) => {
        callback = cb;
        return 1;
      },
      cancelFrame: () => {
        callback = null;
      },
      now: () => now,
    },
  });
  game.start();
  return {
    game,
    renders,
    gl,
    frame(ms: number) {
      now += ms;
      const cb = callback;
      if (!cb) throw new Error('the loop is not running');
      cb(now);
    },
  };
}

/** A scene that writes what happens to it into a shared log, so a test can check the ORDER of things. */
export class TestScene<R = void> extends Scene<R> {
  updates = 0;
  constructor(
    readonly log: string[],
    readonly name: string,
  ) {
    super();
  }
  override init(): void {
    this.log.push(`${this.name}:init`);
  }
  override preload(): void {
    this.log.push(`${this.name}:preload`);
  }
  override create(): void {
    this.log.push(`${this.name}:create`);
    this.events.on('shutdown', () => this.log.push(`${this.name}:shutdown`));
    this.events.on('resume', () => this.log.push(`${this.name}:resume`));
    this.events.on('pause', () => this.log.push(`${this.name}:pause`));
  }
  fixedUpdate(tick: number): void {
    this.updates++;
    this.log.push(`${this.name}:tick${tick}`);
  }
}
