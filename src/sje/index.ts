/**
 * The engine facade (docs/engine/README.md section 4, level 4): the one file that game code and the
 * lab import. Everything under src/sje is reached through here, except the lazy 3D chunk
 * (`src/sje/three/index.ts`), which loads Three.js and so has its own door.
 *
 * M8a adds the UI kit (`src/sje/ui`: TextObject, NineSlice, ListMenu, Bar, Cursor).
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
export { Camera, type CameraBounds, CameraManager, type PanEase } from './display/camera';
export { CanvasImage } from './display/canvasimage';
export { Container } from './display/container';
export * from './display/font';
export { type FxCounts, type FxRequest, FxSystem } from './fx/fxsystem';
export { colorMatrixEffect, createEffect, type Effect, type EffectSpec, FilterList, type UniformType } from './display/effects';
export { DEPTH, depthFor, PART } from './display/depth';
export { type DisplayHost, GameObject } from './display/gameobject';
export { Graphics } from './display/graphics';
export { flickerAmount, type FlickerLook, LIGHT_RES, type Light, type LightHandle, type LightOptions, Lights, type LightSpriteMaker } from './display/lights';
export { ImageObject } from './display/imageobject';
export { Screen, type ScreenSlot } from './display/screen';
export { Sprite } from './display/sprite';
export { canvasToRaw, type Raw, rawToCanvas, type SjFrame, type SjTexture, TextureManager } from './display/texturemanager';
export type { Pixels } from './render/backbuffer';
export { probeWebGL2 } from './render/glcontext';
export type { FrameTexture } from './render/frametexture';
export { Display, type PageDisplay, type ScaleTarget } from './runtime/display';
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
export { type LegacyCompat, SHAKE_PIXEL_GAIN } from './runtime/screenfx';
export { Bar, type BarGhost, type BarRect, barRects } from './ui/bar';
export { Cursor, type CursorKind, cursorNudge, moreVisible } from './ui/cursor';
export { type ListAction, type ListInput, type ListItem, ListMenu, type ListResult, type RowGeometry, listRows, scrollFor, stepIndex, type UiSound } from './ui/listmenu';
export { NineSlice, paintTab, paintWindow, type WindowBounds, type WindowStyle, windowBounds } from './ui/nineslice';
export { type BarParams, type CursorParams, hpColor, keyLegend, type ListParams, OVERLAY_DIM, OVERLAY_DIM_ALPHA, SELECT_FILL, UI, UI_DEFAULTS, type UiParams, type WindowParams } from './ui/params';
export { layoutText, paintText, type TextLayout, TextObject, type TextStyle } from './ui/textobject';
export { type Tween, type TweenConfig, TweenManager } from './runtime/tween';
