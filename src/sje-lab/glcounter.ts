/**
 * Counts the GL objects that are alive (docs/engine/tooling-and-testing.md section 8, "GL-object
 * harness"). It wraps the `create*` and `delete*` methods of the WebGL2 context. An object that is
 * created and never deleted keeps the count up, so a leak shows as a count that grows when a scene
 * is entered and left again. Dev and tests only: the shipped game never loads this file.
 *
 * Call `installGlCounter()` BEFORE the context is made.
 */

export interface GlCounts {
  texture: number;
  buffer: number;
  framebuffer: number;
  renderbuffer: number;
  program: number;
  shader: number;
  vao: number;
  sampler: number;
}

const KINDS: Array<[keyof GlCounts, string, string]> = [
  ['texture', 'createTexture', 'deleteTexture'],
  ['buffer', 'createBuffer', 'deleteBuffer'],
  ['framebuffer', 'createFramebuffer', 'deleteFramebuffer'],
  ['renderbuffer', 'createRenderbuffer', 'deleteRenderbuffer'],
  ['program', 'createProgram', 'deleteProgram'],
  ['shader', 'createShader', 'deleteShader'],
  ['vao', 'createVertexArray', 'deleteVertexArray'],
  ['sampler', 'createSampler', 'deleteSampler'],
];

const live = new Map<keyof GlCounts, Set<object>>(KINDS.map(([kind]) => [kind, new Set<object>()]));
let installed = false;

export function installGlCounter(): void {
  if (installed) return;
  installed = true;
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const [kind, create, remove] of KINDS) {
    const set = live.get(kind);
    const origCreate = proto[create];
    const origRemove = proto[remove];
    if (!set || !origCreate || !origRemove) continue;
    proto[create] = function (this: unknown, ...args: unknown[]) {
      const obj = origCreate.apply(this, args);
      if (obj) set.add(obj as object);
      return obj;
    };
    proto[remove] = function (this: unknown, ...args: unknown[]) {
      if (args[0]) set.delete(args[0] as object);
      return origRemove.apply(this, args);
    };
  }
}

export function readGlCounts(): GlCounts {
  const out = {} as GlCounts;
  for (const [kind] of KINDS) out[kind] = live.get(kind)?.size ?? 0;
  return out;
}
