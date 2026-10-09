/**
 * The engine facade (docs/engine/README.md section 4, level 4): the one file that game code and the
 * lab import. Everything under src/sje is reached through here, except the lazy 3D chunk
 * (`src/sje/three/index.ts`), which loads Three.js and so has its own door.
 *
 * M0 holds the parts that the lab and the canary suite test directly: core, render, display and the GL
 * renderer. M1 adds the scene runtime (`Game`, `Scene`, `SceneManager`, `LegacyScene`, `Clock`, `TweenManager`, `Loader`,
 * `GameObjectFactory`). `Scene3D` is M1b. Add each export with its module.
 */
export { assert, must } from './core/assert';
export { EventEmitter } from './core/eventemitter';
export { FixedLoop, type FixedLoopHooks, type FixedLoopOptions, MAX_ELAPSED_MS, MAX_TICKS_PER_FRAME } from './core/fixedloop';
export * from './core/rng';
export { FPS, grain, H, TICK_MS, W } from './core/size';
export { Camera, type CameraBounds, CameraManager } from './display/camera';
export { CanvasImage } from './display/canvasimage';
export { Container } from './display/container';
export { type FxCounts, type FxRequest, FxSystem } from './fx/fxsystem';
export { colorMatrixEffect, createEffect, type Effect, type EffectSpec, FilterList, type UniformType } from './display/effects';
export { DEPTH, depthFor, PART } from './display/depth';
export { type DisplayHost, GameObject } from './display/gameobject';
export { Graphics } from './display/graphics';
export { ImageObject } from './display/imageobject';
export { Screen, type ScreenSlot } from './display/screen';
export { Sprite } from './display/sprite';
export { type Raw, type SjFrame, type SjTexture, TextureManager } from './display/texturemanager';
export { View3D } from './display/view3d';
export type { Pixels } from './render/backbuffer';
export { probeWebGL2 } from './render/glcontext';
export { ExternalFrameTexture, type FrameTexture } from './render/frametexture';
export { Display, type ScaleTarget } from './runtime/display';
export { type FrameRenderer, GlRenderer } from './runtime/glrenderer';
export { Cancelled, Clock, ignoreCancel, type TimerEvent, type TimerEventConfig } from './runtime/clock';
export { FAULT_LIMIT, type FxLevel, Game, type GameConfig, type GameEvents, type GameParts } from './runtime/game';
export type { AnyLegacy, GameApi, LegacyGameSurface, LegacyShape, ShakeDirection } from './runtime/gameapi';
export { GameObjectFactory } from './runtime/gameobjectfactory';
export type { Action, ActionMap, SceneInput } from './runtime/input';
export { LegacyScene } from './runtime/legacyscene';
export { browserBackend, CacheManager, type LoadBackend, type LoadFile, Loader } from './runtime/loader';
export { Scene, type SceneEvents, type SceneStatus, type Systems } from './runtime/scene';
export { type AnyScene, computeVisibility, SceneManager } from './runtime/scenemanager';
export type { LegacyCompat } from './runtime/screenfx';
export { type Tween, type TweenConfig, TweenManager } from './runtime/tween';
