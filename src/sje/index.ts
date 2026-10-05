/**
 * The Shadow Jog Engine facade: the ONE import for game code (docs/engine/README.md section 4,
 * level 4). Game code never imports `pixi.js`, and never reaches into `src/sje/render` or
 * `src/sje/display` directly.
 *
 * `sje` means Shadow Jog Engine. Built so far (step B0 of the engine-platform spike): the kernel.
 * See docs/spikes/engine-platform.md.
 */

// Level 0: size, loop, events.
export { assert, must } from './core/assert';
export { EventEmitter } from './core/eventemitter';
export { FixedLoop, type FixedLoopHooks, type FixedLoopOptions, MAX_ELAPSED_MS, MAX_TICKS_PER_FRAME } from './core/fixedloop';
export { FPS, grain, H, TICK_MS, W } from './core/size';

// Level 2: the display list.
export { Camera, type CameraBounds, CameraManager } from './display/camera';
export { Container } from './display/container';
export { DEPTH, depthFor, PART } from './display/depth';
export { type DisplayHost, GameObject } from './display/gameobject';
export { Graphics } from './display/graphics';
export { ImageObject } from './display/imageobject';
export { Sprite } from './display/sprite';
export { type Raw, type SjFrame, type SjTexture, TextureManager } from './display/texturemanager';

// Level 1: only the plain-data type that a test reads pixels with. Game code never touches the renderer.
export type { Pixels } from './render/backbuffer';

// Level 3: the runtime.
export { Game, type GameConfig, type GameEvents, type GameParts } from './runtime/game';
// GlRenderer: for the dev lab and tests only (its readback and context-loss helpers). Game code never uses it.
export { type FrameRenderer, GlRenderer } from './runtime/glrenderer';
export { GameObjectFactory } from './runtime/gameobjectfactory';
export { Scene, type SceneEvents, type SceneStatus, type Systems } from './runtime/scene';
export { type AnyScene, computeVisibility, SceneManager } from './runtime/scenemanager';
