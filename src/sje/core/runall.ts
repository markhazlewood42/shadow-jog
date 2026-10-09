/**
 * Run every step, even when an earlier one throws, and then throw the FIRST error. A dispose is a row of independent frees (the
 * Pixi side, then the Three side): one that fails must not skip the rest, or the GPU objects behind it leak for good, because an
 * object that is flagged as disposed cannot be disposed again. `Frame3D.dispose` and `Scene3D`'s shutdown both use it.
 */
export function runAll(steps: ReadonlyArray<() => void>): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (e) {
      errors.push(e);
    }
  }
  if (errors.length) throw errors[0];
}
