/**
 * What every engine filter fragment shader starts with (the same four lines `createEffect` puts in front of a game effect, see
 * display/effects.ts). Pixi 8.22 needs the vertex shader passed in as well: the caller adds `defaultFilterVert`.
 * `uInputSize` must be declared in the fragment or the shader fails and floods the console.
 */
export const FILTER_PRELUDE = 'in vec2 vTextureCoord;\nout vec4 finalColor;\nuniform sampler2D uTexture;\nuniform highp vec4 uInputSize;\n';
