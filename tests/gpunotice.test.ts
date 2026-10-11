/**
 * The one-time graphics notice (src/game/gpunotice.ts, decision 59): it shows once on a software renderer, never on a normal GPU,
 * and it changes no setting. The renderer names are real ones from the field.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GPU_NOTICE_KEY, GPU_NOTICE_TEXT, resetGpuNotice, showGpuNoticeOnce } from '../src/game/gpunotice';
import { settings } from '../src/game/settings';
import { SOFTWARE_GL } from '../src/sje/render/glcontext';

/** A Storage that keeps its values in a Map. */
function memoryStore(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const SOFTWARE = ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver'];
const GPUS = ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'webgl2'];

beforeEach(() => resetGpuNotice());

describe('the renderer test the notice uses', () => {
  it.each(SOFTWARE)('treats "%s" as software', (name) => expect(SOFTWARE_GL.test(name)).toBe(true));
  it.each(GPUS)('treats "%s" as a normal GPU', (name) => expect(SOFTWARE_GL.test(name)).toBe(false));
});

describe('showGpuNoticeOnce', () => {
  it('shows once on a software renderer, with the Options hint, then never again in this browser', () => {
    const store = memoryStore();
    const shown: string[] = [];
    expect(showGpuNoticeOnce(true, store, (t) => shown.push(t))).toBe(true);
    expect(shown).toEqual([GPU_NOTICE_TEXT]);
    expect(GPU_NOTICE_TEXT).toMatch(/turn off GPU effects in Options/);
    expect(store.data.get(GPU_NOTICE_KEY)).toBe('1');
    // The same page, and then a later visit (a new page load forgets the memory flag, not the saved one).
    expect(showGpuNoticeOnce(true, store, (t) => shown.push(t))).toBe(false);
    resetGpuNotice();
    expect(showGpuNoticeOnce(true, store, (t) => shown.push(t))).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it('does not show on a normal GPU, and does not save the flag', () => {
    const store = memoryStore();
    const shown: string[] = [];
    expect(showGpuNoticeOnce(false, store, (t) => shown.push(t))).toBe(false);
    expect(shown).toEqual([]);
    expect(store.data.size).toBe(0);
    // Control: the same store and the same call with a software renderer does show.
    expect(showGpuNoticeOnce(true, store, (t) => shown.push(t))).toBe(true);
  });

  it('shows once per page when storage is missing or refuses', () => {
    const shown: string[] = [];
    expect(showGpuNoticeOnce(true, null, (t) => shown.push(t))).toBe(true);
    expect(showGpuNoticeOnce(true, null, (t) => shown.push(t))).toBe(false);
    resetGpuNotice();
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(showGpuNoticeOnce(true, refusing, (t) => shown.push(t))).toBe(true);
    expect(showGpuNoticeOnce(true, refusing, (t) => shown.push(t))).toBe(false);
    expect(shown).toHaveLength(2);
  });

  it('changes no setting by itself', () => {
    const before = JSON.stringify(settings);
    showGpuNoticeOnce(true, memoryStore(), () => undefined);
    expect(JSON.stringify(settings)).toBe(before);
  });
});
