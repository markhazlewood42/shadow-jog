/**
 * Frame-work timing: milliseconds spent per displayed frame on simulation + render + present
 * (not the idle wait for vsync). A fixed ring buffer, so measuring allocates nothing.
 */
const N = 600;
const samples = new Float64Array(N);
let count = 0;
let head = 0;

export const perf = {
  record(ms: number): void {
    samples[head] = ms;
    head = (head + 1) % N;
    if (count < N) count++;
  },
  reset(): void {
    count = 0;
    head = 0;
  },
  /** Mean, 95th percentile and worst frame over the last (up to) 600 frames. */
  stats(): { frames: number; mean: number; p95: number; max: number } {
    if (!count) return { frames: 0, mean: 0, p95: 0, max: 0 };
    const xs = Array.from(samples.subarray(0, count)).sort((a, b) => a - b);
    const mean = xs.reduce((s, x) => s + x, 0) / count;
    return { frames: count, mean, p95: xs[Math.min(count - 1, Math.floor(count * 0.95))] ?? 0, max: xs[count - 1] ?? 0 };
  },
};
