/**
 * Small helpers that the three content files share (M8a: `shops.json`, `speakers.json`, `dialogue.json`): the checks that read
 * a value of unknown type, and the one-line JSON writer that keeps a saved file easy to diff.
 */

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
export const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
/** A color as `#rrggbb`. */
export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** The ids of a shop or a speaker: lower-case words with digits and underscores. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** The fields of `rec` that are not in `allowed` (each one is a typo that would silently do nothing). */
export function unknownFields(rec: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(rec).filter((k) => !allowed.includes(k));
}

/** One JSON value on one line, with a space inside the braces and after each comma: `{ "a": 1, "b": [1, 2] }`. */
export function inlineJson(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `[${v.map(inlineJson).join(', ')}]` : '[]';
  if (isObj(v)) {
    const parts = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${inlineJson(x)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

/**
 * Write a file of the shape `{ "<top>": { "<id>": record, ... } }`, one record per line (a diff then shows only the records that
 * changed). `extra` is written before the table, as `"key": value` lines. Ends with a newline.
 */
export function tableJson(extra: Record<string, unknown>, top: string, table: Record<string, unknown>): string {
  const rows = [
    ...Object.entries(extra).map(([k, v]) => `  ${JSON.stringify(k)}: ${inlineJson(v)},`),
    `  ${JSON.stringify(top)}: {`,
  ];
  const entries = Object.entries(table);
  for (const [i, [id, rec]] of entries.entries()) rows.push(`    ${JSON.stringify(id)}: ${inlineJson(rec)}${i < entries.length - 1 ? ',' : ''}`);
  rows.push('  }', '}');
  return `{\n${rows.join('\n')}\n`;
}
