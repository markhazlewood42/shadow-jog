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
export { colorMatrixEffect, createEffect, type Effect, type EffectSpec, FilterList, type UniformType } from './display/effects';
export { DEPTH, depthFor, PART } from './display/depth';
export { type DisplayHost, GameObject } from './display/gameobject';
export { Graphics } from './display/graphics';
export { ImageObject } from './display/imageobject';
export { Sprite } from './display/sprite';
export { type Raw, type SjFrame, type SjTexture, TextureManager } from './display/texturemanager';
export { View3D } from './display/view3d';
// A lab tool for Part A (Pixi RenderLayer with filters). Not part of the engine's API: game code does not use it.
export { RenderLayerProbe } from './display/renderlayerprobe';

// Level 1: only what game code may know about the renderer: the plain-data type a test reads pixels with,
// and the WebGL2 probe (a story asks it before it loads the 3D chunk). Game code never touches the renderer.
export type { Pixels } from './render/backbuffer';
export { probeWebGL2 } from './render/glcontext';

// Level 3: the runtime.
export { Game, type GameConfig, type GameEvents, type GameParts } from './runtime/game';
// GlRenderer: for the dev lab and tests only (its readback and context-loss helpers). Game code never uses it.
export { type FrameRenderer, GlRenderer } from './runtime/glrenderer';
export { GameObjectFactory } from './runtime/gameobjectfactory';
export { Scene, type SceneEvents, type SceneStatus, type Systems } from './runtime/scene';
export { type AnyScene, computeVisibility, SceneManager } from './runtime/scenemanager';
