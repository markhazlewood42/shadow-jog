/**
 * The Pixi extensions the engine uses, imported from ONE file (docs/engine/frame-and-rendering.md
 * section 6.1, item 3).
 *
 * Pixi can register everything on its own when `init` runs, but that pulls in about 30 kB (gzip)
 * we do not use (accessibility, events, spritesheets...). `skipExtensionImports: true` skips it,
 * so we add back only what the engine draws with. The sprite pipe is in Pixi's core, so a sprite
 * needs no import here. Add `pixi.js/mesh`, `particle-container`, `sprite-nine-slice` and
 * `sprite-tiling` here when a scene first uses them.
 *
 * Never import `pixi.js/accessibility`: its Tab handler would clash with the game's menu key.
 */
import 'pixi.js/filters';
import 'pixi.js/graphics';
