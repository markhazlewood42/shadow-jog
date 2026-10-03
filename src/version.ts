/**
 * The game's version and the commit it was built from, for the title screen, the DEV tab and the
 * debug hooks.
 *
 * Both come from vite.config.ts as build-time "defines": Vite finds the names below in the source
 * and swaps in the real values while it builds (the tests get them too), so nothing reads a file
 * at runtime. The `declare const` lines only tell TypeScript those names exist; they produce no
 * code. If a define is ever missing the typeof checks fall back to 'dev' / 'nogit' instead of
 * throwing a ReferenceError.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;

/** The version in package.json, such as '0.1.0' or '0.2.0-dev'. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** The short git commit of the build, or 'nogit' when it was built without git. */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'nogit';

/** The one line shown on screen, such as 'v0.1.0 · abc1234'. Every character is one the bitmap font draws. */
export const VERSION_LABEL = `v${APP_VERSION} · ${BUILD_SHA}`;
