/**
 * The 3D facade: the ONE import of the lazy 3D chunk (docs/engine/README.md section 4). Code in
 * `src/hack3d` (M7) and the lab import from here and from `src/sje/index.ts`, never from the files
 * under `src/sje/three/` directly.
 *
 * Nothing outside the lazy chunk may import this file: it pulls in Three.js. The game reaches it
 * only through one dynamic `import()` (the way `s.hack` loads `src/hack3d`).
 */
export { disposeObject3D, releaseGpuData } from './dispose';
export { type BloomSettings, createFrame3D, frame3dTestSeams, type Frame3D, type Frame3DMode, type Frame3DPreference, type Frame3DSetup } from './frame3d';
export { hostsCreated, ThreeHost, type ThreeHostKind } from './threehost';
// `Scene3D` (src/sje/three/scene3d.ts in the spike) comes with the scene runtime: M1b builds it on `Scene`. M0 has frames only.
