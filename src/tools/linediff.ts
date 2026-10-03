/**
 * Which lines of a text are new or different compared with an earlier version of it. The Battle Stage Editor's
 * JSON pane uses it to highlight exactly what the last drag changed ("the lines a gesture changed").
 *
 * It finds the longest run of lines the two texts share, in order (the classic "longest common subsequence"
 * that `diff` is built on); every line of the new text outside that run is reported. Both texts here are a few
 * hundred lines, so the simple table (n x m) is fast enough; for a very large pair it falls back to comparing
 * line by line, which over-reports when lines were inserted but never under-reports.
 */

/** Zero-based numbers of the lines of `after` that are not part of what it shares with `before`. */
export function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) return b.flatMap((line, i) => (a[i] === line ? [] : [i]));
  // table[i][j] = length of the common run of a[i..] and b[j..].
  const w = b.length + 1;
  const table = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? (table[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * w + j] ?? 0, table[i * w + j + 1] ?? 0);
    }
  }
  // Walk the table from the top: lines on the shared run are kept, the others of `b` are the changes.
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && (table[(i + 1) * w + j] ?? 0) >= (table[i * w + j + 1] ?? 0)) i++;
    else out.push(j++);
  }
  return out;
}
