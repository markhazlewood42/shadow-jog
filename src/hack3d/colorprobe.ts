/**
 * ColourProbeScene: the smallest 3D scene there is, for ONE job: to prove a colour written in the Three
 * code reaches the picture unchanged (docs/engine/frame-and-rendering.md 7.5, "Color").
 *
 * With Three's default colour management, a colour such as #ff2080 comes out of a render target as
 * #ff0437 (lab, research finding 13): Three converts it to linear light and never converts it back. The
 * engine switches colour management off (`ThreeHost`) so that a palette colour is the palette colour.
 * This scene shows two flat areas, side by side, drawn two ways:
 *   left half   the scene BACKGROUND colour (what Three clears the target with)
 *   right half  an unlit `MeshBasicMaterial` colour (what a material draws)
 * The e2e spec reads the 3D picture and the screen and expects exactly the two numbers it asked for.
 *
 * Not part of the game: the lab starts it through its test hook.
 */
import { Color, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry } from 'three';
import { Scene3D, type Scene3DAbort, type Scene3DOptions } from '../sje/three';

export class ColourProbeScene extends Scene3D<void> {
  constructor(
    private readonly background: number,
    private readonly plane: number,
    options?: Scene3DOptions,
  ) {
    super(options);
  }

  protected create3D(): void {
    this.threeScene.background = new Color(this.background);
    // A flat 2-by-2 view straight on: x from -1 (left edge) to +1 (right edge), y from -1 to +1.
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.set(0, 0, 2);
    // A plane that covers the right half of the view.
    const right = new Mesh(new PlaneGeometry(1, 2), new MeshBasicMaterial({ color: new Color(this.plane) }));
    right.position.set(0.5, 0, 0);
    this.threeScene.add(right);
  }

  protected update3D(): void {}
  protected sync3D(): void {}
  protected abortResult(_reason: Scene3DAbort): void {}
}
