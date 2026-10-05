/**
 * The engine lab (DEV only, /sjelab.html): boots the Shadow Jog Engine with a sandbox scene made of
 * the game's own art, and installs `window.__SJE__`, the hook the e2e spec (e2e/sjelab.spec.ts)
 * uses to step the game deterministically and read the pixels back.
 *
 * Why a lab and not the game: the game still runs on the old Canvas 2D engine. This page is the
 * place where the NEW engine runs for real, so its pixels, its snap rules and its scene stack can
 * be checked in a browser, on a GPU and on software GL.
 */
import { assert, type Container, Game, GlRenderer, type Graphics, H, type ImageObject, must, Scene, type Sprite, W } from '../sje';
import { buildLabContent, type GroupNode, type ImageLeaf, type LabContent, type LabNode, type LineLeaf, type RectLeaf, WORLD_W } from './content';
import { installGlCounter, type GlCounts, readGlCounts } from './glcounter';
import { installHook } from './hook';

/** The sandbox scene: builds the lab's content, pans the camera slowly, and cycles the animated sprites. */
export class LabScene extends Scene<void> {
  private readonly animated: Array<{ sprite: Sprite; leaf: ImageLeaf }> = [];
  private probe: ImageObject | null = null;

  constructor(readonly content: LabContent) {
    super();
  }

  override create(): void {
    this.cameras.main.setBounds(0, 0, WORLD_W, H);
    for (const n of this.content.world) this.build(n, this.sys.world);
    // The HUD layer: not moved by the camera (it lives in `scene.ui`).
    const hud = this.add.layer({ ui: true });
    for (const n of this.content.ui) this.build(n, hud);
  }

  fixedUpdate(tick: number): void {
    // The camera takes the fractional pan and rounds it to whole pixels (snap to pixel).
    this.cameras.main.setScroll(this.content.panX(tick), 0);
    for (const { sprite, leaf } of this.animated) {
      const frame = leaf.frameAt?.(tick);
      if (frame !== undefined && sprite.frame !== frame) sprite.setFrame(frame);
    }
  }

  /** Move the probe sprite (the hook uses this to test snap to pixel). */
  setProbe(x: number, y: number): void {
    this.content.probe.x = x;
    this.content.probe.y = y;
    must(this.probe, 'the probe sprite').setPosition(x, y);
  }

  private build(node: LabNode, parent: Container): void {
    if (node.kind === 'image') parent.add(this.buildImage(node));
    else if (node.kind === 'rect') parent.add(this.buildRect(node));
    else if (node.kind === 'line') parent.add(this.buildLine(node));
    else {
      const group: GroupNode = node;
      const c = this.add.container(group.x, group.y).setDepth(group.depth);
      c.name = group.name;
      parent.add(c);
      for (const child of group.children) this.build(child, c);
    }
  }

  private buildImage(leaf: ImageLeaf): ImageObject {
    const obj = leaf.frameAt ? this.add.sprite(leaf.x, leaf.y, leaf.tex, leaf.frameAt(0)) : this.add.image(leaf.x, leaf.y, leaf.tex, leaf.frame);
    obj.setOrigin(leaf.originX, leaf.originY).setScale(leaf.scale).setFlipX(leaf.flipX).setAlpha(leaf.alpha).setDepth(leaf.depth);
    obj.name = leaf.name;
    if (leaf.frameAt) this.animated.push({ sprite: obj as Sprite, leaf });
    if (leaf === this.content.probe) this.probe = obj;
    return obj;
  }

  private buildRect(r: RectLeaf): Graphics {
    const g = this.add.graphics().setDepth(r.depth);
    g.fillStyle(r.color, r.alpha).fillRect(r.x, r.y, r.w, r.h);
    g.name = r.name;
    return g;
  }

  private buildLine(l: LineLeaf): Graphics {
    const g = this.add.graphics().setDepth(l.depth);
    g.lineStyle(1, l.color, l.alpha).lineBetween(l.x0, l.y0, l.x1, l.y1);
    g.name = l.name;
    return g;
  }
}

export interface Lab {
  game: Game;
  renderer: GlRenderer;
  content: LabContent;
  scene: LabScene;
  /** Run `n` enter-and-leave cycles of a fresh lab scene (for the leak check). */
  reenter(n: number): void;
  counts(): GlCounts;
}

/** Boot the engine and the lab scene. */
export async function startLab(): Promise<Lab> {
  const params = new URLSearchParams(location.search);
  // Count GL objects from before the context exists, so nothing is missed.
  installGlCounter();
  const parent = must(document.getElementById('stage'), '#stage');
  const game = await Game.create({ parent, dev: true });
  assert(game.renderer instanceof GlRenderer, 'the lab needs the GL renderer');
  const renderer = game.renderer;
  const content = buildLabContent();
  for (const t of content.textures) {
    game.textures.addCanvas(t.key, t.canvas);
    if (t.frames) game.textures.addFrames(t.key, t.frames);
  }
  const status = document.getElementById('status');
  // The tests screenshot the canvas: nothing may sit on top of it.
  if (status && params.has('manual')) status.style.display = 'none';
  const fitCanvas = (): void => {
    const k = renderer.fitToWindow(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    game.draw();
    if (status) status.textContent = `${W}x${H}  x${k}  dpr ${window.devicePixelRatio}  tick ${game.tick}`;
  };
  const scene = new LabScene(content);
  void game.run(scene);
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  // `?manual` leaves the clock to the tests (`__SJE__.step`). Otherwise the real 60 Hz loop runs.
  if (!params.has('manual')) {
    game.start();
    game.events.on('postrender', () => {
      if (status) status.textContent = `${W}x${H}  x${renderer.presenter.k}  dpr ${window.devicePixelRatio}  tick ${game.tick}`;
    });
  }
  const lab: Lab = {
    game,
    renderer,
    content,
    scene,
    reenter(n: number): void {
      for (let i = 0; i < n; i++) {
        const s = new LabScene(content);
        void game.run(s);
        game.step(2);
        s.close();
      }
    },
    counts: () => readGlCounts(),
  };
  window.__SJE__ = installHook(lab);
  return lab;
}

