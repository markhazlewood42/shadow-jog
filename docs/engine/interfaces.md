---
type: design
title: "Shadow Jog Engine — Interfaces"
project: shadow-jog
created: 2026-10-04
updated: 2026-10-04
status: approved 2026-10-04 (all recommendations)
tags: [engine, design]
---

# Shadow Jog Engine — Interfaces

This file shows the key public TypeScript interfaces. Each block has a short explanation above it. The code is a design sketch. The compiler does not check it. M0 compiles every sketch under the repo's strict settings (`exactOptionalPropertyTypes` included). The real `.d.ts` files will then replace the sketches, and a script will copy them here so the docs cannot drift.

> **Read first:** [Three things that look like Phaser and are not](README.md#2-three-things-that-look-like-phaser-and-are-not). Tag meanings are in the "Tags" table at the top of [conventions.md](conventions.md).

**Tags in comments.** `// ours` means no engine has this, or we changed it. `// deviation` means the name is Phaser's and the behaviour is not. `// on demand` means we build it only when a ported scene needs it. No tag means Phaser 4.

**Strict types.** Phaser members that we do not implement are absent from the types, so a call to them is a compile error. The list is in [conventions.md](conventions.md).

**Types that are not shown.** Some names come from the real code and are not part of this design. Examples: `Ctx` (`src/engine/canvas.ts`), `Fighter`, `StageData`, `HackDef`, `SceneDump`, `EmitterPreset`. The block below defines the small value types that the sketches share. Points are plain `{ x, y }` objects. There is no `Vec2` class.

```ts
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Raw { w: number; h: number; data: Uint8ClampedArray; }        // CPU pixels, from the spike's textures.ts
export interface ShockOpts { strength?: number; reach?: number; life?: number; width?: number; }   // today's postfx.shock options
export interface HazeOpts { radius?: number; strength?: number; life?: number; }
export interface GlitchOpts { w?: number; h?: number; strength?: number; life?: number; }
export interface TimerEvent { remove(): void; readonly hasDispatched: boolean; }                    // Phaser TimerEvent
export interface DisplayList { readonly list: readonly GameObject[]; }
```

---

## 1. Size and Game

`size.ts` is the one source of the logical resolution. `Game` owns everything else. `Game.create` is async because Pixi `init` is async. `run` returns a promise that resolves when the scene calls `close`.

```ts
// src/sje/core/size.ts
export const W = 480, H = 270, FPS = 60;
export const TICK_MS = 1000 / FPS;
export const grain = (n: 1 | 2 | 4) => ({ w: W / n, h: H / n });   // ours

// src/sje/runtime/game.ts
export type FxLevel = 'full' | 'lite' | 'none';
export interface GameConfig {
  parent: HTMLElement;
  fxLevel?: 'auto' | FxLevel;           // ours. 'auto' picks 'lite' on software GL
  scaleMode?: 'integer' | 'fit';        // ours
  seed?: number;                         // ours. Visual randomness only
  dev?: boolean;                         // ours. Enables __SJ__, editors, pixi/events
}
export interface GameEvents {
  prestep(tick: number): void; step(tick: number): void; poststep(tick: number): void;
  prerender(alpha: number): void; postrender(): void;
  contextlost(): void; contextrestored(): void;      // ours
  fault(scene: Scene, err: unknown): void;           // ours
}
export declare class Game {
  static create(config: GameConfig): Promise<Game>;
  readonly events: EventEmitter<GameEvents>;
  readonly scene: SceneManager;
  readonly textures: TextureManager;
  readonly cache: CacheManager;                       // on demand
  readonly registry: DataManager;                     // on demand. Engine values only
  readonly scale: Display;
  readonly input: InputManager;
  readonly fx: FxSystem;                              // ours
  readonly audio: AudioBridge;                        // ours
  tick: number;                                       // today's `frame`
  speed: number;
  /** Phaser's ScenePlugin.run does not wait. This does. */   // deviation
  run<R>(scene: Scene<R>): Promise<R>;
  reset<R>(scene: Scene<R>): Promise<R>;
  abandon(): void;                                    // pending run() promises stay pending
  wait(frames: number): Promise<void>;                // frames equal ticks. Keeps story code
  waitMs(ms: number): Promise<void>;                  // ours
  fadeTo(level: number, frames?: number, color?: string): Promise<void>;
  fadeOut(frames?: number): Promise<void>;
  fadeIn(frames?: number): Promise<void>;
  shake(frames?: number, mag?: number, dir?: 'x' | 'y' | 'both'): void;
  flash(color?: string, frames?: number): void;
  /** Dev only. Production never destroys the renderer: it kills a shared context. */
  destroyForTests(): void;
}
```

---

## 2. Scene and SceneManager

A `Scene` owns its display list, cameras, input, loader, clock, tweens, and events. They all die with it. The hook that runs every tick is `fixedUpdate`. `update` is typed as `never`, so a Phaser habit does not compile (E2).

```ts
export interface SceneEvents {                         // Phaser event names, fired per tick or per frame as noted
  create(): void;
  preupdate(tick: number): void; update(tick: number): void; postupdate(tick: number): void;   // per tick
  prerender(): void;                                   // per frame
  pause(): void; resume(): void; sleep(): void; wake(): void;
  shutdown(): void; destroy(): void;
}
export type SceneStatus = 'init' | 'start' | 'loading' | 'creating' | 'running' | 'paused' | 'sleeping' | 'shutdown' | 'destroyed';

export abstract class Scene<R = unknown> {
  readonly key: string;                                // ours. Generated for a scene that runs through game.run
  readonly sys: Systems; readonly game: Game;
  readonly add: GameObjectFactory;
  readonly cameras: CameraManager;                     // main + ui (ours)
  readonly input: SceneInput;
  readonly load: Loader;
  readonly time: Clock;                                // on demand
  readonly tweens: TweenManager;                       // on demand
  readonly events: EventEmitter<SceneEvents>;
  readonly textures: TextureManager;
  readonly lights: Lights;                             // deviation. On demand
  readonly signal: AbortSignal;                        // ours. Aborts at shutdown
  opaque: boolean; curtain: boolean; passUpdate: boolean;       // ours. Today's meaning
  init?(data: unknown): void;
  preload?(): void;
  create?(data: unknown): void;                        // runs once, after preload() and any load completes. Never async
  /** Fixed 60 Hz tick. Change game state here. */      // deviation: Phaser's update is variable
  abstract fixedUpdate(tick: number): void;
  update?: never;                                      // compile error on purpose
  close(result: R): void;                              // pops this scene, resumes the one below, resolves game.run
}

export interface Systems {
  readonly tick: number; status: SceneStatus; visible: boolean;
  readonly displayList: DisplayList;
  readonly world: Container; readonly ui: Container;   // per scene. The screen's worldRoot and uiRoot hold them. cameras.main moves `world`
}

export declare class SceneManager {                    // Phaser ScenePlugin names. Operations queue to the next tick. `key` names a scene added with `add`, or the generated `Scene.key`
  add(key: string, cls: new () => Scene, autoStart?: boolean, data?: unknown): Scene;
  launch(key: string, data?: unknown): void;
  pause(key: string): void; resume(key: string): void;
  sleep(key: string): void; wake(key: string): void;
  stop(key: string): void; switch(from: string, to: string): void;
  get(key: string): Scene | undefined;
  readonly scenes: readonly Scene[];
}
```

---

## 3. GameObjects and the node types

Every setter returns `this`. A `GameObject` owns one private Pixi node. Leaf classes do not accept children. `ImageObject` and `TextObject` have suffixes so they do not shadow the DOM globals `Image` and `Text`.

```ts
export type SjBlend = 'normal' | 'add' | 'multiply' | 'screen' | 'min' | 'max';   // ours. Safe over 3D pixels

export abstract class GameObject {
  readonly scene: Scene; name: string; active: boolean;
  x: number; y: number; depth: number; alpha: number; visible: boolean;
  originX: number; originY: number;                    // default 0.5. Written to the Pixi anchor
  flipX: boolean;                                      // flips about the texture middle
  scrollFactorX: 0 | 1; scrollFactorY: 0 | 1;          // deviation. Phaser allows any number. 0 moves a top-level object into scene.ui
  readonly filters: FilterList;                        // deviation. Flat. Phaser 4 has filters.internal and filters.external, after enableFilters()
  setPosition(x: number, y?: number): this;
  setDepth(d: number): this; setAlpha(a: number): this; setVisible(v: boolean): this;
  setOrigin(x: number, y?: number): this; setFlipX(f: boolean): this;
  setScrollFactor(x: 0 | 1, y?: 0 | 1): this;
  setBlendMode(m: SjBlend): this;
  setPixelSnap(on: boolean): this;                     // ours. Default on. View3D turns it off
  setData(key: string, v: unknown): this; getData<T>(key: string): T | undefined;
  destroy(): void;
  /** @internal The only escape hatch to Pixi. Allowed under src/sje only. */
  readonly node: unknown;
}

export declare class Container extends GameObject {
  readonly list: readonly GameObject[];
  add(child: GameObject | GameObject[]): this;
  remove(child: GameObject, destroy?: boolean): this;
  setGrain(n: 1 | 2 | 4): this;                        // ours. Container with scale n in the coarse grid
  setSortingGroup(on: boolean): this;                  // Unity Sorting Group
  ySort: boolean;                                      // Godot y-sort
}
export declare class ImageObject extends GameObject {
  texture: SjTexture;
  setTexture(key: string, frame?: string | number): this;
}
export declare class Sprite extends ImageObject {     // deviation. Phaser's Sprite is a sibling of Image
  setFrame(f: string | number): this;
  // play(anim) is not built. Rejected in E23 option A. Scenes pick frames by tick
}
export declare class Graphics extends GameObject {
  fillStyle(color: number, alpha?: number): this;
  fillRect(x: number, y: number, w: number, h: number): this;
  clear(): this;
}
export interface TextStyle { color?: string; shadow?: boolean; outline?: string; align?: 'left' | 'center' | 'right'; max?: number; scale?: number; }
export declare class TextObject extends ImageObject {
  setText(s: string): this; setStyle(s: TextStyle): this;
}
export declare class Zone extends GameObject {            // Phaser Zone. Hit area for editors
  setSize(w: number, h: number): this;
  setAlphaMask(texKey: string, frame?: string | number): this;     // ours. CPU pixel alpha
}
export declare class CanvasImage extends ImageObject {  // ours as a class
  readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D;
  refresh(): void;                                     // source.update()
}
export declare class RenderImage extends ImageObject {} // GPU only. Re-baked after context loss. On demand
export declare class NineSlice extends GameObject {       // on demand. For window frames
  setSize(w: number, h: number): this;
}
export declare class Group<T extends GameObject = GameObject> {   // on demand. A pool and a set of references. Not displayed
  readonly children: readonly T[];
  add(o: T): this; remove(o: T, destroy?: boolean): this;
  clear(destroy?: boolean): this;
}
export declare class Lights {                          // deviation. On demand. Draws a multiply light map
  setAmbientColor(color: string): this;
  addLight(x: number, y: number, radius: number, color?: string, intensity?: number): { remove(): void };
}

export declare class GameObjectFactory {               // scene.add
  image(x: number, y: number, key: string, frame?: string | number): ImageObject;
  sprite(x: number, y: number, key: string, frame?: string | number): Sprite;
  container(x?: number, y?: number, children?: GameObject[]): Container;
  layer(opts?: { ui?: boolean }): Container;           // deviation. Phaser 4 Layer is a class. We return a Container kept at identity. `ui` is ours
  graphics(): Graphics;
  text(x: number, y: number, s: string, style?: TextStyle): TextObject;
  zone(x: number, y: number, w: number, h: number): Zone;
  canvasImage(x: number, y: number, w: number, h: number): CanvasImage;   // ours
  timeline(steps: TimelineStep[]): Timeline;           // on demand
  static register<K extends string>(name: K, fn: (this: GameObjectFactory, ...a: any[]) => GameObject): void;
}

export declare class Pool<T extends GameObject> {      // ours. Unity ObjectPool. For floating numbers and particles
  constructor(create: () => T, reset: (o: T) => void);
  get(): T; release(o: T): void;
}
```

---

## 4. Camera

Pixi has no camera. This `Camera` is a transform on the scene's `world` container. Scroll is always rounded to whole pixels (snap to pixel). The effect arguments differ from Phaser's, and the tags say where.

```ts
export declare class Camera {
  scrollX: number; scrollY: number; zoom: number;      // scroll is rounded
  setScroll(x: number, y?: number): this;
  setZoom(z: number): this;
  setBounds(x: number, y: number, w: number, h: number): this;
  setDeadzone(w: number, h: number): this;
  startFollow(t: GameObject, roundPixels?: boolean, lerpX?: number, lerpY?: number, ox?: number, oy?: number): this;
  fade(ms: number, color?: string): this;             // deviation. Phaser: duration, r, g, b
  flash(ms: number, color?: string): this;            // deviation
  shake(ms: number, magnitudePx?: number): this;      // deviation. Phaser: a fraction of the view
  pan(x: number, y: number, ms: number): this;
  zoomTo(z: number, ms: number): this;
  readonly filters: FilterList;
}
export declare class CameraManager { readonly main: Camera; readonly ui: Camera; }   // ui is ours. It never scrolls, shakes, or zooms
```

---

## 5. Effects and filters

`Effect` wraps one Pixi filter, so a Pixi upgrade or a community filter never reaches game code. `createEffect` builds an `Effect` from your GLSL. `FxSystem` keeps today's `postfx` names **and signatures** (copied from `src/engine/postfx.ts`), so `fx.json`, `moments.ts`, and the FX lab still work.

```ts
export interface Effect {                              // ours
  readonly name: string;
  set(uniform: string, value: number | number[]): this;           // change one uniform
  update?(tick: number): void;
  destroy(): void;
  /** @internal */ readonly filter: unknown;
}
export interface EffectSpec {                          // ours
  name: string;
  fragment: string;                                    // GLSL ES 3.00 fragment body. The engine adds the vertex shader and `uInputSize`
  uniforms?: Record<string, { type: 'f32' | 'vec2<f32>' | 'vec3<f32>' | 'vec4<f32>'; value: number | number[] }>;
  padding?: number;                                    // extra pixels around the object, for blur or glow
  resolution?: number;                                 // default: game resolution (E8)
}
export declare function createEffect(spec: EffectSpec): Effect;   // ours. Wraps Pixi Filter.from with both shaders

export declare class FilterList {                      // deviation. Flat. Phaser 4 has { internal, external } and enableFilters()
  add(e: Effect): this; remove(e: Effect): this; clear(): this;
  addMask(maskObject: GameObject, invert?: boolean): this;       // Phaser 4 Mask filter, flat form
  /** Phaser's internal list. Accepted, but runs as external. Logs once in dev. */
  readonly internal: FilterList;                                  // deviation
  readonly external: FilterList;
}

/** Today's postfx signatures. `playMoment(fx, name, x, y, o)` stays a free function and reads `active`. */
export declare class FxSystem {                       // ours. Keeps the postfx names and signatures
  readonly level: FxLevel;
  readonly active: boolean;                            // today's `postfx.active`. playMoment checks it
  shock(x: number, y: number, opts?: ShockOpts): void;
  aberrate(amount: number, x?: number, y?: number): void;         // x and y default to the screen centre
  haze(x: number, y: number, opts?: HazeOpts): void;
  glitch(x: number, y: number, opts?: GlitchOpts): void;
  dim(amount: number, life?: number): void;
  flare(amount: number): void;
  later(frames: number, fn: () => void): void;
  emit(p: EmitterPreset, x: number, y: number, opts?: { angle?: number; scale?: number }): void;
  update(): void;
  clear(): void;
  warm(): void;                                        // new. Compile shaders off screen
  /** Today's call shape, kept for LegacyScene. A Pixi-side glow layer is a new method beside it. */
  glowLayer(): Ctx | null;
}
```

**Built-in effects.** Costs are not measured yet. The cost column is an estimate.

| Effect | What it does | Where | Cost (estimate) |
|---|---|---|---|
| Hit flash | Tints an object white for a few ticks | One object | Low |
| Ripple | A shockwave ring around a point | One object or a camera | Low to medium |
| Outline | A 1 px outline | One object | Low |
| Glow | Adds a blurred copy | One object or the screen | Medium |
| `CompositeFilter` | The screen composite from section 6.5 of [frame-and-rendering.md](frame-and-rendering.md) | The screen root | Medium to high |

---

## 6. Textures

`TextureManager` is a name-keyed store with a data bag per texture. Pixi has neither. It accepts generated canvases and keeps CPU pixels for picking.

```ts
export interface SjFrame { readonly name: string | number; readonly x: number; readonly y: number; readonly w: number; readonly h: number; }
export interface SjTexture {
  readonly key: string; readonly width: number; readonly height: number;
  readonly frames: ReadonlyMap<string | number, SjFrame>;
  data: Record<string, unknown>;                       // Phaser customData: feet, face, bounds
  readonly cpu?: Raw;                                  // CPU pixels for picking
}
export declare class TextureManager {
  exists(key: string): boolean;
  get(key: string): SjTexture;
  getTextureKeys(): string[];
  addCanvas(key: string, canvas: HTMLCanvasElement, opts?: { cpu?: Raw }): SjTexture;   // nearest, skipCache
  addCanvasOnce(key: string, build: () => HTMLCanvasElement | Raw): SjTexture;          // ours. The spike's entry point
  addFrames(key: string, frames: Record<string | number, [x: number, y: number, w: number, h: number]>): void;
  createCanvas(key: string, w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; refresh(): void };
  variantOf(key: string, newKey: string, paint: (src: HTMLCanvasElement) => HTMLCanvasElement): SjTexture;   // ours. Copies frames
  remove(key: string): boolean;                        // destroy(true) once per source
  prune(prefix: string, inUse: ReadonlySet<string>): number;      // ours
  getPixelAlpha(x: number, y: number, key: string, frame?: string | number): number;
  setStandIn(pattern: RegExp, paint: (key: string) => HTMLCanvasElement): void;   // ours
}
```

---

## 7. Loader and assets

`scene.load` fills a game-level cache. Any scene reads an asset by key. Pixi `Assets` does the fetch and decode. Pixi rejects on failure, so the loader catches and falls back to a code-drawn stand-in with a notice.

While a scene is `loading`, the scene below it stays on the screen. If no scene is below, the engine draws a small `LoadingScene` (proposed). The `progress` event feeds it. The loader has no glTF type. A `Scene3D` loads glTF with Three's `GLTFLoader` inside the lazy 3D chunk. It disposes the result in `finally` (frame-and-rendering.md section 7.2, rule 8).

```ts
export interface LoadFile { key: string; url: string; }
export declare class Loader {
  image(key: string, url: string): this;
  spritesheet(key: string, url: string, cfg: { frameWidth: number; frameHeight: number }): this;
  json(key: string, url: string): this;
  bundle(name: string, files: LoadFile[]): this;       // ours. Unity Addressables idea
  start(): void;
  on(ev: 'progress', fn: (fraction: number) => void): this;       // 0 to 1
  once(ev: 'complete' | 'loaderror', fn: (...a: any[]) => void): this;
  unloadBundle(name: string): Promise<void>;           // ours
}
export declare class CacheManager {                    // on demand
  readonly json: { get(key: string): unknown; exists(key: string): boolean };
}
```

The 10 second timeout and the per-asset stand-in path from `src/art/drawn.ts` stay. In Vite, an unknown path returns 200 with `text/html`, so "not JSON" counts as missing.

---

## 8. Input actions

Phaser has no action map. This follows Godot `InputMap` and Unity action maps. Semantics match `src/engine/input.ts` today: nine actions, one-tick presses, repeat after 16 ticks then every 4, `consume()` on every scene push and pop.

```ts
export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'menu' | 'dash' | 'fullscreen';
export interface ActionMap {                           // ours
  justPressed(a: Action): boolean;                     // true for exactly one tick. Taps shorter than a tick are kept
  justReleased(a: Action): boolean;
  isDown(a: Action): boolean;
  repeat(a: Action): boolean;
  dir(): Action | null;                                // most recently pressed direction
  consume(): void;
}
export interface SceneInput {
  readonly actions: ActionMap;
  context: string;                                     // ours. Unity action-map idea. Stops parallel scenes taking keys
  /** Dev and editor builds only. */
  on?(ev: 'pointerdown' | 'pointermove' | 'pointerup', fn: (p: { x: number; y: number }) => void): void;
}
export interface InputManager {                        // ours. Today's surface in src/engine/input.ts
  readonly actions: ActionMap;
  lastDevice: InputDevice;                             // 'keyboard' | 'gamepad' | 'touch'. Picks the on-screen hint text
  /** Rebind. Returns null if the change would leave an action with no key. */
  bind(a: Action, code: string, custom: Partial<Record<Action, string>>): Partial<Record<Action, string>> | null;
  applyCustom(custom: Partial<Record<Action, string>>): void;
  captureNext(cb: (code: string) => void): void;       // the next key press goes to cb. The game does not see it
  keysFor(a: Action): string[];
  keyName(a: Action, count?: number): string;          // hint text such as "Z"
  setTouch(a: Action, down: boolean): void;            // the touch overlay presses actions
}
```

Custom keys persist in `settings` (`src/game/settings.ts`). Gamepad and touch use fixed maps. `bind` rejects a conflict by returning `null`. `captureNext` swallows the key, so the rebind screen does not trigger a game action.

---

## 9. Audio bridge

The WebAudio synth does not change. `game.audio` is a thin typed wrapper over `src/audio`. Scenes may import it from one place. Pixi sound is not used. Named buses (Godot `AudioServer`, Unity mixer snapshots) are a later option.

Lifecycle rules. The first one is today's behaviour. The others are proposed. Check them at M1.

- **Unlock.** `unlock()` in `src/audio/engine.ts` runs inside the player's first key press (browser autoplay policy). The new `Input` keeps that call.
- **Hidden tab.** The sequencer uses `setInterval`, which browsers slow down in a hidden tab. Proposed: suspend the `AudioContext` when the tab hides, if the test at M1 shows that sound plays on.
- **Catch-up ticks.** Up to 5 ticks can run in one frame. Proposed: `audio.sfx` merges calls with the same name inside one frame.
- **3D mode.** Audio uses the same bridge. Three audio is not used.
- **Speed.** `game.speed` and `Clock.timeScale` do not change audio.

```ts
export interface AudioBridge {                         // ours
  sfx(name: string, pitch?: number): void;             // src/audio/sfx.ts
  music(name: string | null, fade?: number, fadeIn?: number): void;   // src/audio/music.ts
  pushMusic(name: string): void;
  popMusic(): void;
  duck(on: boolean): void;                             // dialogue ducking
}
```

---

## 10. Events and signals

`EventEmitter` has Phaser's names. The third argument is Phaser's `context`. We add one rule: if the context is a `GameObject` or a `Scene`, the connection ends when that object is destroyed (Godot "call down, signal up"). `Signal` is a smaller typed class for engine objects. It is on demand (E21).

```ts
export declare class EventEmitter<M extends { [K in keyof M]: (...a: any[]) => void } = Record<string, (...a: any[]) => void>> {   // this form accepts an interface such as SceneEvents
  on<K extends keyof M>(e: K, fn: M[K], ctx?: unknown): this;     // ctx with `destroyed` ends the link on destroy (ours)
  once<K extends keyof M>(e: K, fn: M[K], ctx?: unknown): this;
  off<K extends keyof M>(e: K, fn?: M[K], ctx?: unknown): this;
  emit<K extends keyof M>(e: K, ...a: Parameters<M[K]>): boolean;
}
export declare class Signal<A extends unknown[] = []> {         // ours. On demand
  connect(fn: (...a: A) => void, owner?: { readonly destroyed: boolean }): () => void;
  emit(...a: A): void;
  wait(): Promise<A>;                                  // rejects with Cancelled if the owner is destroyed
}
export declare class DataManager {                     // on demand. Engine-level values only. GameState stays in state.ts
  set(key: string, v: unknown): this; get<T>(key: string): T | undefined;
  readonly events: EventEmitter;                       // 'changedata-<key>'
}
```

---

## 11. Clock, tweens, timelines

All three are scene-scoped and die with the scene. Durations are in milliseconds and convert to whole ticks. Awaitable members reject with `Cancelled` at shutdown (E11).

```ts
export class Cancelled extends Error {}                // ours
export const ignoreCancel: (e: unknown) => void;       // ours

export declare class Clock {                           // on demand
  timeScale: number;
  delayedCall(ms: number, fn: () => void, args?: unknown[], scope?: unknown): TimerEvent;   // Phaser: (delay, callback, args, callbackScope)
  addEvent(cfg: { delay: number; loop?: boolean; repeat?: number; callback: () => void }): TimerEvent;
  wait(ms: number): Promise<void>;                     // ours. Rejects with Cancelled
}
export interface TweenConfig {
  targets: object | object[]; duration: number; ease?: string; delay?: number;
  yoyo?: boolean; repeat?: number; onComplete?: () => void;
  [prop: string]: unknown;                             // the properties to tween
}
export declare class Tween { stop(): void; readonly finished: Promise<void>; }   // finished is ours
export declare class TweenManager {                     // on demand
  add(cfg: TweenConfig): Tween;
  chain(steps: TweenConfig[]): Tween;
  addCounter(cfg: { from: number; to: number; duration: number; onUpdate: (v: number) => void }): Tween;
}
export interface TimelineStep { at: number; run: () => void; }   // Phaser: scene.add.timeline([{ at, run }])
export declare class Timeline { play(): this; stop(): this; }
```

---

## 12. The 3D mode: View3D, Frame3D, Scene3D, HackResult

`Frame3D` hides how the 3D picture reaches Pixi: through the shared context, or through a canvas copy. `View3D` is the sprite that shows it. `Scene3D` is a `Scene` that owns a Three scene for one session. Inside `create3D`, Three names stay unchanged, so the Three docs apply.

```ts
export interface Frame3D {                             // ours
  readonly sprite: View3D;                             // goes into any display list
  render(): void;                                      // one frame: GlHandoff + three.render
  rewrap(): void;                                      // after a resize or a context restore
  readonly mode: 'shared-context' | 'canvas-copy';
  dispose(): void;
}
export declare class View3D extends ImageObject {       // ours. A Sprite over an ExternalSource
  readonly frame: Frame3D;
}

export type HackResult =
  | { status: 'success'; data?: unknown }
  | { status: 'fail'; data?: unknown }
  | { status: 'aborted'; reason: 'context-lost' | 'user' | 'error' }
  | { status: 'unsupported'; reason: 'no-webgl2' | 'chunk-failed' };

export interface ThreeHost {                           // ours. In the lazy chunk. One per game
  /** Created once, with `{ canvas, context: gl }`. Never call setSize, setViewport, or setPixelRatio on it. */
  readonly renderer: import('three').WebGLRenderer;
}

export declare abstract class Scene3D<R> extends Scene<R> {      // lazy chunk
  protected frame: Frame3D;
  abstract create3D(three: typeof import('three')): void;       // build the Object3D graph, camera, lights
  abstract update3D(tick: number): void;                        // fixed tick: pure sim in
  abstract sync3D(): void;                                      // prerender: sim state out into Object3D
}

// Scene3D implements fixedUpdate as update3D(tick). It calls sync3D() from the scene's prerender event.
// A subclass does not override fixedUpdate.
//
// ScriptApi (src/game/script.ts) gains one method:
//   hack(def: HackDef): Promise<HackResult>;
// It uses the same door as shop() and battle(): a late-bound entry in fieldHooks.
```

The hack simulation (node maze, ICE movement, camera rig) is pure and DOM-free in `src/hack3d/sim`. It runs in Vitest like `src/battle`.

---

## 13. Display, GL, and the migration seam

`Display` chooses the integer scale in device pixels. `GlContext` owns the one WebGL2 context. `GlHandoff` is the only module that moves between Three, Pixi, and raw GL. `GameApi` is the seam that lets story code run on the legacy engine and the new one during the migration.

```ts
export interface Display {                             // Phaser ScaleManager name. Unity Pixel Perfect Camera behaviour
  readonly k: number; readonly cssZoom: number; mode: 'integer' | 'fit';
  toGame(clientX: number, clientY: number): { x: number; y: number };
  on(ev: 'resize', fn: () => void): void;
}
export interface GlContext {                           // ours
  readonly gl: WebGL2RenderingContext; readonly canvas: HTMLCanvasElement; readonly lost: boolean;
  on(ev: 'lost' | 'restored', fn: () => void): void;
}
export declare function probeWebGL2(): boolean;          // calls getContext, not typeof
export interface GlHandoff {                           // ours
  beginThree(three: unknown): void;                    // three.resetState()
  endThree(three: unknown): void;                      // three.resetState(); gl.clearColor(0,0,0,0)
  beginPixi(): void;                                   // pixi.resetState()
}

/** Story code and scenes type against this. The legacy Game and the new Game both implement it. */
export interface GameApi {
  run<R>(s: Scene<R> | LegacyScene<R>): Promise<R>;
  wait(frames: number): Promise<void>;
  fadeTo: Game['fadeTo']; shake: Game['shake']; flash: Game['flash'];
  readonly top: unknown; readonly tick: number; speed: number;
}
```

`LegacyScene` has today's shape: `enter`, `exit`, `resume`, `update()`, `render(ctx)`, `opaque`, `curtain`, `passUpdate`, `close(result)`. It owns a 480x270 `CanvasImage` and calls `render(ctx)` into it each frame. See [migration.md](migration.md).

---

## 14. Dev and test hook

`__SJ__` stays dev only. The shipped build must not expose it (`e2e/prod.spec.ts` checks this). Most current members keep their meaning. Three members name the old engine and need a new home (table below the code).

```ts
export interface SjHook {
  // Existing members keep their names and meaning. See src/boot.ts:
  //   game, top, state, tp(map, x, y, dir?), battle(enc, bg?, boss?), field, idle, version, build,
  //   newGame, stage, say, shop, run, save, toTitle, toField, ending, debug, fx
  // new
  hooks: {                                             // replaces patching game.tick, top.update, and top.render
    onTick(fn: (tick: number) => void): () => void;    // after the scenes update. Returns an unsubscribe function
    onFrame(fn: () => void): () => void;               // in the draw phase
  };
  tree(): SceneDump;                                   // JSON: label, class, x, y, depth, visible, texture key, filters, Pixi node type
  step(n: number): void;                               // n ticks with fixed dt, then one frame
  frameHash(): string;
  pixels(r?: Rect): { w: number; h: number; data: Uint8Array };
  glCounts(): { texture: number; buffer: number; program: number; vao: number; framebuffer: number };
  renderer: { name: string; fxLevel: FxLevel; contextLost: boolean };
  forceContextLoss(): void; forceContextRestore(): void;
}
```

| Today's member | New home |
|---|---|
| `display` | `game.scale` (`Display`). The members that the specs use keep their names. |
| `postfx` | `game.fx` (`FxSystem`). Same method names and signatures. |
| `gpu(on)` | Sets `settings.fxLevel` (`full` for `true`, `none` for `false`). `e2e/gpufx.spec.ts` reads `__SJ__.renderer.fxLevel`. |
