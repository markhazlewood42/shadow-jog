/**
 * GPU effects, as the game sees them. Scenes ask for moments (a shockwave where a blow lands, a
 * colour split on a critical, a burst of embers), draw what should glow into the glow layer, and
 * draw their UI into the UI layer; the WebGL presenter (engine/gl/presenter.ts) turns all of it
 * into the final frame. With GPU effects off (Options) or no WebGL, `active` is false, every call
 * here does nothing, and the game draws exactly as it did before this layer existed.
 *
 * Coordinates are the back buffer's (W×H from engine/game.ts, y down). Durations are frames at 60/s.
 */
import { FxState } from '../sje/fx/fxstate';

// The state moved to src/sje/fx/fxstate.ts (M2), so the new effects system shares it. Everything this file exported stays exported.
export { envelope, type Glitch, type Haze, MAX_GLITCHES, MAX_HAZES, MAX_SHOCKS, type Shock } from '../sje/fx/fxstate';

export class PostFx extends FxState {}

export const postfx = new PostFx();
