/**
 * The one-time graphics notice (Mark, decision 59, 2026-10-11).
 *
 * When the browser draws WebGL on the CPU (SwiftShader, llvmpipe: `SOFTWARE_GL` in `src/sje/render/glcontext.ts`, the same test that makes the
 * effects level `auto` pick `lite`), the game may run slowly. The notice tells the player once that the GPU effects can be turned off in Options.
 * It changes nothing by itself: no setting, no effect level.
 *
 * "Once" means once for this browser profile: the flag is saved in localStorage the first time the notice shows. If storage is not available, the
 * flag lives in memory, so the notice shows once for each page load. The old frame-time fallback (90 frames over 40 ms turned the effects off by
 * itself) is gone since the M6 flip; an automatic version of it is a later idea (CHANGELOG, `docs/engine/m6-brief.md` Record).
 */
export const GPU_NOTICE_KEY = 'shadowjog.gpunotice.v1';

/** The words of the Options row are "GPU effects" (`src/scenes/options.ts`). Keep them the same. */
export const GPU_NOTICE_TEXT = 'This browser draws with software graphics, so the game may run slowly. You can turn off GPU effects in Options.';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

let shownInMemory = false;

/** Tests only: forget the in-memory flag. */
export function resetGpuNotice(): void {
  shownInMemory = false;
}

/**
 * Show the notice if the renderer is a software one and it has not been shown yet. Returns whether it showed.
 * `store` is `localStorage` (or null when the browser has none); `show` puts the text on screen.
 */
export function showGpuNoticeOnce(software: boolean, store: Store | null, show: (text: string) => void): boolean {
  if (!software || shownInMemory) return false;
  try {
    if (store?.getItem(GPU_NOTICE_KEY)) return false;
  } catch {
    /* storage refused: fall back to the in-memory flag */
  }
  shownInMemory = true;
  try {
    store?.setItem(GPU_NOTICE_KEY, '1');
  } catch {
    /* full or blocked: the in-memory flag still stops a second notice in this page */
  }
  show(GPU_NOTICE_TEXT);
  return true;
}
