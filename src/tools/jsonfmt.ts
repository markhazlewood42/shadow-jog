/**
 * The one JSON format every design tool saves in (`docs/TOOLING-UI.md` section 2.5, "Formatting stays stable").
 *
 * Why a formatter of our own: `JSON.stringify(data, null, 2)` puts every number of every array on its own line,
 * so a stage file runs to thousands of lines and one dragged fighter changes a dozen of them. This one keeps the
 * file readable in a diff: an object or array that holds only plain values (numbers, text, true/false) and fits
 * on a line is written on ONE line (`{ "x": 46, "row": 4 }`, `[12, 10]`); anything that holds other objects or
 * arrays, or is too long, gets one field per line. The same value always prints the same way, so saving without
 * changing anything changes nothing.
 *
 * The output is ordinary JSON: `JSON.parse(formatJson(x))` gives `x` back.
 */

/** How wide a line may get before an object or array is spread over several. */
export const JSON_WIDTH = 78;

const isPlain = (v: unknown): boolean => v === null || typeof v !== 'object';

/** An object or array whose values are all plain, written on one line. */
function oneLine(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!keys.length) return '{}';
  return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(', ')} }`;
}

function write(v: unknown, indent: number, width: number): string {
  if (isPlain(v)) return JSON.stringify(v) ?? 'null';
  const kids = Array.isArray(v) ? v : Object.values(v as object);
  if (kids.every(isPlain)) {
    const line = oneLine(v);
    if (line.length + indent <= width) return line;
  }
  const pad = ' '.repeat(indent + 2);
  const end = ' '.repeat(indent);
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + write(x, indent + 2, width)).join(',\n')}\n${end}]` : '[]';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!keys.length) return '{}';
  return `{\n${keys.map((k) => `${pad}${JSON.stringify(k)}: ${write(o[k], indent + 2, width)}`).join(',\n')}\n${end}}`;
}

/** The value as stable, diff-friendly JSON text with a final newline. */
export function formatJson(value: unknown, width = JSON_WIDTH): string {
  return `${write(value, 0, width)}\n`;
}
