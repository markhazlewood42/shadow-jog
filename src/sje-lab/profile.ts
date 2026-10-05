/**
 * Frame-cost profiling for the lab's speed test (spike step B2, the speed line; round 4).
 *
 * WHY THIS FILE EXISTS. The first speed test timed only JavaScript (`performance.now()` around the engine's tick and draw). On a GPU the
 * draw call only SUBMITS commands, so that number says nothing about what the GPU costs, and the frame-interval check cannot fail on a
 * display that is locked to its refresh rate. This file measures the cost of a frame in three ways, from the least to the most direct:
 *
 *   `work`   JavaScript time of tick + draw submit (what the first test measured). A CPU number.
 *   `cost`   (option `sync`) the same, plus the wait for the GPU to FINISH, forced by reading one pixel back (`readPixels` cannot return
 *            until every earlier command has run). It is the whole cost of the frame done one thing after the other: an upper bound on
 *            the real frame cost, because in the real loop the CPU and the GPU overlap. `gl.finish()` is NOT used: in Chromium it
 *            can return before the work is done (it measured 0.19 ms for a frame the read-back timed at several ms).
 *   `gpu`    (option `gpuTimer`) the GPU's own clock, from `EXT_disjoint_timer_query_webgl2`, if the browser offers it. It covers every
 *            command of the draw (Pixi and Three share the context, so one query sees both). `null` when the browser hides the extension.
 *
 * The negative control (option `extraRenders`) draws the 3D frame that many extra times per frame, a load that is certainly too heavy,
 * so a test can show that its own speed line FAILS when the cost is too high.
 */
import type { Game } from '../sje';

export interface ProfileOptions {
  /** Wait for the GPU after each draw (see `cost`). Adds a stall: use it in a run of its own, not together with the interval check. */
  sync?: boolean;
  /** Time each draw with the GPU's own timer (`gpu`). Needs `EXT_disjoint_timer_query_webgl2`. */
  gpuTimer?: boolean;
  /** Draw the 3D frame this many EXTRA times per frame. The negative control. Needs a running hack. */
  extraRenders?: number;
}

export interface ProfileResult {
  /** Time between animation frames, ms. */
  intervals: number[];
  /** JavaScript time of the engine's work in each frame (ticks + draw), ms. */
  work: number[];
  /** With `sync`: the work PLUS the wait for the GPU, ms. Otherwise empty. */
  cost: number[];
  /** With `gpuTimer`: the GPU's time for each draw, ms. Empty if the extension is missing or the timer was disjoint. */
  gpu: number[];
  /** Did the browser give us a GPU timer? */
  gpuTimerAvailable: boolean;
}

/** A GPU timer query that has been issued and not yet read. */
interface Pending {
  query: WebGLQuery;
}

/** Wrap the engine's tick and draw for `frames` animation frames of the real loop, and give back what was measured. */
export function profileLoop(
  game: Game,
  gl: WebGL2RenderingContext,
  /** Draws the running 3D scene's frame once more (the negative control), or null when no 3D scene is up. */
  drawExtraFrame: (() => void) | null,
  /** Waits for the GPU. Goes through `GlHandoff`, the one place that reads raw GL (it reads one pixel back). */
  waitForGpu: () => void,
  frames: number,
  options: ProfileOptions = {},
): Promise<ProfileResult> {
  const timer = options.gpuTimer ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const result: ProfileResult = { intervals: [], work: [], cost: [], gpu: [], gpuTimerAvailable: timer !== null };
  const pending: Pending[] = [];

  /** Read the timer queries the GPU has finished (never wait for one: that would stall the loop). */
  const collect = (): void => {
    const disjoint = timer ? (gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean) : false;
    while (pending.length) {
      const p = pending[0];
      if (!p || !gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      // A disjoint event (the GPU was reset, or changed clock) makes every pending result meaningless: drop it.
      if (!disjoint) result.gpu.push(Number(gl.getQueryParameter(p.query, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(p.query);
    }
  };

  return new Promise((resolve) => {
    // The loop calls these two entry points each frame. A frame's work is the sum of its ticks and its draw.
    let acc = 0;
    const tick = game.advanceTick.bind(game);
    const draw = game.draw.bind(game);
    game.advanceTick = () => {
      const t = performance.now();
      tick();
      acc += performance.now() - t;
    };
    game.draw = (alpha?: number) => {
      const t = performance.now();
      const query = timer ? gl.createQuery() : null;
      if (timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      try {
        for (let i = 0; i < (options.extraRenders ?? 0); i++) drawExtraFrame?.();
        draw(alpha);
      } finally {
        // End the query even when a draw throws: an open TIME_ELAPSED query makes the next `beginQuery` an error (INVALID_OPERATION) and no later frame is measured.
        if (timer && query) {
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          pending.push({ query });
        }
      }
      const submitted = performance.now();
      result.work.push(acc + (submitted - t));
      if (options.sync) {
        // One pixel read back: it cannot be answered before the GPU has run everything before it.
        waitForGpu();
        result.cost.push(acc + (performance.now() - t));
      }
      acc = 0;
      if (timer) collect();
    };
    let last = performance.now();
    const frame = (now: number): void => {
      result.intervals.push(now - last);
      last = now;
      if (result.intervals.length < frames) requestAnimationFrame(frame);
      else {
        game.advanceTick = tick;
        game.draw = draw;
        // Give the GPU a few frames to answer the last timer queries.
        const finish = (left: number): void => {
          if (timer) collect();
          if (left > 0 && pending.length) requestAnimationFrame(() => finish(left - 1));
          else {
            for (const p of pending) gl.deleteQuery(p.query);
            resolve(result);
          }
        };
        finish(10);
      }
    };
    requestAnimationFrame(frame);
  });
}
