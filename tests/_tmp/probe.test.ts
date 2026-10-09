import { describe, expect, it } from 'vitest';
import { Game } from '../../src/sje/runtime/game';
import { Scene } from '../../src/sje/runtime/scene';

const fakeCtx = new Proxy({}, { get: () => () => undefined, set: () => true });
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeCtx }),
};
class S extends Scene<number> {
  fixedUpdate(): void {}
}
describe('probe', () => {
  it('runs a native scene in node', async () => {
    const input = { update() {}, endFrame() {}, consume() {} } as never;
    const g = new Game({ renderer: { render() {} }, input });
    const s = new S();
    const p = g.run(s);
    g.advanceTick();
    s.add.canvasImage(0, 0, 4, 4).refresh();
    g.draw();
    s.close(5);
    expect(await p).toBe(5);
  });
});
