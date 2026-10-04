/**
 * Frame-time numbers for the stage lab (Phaser spike, `spike/phaser-stage`).
 *
 * Two different things get measured, because they answer different questions:
 *  - the **interval** between frames (how long the player waits: 16.7 ms at 60 fps), and
 *  - the **work** per frame (how much of that the CPU spent updating and drawing, which is what the
 *    exit criterion "p95 under 6 ms" is about; the rest is waiting for the next screen refresh).
 * "p95" means the 95th percentile: 95 frames in 100 were at least this fast. It shows the occasional
 * slow frame an average hides.
 */

/** The p-th percentile (0 to 100) of a list of numbers, by nearest rank. 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

export interface FrameSummary {
  frames: number;
  intervalP50: number;
  intervalP95: number;
  workP50: number;
  workP95: number;
}

/** A rolling record of the last `keep` frames. */
export class FrameStats {
  private readonly intervals: number[] = [];
  private readonly work: number[] = [];
  private lastTime = -1;
  private stepStart = 0;

  constructor(private readonly keep = 900) {}

  /** Call at the start of a frame with the frame's timestamp (ms). */
  begin(time: number): void {
    if (this.lastTime >= 0) this.push(this.intervals, time - this.lastTime);
    this.lastTime = time;
    this.stepStart = performance.now();
  }

  /** Call when the frame has been drawn. */
  end(): void {
    this.push(this.work, performance.now() - this.stepStart);
  }

  private push(list: number[], v: number): void {
    list.push(v);
    if (list.length > this.keep) list.shift();
  }

  /** Forget everything (to measure a stretch from now). */
  reset(): void {
    this.intervals.length = 0;
    this.work.length = 0;
    this.lastTime = -1;
  }

  summary(): FrameSummary {
    return {
      frames: this.work.length,
      intervalP50: percentile(this.intervals, 50),
      intervalP95: percentile(this.intervals, 95),
      workP50: percentile(this.work, 50),
      workP95: percentile(this.work, 95),
    };
  }
}
