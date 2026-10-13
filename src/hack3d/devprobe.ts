/**
 * DEV and tests only (M7 pass line 13: "a Three color #ff2080 reaches the screen as written"): put one flat quad of an exact color in front of the camera of a running
 * hack scene, so an e2e test can read the screen pixel behind it. The body is behind `import.meta.env.DEV`, so a shipped build holds none of it.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry, type PerspectiveCamera, type Scene } from 'three';

/** The scene shape this needs from a `HackScene` (its Three root and its camera are protected members; the hook passes the running scene). */
export interface ProbeTarget {
  world3D: Scene;
  camera3D: PerspectiveCamera | null;
}

/** Add the quad (3 units in front of the camera, large enough to cover the picture center). Returns a function that removes and frees it. */
export function devColorQuad(target: ProbeTarget, color: number): () => void {
  if (!import.meta.env.DEV) return () => undefined;
  const cam = target.camera3D;
  if (!cam) throw new Error('the scene has no camera yet');
  const geo = new PlaneGeometry(8, 8);
  const mat = new MeshBasicMaterial({ color, fog: false });
  const quad = new Mesh(geo, mat);
  quad.position.copy(cam.position);
  quad.quaternion.copy(cam.quaternion);
  quad.translateZ(-3);
  target.world3D.add(quad);
  return () => {
    target.world3D.remove(quad);
    geo.dispose();
    mat.dispose();
  };
}
